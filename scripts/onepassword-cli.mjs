// Load a target's runtime configuration from its 1Password sources into a private
// {vars, secrets} file for the shared deploy steps. Values never reach the log:
// every secret is masked before anything else is printed, and errors identify
// keys only.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { loadConfiguration, maskCommands } from "./onepassword.mjs";

try {
  const token = process.env.OP_SERVICE_ACCOUNT_TOKEN;
  if (!token)
    throw new Error("The 1Password service account token secret is not set");
  const output = process.env.OUTPUT_FILE;
  if (!output) throw new Error("OUTPUT_FILE is required");
  const run = async (args) => {
    const result = spawnSync("op", args, {
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        OP_SERVICE_ACCOUNT_TOKEN: token,
      },
    });
    if (result.status !== 0) throw new Error("1Password CLI failed");
    return result.stdout;
  };
  const values = await loadConfiguration(
    run,
    {
      configurationEnvironment:
        process.env.CONFIGURATION_ENVIRONMENT || undefined,
      networkConfiguration: JSON.parse(
        process.env.NETWORK_CONFIGURATION || "null",
      ),
    },
    {
      secrets: JSON.parse(process.env.SECRET_NAMES || "[]"),
      variables: JSON.parse(process.env.VARIABLE_NAMES || "[]"),
      workflowVariables: JSON.parse(
        process.env.WORKFLOW_VARIABLE_NAMES || "[]",
      ),
    },
  );
  for (const command of maskCommands(values))
    process.stdout.write(`${command}\n`);
  fs.writeFileSync(output, JSON.stringify(values), { mode: 0o600, flag: "wx" });
  process.stdout.write(
    `Loaded ${Object.keys(values.vars).length} public values and ${Object.keys(values.secrets).length} secrets from 1Password\n`,
  );
} catch (error) {
  process.stderr.write(`::error::${error.message}\n`);
  process.exitCode = 1;
}
