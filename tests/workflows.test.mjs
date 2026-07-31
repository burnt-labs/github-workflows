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

test("every action reference is pinned to a full commit SHA", () => {
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith(".yml")) continue;
    const source = fs.readFileSync(`${directory}/${name}`, "utf8");
    for (const [, reference] of source.matchAll(/^\s*(?:- )?uses: (\S+)/gm)) {
      assert.match(reference, /@[0-9a-f]{40}$/, `${name}: ${reference}`);
    }
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

test("the single-topology --env fragment cannot fall through", () => {
  // GitHub's && / || return the last evaluated operand, and '' is falsy. So
  // `topology == 'single' && '' || format('--env {0}', …)` returns the format
  // every time — including for single, where passing --env fails the deploy.
  // The condition must be written negated, with '' on the right.
  const source = fs.readFileSync(`${directory}/cloudflare-version.yml`, "utf8");
  const fragment = source
    .split("\n")
    .find((line) => line.includes("--env {0}"));
  assert.ok(fragment, "expected a conditional --env fragment");
  assert.match(fragment, /topology != 'single' &&/);
  assert.doesNotMatch(fragment, /&& ''/);
});

test("Worker secrets are allowlisted, never forwarded wholesale", () => {
  // toJSON(secrets) in the publish step contains every secret the caller
  // inherited, the Cloudflare API token included. The allowlist is the entire
  // safety property, so the step must select from the policy rather than pipe
  // the whole object to wrangler.
  const source = fs.readFileSync(`${directory}/cloudflare-version.yml`, "utf8");
  assert.match(source, /workerSecrets/);
  assert.match(source, /\$want \| map\(\{key: \., value: \$all\[\.\]\}\)/);
  assert.doesNotMatch(source, /secret bulk[^\n]*ALL_SECRETS/);
});

test("Worker secrets are published on deploy but never on preview", () => {
  // `wrangler secret bulk` creates a version and deploys it immediately, so
  // doing this on a preview would serve an intermediate version — on a chain
  // repository, straight to mainnet from a job whose purpose is not to serve.
  const workflow = parse(
    fs.readFileSync(`${directory}/cloudflare-version.yml`, "utf8"),
  );
  const collect = workflow.jobs.version.steps.find(
    (step) => step.id === "worker-secrets",
  );
  assert.match(collect.if, /inputs\.operation == 'deploy'/);
});

test("Worker secrets are published by the pinned action, not consumer wrangler", () => {
  // Resolving wrangler from the consumer's node_modules would put a
  // caller-controlled binary in the same step as the deployment credential.
  const workflow = parse(
    fs.readFileSync(`${directory}/cloudflare-version.yml`, "utf8"),
  );
  const publish = workflow.jobs.version.steps.find(
    (step) => step.name === "Publish Worker secrets",
  );
  assert.match(publish.uses, /^cloudflare\/wrangler-action@[0-9a-f]{40}$/);
  assert.match(publish.command ?? publish.with.command, /secret bulk/);
  assert.match(
    publish.with.workingDirectory,
    /deployment-policy\)\.workingDirectory/,
  );
});

test("a missing declared Worker secret fails the deploy", () => {
  // Absent configuration must not degrade quietly: wrangler would happily
  // deploy without it and the Worker would fail at runtime, or worse, not fail.
  const source = fs.readFileSync(`${directory}/cloudflare-version.yml`, "utf8");
  assert.match(source, /Declared workerSecrets not set/);
});

test("single topology uploads the candidate rather than serving it", () => {
  // Candidate and release are the same Worker under single, so deploying on
  // merge would serve it and leave the release with nothing to promote.
  const source = fs.readFileSync(`${directory}/cloudflare-main.yml`, "utf8");
  const workflow = parse(source);
  assert.match(
    workflow.jobs["deploy-candidate"].with.operation,
    /topology == 'single' && 'preview' \|\| 'deploy'/,
  );
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
    "needs.quality.outputs['promotion-mode'] == 'automatic'",
  );
});

test("hyphenated promotion outputs use bracket notation", () => {
  const requiredQuality = fs.readFileSync(
    `${directory}/required-quality.yml`,
    "utf8",
  );
  assert.match(requiredQuality, /jobs\.policy\.outputs\['promotion-mode'\]/);
  assert.match(
    requiredQuality,
    /steps\.policy\.outputs\['npm-promotion-mode'\]/,
  );

  for (const workflowName of [
    "cloudflare-main.yml",
    "cloudflare-release.yml",
    "npm-main.yml",
    "npm-release.yml",
  ]) {
    const source = fs.readFileSync(`${directory}/${workflowName}`, "utf8");
    assert.doesNotMatch(source, /outputs\.(?:npm-)?promotion-mode/);
  }
});

test("main release preview is policy-gated and skip-safe", () => {
  const source = fs.readFileSync(`${directory}/cloudflare-main.yml`, "utf8");
  const workflow = parse(source);
  assert.equal(
    workflow.jobs["preview-release"].if,
    "fromJSON(needs.quality.outputs.deployment-policy).previewReleaseOnMain",
  );
  // A skipped need skips its dependents by default, so disabling the preview
  // would otherwise stop releases from being created at all.
  const createReleases = workflow.jobs["create-releases"].if;
  assert.match(createReleases, /!cancelled\(\)/);
  assert.match(createReleases, /needs\.preview-release\.result == 'skipped'/);
});

test("release rejects an unrecognized operation instead of skipping", () => {
  const source = fs.readFileSync(`${directory}/cloudflare-release.yml`, "utf8");
  const workflow = parse(source);
  assert.match(source, /operation must be preview or deploy/);
  assert.equal(
    workflow.jobs["preview-release"].if,
    "inputs.operation == 'preview'",
  );
  assert.match(
    workflow.jobs["deploy-release"].if,
    /inputs\.operation == 'deploy'/,
  );
  // Every deploying job must sit downstream of the guard.
  assert.deepEqual(workflow.jobs.quality.needs, "validate");
});

test("release candidates cannot deploy the release target", () => {
  const source = fs.readFileSync(`${directory}/cloudflare-release.yml`, "utf8");
  assert.match(source, /inputs\.prerelease == false/);
  assert.match(source, /\['promotion-mode'\] == 'manual'/);
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
    "needs.quality.outputs['npm-promotion-mode'] == 'automatic'",
  );
  assert.match(source, /candidateDistTag/);
  assert.match(source, /releaseDistTag/);
});
