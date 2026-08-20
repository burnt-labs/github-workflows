import assert from "node:assert/strict";
import test from "node:test";
import {
  bumpFromCommits,
  nextReleaseVersion,
} from "../scripts/release-metadata.mjs";

test("release metadata preserves repository-wide tags by default", () => {
  assert.equal(nextReleaseVersion("1.0.0", []), "1.0.1");
  assert.equal(nextReleaseVersion("1.0.0", ["v1.4.2"]), "1.4.3");
});

test("release metadata isolates app-prefixed release histories", () => {
  assert.equal(
    nextReleaseVersion(
      "1.0.0",
      ["v9.0.0", "burnt-v2.3.4", "screening-v7.8.9"],
      "burnt",
    ),
    "2.3.5",
  );
  assert.equal(
    nextReleaseVersion(
      "1.0.0",
      ["v9.0.0", "burnt-v2.3.4", "screening-v7.8.9"],
      "screening",
    ),
    "7.8.10",
  );
});

test("release metadata treats prefixes as literal text", () => {
  assert.equal(
    nextReleaseVersion("1.0.0", ["webX-v9.9.9", "web.+-v2.3.4"], "web.+"),
    "2.3.5",
  );
});

test("bump levels move the right component and reset the ones below", () => {
  assert.equal(nextReleaseVersion("0.0.0", ["v1.4.2"], "", "patch"), "1.4.3");
  assert.equal(nextReleaseVersion("0.0.0", ["v1.4.2"], "", "minor"), "1.5.0");
  assert.equal(nextReleaseVersion("0.0.0", ["v1.4.2"], "", "major"), "2.0.0");
});

test("bump defaults to patch, so existing repositories do not move", () => {
  assert.equal(nextReleaseVersion("1.0.0", ["v1.4.2"]), "1.4.3");
  assert.throws(
    () => nextReleaseVersion("1.0.0", [], "", "huge"),
    /bump must be major, minor, or patch/,
  );
});

test("conventional commits decide the bump", () => {
  assert.equal(bumpFromCommits(["fix: a thing"]), "patch");
  assert.equal(bumpFromCommits(["feat: a thing"]), "minor");
  assert.equal(bumpFromCommits(["feat(scope): a thing"]), "minor");
  assert.equal(bumpFromCommits(["feat!: a thing"]), "major");
  assert.equal(bumpFromCommits(["fix(scope)!: a thing"]), "major");
  assert.equal(
    bumpFromCommits(["fix: a thing\n\nBREAKING CHANGE: it moved"]),
    "major",
  );
  assert.equal(
    bumpFromCommits(["fix: a thing\n\nBREAKING-CHANGE: it moved"]),
    "major",
  );
});

test("the highest bump in the set wins", () => {
  assert.equal(bumpFromCommits(["fix: a", "feat: b", "chore: c"]), "minor");
  assert.equal(bumpFromCommits(["fix: a", "feat: b", "refactor!: c"]), "major");
});

test("unconventional commits are a patch, never a failure", () => {
  // A repository opting in still has old commits. Refusing to compute a
  // version because someone wrote "wip" is a worse failure than under-bumping,
  // and under-bumping is the safe direction: `^1.2` is not broken by 1.2.4.
  assert.equal(
    bumpFromCommits(["wip", "", "   ", "Merge pull request #3"]),
    "patch",
  );
  assert.equal(bumpFromCommits([]), "patch");
  assert.equal(bumpFromCommits([null, undefined, 42]), "patch");
});

test("BREAKING CHANGE only counts as a footer, not in a subject", () => {
  // Otherwise "docs: explain the BREAKING CHANGE: policy" cuts a major.
  assert.equal(
    bumpFromCommits(["docs: explain BREAKING CHANGE: policy"]),
    "patch",
  );
});

test("a prefixed package ignores an unprefixed release line", () => {
  // provider-devtool, exactly: the Worker is at v0.1.21 and the package at
  // 0.4.0. Reading the Worker's tags would publish the package as 0.1.22 — a
  // version regression cut from a tag that has nothing to do with it.
  const workerTags = ["v0.1.21", "v0.1.20", "v0.1.19"];
  assert.equal(
    nextReleaseVersion("0.4.0", workerTags, "types", "minor"),
    "0.5.0",
  );
  // And the package's own line is what it follows once it exists.
  assert.equal(
    nextReleaseVersion(
      "0.4.0",
      [...workerTags, "types-v0.5.0"],
      "types",
      "minor",
    ),
    "0.6.0",
  );
});
