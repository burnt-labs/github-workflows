import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  materializePublicConfiguration,
  materializeWorkerSecrets,
  removeSecretsFile,
  validateEnvironmentBundle,
} from "../scripts/env-json.mjs";

function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "env-json-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true }));
  const directory = path.join(root, "worker");
  const runnerTemp = path.join(root, "runner");
  fs.mkdirSync(directory);
  fs.mkdirSync(runnerTemp);
  const config = {
    name: "service",
    main: "src/index.ts",
    containers: [{ image: "../Dockerfile", image_build_context: ".." }],
    migrations: [{ tag: "v1", new_sqlite_classes: ["State"] }],
    durable_objects: { bindings: [{ name: "STATE", class_name: "State" }] },
    vars: { SHARED: "source" },
    env: {
      staging: {
        vars: { STALE: "remove-me" },
        d1_databases: [{ binding: "DB", database_id: "id" }],
      },
      production: {
        vars: { PRIVATE_TO_OTHER_ENV: "retained" },
        r2_buckets: [{ binding: "BUCKET", bucket_name: "production" }],
      },
    },
  };
  const source = path.join(directory, "wrangler.jsonc");
  const original = `// source config comment\n${JSON.stringify(config, null, 2).replace('"source"', '"source",')}\n`;
  fs.writeFileSync(source, original);
  const policy = {
    schemaVersion: 1,
    topology: "standard",
    promotionMode: "manual",
    packageManager: "npm",
    workingDirectory: "worker",
    versionFile: "package.json",
    environmentSecret: "SERVICE_ENV_JSON",
    workerVariables: ["API_URL", "EMPTY"],
    workerSecrets: ["SERVICE_KEY"],
    targets: {
      candidate: {
        wranglerEnv: "staging",
        githubEnvironment: "staging",
        url: "https://staging.example.com",
        wranglerConfig: ".wrangler.staging.generated.jsonc",
      },
      release: {
        wranglerEnv: "production",
        githubEnvironment: "production",
        url: "https://example.com",
        wranglerConfig: ".wrangler.production.generated.jsonc",
      },
    },
  };
  const bundle = JSON.stringify({
    vars: { API_URL: "https://api.example.com", EMPTY: "" },
    secrets: { SERVICE_KEY: "super-private-runtime-marker" },
  });
  return {
    root,
    runnerTemp,
    config,
    source,
    original,
    policy,
    bundle,
    target: "candidate",
  };
}

function runCli(options, phase = "prepare", bundle = options.bundle) {
  return spawnSync(
    process.execPath,
    [path.resolve("scripts/env-json.bundle.mjs"), phase],
    {
      cwd: options.root,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        GITHUB_WORKSPACE: options.root,
        RUNNER_TEMP: options.runnerTemp,
        TARGET: options.target,
        OPERATION: "deploy",
        DEPLOYMENT_POLICY: JSON.stringify(options.policy),
        ENVIRONMENT_JSON: bundle,
      },
    },
  );
}

test("JSONC source retains resources, DO identities, relative paths and other environments", (t) => {
  const options = fixture(t);
  const generated = materializePublicConfiguration(options);
  const expected = structuredClone(options.config);
  expected.env.staging.vars = JSON.parse(options.bundle).vars;
  assert.deepEqual(JSON.parse(fs.readFileSync(generated, "utf8")), expected);
  assert.equal(path.dirname(generated), path.dirname(options.source));
  assert.equal(fs.readFileSync(options.source, "utf8"), options.original);
  assert.equal(
    fs.existsSync(path.join(options.runnerTemp, "worker-secrets.json")),
    false,
  );
  assert.doesNotMatch(
    fs.readFileSync(generated, "utf8"),
    /super-private-runtime-marker/,
  );
});

test("production bundle changes only production vars and cannot bleed candidate values", (t) => {
  const options = fixture(t);
  materializePublicConfiguration(options);
  options.target = "release";
  options.bundle = JSON.stringify({
    vars: { API_URL: "https://production.example.com", EMPTY: "" },
    secrets: { SERVICE_KEY: "production-key" },
  });
  const output = JSON.parse(
    fs.readFileSync(materializePublicConfiguration(options), "utf8"),
  );
  assert.deepEqual(output.env.staging, options.config.env.staging);
  assert.deepEqual(output.env.production.vars, JSON.parse(options.bundle).vars);
  assert.equal(output.env.production.r2_buckets[0].bucket_name, "production");
});

test("single topology replaces top-level vars without changing resources", (t) => {
  const options = fixture(t);
  options.policy.topology = "single";
  options.policy.targets.candidate = {
    githubEnvironment: "production",
    url: "https://example.com",
    wranglerConfig: ".wrangler.generated.jsonc",
  };
  options.policy.targets.release = { ...options.policy.targets.candidate };
  const expected = { ...options.config, vars: JSON.parse(options.bundle).vars };
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(materializePublicConfiguration(options), "utf8"),
    ),
    expected,
  );
});

test("bundle rejects missing, unknown or non-string entries without coercion", (t) => {
  const options = fixture(t);
  const original = JSON.parse(options.bundle);
  const invalid = [
    null,
    [],
    {},
    { ...original, extra: "secret-snippet" },
    { vars: [], secrets: {} },
    { vars: {}, secrets: [] },
  ];
  for (const section of ["vars", "secrets"]) {
    const keys = Object.keys(original[section]);
    const missing = structuredClone(original);
    delete missing[section][keys[0]];
    invalid.push(missing);
    const unknown = structuredClone(original);
    unknown[section].UNDECLARED = "secret-snippet";
    invalid.push(unknown);
    for (const value of [null, false, 123, {}, []]) {
      const item = structuredClone(original);
      item[section][keys[0]] = value;
      invalid.push(item);
    }
  }
  invalid.push(
    { ...original, secrets: { SERVICE_KEY: "" } },
    { ...original, secrets: { SERVICE_KEY: "  " } },
  );
  for (const item of invalid) {
    assert.throws(() =>
      materializePublicConfiguration({
        ...options,
        bundle: JSON.stringify(item),
      }),
    );
    assert.equal(
      fs.existsSync(
        path.join(
          path.dirname(options.source),
          options.policy.targets.candidate.wranglerConfig,
        ),
      ),
      false,
    );
  }
});

test("malformed bundle parse errors never reveal secret JSON snippets", (t) => {
  const options = fixture(t);
  const bad =
    '{"vars":{},"secrets":{"SERVICE_KEY":"super-private-runtime-marker"},oops}';
  assert.throws(() => validateEnvironmentBundle(bad, options.policy), {
    message: "Environment bundle is not valid JSON",
  });
  const result = runCli(options, "prepare", bad);
  assert.equal(result.status, 1);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /super-private-runtime-marker|SERVICE_KEY|oops/,
  );
});

test("generated config rejects source overwrite, traversal, symlinks and hardlinks", (t) => {
  const options = fixture(t);
  for (const destination of [
    "wrangler.jsonc",
    "../escape.jsonc",
    "/tmp/escape.jsonc",
    "missing/dest.jsonc",
  ]) {
    options.policy.targets.candidate.wranglerConfig = destination;
    assert.throws(() => materializePublicConfiguration(options));
  }
  const linked = path.join(path.dirname(options.source), "linked.jsonc");
  fs.symlinkSync(options.source, linked);
  options.policy.targets.candidate.wranglerConfig = "linked.jsonc";
  assert.throws(() => materializePublicConfiguration(options), /symlink/);
  fs.unlinkSync(linked);
  fs.symlinkSync(path.join(options.root, "not-created.jsonc"), linked);
  assert.throws(() => materializePublicConfiguration(options), /symlink/);
  fs.unlinkSync(linked);
  fs.linkSync(options.source, linked);
  assert.throws(() => materializePublicConfiguration(options), /source/);
  assert.equal(fs.readFileSync(options.source, "utf8"), options.original);
});

test("source and working directory symlinks cannot redirect generated configuration", (t) => {
  const options = fixture(t);
  const copy = path.join(options.root, "saved-source.jsonc");
  fs.renameSync(options.source, copy);
  fs.symlinkSync(copy, options.source);
  assert.throws(() => materializePublicConfiguration(options), /symlink/);
  fs.unlinkSync(options.source);
  fs.renameSync(copy, options.source);
  fs.symlinkSync(
    path.dirname(options.source),
    path.join(options.root, "linked-worker"),
  );
  options.policy.workingDirectory = "linked-worker";
  assert.throws(() => materializePublicConfiguration(options), /symlink/);
});

test("missing source environment fails instead of inventing one", (t) => {
  const options = fixture(t);
  options.policy.targets.candidate.wranglerEnv = "not-configured";
  assert.throws(
    () => materializePublicConfiguration(options),
    /selected environment/,
  );
});

test("runtime secrets are written only for deploy with 0600 permissions after build", (t) => {
  const options = fixture(t);
  materializePublicConfiguration(options);
  const output = path.join(options.runnerTemp, "worker-secrets.json");
  assert.equal(fs.existsSync(output), false);
  assert.throws(
    () => materializeWorkerSecrets({ ...options, operation: "preview" }),
    /only for deploy/,
  );
  assert.equal(fs.existsSync(output), false);
  materializeWorkerSecrets({ ...options, operation: "deploy" });
  assert.deepEqual(
    JSON.parse(fs.readFileSync(output, "utf8")),
    JSON.parse(options.bundle).secrets,
  );
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  removeSecretsFile(options.runnerTemp);
  assert.equal(fs.existsSync(output), false);
});

test("failed collection removes stale secret files and reports no secret values", (t) => {
  const options = fixture(t);
  const output = path.join(options.runnerTemp, "worker-secrets.json");
  fs.writeFileSync(output, "stale-private-key");
  const invalid = JSON.parse(options.bundle);
  invalid.secrets.SERVICE_KEY = 123;
  const result = runCli(options, "secrets", JSON.stringify(invalid));
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(output), false);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /stale-private-key|super-private-runtime-marker|SERVICE_KEY/,
  );
});

test("bundled CLI materializes with no dependencies or secret logging", (t) => {
  const options = fixture(t);
  const prepared = runCli(options);
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(prepared.stdout + prepared.stderr, "");
  const collected = runCli(options, "secrets");
  assert.equal(collected.status, 0, collected.stderr);
  assert.equal(collected.stdout + collected.stderr, "");
});

test("outside working directories and absent bundle policies fail closed", (t) => {
  const options = fixture(t);
  options.policy.workingDirectory = "..";
  assert.throws(
    () => materializePublicConfiguration(options),
    /inside the repository/,
  );
  options.policy.workingDirectory = "../outside/worker";
  assert.throws(
    () => materializePublicConfiguration(options),
    /inside the repository/,
  );
  options.policy.workingDirectory = "worker";
  delete options.policy.environmentSecret;
  options.policy.workerVariables = [];
  assert.throws(
    () => materializePublicConfiguration(options),
    /environmentSecret is required/,
  );
  options.policy.environmentSecret = "SERVICE_ENV_JSON";
  options.policy.workerVariables = ["API_URL", "EMPTY"];
  assert.throws(
    () => materializePublicConfiguration({ ...options, target: "unknown" }),
    /Unknown/,
  );
  fs.writeFileSync(options.source, "null");
  assert.throws(
    () => materializePublicConfiguration(options),
    /must be an object/,
  );
});

test("workflow commands keep secrets out of builds and clean up after deployment failure", async (t) => {
  const { parse } = await import("yaml");
  const workflow = parse(
    fs.readFileSync(".github/workflows/cloudflare-version.yml", "utf8"),
  );
  const commands = Object.fromEntries(
    workflow.jobs.version.steps.map((step) => [step.name, step.run]),
  );
  const helper = fs.readFileSync("scripts/env-json.bundle.mjs", "utf8");
  for (const operation of ["preview", "deploy"]) {
    const options = fixture(t);
    fs.mkdirSync(path.join(options.root, ".burnt-workflows/scripts"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(options.root, ".burnt-workflows/scripts/env-json.bundle.mjs"),
      helper,
    );
    const env = {
      PATH: process.env.PATH,
      GITHUB_WORKSPACE: options.root,
      RUNNER_TEMP: options.runnerTemp,
      DEPLOYMENT_POLICY: JSON.stringify(options.policy),
      TARGET: options.target,
      OPERATION: operation,
    };
    const execute = (name, secret = false) =>
      spawnSync("bash", ["-euo", "pipefail", "-c", commands[name]], {
        cwd: options.root,
        env: {
          ...env,
          ...(secret ? { ENVIRONMENT_JSON: options.bundle } : {}),
        },
        encoding: "utf8",
      });
    const output = path.join(options.runnerTemp, "worker-secrets.json");
    try {
      assert.equal(
        execute("Materialize public Worker variables", true).status,
        0,
      );
      // An application build has the public generated file, but no service secret environment or file.
      const build = spawnSync(
        process.execPath,
        [
          "-e",
          `
        const fs = require('node:fs');
        if (process.env.ENVIRONMENT_JSON || process.env.ALL_SECRETS) process.exit(2);
        if (fs.existsSync(${JSON.stringify(output)})) process.exit(3);
        const config = fs.readFileSync(${JSON.stringify(path.join(path.dirname(options.source), options.policy.targets.candidate.wranglerConfig))}, 'utf8');
        if (config.includes('super-private-runtime-marker')) process.exit(4);
      `,
        ],
        { env, encoding: "utf8" },
      );
      assert.equal(build.status, 0, build.stderr);
      if (operation === "deploy") {
        assert.equal(
          execute("Materialize bundled Worker secrets", true).status,
          0,
        );
        assert.equal(fs.statSync(output).mode & 0o777, 0o600);
        // The pinned action failed after opening its secrets input; always-cleanup still runs.
        const deploy = spawnSync(
          process.execPath,
          [
            "-e",
            `require('node:fs').readFileSync(${JSON.stringify(output)}); process.exit(1)`,
          ],
          { env },
        );
        assert.equal(deploy.status, 1);
      } else assert.equal(fs.existsSync(output), false);
    } finally {
      assert.equal(execute("Remove Worker secrets file").status, 0);
      assert.equal(fs.existsSync(output), false);
    }
  }
});

test("generated configuration cannot overwrite an existing unrelated sibling file", (t) => {
  const options = fixture(t);
  const sentinel = path.join(path.dirname(options.source), "package.json");
  fs.writeFileSync(sentinel, "sentinel original package metadata");
  options.policy.targets.candidate.wranglerConfig = "package.json";
  assert.throws(() => materializePublicConfiguration(options), /EEXIST/);
  assert.equal(
    fs.readFileSync(sentinel, "utf8"),
    "sentinel original package metadata",
  );
  assert.equal(fs.readFileSync(options.source, "utf8"), options.original);
});
