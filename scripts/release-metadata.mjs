import fs from "node:fs";
import process from "node:process";

function strictVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`version is not strict semver: ${version}`);
  return match.slice(1).map(Number);
}

function releaseTagPattern(releasePrefix) {
  const escapedPrefix = releasePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = escapedPrefix ? `${escapedPrefix}-` : "";
  return new RegExp(`^${prefix}v(\\d+)\\.(\\d+)\\.(\\d+)$`);
}

/**
 * The bump a set of commit subjects and bodies asks for.
 *
 * Conventional Commits, read conservatively: `feat` is a minor, a `!` before
 * the colon or a `BREAKING CHANGE` footer is a major, and everything else —
 * including a subject that is not conventional at all — is a patch.
 *
 * Unrecognized means patch rather than an error on purpose. A repository that
 * opts into this strategy still has old commits, and refusing to compute a
 * version because someone wrote "wip" is a worse failure than under-bumping.
 * Under-bumping is also the safe direction: a consumer pinned to `^1.2` is not
 * broken by receiving 1.2.4 when 1.3.0 was meant, only by the reverse.
 */
export function bumpFromCommits(messages = []) {
  let bump = "patch";

  for (const message of messages) {
    if (typeof message !== "string" || message.trim() === "") continue;

    const [subject, ...rest] = message.split("\n");
    const body = rest.join("\n");

    // `BREAKING CHANGE:` / `BREAKING-CHANGE:` in a footer, per the spec.
    if (/^BREAKING[ -]CHANGE:/m.test(body)) return "major";

    // type(scope)!: description — the `!` marks a breaking change.
    const header = /^([a-zA-Z]+)(\([^)]*\))?(!)?:/.exec(subject.trim());
    if (!header) continue;

    if (header[3]) return "major";
    if (header[1].toLowerCase() === "feat") bump = "minor";
  }

  return bump;
}

const BUMPS = new Set(["major", "minor", "patch"]);

export function nextReleaseVersion(
  packageVersion,
  releaseTags = [],
  releasePrefix = "",
  bump = "patch",
) {
  if (!BUMPS.has(bump)) {
    throw new Error(`bump must be major, minor, or patch: ${bump}`);
  }
  const pattern = releaseTagPattern(releasePrefix);
  const versions = releaseTags
    .map((tag) => pattern.exec(tag))
    .filter(Boolean)
    .map((match) => match.slice(1).map(Number));
  if (versions.length === 0) versions.push(strictVersion(packageVersion));
  versions.sort((left, right) => {
    for (let index = 0; index < 3; index += 1) {
      if (left[index] !== right[index]) return right[index] - left[index];
    }
    return 0;
  });
  const [major, minor, patch] = versions[0];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** NUL-delimited commit records, or none when the file is absent or empty. */
function readCommitMessages(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\0");
}

function output(name, value) {
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function main() {
  const versionFile = process.env.VERSION_FILE ?? "package.json";
  const packageJson = JSON.parse(fs.readFileSync(versionFile, "utf8"));
  const releasePrefix = process.env.RELEASE_PREFIX ?? "";
  const tagPrefix = releasePrefix ? `${releasePrefix}-` : "";

  // Default `patch`, so a repository that does not opt in gets exactly the
  // behaviour it had before this existed.
  const strategy = process.env.VERSION_STRATEGY || "patch";
  if (!["patch", "conventional"].includes(strategy)) {
    throw new Error(
      `VERSION_STRATEGY must be patch or conventional: ${strategy}`,
    );
  }

  // Read from a file, not an environment variable. The records are
  // NUL-delimited — commit bodies contain blank lines and arbitrary text, so no
  // printable separator is safe — and a shell cannot carry a NUL byte in a
  // variable at all: `VAR="$(cat file)"` silently drops them, which would merge
  // every commit into one unparseable blob and quietly yield `patch`.
  const bump =
    strategy === "conventional"
      ? bumpFromCommits(readCommitMessages(process.env.COMMIT_MESSAGES_FILE))
      : "patch";

  const next = nextReleaseVersion(
    packageJson.version,
    (process.env.RELEASE_TAGS ?? "").split("\n").filter(Boolean),
    releasePrefix,
    bump,
  );
  output("bump", bump);
  if (!process.env.GITHUB_RUN_NUMBER) {
    throw new Error("GITHUB_RUN_NUMBER is required");
  }
  output(
    "candidate-tag",
    `${tagPrefix}v${next}-rc.${process.env.GITHUB_RUN_NUMBER}`,
  );
  output("release-tag", `${tagPrefix}v${next}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
