import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

test("every direct job runs on an approved Ubicloud runner", () => {
  const approvedRunners = new Set([
    "ubicloud-standard-2",
    "ubicloud-standard-4",
    "ubicloud-standard-8",
  ]);

  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith(".yml")) continue;
    const workflow = parse(fs.readFileSync(`${directory}/${name}`, "utf8"));
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      if (job.uses) continue;
      assert.ok(
        approvedRunners.has(job["runs-on"]),
        `${name}:${jobName} must use an approved Ubicloud runner`,
      );
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

test("release metadata consumers use the same pinned script revision", () => {
  const refs = ["cloudflare-main.yml", "npm-main.yml"].map((name) => {
    const workflow = parse(fs.readFileSync(`${directory}/${name}`, "utf8"));
    const checkout = workflow.jobs.metadata.steps.find(
      (step) =>
        step.with?.repository === "burnt-labs/github-workflows" &&
        step.with?.path === ".burnt-workflows",
    );
    assert.ok(checkout, `${name} must check out release metadata scripts`);
    assert.match(checkout.with.ref, /^[0-9a-f]{40}$/, name);
    return checkout.with.ref;
  });
  assert.equal(
    new Set(refs).size,
    1,
    `release metadata workflows disagree on the script revision: ${refs.join(", ")}`,
  );
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

test("Cloudflare PRs keep quality but skip credentialed previews for Dependabot", () => {
  const source = fs.readFileSync(`${directory}/cloudflare-pr.yml`, "utf8");
  const workflow = parse(source);
  assert.doesNotMatch(workflow.jobs.quality.if, /dependabot/);
  assert.match(workflow.jobs["preview-candidate"].if, /dependabot\[bot\]/);
});

test("Cloudflare entrypoints forward app-scoped policy paths", () => {
  for (const name of [
    "cloudflare-pr.yml",
    "cloudflare-main.yml",
    "cloudflare-release.yml",
  ]) {
    const workflow = parse(fs.readFileSync(`${directory}/${name}`, "utf8"));
    assert.equal(
      workflow.on.workflow_call.inputs["quality-policy-path"].default,
      ".github/quality-policy.jsonc",
      name,
    );
    assert.equal(
      workflow.on.workflow_call.inputs["deployment-policy-path"].default,
      ".github/deployment-policy.jsonc",
      name,
    );
    assert.match(
      workflow.jobs.quality.with["quality-policy-path"],
      /inputs\.quality-policy-path/,
      name,
    );
    assert.match(
      workflow.jobs.quality.with["deployment-policy-path"],
      /inputs\.deployment-policy-path/,
      name,
    );
    assert.equal(workflow.jobs.quality.with["deployment-required"], true, name);
  }
});

test("Cloudflare release and preview metadata is app-scoped", () => {
  const main = fs.readFileSync(`${directory}/cloudflare-main.yml`, "utf8");
  assert.match(main, /RELEASE_PREFIX:.*releasePrefix/);

  const pullRequest = fs.readFileSync(`${directory}/cloudflare-pr.yml`, "utf8");
  assert.match(pullRequest, /RELEASE_PREFIX:.*releasePrefix/);
  assert.match(pullRequest, /burnt-cloudflare-candidate:\$\{scope\}/);
  assert.match(pullRequest, /\$\{RELEASE_PREFIX\}pr-/);
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

test("Wrangler metadata arguments remain single tokens", () => {
  // wrangler-action parses its multiline command before execution. Quoting a
  // human-readable message containing spaces is not preserved, so the trailing
  // URL becomes a positional argument that `wrangler deploy` mistakes for an
  // entry-point path. The release tag is already a safe, traceable identifier;
  // keep the full source URL in the job summary instead.
  const workflow = parse(
    fs.readFileSync(`${directory}/cloudflare-version.yml`, "utf8"),
  );
  const deploy = workflow.jobs.version.steps.find(
    (step) => step.id === "wrangler",
  );
  assert.match(
    deploy.with.command,
    /--message=\$\{\{ inputs\.version-tag \}\}/,
  );
  assert.doesNotMatch(
    deploy.with.command,
    /--message[^\n]*inputs\.version-message/,
  );
});

test("preview metadata tolerates Workers without preview URLs", () => {
  // Cloudflare never generates preview URLs for Workers that implement a
  // Durable Object (Containers included) — `versions upload` succeeds with a
  // Version ID and no URL. The metadata step must fall back to the target URL
  // with an explanatory note instead of failing the preview, and the note must
  // travel to the caller so cloudflare-pr.yml can surface it in the comment.
  const source = fs.readFileSync(`${directory}/cloudflare-version.yml`, "utf8");
  const workflow = parse(source);
  const metadata = workflow.jobs.version.steps.find(
    (step) => step.id === "metadata",
  );
  assert.match(metadata.run, /DEPLOYMENT_URL="\$TARGET_URL"/);
  assert.match(metadata.run, /PREVIEW_NOTE=/);
  assert.match(metadata.run, /Durable Object/);
  assert.equal(
    workflow.on.workflow_call.outputs["preview-note"].value,
    "${{ jobs.version.outputs.preview-note }}",
  );
  const pr = parse(fs.readFileSync(`${directory}/cloudflare-pr.yml`, "utf8"));
  const comment = pr.jobs["publish-preview"].steps.find(
    (step) => step.env && step.env.PREVIEW_NOTE !== undefined,
  );
  assert.ok(comment, "PR comment step must receive the preview note");
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

test("release rejects tags from another app namespace", () => {
  const workflow = parse(
    fs.readFileSync(`${directory}/cloudflare-release.yml`, "utf8"),
  );
  const guard = workflow.jobs["validate-release-tag"];
  assert.equal(guard.needs, "quality");
  assert.match(guard.env.PRERELEASE, /inputs\.prerelease/);
  assert.match(guard.env.RELEASE_PREFIX, /releasePrefix/);
  assert.match(guard.steps[0].run, /does not belong/);
  for (const [releaseTag, prerelease, expectedStatus] of [
    ["screening-v1.2.3", "false", 0],
    ["screening-v1.2.3-rc.7", "true", 0],
    ["screening-v1.2.3-rc.7", "false", 1],
    ["screening-v1.2.3", "true", 1],
    ["burnt-v1.2.3", "false", 1],
  ]) {
    const result = spawnSync(
      "bash",
      ["-euo", "pipefail", "-c", guard.steps[0].run],
      {
        env: {
          ...process.env,
          PRERELEASE: prerelease,
          RELEASE_PREFIX: "screening",
          RELEASE_TAG: releaseTag,
        },
      },
    );
    assert.equal(
      result.status,
      expectedStatus,
      `${releaseTag} prerelease=${prerelease}: ${result.stderr}`,
    );
  }
  assert.deepEqual(workflow.jobs["preview-release"].needs, [
    "quality",
    "validate-release-tag",
  ]);
  assert.deepEqual(workflow.jobs["deploy-release"].needs, [
    "quality",
    "validate-release-tag",
  ]);
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
  // so a token name may appear only where a guard refuses to run when one is
  // present: the emptiness check, the refusal message, the grep pattern that
  // exempts setup-node's literal interpolation placeholder, and comments
  // explaining those.
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith(".yml")) continue;
    const source = fs.readFileSync(`${directory}/${name}`, "utf8");
    for (const [line] of source.matchAll(
      /^.*(NPM_TOKEN|NODE_AUTH_TOKEN).*$/gm,
    )) {
      assert.match(
        line,
        /-n "\$\{|must not carry one|^\s*#|NODE_AUTH_TOKEN\\\}/,
        `${name}: ${line}`,
      );
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

test("npm release metadata is namespace-scoped", () => {
  const source = fs.readFileSync(`${directory}/npm-main.yml`, "utf8");
  // Both the version derivation and the conventional commit range must read
  // only this flow's tags. Without the prefix, a repository whose Worker
  // deploy flow also cuts releases would seed the package version — and the
  // commit range — from whatever that flow released last.
  const workflow = parse(source);
  const metadata = workflow.jobs.metadata.steps.find(
    (step) => step.id === "metadata",
  );
  assert.match(metadata.env.RELEASE_PREFIX, /npm-policy\)\.releasePrefix/);
  const commits = workflow.jobs.metadata.steps.find(
    (step) => step.name === "Read commits since the last release",
  );
  assert.match(commits.env.RELEASE_PREFIX, /npm-policy\)\.releasePrefix/);
  assert.match(commits.run, /tag_prefix/);
});

test("npm versions strip the namespace the tags carry", (t) => {
  // The tag carries the namespace; the npm version must not. Stripping only
  // `v` would hand npm `types-v1.2.3-rc.4` as a version, which it rejects.
  const workflow = parse(fs.readFileSync(`${directory}/npm-main.yml`, "utf8"));
  const versions = workflow.jobs.metadata.steps.find(
    (step) => step.id === "versions",
  );
  assert.match(versions.env.RELEASE_PREFIX, /npm-policy\)\.releasePrefix/);
  const outputDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "npm-versions-"),
  );
  t.after(() => fs.rmSync(outputDirectory, { recursive: true }));
  for (const [index, [releasePrefix, candidateTag, releaseTag]] of [
    ["types", "types-v1.2.3-rc.7", "types-v1.2.3"],
    ["", "v1.2.3-rc.7", "v1.2.3"],
  ].entries()) {
    const outputFile = path.join(outputDirectory, `case-${index}`);
    fs.writeFileSync(outputFile, "");
    const result = spawnSync("bash", ["-euo", "pipefail", "-c", versions.run], {
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputFile,
        RELEASE_PREFIX: releasePrefix,
        CANDIDATE_TAG: candidateTag,
        RELEASE_TAG: releaseTag,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      fs.readFileSync(outputFile, "utf8"),
      "candidate-version=1.2.3-rc.7\nrelease-version=1.2.3\n",
      releasePrefix || "(none)",
    );
  }
});

test("npm release rejects tags from another namespace", (t) => {
  const workflow = parse(
    fs.readFileSync(`${directory}/npm-release.yml`, "utf8"),
  );
  const guard = workflow.jobs.metadata.steps.find(
    (step) => step.id === "version",
  );
  assert.match(guard.env.RELEASE_PREFIX, /npm-policy\)\.releasePrefix/);
  const outputDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "npm-release-guard-"),
  );
  t.after(() => fs.rmSync(outputDirectory, { recursive: true }));
  for (const [releasePrefix, releaseTag, expectedStatus, version] of [
    ["types", "types-v1.2.3", 0, "1.2.3"],
    ["types", "v1.2.3", 1],
    ["types", "web-v1.2.3", 1],
    ["types", "types-v1.2.3-rc.7", 1],
    ["", "v1.2.3", 0, "1.2.3"],
    ["", "types-v1.2.3", 1],
    ["", "1.2.3", 1],
  ]) {
    const outputFile = path.join(
      outputDirectory,
      `${releasePrefix || "none"}-${releaseTag}`,
    );
    fs.writeFileSync(outputFile, "");
    const result = spawnSync("bash", ["-euo", "pipefail", "-c", guard.run], {
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputFile,
        RELEASE_PREFIX: releasePrefix,
        RELEASE_TAG: releaseTag,
      },
    });
    assert.equal(
      result.status,
      expectedStatus,
      `${releasePrefix || "(none)"}/${releaseTag}: ${result.stderr}`,
    );
    if (expectedStatus === 0) {
      assert.match(
        fs.readFileSync(outputFile, "utf8"),
        new RegExp(`version=${version}`),
      );
    }
  }
});

test("npm provenance follows source repository visibility", () => {
  // The registry refuses provenance from a private source repository with
  // E422 instead of publishing without the attestation, so the flag has to
  // follow visibility. The flag must sit on the && side of the fragment —
  // the idiom returns the last evaluated operand and '' is falsy, so the
  // reversed form would emit the flag every time.
  const source = fs.readFileSync(`${directory}/npm-publish.yml`, "utf8");
  assert.match(
    source,
    /github\.event\.repository\.private == false && '--provenance' \|\| ''/,
  );
});

test("D1 migrations run on deploy only and render from policy", (t) => {
  const workflow = parse(
    fs.readFileSync(`${directory}/cloudflare-version.yml`, "utf8"),
  );
  const steps = workflow.jobs.version.steps;
  const plan = steps.find((step) => step.name === "Plan D1 migrations");
  const apply = steps.find((step) => step.name === "Apply D1 migrations");
  // Deploy only: a preview must not mutate the target's database, the same
  // boundary the Worker secrets steps draw.
  assert.match(plan.if, /inputs\.operation == 'deploy'/);
  assert.match(plan.if, /d1Migrations\[0\] != null/);
  assert.equal(apply.if, "steps.d1-migrations.outcome == 'success'");
  // Migrations resolve against the same wrangler configuration the deploy
  // reads, and land before the version that needs them goes live.
  assert.match(
    apply.with.workingDirectory,
    /deployment-policy\)\.workingDirectory/,
  );
  assert.match(apply.with.command, /steps\.d1-migrations\.outputs\.commands/);
  assert.ok(
    steps.indexOf(apply) <
      steps.findIndex(
        (step) => step.name === "Upload or deploy Worker version",
      ),
  );

  const outputDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "d1-migrations-"),
  );
  t.after(() => fs.rmSync(outputDirectory, { recursive: true }));
  for (const [index, [envFlag, expected]] of [
    [
      "",
      "d1 migrations apply DEVTOOL_DB --remote\n" +
        "d1 migrations apply provider-db --remote\n",
    ],
    [
      "--env mainnet",
      "d1 migrations apply DEVTOOL_DB --remote --env mainnet\n" +
        "d1 migrations apply provider-db --remote --env mainnet\n",
    ],
  ].entries()) {
    const outputFile = path.join(outputDirectory, `case-${index}`);
    fs.writeFileSync(outputFile, "");
    const result = spawnSync("bash", ["-euo", "pipefail", "-c", plan.run], {
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputFile,
        DATABASES: JSON.stringify(["DEVTOOL_DB", "provider-db"]),
        ENV_FLAG: envFlag,
      },
    });
    assert.equal(result.status, 0, `${envFlag}: ${result.stderr}`);
    assert.equal(
      fs.readFileSync(outputFile, "utf8"),
      `commands<<D1_COMMANDS\n${expected}D1_COMMANDS\n`,
    );
  }
});

test("npm publish runs package-scoped steps in the package directory", () => {
  // npm-pr and npm-main already run in the npm policy's workingDirectory. In
  // a workspace repository the quality directory is the root — that is where
  // the lockfile and the install live — and `npm publish` from the root packs
  // the private root package instead of the workspace package.
  const workflow = parse(
    fs.readFileSync(`${directory}/npm-publish.yml`, "utf8"),
  );
  const steps = workflow.jobs.publish.steps;
  for (const name of [
    "Set publish version without committing",
    "Read package name",
    "Publish with provenance when the source is public",
  ]) {
    const step = steps.find((step) => step.name === name);
    assert.match(
      step["working-directory"],
      /npm-policy\)\.workingDirectory/,
      name,
    );
  }
});

test("npm changesets flow publishes with OIDC and API commits only", () => {
  const source = fs.readFileSync(`${directory}/npm-changesets.yml`, "utf8");
  const workflow = parse(source);
  const release = workflow.jobs.release;
  assert.equal(release.permissions["id-token"], "write");
  // Serialization is enforced here, not trusted to the caller: concurrent
  // runs force-update the changeset-release branch, and a cancel between
  // publish and tagging leaves registry versions with nothing behind them.
  assert.match(release.concurrency.group, /github\.repository/);
  assert.equal(release.concurrency["cancel-in-progress"], false);
  const checkout = release.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(checkout.with["fetch-depth"], 0);
  assert.equal(checkout.with["persist-credentials"], false);
  // The guard runs before any npm invocation at all — the global pin
  // downloads npm through the generated user config — and so before any
  // consumer code has a rejected credential in scope.
  const stepNames = release.steps.map((step) => step.name);
  assert.ok(
    stepNames.indexOf("Verify trusted-publishing credentials") <
      stepNames.indexOf("Pin the npm CLI"),
  );
  assert.ok(
    stepNames.indexOf("Pin the npm CLI") < stepNames.indexOf("Install"),
  );
  // The action resolves the workspace at the repository root; a nested
  // quality workingDirectory is rejected rather than accommodated.
  const validate = release.steps.find(
    (step) => step.name === "Validate invocation",
  );
  assert.match(validate.if, /workingDirectory != '\.'/);
  assert.match(validate.run, /repository root/);
  const publish = release.steps.at(-1);
  assert.equal(publish.with.commitMode, "github-api");
  // A stale run — one whose branch has already moved on — must stand down
  // rather than force-update the version pull request backwards.
  assert.equal(publish.if, "steps.freshness.outputs.stale == 'false'");
  assert.ok(release.steps.find((step) => step.id === "freshness"));
  // Provenance follows source visibility; the registry refuses it from
  // private repositories rather than degrading.
  assert.match(
    publish.env.NPM_CONFIG_PROVENANCE,
    /repository\.private == false/,
  );
  assert.match(source, /ACTIONS_ID_TOKEN_REQUEST_URL/);
});

test("npm changesets guard rejects real credentials, allows the placeholder", (t) => {
  const workflow = parse(
    fs.readFileSync(`${directory}/npm-changesets.yml`, "utf8"),
  );
  const guard = workflow.jobs.release.steps.find(
    (step) => step.name === "Verify trusted-publishing credentials",
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "npmrc-guard-"));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const cases = [
    // [label, user npmrc, project npmrc, env overrides, expected status]
    ["no oidc", null, null, { ACTIONS_ID_TOKEN_REQUEST_URL: "" }, 1],
    ["env NODE_AUTH_TOKEN", null, null, { NODE_AUTH_TOKEN: "npm_x" }, 1],
    ["env NPM_TOKEN", null, null, { NPM_TOKEN: "npm_x" }, 1],
    ["no npmrc anywhere", null, null, {}, 0],
    [
      "placeholder",
      "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n",
      null,
      {},
      0,
    ],
    ["empty value", "//registry.npmjs.org/:_authToken=\n", null, {}, 0],
    [
      "literal credential",
      "//registry.npmjs.org/:_authToken=npm_realtoken\n",
      null,
      {},
      1,
    ],
    // npm's ini parser trims whitespace around `=`, so this authenticates —
    // the guard has to see through the spacing (caught in review of the
    // guard's first incarnation).
    [
      "literal credential with spaces",
      "//registry.npmjs.org/:_authToken = npm_realtoken\n",
      null,
      {},
      1,
    ],
    [
      "placeholder with spaces",
      "//registry.npmjs.org/:_authToken =${NODE_AUTH_TOKEN}\n",
      null,
      {},
      0,
    ],
    // The other credential keys npm accepts authenticate a registry just as
    // _authToken does, and a project .npmrc is read by npm like the user one.
    ["basic auth", "//registry.npmjs.org/:_auth=dXNlcjpwYXNz\n", null, {}, 1],
    ["password", "//registry.npmjs.org/:_password=cGFzcw==\n", null, {}, 1],
    [
      "token helper",
      "//registry.npmjs.org/:tokenHelper=/usr/local/bin/npm-token\n",
      null,
      {},
      1,
    ],
    [
      "client certificate",
      "//registry.npmjs.org/:certfile=/etc/ssl/npm.crt\n//registry.npmjs.org/:keyfile=/etc/ssl/npm.key\n",
      null,
      {},
      1,
    ],
    [
      "project npmrc credential",
      null,
      "//registry.npmjs.org/:_authToken=npm_realtoken\n",
      {},
      1,
    ],
    ["project npmrc benign", null, "save-exact=true\n", {}, 0],
    // The action runs version/publish from the repository root, which can
    // differ from this step's working directory under a non-root quality
    // policy — the workspace root .npmrc must be scanned from anywhere.
    [
      "workspace root credential from elsewhere",
      null,
      "workspace://registry.npmjs.org/:_authToken=npm_realtoken\n",
      {},
      1,
    ],
  ];
  for (const [
    index,
    [label, userRc, projectRc, extra, expected],
  ] of cases.entries()) {
    const cwd = fs.mkdtempSync(path.join(root, `cwd-${index}-`));
    const env = {
      ...process.env,
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc",
      NPM_CONFIG_USERCONFIG: path.join(cwd, "absent-user-npmrc"),
      ...extra,
    };
    delete env.NODE_AUTH_TOKEN;
    delete env.NPM_TOKEN;
    Object.assign(env, extra);
    if (userRc !== null) {
      const file = path.join(cwd, "user-npmrc");
      fs.writeFileSync(file, userRc);
      env.NPM_CONFIG_USERCONFIG = file;
    }
    const workspace = fs.mkdtempSync(path.join(root, `ws-${index}-`));
    env.GITHUB_WORKSPACE = workspace;
    if (projectRc !== null) {
      if (projectRc.startsWith("workspace:")) {
        fs.writeFileSync(
          path.join(workspace, ".npmrc"),
          projectRc.slice("workspace:".length),
        );
      } else {
        fs.writeFileSync(path.join(cwd, ".npmrc"), projectRc);
      }
    }
    const result = spawnSync("bash", ["-euo", "pipefail", "-c", guard.run], {
      cwd,
      env,
    });
    assert.equal(result.status, expected, `${label}: ${result.stderr}`);
  }
});
