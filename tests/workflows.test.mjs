import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const directory = ".github/workflows";

test("workflows parse and never create commits", () => {
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith(".yml")) continue;
    const source = fs.readFileSync(`${directory}/${name}`, "utf8");
    const workflow = parse(source);
    assert.ok(workflow.on, name);
    assert.ok(workflow.jobs, name);
    assert.doesNotMatch(source, /\bgit (commit|push)\b/, name);
    assert.doesNotMatch(source, /burnt-labs\/github-workflows\/.+@main/, name);
    assert.doesNotMatch(source, /ref: main/, name);
  }
});

test("required quality supports ruleset events without filters", () => {
  const source = fs.readFileSync(`${directory}/required-quality.yml`, "utf8");
  const workflow = parse(source);
  assert.deepEqual(workflow.on.pull_request, null);
  assert.deepEqual(workflow.on.merge_group, null);
  for (const gate of [
    "commands.lint",
    "commands.prettier",
    "commands.test",
    "commands.coverage",
    "commands.build",
  ]) {
    assert.match(source, new RegExp(gate.replace(".", "\\.")));
  }
});

test("Cloudflare uses the caller target environment", () => {
  const source = fs.readFileSync(`${directory}/cloudflare-version.yml`, "utf8");
  assert.match(source, /targets\[inputs\.target\]\.githubEnvironment/);
  assert.doesNotMatch(source, /environment:\s*(preview|preview-)/);
});

test("Cloudflare promotion ordering is explicit", () => {
  const source = fs.readFileSync(`${directory}/cloudflare-main.yml`, "utf8");
  const workflow = parse(source);
  assert.deepEqual(workflow.jobs["preview-release"].needs, [
    "quality",
    "metadata",
    "deploy-candidate",
  ]);
  assert.deepEqual(workflow.jobs["create-releases"].needs, [
    "quality",
    "metadata",
    "deploy-candidate",
    "preview-release",
  ]);
  assert.equal(
    workflow.jobs["deploy-release-automatic"].if,
    "needs.quality.outputs.promotion-mode == 'automatic'",
  );
});

test("release candidates cannot deploy the release target", () => {
  const source = fs.readFileSync(`${directory}/cloudflare-release.yml`, "utf8");
  assert.match(source, /inputs\.prerelease == false/);
  assert.match(source, /promotion-mode == 'manual'/);
});

test("npm uses trusted publishing without tokens or commits", () => {
  const source = fs.readFileSync(`${directory}/npm-publish.yml`, "utf8");
  assert.match(source, /id-token: write/);
  assert.match(source, /npm publish/);
  assert.match(source, /--provenance/);
  assert.doesNotMatch(source, /NPM_TOKEN|NODE_AUTH_TOKEN/);
  assert.doesNotMatch(source, /\bgit (commit|push)\b/);
});

test("npm promotes next before latest", () => {
  const source = fs.readFileSync(`${directory}/npm-main.yml`, "utf8");
  const workflow = parse(source);
  assert.deepEqual(workflow.jobs["create-releases"].needs, [
    "quality",
    "metadata",
    "publish-candidate",
  ]);
  assert.deepEqual(workflow.jobs["publish-release-automatic"].needs, [
    "quality",
    "metadata",
    "create-releases",
  ]);
  assert.equal(
    workflow.jobs["publish-release-automatic"].if,
    "needs.quality.outputs.npm-promotion-mode == 'automatic'",
  );
  assert.match(source, /candidateDistTag/);
  assert.match(source, /releaseDistTag/);
});
