import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  cvmDetail,
  proveRegistryAccess,
  registryImages,
  resealCvm,
  resealEnvironment,
  resealTarget,
  REGISTRY_KEYS,
} from "./phala-reseal.mjs";
import {
  requireSetupInvocation,
  PHALA_SETUP_API,
  PHALA_SETUP_CLI,
} from "./phala-setup.mjs";

const envFile = path.join(process.env.RUNNER_TEMP ?? "", "phala-reseal.env");
try {
  requireSetupInvocation(process.env, process.env.DEFAULT_BRANCH);
  const policy = JSON.parse(process.env.PHALA_POLICY);
  const role = process.env.TARGET_ROLE;
  if (!["candidate", "release"].includes(role) || !policy.targets?.[role])
    throw new Error("Invalid target");
  const target = policy.targets[role];
  const secrets = JSON.parse(process.env.ALL_SECRETS);
  const variables = JSON.parse(process.env.ALL_VARIABLES);
  // A 1Password-sourced policy: the declared runtime names come from the
  // target's item (loaded into a private file), not the GitHub Environment.
  const itemFile = process.env.RUNTIME_CONFIGURATION_FILE;
  if (policy.credentials.onePasswordTokenSecret) {
    if (!itemFile || !fs.existsSync(itemFile))
      throw new Error("The 1Password runtime configuration was not loaded");
    const loaded = JSON.parse(fs.readFileSync(itemFile, "utf8"));
    fs.rmSync(itemFile, { force: true });
    for (const name of policy.runtimeSecrets)
      secrets[name] = loaded.secrets[name];
    for (const name of policy.runtimeVariables)
      variables[name] = loaded.vars[name];
  }
  const apiKey = secrets[policy.credentials.phalaApiKeySecret];
  if (!apiKey)
    throw new Error(
      `Declared Phala configuration not set: ${policy.credentials.phalaApiKeySecret}`,
    );
  const run = async (args) => {
    const result = spawnSync(
      "npx",
      [
        "--yes",
        `phala@${PHALA_SETUP_CLI}`,
        ...args,
        "--api-version",
        PHALA_SETUP_API,
        "--timeout",
        "30",
      ],
      {
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          ALL_SECRETS: "",
          PHALA_CLOUD_API_KEY: apiKey,
          DEBUG: "",
          PHALA_DEBUG: "",
        },
      },
    );
    if (result.status !== 0) throw new Error("Phala operation failed");
    return result.stdout;
  };

  const appId = await resealTarget(run, target.cvmName);
  const detail = await cvmDetail(run, appId);
  const environment = resealEnvironment({
    policy,
    allowedEnvs: detail.allowedEnvs,
    secrets,
    variables,
  });
  if (REGISTRY_KEYS.every((name) => name in environment))
    await proveRegistryAccess({
      registry: policy.image.registry,
      images: registryImages(detail.compose, policy.image.registry),
      username: environment.DSTACK_DOCKER_USERNAME,
      password: environment.DSTACK_DOCKER_PASSWORD,
    });
  const quote = (value) =>
    `"${String(value)
      .replaceAll("\\", "\\\\")
      .replaceAll("\n", "\\n")
      .replaceAll("\r", "\\r")
      .replaceAll('"', '\\"')}"`;
  fs.writeFileSync(
    envFile,
    Object.entries(environment)
      .map(([key, value]) => `${key}=${quote(value)}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  await resealCvm({ appId, envFile, run });
  fs.rmSync(envFile, { force: true });
  const url = (target.publicUrl ?? detail.endpoint ?? "").replace(/\/$/, "");
  if (!url.startsWith("https://"))
    throw new Error("Phala CVM metadata did not contain a public HTTPS URL");
  process.stdout.write(
    `Resealed ${target.cvmName} (app_${appId}): ${Object.keys(environment).join(" ")}\n`,
  );
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `app-id=${appId}\ndeployment-url=${url}\n`,
    );
} catch (error) {
  process.stderr.write(`::error::${error.message}\n`);
  process.exitCode = 1;
} finally {
  fs.rmSync(envFile, { force: true });
}
