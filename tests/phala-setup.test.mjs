import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appInventory,
  requireAbsentApp,
  requireSetupInvocation,
  setupCvm,
} from "../scripts/phala-setup.mjs";

const appId = "a".repeat(40);
const vmUuid = "11111111-2222-4333-8444-555555555555";
const infrastructure = {
  osImage: "dstack-0.6.1",
  instanceType: "tdx.small",
  region: "us-west-1",
};
const env = {
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY: "example/service",
};
const page = (apps, number = 1, total = apps.length, pages = 1) => ({
  dstack_apps: apps,
  page: number,
  page_size: 100,
  total,
  total_pages: pages,
});
const app = (overrides = {}) => ({
  app_id: appId,
  name: "other-service",
  current_cvm: null,
  cvms: [],
  ...overrides,
});
const detail = (overrides = {}) => ({
  app_id: appId,
  vm_uuid: vmUuid,
  name: "service-production",
  status: "running",
  compose_hash: "c".repeat(64),
  os: { name: infrastructure.osImage, is_dev: false },
  resource: { instance_type: infrastructure.instanceType },
  node_info: { object_type: "node", region: "US-WEST-1" },
  listed: false,
  public_logs: false,
  public_sysinfo: false,
  ...overrides,
});

test("setup only accepts a manual run from the caller's default branch", () => {
  requireSetupInvocation(env, "main");
  requireSetupInvocation({ ...env, GITHUB_REF: "refs/heads/trunk" }, "trunk");
  for (const change of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_EVENT_NAME: "pull_request_target" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_REF: "refs/tags/main" },
  ]) {
    assert.throws(
      () => requireSetupInvocation({ ...env, ...change }, "main"),
      /manual.*default branch/,
    );
  }
  assert.throws(
    () => requireSetupInvocation(env, ""),
    /manual.*default branch/,
  );
});

test("raw inventory includes pending apps and every page before absence is decided", async () => {
  const calls = [];
  const apps = await appInventory(async (args) => {
    calls.push(args);
    return JSON.stringify(
      args.includes("page=1")
        ? page([app()], 1, 2, 2)
        : page(
            [app({ app_id: "b".repeat(40), name: "service-production" })],
            2,
            2,
            2,
          ),
    );
  });
  assert.equal(calls.length, 2);
  assert.throws(() => requireAbsentApp(apps, "service-production"), /recovery/);
  for (const candidate of [
    app({ name: "service-production" }),
    app({ current_cvm: { name: "service-production" } }),
    app({ cvms: [{ name: "service-production" }] }),
  ]) {
    assert.throws(
      () => requireAbsentApp([candidate], "service-production"),
      /recovery/,
    );
  }
  requireAbsentApp([app()], "service-production");
});

test("incomplete, malformed, changing, duplicate and unavailable inventories fail closed", async () => {
  for (const payload of [
    null,
    {},
    page([], 1, 1),
    page([app(), app()]),
    page([app({ app_id: "bad" })]),
    page([app({ current_cvm: {} })]),
    page([app({ cvms: [null] })]),
    page([], 1, 0, 101),
    page([], 1, -1),
    page([], 2),
  ]) {
    await assert.rejects(
      appInventory(async () => JSON.stringify(payload)),
      /inventory|pagination|identity|metadata/,
    );
  }
  await assert.rejects(
    appInventory(async () => {
      throw new Error("private-upstream-sentinel");
    }),
    /inventory/,
  );
  let n = 0;
  await assert.rejects(
    appInventory(async () =>
      JSON.stringify(++n === 1 ? page([app()], 1, 2, 2) : page([], 2, 3, 2)),
    ),
    /changed/,
  );
  n = 0;
  await assert.rejects(
    appInventory(async () => JSON.stringify(page([app()], ++n, 2, 2))),
    /duplicate/,
  );
  assert.deepEqual(
    await appInventory(async () => JSON.stringify(page([], 1, 0, 0))),
    [],
  );
});

function fixture(t, override = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phala-setup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const receiptFile = path.join(root, "receipt.json");
  const options = {
    name: "service-production",
    infrastructure,
    image: `ghcr.io/example/service/app@sha256:${"c".repeat(64)}`,
    revision: "d".repeat(40),
    composeFile: path.join(root, "compose.yaml"),
    envFile: path.join(root, "runtime.env"),
    receiptFile,
    run: async (args) => {
      calls.push(args);
      if (args[0] === "api") return JSON.stringify(page([]));
      if (args[0] === "deploy")
        return JSON.stringify({
          success: true,
          app_id: appId,
          vm_uuid: vmUuid,
          name: "service-production",
          private: "secret-not-for-receipt",
        });
      return JSON.stringify(detail());
    },
    wait: async () => {},
    attempts: 2,
    ...override,
  };
  return { calls, options, receiptFile };
}

test("setup creates once, saves only public identity and polls the exact created app", async (t) => {
  const { calls, options, receiptFile } = fixture(t);
  await setupCvm(options);
  assert.equal(calls.filter((args) => args[0] === "deploy").length, 1);
  const create = calls.find((args) => args[0] === "deploy");
  assert(create.includes("--no-dev-os"));
  assert(create.includes("--no-public-logs"));
  assert(
    !create.includes("--wait"),
    "identity must be captured before readiness polling",
  );
  assert(
    calls.some((args) => args[0] === "cvms" && args.includes(`app_${appId}`)),
  );
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  assert.equal(receipt.appId, appId);
  assert.equal(receipt.vmUuid, vmUuid);
  assert.equal(receipt.status, "pending");
  assert.equal(receipt.revision, "d".repeat(40));
  assert(!JSON.stringify(receipt).includes("secret-not-for-receipt"));
});

test("existing identities and invalid inputs prevent creation", async (t) => {
  const { calls, options } = fixture(t);
  for (const change of [
    { infrastructure: undefined },
    { infrastructure: { ...infrastructure, region: "" } },
    { image: "image:latest" },
    { revision: "bad" },
  ]) {
    await assert.rejects(setupCvm({ ...options, ...change }));
    assert.equal(calls.length, 0);
  }
  await assert.rejects(
    setupCvm({
      ...options,
      run: async (args) => {
        calls.push(args);
        return JSON.stringify(page([app({ name: options.name })]));
      },
    }),
    /recovery/,
  );
  assert(!calls.some((args) => args[0] === "deploy"));
});

test("timeout retains the pending identity; retry cannot overwrite the receipt", async (t) => {
  const { calls, options, receiptFile } = fixture(t);
  const base = options.run;
  options.run = async (args) =>
    args[0] === "cvms"
      ? JSON.stringify(detail({ status: "starting" }))
      : base(args);
  await assert.rejects(setupCvm(options), /readiness/);
  assert.equal(JSON.parse(fs.readFileSync(receiptFile)).appId, appId);
  assert.equal(calls.filter((args) => args[0] === "deploy").length, 1);
  await assert.rejects(setupCvm(options), /overwrite/);
});

test("wrong identity or posture is fatal and keeps the public recovery receipt", async (t) => {
  for (const mismatch of [
    { app_id: "b".repeat(40) },
    { vm_uuid: "22222222-2222-4333-8444-555555555555" },
    { name: "wrong-service" },
    { public_logs: true },
    { os: { name: infrastructure.osImage, is_dev: true } },
    { node_info: { region: "eu-west-1" } },
  ]) {
    const { options, receiptFile } = fixture(t);
    const base = options.run;
    options.run = async (args) =>
      args[0] === "cvms" ? JSON.stringify(detail(mismatch)) : base(args);
    await assert.rejects(setupCvm(options), /identity|infrastructure/);
    assert.equal(JSON.parse(fs.readFileSync(receiptFile)).appId, appId);
  }
});

test("a failed creation is not retried and failed reads preserve the pending identity", async (t) => {
  const { options, calls, receiptFile } = fixture(t);
  const base = options.run;
  options.run = async (args) => {
    if (args[0] === "deploy") {
      calls.push(args);
      throw new Error("private-upstream-sentinel");
    }
    return base(args);
  };
  await assert.rejects(setupCvm(options));
  assert.equal(calls.filter((args) => args[0] === "deploy").length, 1);
  assert(!fs.existsSync(receiptFile));
  options.run = async (args) => {
    if (args[0] === "cvms") throw new Error("private-upstream-sentinel");
    return base(args);
  };
  await assert.rejects(setupCvm(options), /readiness/);
  assert.equal(JSON.parse(fs.readFileSync(receiptFile)).appId, appId);
});

test("CLI refuses untrusted invocation before reading credentials and never echoes malformed input", (t) => {
  const { options } = fixture(t);
  const result = spawnSync(
    process.execPath,
    ["scripts/phala-setup-cli.mjs", "preflight"],
    {
      encoding: "utf8",
      env: {
        ...env,
        GITHUB_EVENT_NAME: "push",
        DEFAULT_BRANCH: "main",
        PHALA_POLICY: "private-malformed-sentinel",
        RUNNER_TEMP: path.dirname(options.receiptFile),
      },
    },
  );
  assert.equal(result.status, 1);
  assert(!result.stderr.includes("private-malformed-sentinel"));
  assert(!fs.existsSync(options.receiptFile));
});

test("pinned official CLI exposes pending apps and raw identity under the selected API", async () => {
  assert.equal(
    JSON.parse(fs.readFileSync("node_modules/phala/package.json", "utf8"))
      .version,
    "1.1.22",
  );
  const current = {
    ...detail(),
    id: vmUuid,
    gateway: {},
    compose_hash: "c".repeat(64),
    kms_type: "phala",
    kms_info: { encrypted_env_pubkey: "a".repeat(64) },
  };
  const payload = page([
    app({ id: appId, current_cvm: current }),
    app({
      id: "b".repeat(40),
      app_id: "b".repeat(40),
      name: "service-pending",
    }),
  ]);
  const preload = `import http from 'node:http'; import https from 'node:https'; import net from 'node:net'; import tls from 'node:tls'; import {syncBuiltinESMExports} from 'node:module';
const denied=()=>{throw new Error('Real network forbidden');};http.request=http.get=https.request=https.get=net.connect=net.createConnection=tls.connect=denied;syncBuiltinESMExports();
globalThis.fetch=async(raw,options)=>{const u=new URL(typeof raw==='string'?raw:raw.url);if(u.origin!=='https://cloud-api.phala.com')throw new Error('Unexpected origin');const headers=new Headers(options?.headers);if(headers.get('X-Phala-Version')!=='2026-06-23')throw new Error('Wrong API version');let data;if(u.pathname.endsWith('/apps'))data=${JSON.stringify(payload)};else if(u.pathname.endsWith('/status/batch'))data={${JSON.stringify(vmUuid)}:{vm_uuid:${JSON.stringify(vmUuid)},status:'running',in_progress:false}};else if(u.pathname.endsWith('/cvms/app_' + ${JSON.stringify(appId)}))data=${JSON.stringify(current)};else throw new Error('Unexpected network operation');return Response.json(data);};`;
  const run = async (args) => {
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        `data:text/javascript,${encodeURIComponent(preload)}`,
        "node_modules/phala/dist/index.js",
        ...args,
        "--api-version",
        "2026-06-23",
      ],
      {
        encoding: "utf8",
        timeout: 10000,
        env: {
          PATH: process.env.PATH,
          HOME: os.tmpdir(),
          PHALA_CLOUD_API_KEY: "synthetic-test-key",
        },
      },
    );
    assert.equal(child.status, 0, child.stderr + child.stdout);
    return child.stdout;
  };
  const apps = await appInventory(run);
  assert.equal(apps.length, 2);
  assert.throws(() => requireAbsentApp(apps, "service-pending"), /recovery/);
  assert.equal(apps[1].current_cvm, null);
  const result = JSON.parse(
    await run(["cvms", "get", `app_${appId}`, "--json"]),
  );
  assert.equal(result.app_id, appId);
  assert.equal(result.vm_uuid, vmUuid);
  assert.equal(result.node_info.region, "US-WEST-1");
});

test("workflow CLI stages preserve the receipt through HTTP acceptance and withhold upstream errors", (t) => {
  const { options, receiptFile } = fixture(t);
  const root = path.dirname(receiptFile);
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(root, "phala-api-key"),
    "synthetic-cli-credential",
  );
  fs.writeFileSync(path.join(root, "phala.env"), "TOKEN=synthetic-runtime\n");
  fs.writeFileSync(
    path.join(bin, "npx"),
    `#!${process.execPath}\nconst args=process.argv.slice(2);if(process.env.TEST_FAIL){process.stdout.write('private-upstream-sentinel');process.exit(1);}if(args[2]==='api')process.stdout.write(${JSON.stringify(JSON.stringify(page([])))});else if(args[2]==='deploy')process.stdout.write(${JSON.stringify(JSON.stringify({ success: true, name: options.name, app_id: appId, vm_uuid: vmUuid }))});else process.stdout.write(${JSON.stringify(JSON.stringify(detail({ public_url: "https://service.example" })))});\n`,
    { mode: 0o700 },
  );
  const output = path.join(root, "outputs");
  const invoke = (phase, extra = {}) =>
    spawnSync(process.execPath, ["scripts/phala-setup-cli.mjs", phase], {
      encoding: "utf8",
      env: {
        ...env,
        PATH: `${bin}:${process.env.PATH}`,
        DEFAULT_BRANCH: "main",
        PHALA_POLICY: JSON.stringify({
          targets: {
            release: { cvmName: options.name, setup: infrastructure },
          },
        }),
        TARGET_ROLE: "release",
        RUNNER_TEMP: root,
        GITHUB_SHA: options.revision,
        IMAGE_REPOSITORY: "ghcr.io/example/service/app",
        IMAGE_DIGEST: `sha256:${"c".repeat(64)}`,
        COMPOSE_FILE: options.composeFile,
        GITHUB_OUTPUT: output,
        ...extra,
      },
    });
  for (const phase of ["preflight", "create", "url"]) {
    const child = invoke(phase);
    assert.equal(child.status, 0, `${phase}: ${child.stderr}`);
  }
  const saved = path.join(root, "phala-setup.json");
  assert.equal(JSON.parse(fs.readFileSync(saved)).status, "pending");
  assert.equal(
    fs.readFileSync(output, "utf8"),
    `app-id=${appId}\ncompose-hash=${"c".repeat(64)}\ndeployment-url=https://service.example\n`,
  );
  assert.equal(invoke("ready").status, 0);
  assert.equal(JSON.parse(fs.readFileSync(saved)).status, "ready");
  const failed = invoke("url", { TEST_FAIL: "1" });
  assert.equal(failed.status, 1);
  assert(
    !(failed.stdout + failed.stderr).includes("private-upstream-sentinel"),
  );
});

test("creation response mismatch preserves valid returned IDs for recovery", async (t) => {
  const { options, receiptFile } = fixture(t);
  const base = options.run;
  options.run = async (args) =>
    args[0] === "deploy"
      ? JSON.stringify({
          success: true,
          app_id: appId,
          vm_uuid: vmUuid,
          name: "unexpected-service",
        })
      : base(args);
  await assert.rejects(setupCvm(options), /identity/);
  assert.equal(JSON.parse(fs.readFileSync(receiptFile)).appId, appId);
});

test("explicit update preserves app identity, checks posture before mutation, and never creates", async (t) => {
  const { options, calls } = fixture(t);
  const base = options.run;
  options.operation = "update";
  options.run = async (args) =>
    args[0] === "api"
      ? JSON.stringify(
          page([app({ name: options.name, current_cvm: detail() })]),
        )
      : base(args);
  await setupCvm(options);
  const deployment = calls.find((args) => args[0] === "deploy");
  assert(deployment.includes("--cvm-id"));
  assert(deployment.includes(`app_${appId}`));
  assert(!deployment.includes("--name"));
  const absent = fixture(t);
  await assert.rejects(
    setupCvm({ ...absent.options, operation: "update" }),
    /existing CVM/,
  );
  assert(!absent.calls.some((args) => args[0] === "deploy"));
  const wrong = fixture(t);
  const wrongBase = wrong.options.run;
  await assert.rejects(
    setupCvm({
      ...wrong.options,
      operation: "update",
      run: async (args) =>
        args[0] === "api"
          ? JSON.stringify(
              page([app({ name: options.name, current_cvm: detail() })]),
            )
          : args[0] === "cvms"
            ? JSON.stringify(detail({ public_logs: true }))
            : wrongBase(args),
    }),
    /infrastructure/,
  );
  assert(!wrong.calls.some((args) => args[0] === "deploy"));
});
