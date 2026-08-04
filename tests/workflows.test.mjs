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

test("every internal workflow pin carries release metadata", () => {
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith(".yml")) continue;
    const source = fs.readFileSync(`${directory}/${name}`, "utf8");
    for (const [line] of source.matchAll(
      /^\s*(?:- )?uses: burnt-labs\/github-workflows\/.*$/gm,
    )) {
      assert.match(line, /@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, `${name}: ${line}`);
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

test("required quality accepts app-scoped policy paths", () => {
  const source = fs.readFileSync(`${directory}/required-quality.yml`, "utf8");
  const workflow = parse(source);
  const inputs = workflow.on.workflow_call.inputs;
  assert.equal(
    inputs["quality-policy-path"].default,
    ".github/quality-policy.jsonc",
  );
  assert.equal(
    inputs["deployment-policy-path"].default,
    ".github/deployment-policy.jsonc",
  );
  assert.equal(inputs["deployment-required"].default, false);

  const policyStep = workflow.jobs.policy.steps.find(
    (step) => step.id === "policy",
  );
  assert.match(policyStep.env.QUALITY_POLICY_PATH, /quality-policy-path/);
  assert.match(policyStep.env.DEPLOYMENT_POLICY_PATH, /deployment-policy-path/);
  assert.match(policyStep.run, /--deployment/);
});

test("Cloudflare uses the caller target environment", () => {
  const source = fs.readFileSync(`${directory}/cloudflare-version.yml`, "utf8");
  assert.match(source, /targets\[inputs\.target\]\.githubEnvironment/);
  assert.doesNotMatch(source, /environment:\s*(preview|preview-)/);
});

test("Cloudflare PRs allow same-repository branches when the repository is a fork", () => {
  const source = fs.readFileSync(`${directory}/cloudflare-pr.yml`, "utf8");
  const workflow = parse(source);
  assert.match(
    workflow.jobs.quality.if,
    /head\.repo\.full_name == github\.repository/,
  );
  assert.doesNotMatch(workflow.jobs.quality.if, /head\.repo\.fork/);
});

test("Phala deploys to the caller's selected real environment", () => {
  const source = fs.readFileSync(`${directory}/phala-deploy.yml`, "utf8");
  assert.match(source, /targets\[inputs\.target\]\.githubEnvironment/);
  assert.doesNotMatch(source, /environment:\s*(preview|preview-)/);
  assert.match(source, /target must be candidate or release/);
});

test("Phala requires policy before running consumer quality", () => {
  const workflow = parse(
    fs.readFileSync(`${directory}/phala-deploy.yml`, "utf8"),
  );
  assert.match(workflow.jobs.policy.steps.at(-1).run, /--phala/);
  assert.equal(workflow.jobs.quality.needs, "policy");
  assert.deepEqual(workflow.jobs.deploy.needs, ["policy", "quality"]);
});

test("Phala uses pinned build actions and a pinned CLI", () => {
  const source = fs.readFileSync(`${directory}/phala-deploy.yml`, "utf8");
  assert.match(source, /docker\/build-push-action@[0-9a-f]{40}/);
  assert.match(source, /npx --yes phala@1\.1\.20 deploy/);
  assert.match(source, /v1\.1\.20 \| v1\.1\.20\+\*/);
  assert.doesNotMatch(source, /npx (?!--yes phala@1\.1\.20)/);
});

test("Phala seals only policy-allowlisted runtime configuration", () => {
  const source = fs.readFileSync(`${directory}/phala-deploy.yml`, "utf8");
  assert.match(source, /runtimeSecrets/);
  assert.match(source, /runtimeVariables/);
  assert.match(source, /Declared Phala configuration not set/);
  assert.match(source, /toJSON\(secrets\)/);
  assert.doesNotMatch(source, /environment-json|CUE_|TEE_SERVICE_URL/);
});

test("Phala private-image credentials are durable and separate from the push token", () => {
  const workflow = parse(
    fs.readFileSync(`${directory}/phala-deploy.yml`, "utf8"),
  );
  const login = workflow.jobs.deploy.steps.find(
    (step) => step.name === "Login to GHCR for push",
  );
  assert.match(login.with.password, /github\.token/);
  const collect = workflow.jobs.deploy.steps.find(
    (step) =>
      step.name === "Collect deployment credentials and runtime configuration",
  );
  assert.match(collect.env.REGISTRY_PASSWORD_NAME, /registryPasswordSecret/);
  assert.match(collect.run, /DSTACK_DOCKER_PASSWORD/);
  assert.doesNotMatch(collect.run, /github\.token/);
});

test("Phala deployment is serialized and updates CVMs by id", () => {
  const workflow = parse(
    fs.readFileSync(`${directory}/phala-deploy.yml`, "utf8"),
  );
  const source = fs.readFileSync(`${directory}/phala-deploy.yml`, "utf8");
  assert.match(workflow.jobs.deploy.concurrency.group, /cvmName/);
  assert.equal(workflow.jobs.deploy.concurrency["cancel-in-progress"], true);
  assert.match(source, /existing_id=/);
  assert.match(source, /target=\(--cvm-id "\$existing_id"\)/);
  assert.match(source, /has no id/);
});

test("Phala health checks fail closed and URL propagation stays caller-owned", () => {
  const source = fs.readFileSync(`${directory}/phala-deploy.yml`, "utf8");
  assert.match(source, /health check failed after 30 attempts/);
  assert.doesNotMatch(source, /gh variable|gh workflow run|Synchronize/);
  assert.doesNotMatch(source, /::warning::/);
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
    "!cancelled() && needs.create-releases.result == 'success' && fromJSON(needs.quality.outputs.deployment-policy).promotionMode == 'automatic'",
  );
});

test("promotion outputs use workflow-safe names", () => {
  const requiredQuality = fs.readFileSync(
    `${directory}/required-quality.yml`,
    "utf8",
  );
  assert.match(requiredQuality, /promotionMode:/);
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
    assert.doesNotMatch(source, /outputs\[['"](?:npm-)?promotion-mode/);
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
  assert.match(
    source,
    /outputs\.deployment-policy\)\.promotionMode == 'manual'/,
  );
});

test("npm uses trusted publishing without tokens or commits", () => {
  const source = fs.readFileSync(`${directory}/npm-publish.yml`, "utf8");
  assert.match(source, /id-token: write/);
  assert.match(source, /npm publish/);
  assert.match(source, /--provenance/);
  assert.doesNotMatch(source, /\bgit (commit|push)\b/);
});

test("no workflow accepts an npm token", () => {
  // npm is retiring 2FA-bypass granular access tokens: they stop skipping 2FA
  // for account operations in August 2026 and lose publishing entirely around
  // January 2027. Publishing here is OIDC trusted publishing and nothing else,
  // so the only mention of a token name allowed anywhere is npm-publish.yml
  // refusing to run when one is present.
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith(".yml")) continue;
    const source = fs.readFileSync(`${directory}/${name}`, "utf8");
    for (const [line] of source.matchAll(
      /^.*(NPM_TOKEN|NODE_AUTH_TOKEN).*$/gm,
    )) {
      assert.match(line, /-n "\$\{|must not carry one/, `${name}: ${line}`);
    }
  }
});

test("publishing fails loudly when the caller withholds OIDC", () => {
  // Without id-token: write the failure surfaces inside `npm publish` as an
  // authentication error that reads like a registry outage, and the caller's
  // missing permission is nowhere in it.
  const source = fs.readFileSync(`${directory}/npm-publish.yml`, "utf8");
  assert.match(source, /ACTIONS_ID_TOKEN_REQUEST_URL/);
  assert.match(source, /must grant id-token: write/);
});

test("every job that installs consumer dependencies pins the npm CLI", () => {
  // Node's `lts/*` bundles npm 11, which only warns about the install-time
  // defaults npm 12 enforces — default-deny dependency lifecycle scripts, and
  // allow-git and allow-remote at none. `lts/*` rolls to an npm 12 Node on its
  // own schedule, so an unpinned CLI means every consumer's install semantics
  // change on a day nobody chose. Pinning is what makes that a decision.
  const pins = new Map();
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith(".yml")) continue;
    const source = fs.readFileSync(`${directory}/${name}`, "utf8");
    if (!source.includes("commands.install")) continue;
    const pin = source.match(/npm install --global npm@(\d+)/);
    assert.ok(pin, `${name} runs a consumer install without pinning npm`);
    assert.ok(
      Number(pin[1]) >= 12,
      `${name}: npm ${pin[1]} predates the install-time security defaults`,
    );
    // A pin that silently loses to a corepack shim or a consumer .npmrc buys
    // nothing, so each one asserts what actually landed on PATH.
    assert.match(source, /Something is shadowing the pinned CLI/, name);
    pins.set(name, pin[1]);
  }
  assert.ok(
    pins.size >= 4,
    `expected every install path pinned, got ${pins.size}`,
  );
  assert.equal(
    new Set(pins.values()).size,
    1,
    `workflows disagree on the npm major: ${[...pins].map(([n, v]) => `${n}=${v}`).join(", ")}`,
  );
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
    "!cancelled() && needs.create-releases.result == 'success' && fromJSON(needs.quality.outputs.npm-policy).promotionMode == 'automatic'",
  );
  assert.match(source, /candidateDistTag/);
  assert.match(source, /releaseDistTag/);
});
