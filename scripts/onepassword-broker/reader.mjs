import fs from "node:fs";
import { loadConfiguration, maskCommands } from "../onepassword.mjs";

async function oidcToken(audience, env) {
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (url.protocol !== "https:" || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
    throw new Error("GitHub workload identity is unavailable");
  url.searchParams.set("audience", audience);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("GitHub denied workload identity");
  const { value } = await response.json();
  if (typeof value !== "string" || !value)
    throw new Error("GitHub did not return workload identity");
  return value;
}

export async function readBrokerConfiguration(
  env,
  createClient,
  fetchIdentity,
) {
  const key = env.OP_INTEGRATION_KEY?.replace(/=+$/, "");
  if (!key) throw new Error("OP_INTEGRATION_KEY is missing");
  const target = {
    configurationEnvironment: env.CONFIGURATION_ENVIRONMENT || undefined,
    networkConfiguration:
      JSON.parse(env.NETWORK_CONFIGURATION || "null") ?? undefined,
  };
  const names = {
    secrets: JSON.parse(env.SECRET_NAMES || "[]"),
    variables: JSON.parse(env.VARIABLE_NAMES || "[]"),
  };
  async function read(id) {
    const network = id === target.networkConfiguration?.environment;
    const workloadUuid = network
      ? env.OP_NETWORK_WORKLOAD_ID
      : env.OP_WORKLOAD_ID;
    if (!workloadUuid)
      throw new Error(
        network
          ? "OP_NETWORK_WORKLOAD_ID is missing"
          : "OP_WORKLOAD_ID is missing",
      );
    try {
      const client = await createClient({
        integrationName: "Burnt GitHub Workflows",
        integrationVersion: "1.0.0",
        oidcFetcher: (audience) => fetchIdentity(audience, env),
        workloadDetails: { workloadUuid, customerManagedSecret: key },
      });
      const { variables } = await client.environments.getVariables(id);
      return variables.map(({ name, value, masked }) => ({
        name,
        concealed: masked,
        value: network && masked ? undefined : value,
      }));
    } catch {
      throw new Error(
        "1Password Broker could not read the assigned Environment",
      );
    }
  }
  return loadConfiguration(undefined, target, names, read);
}

export async function writeBrokerConfiguration(env) {
  const { createClient } = await import("@1password/sdk");
  const output = env.OUTPUT_FILE;
  if (!output) throw new Error("OUTPUT_FILE is required");
  const values = await readBrokerConfiguration(env, createClient, oidcToken);
  for (const command of maskCommands(values))
    process.stdout.write(`${command}\n`);
  fs.writeFileSync(output, JSON.stringify(values), { mode: 0o600, flag: "wx" });
  process.stdout.write(
    "Verified the declared 1Password runtime configuration\n",
  );
}
