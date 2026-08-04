import assert from "node:assert/strict";
import test from "node:test";
import { nextReleaseVersion } from "../scripts/release-metadata.mjs";

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
