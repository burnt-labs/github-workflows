import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parse } from "yaml";

const modal = fs.existsSync("scripts/modal.mjs")
  ? await import("../scripts/modal.mjs")
  : {};

export function modalPolicy() {
  return {
    schemaVersion: 1,
    workingDirectory: ".",
    entrypoint: "modal_app.py",
    pythonVersion: "3.11",
    image: {
      repository: "docker.io/burntlabs/zk-email-prover",
      repositoryVariable: "DOCKER_REPO",
      tagVariable: "DOCKER_TAG",
    },
    targets: {
      legacy: {
        githubEnvironment: "testnet",
        variables: {
          MODAL_APP_NAME: "zk-gpu-prover",
          MODAL_STORAGE_VOLUME: "zk-prover-artifacts",
          GPU_TYPE: "H100:2",
          SCALEDOWN_WINDOW: "900",
          TIMEOUT: "60",
        },
      },
      mainnet: {
        githubEnvironment: "mainnet",
        variables: {
          MODAL_APP_NAME: "zk-email-prover-mainnet",
          MODAL_STORAGE_VOLUME: "zk-prover-artifacts-mainnet",
          GPU_TYPE: "H100:2",
          SCALEDOWN_WINDOW: "900",
          TIMEOUT: "300",
        },
      },
      testnet: {
        githubEnvironment: "testnet",
        variables: {
          MODAL_APP_NAME: "zk-email-prover-testnet",
          MODAL_STORAGE_VOLUME: "zk-prover-artifacts-testnet",
          GPU_TYPE: "H100:2",
          SCALEDOWN_WINDOW: "300",
          TIMEOUT: "300",
        },
      },
    },
  };
}

test("Modal example matches archived consumer source for every target without runtime changes", () => {
  assert.equal(
    fs.existsSync("tests/fixtures/zk-email-prover-modal.json"),
    true,
  );
  const archived = JSON.parse(
    fs.readFileSync("tests/fixtures/zk-email-prover-modal.json", "utf8"),
  );
  const policy = JSON.parse(
    JSON.stringify(
      modal.loadModalPolicy(
        process.cwd(),
        "examples/modal/zk-email-prover-policy.jsonc",
      ),
    ),
  );
  assert.deepEqual(policy, modalPolicy());
  assert.equal(archived.sourceSha, "8da73388af7cab752bce512a3d43e5c518e6dd7c");
  assert.deepEqual(
    Object.keys(archived.workflows).sort(),
    Object.keys(policy.targets).sort(),
  );
  for (const [target, source] of Object.entries(archived.workflows)) {
    const workflow = parse(source);
    const variables = Object.fromEntries(
      Object.entries(workflow.env)
        .filter(
          ([name]) =>
            ![
              "MODAL_TOKEN_ID",
              "MODAL_TOKEN_SECRET",
              "DOCKER_REPO",
              "DOCKER_TAG",
            ].includes(name),
        )
        .map(([name, value]) => [name, String(value)]),
    );
    assert.deepEqual(policy.targets[target], {
      githubEnvironment: workflow.jobs.deploy.environment,
      variables,
    });
    assert.equal(policy.image.repository, workflow.env.DOCKER_REPO);
    assert.equal(workflow.env.DOCKER_TAG, "${{ inputs.docker_tag }}");
    assert.equal(
      policy.pythonVersion,
      workflow.jobs.deploy.steps.find((step) =>
        step.uses?.startsWith("actions/setup-python"),
      ).with["python-version"],
    );
    assert.match(
      workflow.jobs.deploy.steps.find((step) => step.name === "Deploy to Modal")
        .run,
      /modal deploy modal_app\.py/,
    );
  }
});

test("Modal schema preserves all three existing target declarations", () => {
  assert.equal(typeof modal.validateModalPolicy, "function");
  assert.deepEqual(modal.validateModalPolicy(modalPolicy()), modalPolicy());
});

test("Modal schema is capped and rejects unsafe or credential-shaped configuration", () => {
  const changes = [
    (p) => (p.commands = { build: "echo unsafe" }),
    (p) => (p.credentials = { token: "OTHER_SECRET" }),
    (p) => (p.workingDirectory = "../outside"),
    (p) => (p.entrypoint = "--help"),
    (p) => (p.entrypoint = "../app.py"),
    (p) => (p.pythonVersion = "3.11; echo unsafe"),
    (p) => (p.image.repository = "image:latest"),
    (p) => (p.image.tagVariable = p.image.repositoryVariable),
    (p) => (p.image.repositoryVariable = "PATH"),
    (p) => (p.targets = {}),
    (p) => (p.targets.legacy.githubEnvironment = "Preview-test"),
    (p) => (p.targets.legacy.githubEnvironment = "mainnet\nother"),
    (p) => (p.targets.legacy.secrets = ["MODAL_TOKEN_SECRET"]),
    (p) => (p.targets.legacy.variables.MODAL_TOKEN_ID = "credential"),
    (p) => (p.targets.legacy.variables.GITHUB_TOKEN = "credential"),
    (p) => (p.targets.legacy.variables.PYTHONPATH = "malicious"),
    (p) =>
      (p.targets.legacy.variables.MODAL_SERVER_URL = "https://example.com"),
    (p) => (p.targets.legacy.variables.MODAL_OVERRIDE_HEADERS = "injection"),
    (p) => (p.targets.legacy.variables.MODAL_FORCE_BUILD = "1"),
    (p) => (p.targets.legacy.variables.HTTPS_PROXY = "https://example.com"),
    (p) => (p.targets.legacy.variables.AWS_SECRET_ACCESS_KEY = "credential"),
    (p) => (p.targets.legacy.variables.DOCKER_TAG = "latest"),
    (p) => (p.targets.legacy.variables.TIMEOUT = 60),
    (p) => (p.targets.legacy.variables.TIMEOUT = "60\nother=1"),
  ];
  for (const change of changes) {
    const policy = modalPolicy();
    change(policy);
    assert.throws(() => modal.validateModalPolicy(policy), /Modal/);
  }
});

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "modal-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".github"));
  fs.writeFileSync(
    path.join(root, ".github/modal-policy.jsonc"),
    JSON.stringify(modalPolicy()),
  );
  fs.writeFileSync(
    path.join(root, "modal_app.py"),
    "# Not executed by planning\n",
  );
  return root;
}

test("Modal planning loads JSONC and binds exactly the selected image and target", (t) => {
  assert.equal(typeof modal.loadModalPolicy, "function");
  assert.equal(typeof modal.resolveModalDeployment, "function");
  const root = repository(t);
  for (const [target, configuration] of Object.entries(modalPolicy().targets)) {
    const plan = modal.resolveModalDeployment(
      root,
      modal.loadModalPolicy(root),
      target,
      "sha-abc1234",
    );
    assert.equal(plan.githubEnvironment, configuration.githubEnvironment);
    assert.equal(plan.cwd, root);
    assert.equal(plan.entrypoint, path.join(root, "modal_app.py"));
    assert.deepEqual(plan.variables, {
      ...configuration.variables,
      DOCKER_REPO: modalPolicy().image.repository,
      DOCKER_TAG: "sha-abc1234",
    });
  }
  for (const target of ["missing", "__proto__", "constructor"])
    assert.throws(
      () => modal.resolveModalDeployment(root, modalPolicy(), target, "tag"),
      /Modal/,
    );
  for (const tag of ["", "a\nb", "--help", "tag;echo unsafe", "a".repeat(129)])
    assert.throws(
      () => modal.resolveModalDeployment(root, modalPolicy(), "legacy", tag),
      /Modal/,
    );
});

test("Modal rejects policy, working-directory and entrypoint symlink escapes", (t) => {
  const root = repository(t);
  const outside = repository(t);
  fs.symlinkSync(outside, path.join(root, "escape"));
  fs.symlinkSync(
    path.join(outside, ".github/modal-policy.jsonc"),
    path.join(root, ".github/link.jsonc"),
  );
  for (const file of [
    "../outside.jsonc",
    ".github/link.jsonc",
    "/etc/passwd",
    ".github/missing.jsonc",
  ])
    assert.throws(() => modal.loadModalPolicy(root, file));
  const p = modalPolicy();
  p.workingDirectory = "escape";
  assert.throws(
    () => modal.resolveModalDeployment(root, p, "legacy", "tag"),
    /Modal/,
  );
  fs.unlinkSync(path.join(root, "modal_app.py"));
  fs.symlinkSync(
    path.join(outside, "modal_app.py"),
    path.join(root, "modal_app.py"),
  );
  assert.throws(
    () => modal.resolveModalDeployment(root, modalPolicy(), "legacy", "tag"),
    /Modal/,
  );
  fs.writeFileSync(
    path.join(root, ".github/modal-policy.jsonc"),
    '{"schemaVersion":1,"schemaVersion":2}',
  );
  assert.throws(() => modal.loadModalPolicy(root), /duplicate/);
});

test("Modal permits only reviewed commit ancestry, never PR or mismatched checkout refs", (t) => {
  assert.equal(typeof modal.assertReviewedSource, "function");
  const root = repository(t);
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "--quiet", "repo");
  const repo = path.join(root, "repo");
  // Real signed objects, stored as fixtures so even a depth-one CI checkout
  // exercises ancestry without network access or creating unsigned commits.
  const [head, parent] = JSON.parse(
    fs.readFileSync("tests/fixtures/modal-signed-history.json", "utf8"),
  ).map((commit) => {
    const result = spawnSync(
      "git",
      ["hash-object", "-t", "commit", "-w", "--stdin"],
      { cwd: repo, input: commit, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  });
  assert.equal(
    spawnSync("git", ["update-ref", "HEAD", head], { cwd: repo }).status,
    0,
  );
  const setDefault = (sha) =>
    assert.equal(
      spawnSync("git", ["update-ref", "refs/remotes/origin/main", sha], {
        cwd: repo,
      }).status,
      0,
    );
  const context = {
    eventName: "workflow_dispatch",
    ref: "refs/heads/main",
    defaultBranch: "main",
    sourceSha: head,
  };
  setDefault(head);
  modal.assertReviewedSource(repo, context);
  modal.assertReviewedSource(repo, { ...context, ref: "refs/tags/v1.0.0" });
  for (const eventName of [
    "pull_request",
    "pull_request_target",
    "issue_comment",
    "release",
  ])
    assert.throws(
      () => modal.assertReviewedSource(repo, { ...context, eventName }),
      /Modal/,
    );
  assert.throws(
    () => modal.assertReviewedSource(repo, { ...context, sourceSha: parent }),
    /Modal/,
  );
  assert.throws(
    () =>
      modal.assertReviewedSource(repo, { ...context, ref: "refs/pull/1/head" }),
    /Modal/,
  );
  setDefault(parent);
  assert.throws(() => modal.assertReviewedSource(repo, context), /reviewed/);
});

test("Modal execution forwards only public policy and the two credentials and propagates failure", (t) => {
  assert.equal(typeof modal.deployModal, "function");
  const root = repository(t);
  const record = path.join(root, "record.json");
  const python = path.join(root, "python-recorder");
  fs.writeFileSync(
    python,
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({argv:process.argv.slice(2), env:process.env, cwd:process.cwd()})); process.exit(7);\n`,
    { mode: 0o700 },
  );
  const plan = modal.resolveModalDeployment(
    root,
    modalPolicy(),
    "legacy",
    "sha-abc1234",
  );
  const original = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "never-forward-this";
  t.after(() => {
    if (original === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = original;
  });
  assert.throws(
    () =>
      modal.deployModal(plan, {
        python,
        tokenId: "test-id",
        tokenSecret: "test-secret",
      }),
    /Modal deploy failed/,
  );
  const result = JSON.parse(fs.readFileSync(record, "utf8"));
  assert.deepEqual(result.argv, ["-m", "modal", "deploy", plan.entrypoint]);
  assert.equal(result.cwd, root);
  assert.equal(result.env.MODAL_TOKEN_ID, "test-id");
  assert.equal(result.env.MODAL_TOKEN_SECRET, "test-secret");
  assert.equal(result.env.MODAL_APP_NAME, "zk-gpu-prover");
  assert.equal(result.env.DOCKER_TAG, "sha-abc1234");
  assert.equal(result.env.GITHUB_TOKEN, undefined);
  assert.equal(
    fs.existsSync(result.env.HOME),
    false,
    "temporary Modal config is removed even after failure",
  );
  fs.unlinkSync(record);
  for (const values of [
    {},
    { tokenId: "test-id" },
    { tokenSecret: "test-secret" },
  ])
    assert.throws(
      () => modal.deployModal(plan, { python, ...values }),
      /Modal credentials/,
    );
  assert.equal(fs.existsSync(record), false);
});

test("Modal workflow gates secrets behind reviewed-source policy and honest separate quality", () => {
  assert.equal(fs.existsSync(".github/workflows/modal-deploy.yml"), true);
  const source = fs.readFileSync(".github/workflows/modal-deploy.yml", "utf8");
  const workflow = parse(source);
  assert.deepEqual(Object.keys(workflow.on), ["workflow_call"]);
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.on.workflow_call.inputs["image-tag"].required, true);
  assert.deepEqual(workflow.jobs.quality.needs, "policy");
  assert.match(
    workflow.jobs.quality.uses,
    /required-quality.yml@[a-f0-9]{40}$/,
  );
  assert.deepEqual(workflow.jobs.deploy.needs, ["policy", "quality"]);
  assert.equal(workflow.jobs.policy["runs-on"], "ubicloud-standard-2");
  assert.equal(workflow.jobs.deploy["runs-on"], "ubicloud-standard-4");
  assert.match(workflow.jobs.deploy.environment.name, /githubEnvironment/);
  assert.equal(workflow.jobs.deploy.concurrency["cancel-in-progress"], false);
  assert.match(workflow.jobs.deploy.concurrency.group, /inputs.target/);
  const steps = workflow.jobs.deploy.steps;
  const credentialSteps = steps.filter((step) =>
    Object.values(step.env ?? {}).some((value) =>
      String(value).includes("secrets."),
    ),
  );
  assert.deepEqual(
    credentialSteps.map((step) => step.name),
    ["Deploy Modal"],
  );
  assert.deepEqual(
    Object.keys(credentialSteps[0].env).filter((name) =>
      name.startsWith("MODAL_TOKEN_"),
    ),
    ["MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"],
  );
  assert.doesNotMatch(
    source,
    /toJSON\(secrets\)|toJSON\(vars\)|commands\.build|pip install modal\s*$/m,
  );
  const install = steps.find(
    (step) => step.name === "Install pinned Modal SDK",
  );
  assert.match(
    install.run,
    /--isolated install --only-binary=:all: modal==1\.6\.3/,
  );
  assert.equal(install.env, undefined);
  for (const job of [workflow.jobs.policy, workflow.jobs.deploy]) {
    assert.ok(
      job.steps.find(
        (step) => step.name === "Validate reviewed source and policy",
      ),
    );
    for (const step of job.steps.filter((step) =>
      step.uses?.startsWith("actions/checkout"),
    ))
      assert.equal(step.with["persist-credentials"], false);
  }
});

test("bundled Modal CLI validates without importing the app and deploys only after guard", (t) => {
  assert.equal(fs.existsSync("scripts/modal.bundle.mjs"), true);
  const root = repository(t);
  const clone = spawnSync(
    "git",
    ["clone", "--quiet", "--shared", process.cwd(), path.join(root, "repo")],
    { encoding: "utf8" },
  );
  assert.equal(clone.status, 0, clone.stderr);
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, ".github"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, ".github/modal-policy.jsonc"),
    JSON.stringify(modalPolicy()),
  );
  fs.writeFileSync(
    path.join(repo, "modal_app.py"),
    "raise RuntimeError('planning must not import app')\n",
  );
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).stdout.trim();
  assert.equal(
    spawnSync("git", ["update-ref", "refs/remotes/origin/main", head], {
      cwd: repo,
    }).status,
    0,
  );
  const output = path.join(root, "output");
  const env = {
    PATH: process.env.PATH,
    SOURCE_EVENT: "workflow_dispatch",
    SOURCE_REF: "refs/heads/main",
    SOURCE_SHA: head,
    DEFAULT_BRANCH: "main",
    MODAL_TARGET: "legacy",
    MODAL_IMAGE_TAG: "sha-abc1234",
    GITHUB_OUTPUT: output,
  };
  const cli = (command, additions = {}) =>
    spawnSync(
      process.execPath,
      [path.resolve("scripts/modal.bundle.mjs"), command],
      { cwd: repo, env: { ...env, ...additions }, encoding: "utf8" },
    );
  const plan = cli("plan");
  assert.equal(plan.status, 0, plan.stderr);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(output, "utf8").trim().slice("plan=".length)),
    { githubEnvironment: "testnet", pythonVersion: "3.11" },
  );
  const record = path.join(root, "cli-record");
  const python = path.join(root, "python-recorder");
  fs.writeFileSync(
    python,
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.env));\n`,
    { mode: 0o700 },
  );
  const credentials = {
    MODAL_PYTHON: python,
    MODAL_TOKEN_ID: "test-id",
    MODAL_TOKEN_SECRET: "test-secret",
  };
  const denied = cli("deploy", {
    ...credentials,
    SOURCE_EVENT: "pull_request_target",
  });
  assert.notEqual(denied.status, 0);
  assert.equal(fs.existsSync(record), false);
  assert.doesNotMatch(denied.stderr, /test-secret|test-id/);
  const deployed = cli("deploy", credentials);
  assert.equal(deployed.status, 0, deployed.stderr);
  assert.equal(
    JSON.parse(fs.readFileSync(record, "utf8")).DOCKER_TAG,
    "sha-abc1234",
  );
  assert.notEqual(cli("typo").status, 0);
});
