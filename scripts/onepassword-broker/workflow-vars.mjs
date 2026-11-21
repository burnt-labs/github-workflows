import fs from "node:fs";
import { createClient } from "@1password/sdk";
import { readBrokerWorkflowVariables } from "./reader.mjs";

try {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is required");
  const publicValues = await readBrokerWorkflowVariables(
    process.env,
    createClient,
  );
  fs.appendFileSync(output, `configuration=${JSON.stringify(publicValues)}\n`);
} catch (error) {
  process.stderr.write(`::error::${error.message}\n`);
  process.exitCode = 1;
}
