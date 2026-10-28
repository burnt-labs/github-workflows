import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { validateDeploymentPolicy } from "../scripts/policy.mjs";
import {
  validateBuildInputs,
  resolveBuildVariables,
  fetchBuildAssets,
} from "../scripts/frontend-build.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assetPolicy = (bytes) => ({
  bucket: "brand-assets",
  objects: [
    {
      key: "fonts/a.woff2",
      sha256: digest(bytes),
      destinations: ["public/fonts/a.woff2"],
    },
  ],
});
const fixture = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-build-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test("target build variables select only declared public inputs and metadata", () => {
  const variables = {
    VITE_NETWORK: { value: "mainnet" },
    VITE_SITE_KEY: { variable: "SITE_KEY" },
    VITE_PUBLIC_TOKEN: { secret: ["PUBLIC_TOKEN", "PUBLIC_DEFAULT_TOKEN"] },
    VITE_VERSION: { metadata: "version-tag" },
  };
  validateBuildInputs({ buildVariables: variables });
  assert.deepEqual(
    resolveBuildVariables(variables, {
      variables: { SITE_KEY: "site", UNUSED: "unused" },
      secrets: {
        PUBLIC_DEFAULT_TOKEN: "public-token",
        BURNT_CLOUDFLARE_API_TOKEN: "private",
      },
      versionTag: "v18.2.3",
    }),
    {
      VITE_NETWORK: "mainnet",
      VITE_SITE_KEY: "site",
      VITE_PUBLIC_TOKEN: "public-token",
      VITE_VERSION: "v18.2.3",
    },
  );
  assert.throws(
    () =>
      resolveBuildVariables(variables, {
        variables: {},
        secrets: {},
        versionTag: "v1",
      }),
    /Missing build input/,
  );
});

test("build configuration rejects credential/control exports and ambiguous sources", () => {
  for (const name of [
    "PATH",
    "NODE_OPTIONS",
    "GITHUB_ENV",
    "CLOUDFLARE_API_TOKEN",
  ]) {
    assert.throws(
      () =>
        validateBuildInputs({ buildVariables: { [name]: { value: "bad" } } }),
      /public frontend/,
    );
  }
  for (const source of [
    "BURNT_CLOUDFLARE_API_TOKEN",
    "GITHUB_TOKEN",
    "ENV_JSON",
  ]) {
    assert.throws(
      () =>
        validateBuildInputs({
          buildVariables: { VITE_KEY: { secret: [source] } },
        }),
      /credential/,
    );
  }
  assert.throws(
    () =>
      validateBuildInputs({
        buildVariables: { VITE_KEY: { value: "x", variable: "KEY" } },
      }),
    /one source/,
  );
  assert.throws(
    () =>
      validateBuildInputs({
        buildVariables: { VITE_KEY: { value: "x", optional: true } },
      }),
    /one source/,
  );
});

test("R2 assets use fixed origin, literal key slashes, token isolation and verified bytes", async (t) => {
  const root = fixture(t);
  const bytes = Buffer.from("font bytes");
  const policy = assetPolicy(bytes);
  const requests = [];
  await fetchBuildAssets(policy, {
    root,
    accountId: "a".repeat(32),
    token: "private",
    fetcher: async (url, options) => {
      requests.push({ url, options });
      return new Response(bytes);
    },
  });
  assert.equal(
    fs.readFileSync(path.join(root, "public/fonts/a.woff2"), "utf8"),
    "font bytes",
  );
  assert.equal(
    requests[0].url,
    `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/r2/buckets/brand-assets/objects/fonts/a.woff2`,
  );
  assert.equal(requests[0].options.redirect, "error");
  assert.equal(requests[0].options.headers.Authorization, "Bearer private");
});

test("checksum and HTTP failures never publish downloaded bytes", async (t) => {
  const root = fixture(t);
  const policy = assetPolicy(Buffer.from("expected"));
  for (const response of [
    new Response("wrong"),
    new Response("secret upstream body", { status: 403 }),
  ]) {
    await assert.rejects(
      fetchBuildAssets(policy, {
        root,
        accountId: "a".repeat(32),
        token: "private",
        fetcher: async () => response,
      }),
      /checksum|HTTP 403/,
    );
    assert.equal(fs.existsSync(path.join(root, "public/fonts/a.woff2")), false);
  }
});

test("asset paths reject traversal, tooling paths and symlinked public directories", async (t) => {
  for (const destination of [
    "../public/a",
    "public/../../.github/workflows/a.yml",
    ".github/workflows/a.yml",
    "public/.git/config",
    "/public/a",
  ]) {
    const policy = assetPolicy(Buffer.from("font"));
    policy.objects[0].destinations = [destination];
    assert.throws(
      () => validateBuildInputs({ buildAssets: policy }),
      /asset path/,
    );
  }
  const root = fixture(t);
  const outside = fixture(t);
  fs.symlinkSync(outside, path.join(root, "public"));
  await assert.rejects(
    fetchBuildAssets(assetPolicy(Buffer.from("font")), {
      root,
      accountId: "a".repeat(32),
      token: "private",
      fetcher: async () => new Response("font"),
    }),
    /symlink/,
  );
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("assets require credentials and enforce object limits and valid object keys", async (t) => {
  const root = fixture(t);
  await assert.rejects(
    fetchBuildAssets(assetPolicy(Buffer.from("font")), {
      root,
      accountId: "",
      token: "",
    }),
    /credentials/,
  );
  for (const key of [
    "../escape",
    "fonts/../escape",
    "fonts//empty",
    "fonts/a?query",
    "fonts/a\n",
  ]) {
    const policy = assetPolicy(Buffer.from("font"));
    policy.objects[0].key = key;
    assert.throws(
      () => validateBuildInputs({ buildAssets: policy }),
      /object key/,
    );
  }
});

test("schema validation rejects invalid target inputs before any workflow command", () => {
  const policy = {
    schemaVersion: 1,
    topology: "chain",
    promotionMode: "manual",
    packageManager: "pnpm",
    workingDirectory: ".",
    versionFile: "package.json",
    targets: {
      candidate: {
        githubEnvironment: "testnet",
        wranglerEnv: "testnet",
        url: "https://testnet.example.com",
      },
      release: {
        githubEnvironment: "mainnet",
        wranglerEnv: "mainnet",
        url: "https://example.com",
      },
    },
  };
  policy.targets.release.buildVariables = { PATH: { value: "bad" } };
  assert.throws(() => validateDeploymentPolicy(policy), /public frontend/);
  delete policy.targets.release.buildVariables;
  policy.buildAssets = assetPolicy(Buffer.from("font"));
  policy.buildAssets.objects[0].sha256 = "invalid";
  assert.throws(() => validateDeploymentPolicy(policy), /SHA-256/);
});

test("bundled helper exports only declared public values and sanitizes parse failures", (t) => {
  const root = fixture(t);
  const envFile = path.join(root, "environment");
  fs.writeFileSync(envFile, "");
  const cli = path.resolve("scripts/frontend-build.bundle.mjs");
  const env = {
    PATH: process.env.PATH,
    GITHUB_ENV: envFile,
    TARGET: "release",
    VERSION_TAG: "v18.2.3",
    DEPLOYMENT_POLICY: JSON.stringify({
      workingDirectory: ".",
      targets: {
        release: {
          buildVariables: {
            VITE_NETWORK: { value: "mainnet" },
            VITE_TOKEN: { secret: ["PUBLIC_TOKEN"] },
            VITE_VERSION: { metadata: "version-tag" },
          },
        },
      },
    }),
    BUILD_SECRETS: JSON.stringify({
      PUBLIC_TOKEN: "public-token",
      BURNT_CLOUDFLARE_API_TOKEN: "never-export-this",
    }),
  };
  const result = spawnSync(process.execPath, [cli], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const contents = fs.readFileSync(envFile, "utf8");
  assert.match(contents, /VITE_NETWORK<<BUILD_[^\n]+\nmainnet\n/);
  assert.match(contents, /VITE_TOKEN<<BUILD_[^\n]+\npublic-token\n/);
  assert.match(contents, /VITE_VERSION<<BUILD_[^\n]+\nv18.2.3\n/);
  assert.doesNotMatch(
    contents + result.stdout + result.stderr,
    /never-export-this/,
  );
  const failed = spawnSync(process.execPath, [cli], {
    cwd: root,
    env: { ...env, BUILD_SECRETS: '{"private":"never-print-this"' },
    encoding: "utf8",
  });
  assert.equal(failed.status, 1);
  assert.doesNotMatch(failed.stderr + failed.stdout, /never-print-this/);
});

test("workflow runs the pinned helper before consumer preparation with scoped step credentials", () => {
  const workflow = parse(
    fs.readFileSync(".github/workflows/cloudflare-version.yml", "utf8"),
  );
  const steps = workflow.jobs.version.steps;
  const index = (name) => steps.findIndex((step) => step.name === name);
  const step = steps[index("Prepare public frontend build inputs")];
  assert.ok(index("Install") < index("Prepare public frontend build inputs"));
  assert.ok(
    index("Prepare public frontend build inputs") <
      index("Prepare target configuration"),
  );
  assert.equal(
    step.run,
    "node .burnt-workflows/scripts/frontend-build.bundle.mjs",
  );
  assert.match(step.if, /buildAssets != null/);
  assert.match(step.if, /buildVariables != null/);
  assert.match(step.env.CLOUDFLARE_API_TOKEN, /secrets/);
  assert.equal(steps[index("Prepare target configuration")].env, undefined);
  assert.equal(steps[index("Build")].env, undefined);
  assert.equal(workflow.jobs.version.env, undefined);
});

test("oversized asset responses fail before any writes", async (t) => {
  const root = fixture(t);
  const bytes = Buffer.alloc(10 * 1024 * 1024 + 1);
  await assert.rejects(
    fetchBuildAssets(assetPolicy(bytes), {
      root,
      accountId: "a".repeat(32),
      token: "private",
      fetcher: async () => new Response(bytes),
    }),
    /size limit/,
  );
  assert.equal(fs.existsSync(path.join(root, "public")), false);
});
