import { runFrontendBuild } from "./frontend-build.mjs";

try {
  await runFrontendBuild();
} catch {
  // Never print upstream bodies, credentials, or parser snippets from secrets.
  process.stderr.write(
    "Frontend build input preparation failed; check declared public inputs, assets and credentials.\n",
  );
  process.exitCode = 1;
}
