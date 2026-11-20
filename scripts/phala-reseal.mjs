import { setTimeout as sleep } from "node:timers/promises";
import { appInventory } from "./phala-setup.mjs";

// Reseal an existing CVM's sealed environment from the caller's policy and restart it,
// without building an image or changing the compose file, so its attested identity stays.
// Phala replaces the whole sealed environment on update and cannot read it back, so the
// new one is exactly the names the CVM's compose allows, each sourced from policy.

export const REGISTRY_KEYS = [
  "DSTACK_DOCKER_REGISTRY",
  "DSTACK_DOCKER_USERNAME",
  "DSTACK_DOCKER_PASSWORD",
];
const appIdPattern = /^[a-f0-9]{40}$/;
function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** The one live CVM carrying the target's name. Reseal never creates or picks between CVMs. */
export async function resealTarget(run, name) {
  const apps = (await appInventory(run)).filter(
    (app) => app.name === name || app.current_cvm?.name === name,
  );
  check(
    apps.length === 1 && apps[0].current_cvm?.name === name,
    `Reseal requires exactly one running CVM named ${name}`,
  );
  return apps[0].app_id;
}

/** CVM detail from the raw API, reduced to what a reseal reads. */
export async function cvmDetail(run, appId) {
  check(appIdPattern.test(appId ?? ""), "Invalid Phala app id");
  let detail;
  try {
    detail = JSON.parse(
      await run(["api", `/cvms/app_${appId}`, "--method", "GET"]),
    );
  } catch {
    throw new Error("Unable to read the Phala CVM");
  }
  const allowed = detail?.compose_file?.allowed_envs;
  const compose = detail?.compose_file?.docker_compose_file;
  check(
    detail?.app_id === appId &&
      Array.isArray(allowed) &&
      allowed.every((name) => /^[A-Z_][A-Z0-9_]*$/.test(name)) &&
      new Set(allowed).size === allowed.length &&
      typeof compose === "string",
    "Malformed Phala CVM detail",
  );
  const endpoint = (detail.endpoints ?? [])
    .map((value) => value?.app)
    .find((url) => typeof url === "string" && url.startsWith("https://"));
  return {
    allowedEnvs: allowed,
    compose,
    endpoint,
    inProgress: detail.in_progress === true,
  };
}

/**
 * The sealed environment: every name the CVM allows, each from policy. A name the CVM
 * allows that policy cannot supply would be erased by the update, so it fails closed.
 * Policy names the CVM does not allow never reach its containers and are left out.
 */
export function resealEnvironment({ policy, allowedEnvs, secrets, variables }) {
  const sources = new Map([
    ...policy.runtimeSecrets.map((name) => [name, () => secrets[name]]),
    ...policy.runtimeVariables.map((name) => [name, () => variables[name]]),
    ["DSTACK_DOCKER_REGISTRY", () => policy.image.registry],
    ["DSTACK_DOCKER_USERNAME", () => policy.image.registryUsername],
    [
      "DSTACK_DOCKER_PASSWORD",
      () => secrets[policy.credentials.registryPasswordSecret],
    ],
  ]);
  check(allowedEnvs.length > 0, "The CVM has no sealed environment to reseal");
  const unknown = allowedEnvs.filter((name) => !sources.has(name));
  check(
    unknown.length === 0,
    `The CVM seals names its policy does not declare: ${unknown.join(" ")}`,
  );
  const registry = REGISTRY_KEYS.filter((name) => allowedEnvs.includes(name));
  check(
    registry.length === 0 || registry.length === REGISTRY_KEYS.length,
    "The CVM seals only part of its registry login",
  );
  const environment = allowedEnvs.map((name) => [name, sources.get(name)()]);
  const missing = environment
    .filter(([, value]) => typeof value !== "string" || value.length === 0)
    .map(([name]) => name);
  check(
    missing.length === 0,
    `Declared Phala configuration not set: ${missing.join(" ")}`,
  );
  return Object.fromEntries(environment);
}

/** Digest-pinned images the CVM pulls from the policy's registry. */
export function registryImages(compose, registry) {
  const images = [];
  for (const [, reference] of compose.matchAll(
    /^[ \t]*image:[ \t]*["']?([^\s"']+)["']?[ \t]*$/gm,
  )) {
    if (!reference.startsWith(`${registry}/`)) continue;
    const match = reference
      .slice(registry.length + 1)
      .match(/^([a-z0-9][a-z0-9._/-]*)@(sha256:[a-f0-9]{64})$/);
    check(match, `Registry image is not pinned by digest: ${reference}`);
    images.push({ repository: match[1], digest: match[2] });
  }
  return images;
}

/** Prove the sealed login pulls every registry image before the CVM depends on it. */
export async function proveRegistryAccess({
  registry,
  images,
  username,
  password,
  fetchImpl = fetch,
}) {
  check(images.length > 0, "The CVM pulls no image from its registry");
  const basic = Buffer.from(`${username}:${password}`).toString("base64");
  for (const { repository, digest } of images) {
    const exchange = await fetchImpl(
      `https://${registry}/token?scope=repository:${repository}:pull&service=${registry}`,
      { headers: { authorization: `Basic ${basic}` }, redirect: "error" },
    );
    const token = exchange.ok ? (await exchange.json()).token : undefined;
    check(
      typeof token === "string" && token.length > 0,
      `The registry login cannot pull ${repository}`,
    );
    const manifest = await fetchImpl(
      `https://${registry}/v2/${repository}/manifests/${digest}`,
      {
        method: "HEAD",
        headers: {
          authorization: `Bearer ${token}`,
          accept: [
            "application/vnd.oci.image.index.v1+json",
            "application/vnd.oci.image.manifest.v1+json",
            "application/vnd.docker.distribution.manifest.list.v2+json",
            "application/vnd.docker.distribution.manifest.v2+json",
          ].join(","),
        },
        redirect: "error",
      },
    );
    check(
      manifest.status === 200,
      `The registry login cannot pull ${repository}@${digest}`,
    );
  }
}

/** Seal, let Phala settle, restart. The workflow's health check proves the boot. */
export async function resealCvm({
  appId,
  envFile,
  run,
  wait = sleep,
  attempts = 60,
}) {
  const settled = async () => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (!(await cvmDetail(run, appId)).inProgress) return;
      await wait(10000);
    }
    throw new Error("The Phala CVM did not settle");
  };
  await settled();
  await run(["envs", "update", `app_${appId}`, "-e", envFile]);
  await settled();
  await run(["cvms", "restart", `app_${appId}`]);
}
