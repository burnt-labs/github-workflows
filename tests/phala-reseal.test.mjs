import assert from "node:assert/strict";
import test from "node:test";
import {
  cvmDetail,
  proveRegistryAccess,
  registryImages,
  resealCvm,
  resealEnvironment,
  resealTarget,
} from "../scripts/phala-reseal.mjs";

const appId = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const policy = {
  image: { registry: "ghcr.io", registryUsername: "burnt-labs" },
  credentials: {
    phalaApiKeySecret: "PHALA_KEY",
    registryPasswordSecret: "GHCR_READ_TOKEN",
  },
  runtimeSecrets: ["SERVICE_TOKEN"],
  runtimeVariables: ["SERVICE_URL"],
};
const secrets = { GHCR_READ_TOKEN: "read-token", SERVICE_TOKEN: "s3cret" };
const variables = { SERVICE_URL: "https://example.test" };
const login = [
  "DSTACK_DOCKER_REGISTRY",
  "DSTACK_DOCKER_USERNAME",
  "DSTACK_DOCKER_PASSWORD",
];
const inventory = (apps) =>
  JSON.stringify({
    dstack_apps: apps,
    page: 1,
    page_size: 100,
    total: apps.length,
    total_pages: 1,
  });
const app = (name, current = name, id = appId) => ({
  app_id: id,
  name,
  current_cvm: current === null ? null : { name: current },
  cvms: [],
});
const detail = (overrides = {}) => ({
  app_id: appId,
  in_progress: false,
  endpoints: [{ app: "https://app.example.test" }],
  compose_file: {
    allowed_envs: login,
    docker_compose_file: `services:\n  app:\n    image: ghcr.io/org/repo/service@${digest}\n`,
  },
  ...overrides,
});

test("reseal targets exactly one live CVM by name", async () => {
  const run = async () =>
    inventory([app("other", "other", "c".repeat(40)), app("service")]);
  assert.equal(await resealTarget(run, "service"), appId);
  // An app renamed since setup is still found by its live CVM's name.
  assert.equal(
    await resealTarget(
      async () => inventory([app("legacy", "service")]),
      "service",
    ),
    appId,
  );
  for (const apps of [
    [],
    [app("service", null)],
    [app("service"), app("service", "service", "d".repeat(40))],
    [app("service", "replacement")],
  ])
    await assert.rejects(
      resealTarget(async () => inventory(apps), "service"),
      /exactly one running CVM named service/,
    );
});

test("CVM detail is read from the raw API and validated", async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    return JSON.stringify(detail());
  };
  assert.deepEqual(await cvmDetail(run, appId), {
    allowedEnvs: login,
    compose: detail().compose_file.docker_compose_file,
    endpoint: "https://app.example.test",
    inProgress: false,
  });
  assert.deepEqual(calls, [["api", `/cvms/app_${appId}`, "--method", "GET"]]);
  await assert.rejects(cvmDetail(run, "nope"), /Invalid Phala app id/);
  await assert.rejects(
    cvmDetail(async () => "not json", appId),
    /Unable to read the Phala CVM/,
  );
  for (const broken of [
    { app_id: "c".repeat(40) },
    { compose_file: { allowed_envs: ["lower"], docker_compose_file: "" } },
    { compose_file: { allowed_envs: ["A", "A"], docker_compose_file: "" } },
    { compose_file: { allowed_envs: [] } },
  ])
    await assert.rejects(
      cvmDetail(async () => JSON.stringify(detail(broken)), appId),
      /Malformed Phala CVM detail/,
    );
  const bare = await cvmDetail(
    async () =>
      JSON.stringify(detail({ endpoints: undefined, in_progress: true })),
    appId,
  );
  assert.equal(bare.endpoint, undefined);
  assert.equal(bare.inProgress, true);
});

test("the sealed environment is exactly what the CVM allows, sourced from policy", () => {
  assert.deepEqual(
    resealEnvironment({ policy, allowedEnvs: login, secrets, variables }),
    {
      DSTACK_DOCKER_REGISTRY: "ghcr.io",
      DSTACK_DOCKER_USERNAME: "burnt-labs",
      DSTACK_DOCKER_PASSWORD: "read-token",
    },
  );
  assert.deepEqual(
    resealEnvironment({
      policy,
      allowedEnvs: ["SERVICE_TOKEN", "SERVICE_URL"],
      secrets,
      variables,
    }),
    { SERVICE_TOKEN: "s3cret", SERVICE_URL: "https://example.test" },
  );
});

test("a reseal never erases or half-writes sealed values", () => {
  const reseal = (allowedEnvs, overrides = {}) =>
    resealEnvironment({
      policy,
      allowedEnvs,
      secrets,
      variables,
      ...overrides,
    });
  assert.throws(() => reseal([]), /no sealed environment/);
  assert.throws(
    () => reseal(["SERVICE_TOKEN", "UNDECLARED"]),
    /policy does not declare: UNDECLARED/,
  );
  assert.throws(
    () => reseal(["DSTACK_DOCKER_PASSWORD"]),
    /only part of its registry login/,
  );
  assert.throws(
    () => reseal(["SERVICE_TOKEN", ...login], { secrets: {} }),
    /not set: SERVICE_TOKEN DSTACK_DOCKER_PASSWORD/,
  );
  assert.throws(
    () => reseal(["SERVICE_URL"], { variables: { SERVICE_URL: "" } }),
    /not set: SERVICE_URL/,
  );
});

test("registry images must be pinned by digest; other registries are ignored", () => {
  const compose = [
    "services:",
    "  app:",
    `    image: ghcr.io/org/repo/service@${digest}`,
    "  sidecar:",
    `    image: "ghcr.io/org/repo/sidecar@${digest}"`,
    "  ingress:",
    `    image: dstacktee/dstack-ingress:2.3@${digest}`,
    `    # image: ghcr.io/org/commented:latest`,
  ].join("\n");
  assert.deepEqual(registryImages(compose, "ghcr.io"), [
    { repository: "org/repo/service", digest },
    { repository: "org/repo/sidecar", digest },
  ]);
  assert.deepEqual(registryImages("services: {}", "ghcr.io"), []);
  assert.throws(
    () => registryImages("    image: ghcr.io/org/app:latest", "ghcr.io"),
    /not pinned by digest: ghcr.io\/org\/app:latest/,
  );
});

test("the login must pull every registry image before it is sealed", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push([
      url,
      options.method ?? "GET",
      options.headers.authorization,
    ]);
    if (url.includes("/token?"))
      return { ok: true, json: async () => ({ token: "pull" }) };
    return { status: 200 };
  };
  await proveRegistryAccess({
    registry: "ghcr.io",
    images: [{ repository: "org/repo/service", digest }],
    username: "burnt-labs",
    password: "read-token",
    fetchImpl,
  });
  assert.deepEqual(requests, [
    [
      "https://ghcr.io/token?scope=repository:org/repo/service:pull&service=ghcr.io",
      "GET",
      `Basic ${Buffer.from("burnt-labs:read-token").toString("base64")}`,
    ],
    [
      `https://ghcr.io/v2/org/repo/service/manifests/${digest}`,
      "HEAD",
      "Bearer pull",
    ],
  ]);
  const images = [{ repository: "org/repo/service", digest }];
  await assert.rejects(
    proveRegistryAccess({ registry: "ghcr.io", images: [], fetchImpl }),
    /pulls no image from its registry/,
  );
  await assert.rejects(
    proveRegistryAccess({
      registry: "ghcr.io",
      images,
      fetchImpl: async () => ({ ok: false }),
    }),
    /cannot pull org\/repo\/service$/,
  );
  await assert.rejects(
    proveRegistryAccess({
      registry: "ghcr.io",
      images,
      fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    }),
    /cannot pull org\/repo\/service$/,
  );
  await assert.rejects(
    proveRegistryAccess({
      registry: "ghcr.io",
      images,
      fetchImpl: async (url) =>
        url.includes("/token?")
          ? { ok: true, json: async () => ({ token: "pull" }) }
          : { status: 401 },
    }),
    /cannot pull org\/repo\/service@sha256/,
  );
});

test("reseal waits for the CVM to settle, seals, settles again, then restarts", async () => {
  const calls = [];
  let busy = 2;
  const run = async (args) => {
    calls.push(args[0] === "api" ? "detail" : args.join(" "));
    if (args[0] === "api")
      return JSON.stringify(detail({ in_progress: busy-- > 0 }));
    return "";
  };
  let waits = 0;
  await resealCvm({
    appId,
    envFile: "/tmp/reseal.env",
    run,
    wait: async () => waits++,
  });
  assert.deepEqual(calls, [
    "detail",
    "detail",
    "detail",
    `envs update app_${appId} -e /tmp/reseal.env`,
    "detail",
    `cvms restart app_${appId}`,
  ]);
  assert.equal(waits, 2);
  await assert.rejects(
    resealCvm({
      appId,
      envFile: "/tmp/reseal.env",
      run: async () => JSON.stringify(detail({ in_progress: true })),
      wait: async () => {},
      attempts: 3,
    }),
    /did not settle/,
  );
});
