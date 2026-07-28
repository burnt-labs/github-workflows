import fs from "node:fs";
import process from "node:process";

function strictVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`version is not strict semver: ${version}`);
  return match.slice(1).map(Number);
}

export function nextReleaseVersion(packageVersion, releaseTags = []) {
  const versions = releaseTags
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .map((tag) => strictVersion(tag.slice(1)));
  if (versions.length === 0) versions.push(strictVersion(packageVersion));
  versions.sort((left, right) => {
    for (let index = 0; index < 3; index += 1) {
      if (left[index] !== right[index]) return right[index] - left[index];
    }
    return 0;
  });
  const [major, minor, patch] = versions[0];
  return `${major}.${minor}.${patch + 1}`;
}

function output(name, value) {
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function main() {
  const versionFile = process.env.VERSION_FILE ?? "package.json";
  const packageJson = JSON.parse(fs.readFileSync(versionFile, "utf8"));
  const next = nextReleaseVersion(
    packageJson.version,
    (process.env.RELEASE_TAGS ?? "").split("\n").filter(Boolean),
  );
  if (!process.env.GITHUB_RUN_NUMBER) {
    throw new Error("GITHUB_RUN_NUMBER is required");
  }
  output("candidate-tag", `v${next}-rc.${process.env.GITHUB_RUN_NUMBER}`);
  output("release-tag", `v${next}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
