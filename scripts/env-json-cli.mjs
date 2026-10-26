import {
  materializePublicConfiguration,
  materializeWorkerSecrets,
  materializeVerificationSecrets,
} from "./env-json.mjs";

try {
  const options = {
    policy: JSON.parse(process.env.DEPLOYMENT_POLICY),
    target: process.env.TARGET,
    bundle: process.env.ENVIRONMENT_JSON,
    root: process.env.GITHUB_WORKSPACE,
    runnerTemp: process.env.RUNNER_TEMP,
    operation: process.env.OPERATION,
  };
  if (process.argv[2] === "prepare") materializePublicConfiguration(options);
  else if (process.argv[2] === "secrets") materializeWorkerSecrets(options);
  else if (process.argv[2] === "verification")
    materializeVerificationSecrets(options);
  else throw new Error("Unknown environment bundle operation");
} catch {
  // Do not expose JSON parser snippets, paths, names, or any runtime values.
  process.stderr.write(
    "Environment bundle materialization failed; verify its schema, declared keys and generated configuration path.\n",
  );
  process.exitCode = 1;
}
