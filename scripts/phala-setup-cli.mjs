import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  appInventory,
  requireAbsentApp,
  requireSetupInvocation,
  setupCvm,
  validateInfrastructure,
  PHALA_SETUP_API,
  PHALA_SETUP_CLI,
} from "./phala-setup.mjs";

try {
  requireSetupInvocation(process.env, process.env.DEFAULT_BRANCH);
  const policy = JSON.parse(process.env.PHALA_POLICY);
  const targetFile = path.join(process.env.RUNNER_TEMP, "phala-target.json");
  const target = fs.existsSync(targetFile)
    ? JSON.parse(fs.readFileSync(targetFile, "utf8"))
    : policy.targets[process.env.TARGET_ROLE];
  if (!target || !["candidate", "release"].includes(process.env.TARGET_ROLE))
    throw new Error("Invalid target");
  validateInfrastructure(target.setup);
  const receiptFile = path.join(process.env.RUNNER_TEMP, "phala-setup.json");
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
        timeout: args[0] === "deploy" ? 15 * 60 * 1000 : 45000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          PHALA_CLOUD_API_KEY: fs.readFileSync(
            path.join(process.env.RUNNER_TEMP, "phala-api-key"),
            "utf8",
          ),
          DEBUG: "",
          PHALA_DEBUG: "",
        },
      },
    );
    if (result.status !== 0) throw new Error("Phala operation failed");
    return result.stdout;
  };
  const phase = process.argv[2];
  if (phase === "preflight") {
    const apps = await appInventory(run);
    if (process.env.PHALA_OPERATION === "update") {
      const matches = apps.filter(
        (app) =>
          app.name === target.cvmName ||
          app.current_cvm?.name === target.cvmName,
      );
      if (matches.length !== 1 || !matches[0].current_cvm)
        throw new Error("Update requires one existing CVM");
    } else requireAbsentApp(apps, target.cvmName);
  } else if (phase === "create") {
    const record = await setupCvm({
      operation: process.env.PHALA_OPERATION || "setup",
      name: target.cvmName,
      infrastructure: target.setup,
      image: `${process.env.IMAGE_REPOSITORY}@${process.env.IMAGE_DIGEST}`,
      revision: process.env.GITHUB_SHA,
      composeFile: process.env.COMPOSE_FILE,
      envFile: path.join(process.env.RUNNER_TEMP, "phala.env"),
      receiptFile,
      run,
    });
    if (process.env.GITHUB_OUTPUT)
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        `app-id=${record.appId}\ncompose-hash=${record.reportedComposeHash}\n`,
      );
  } else if (phase === "url") {
    const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
    const detail = JSON.parse(
      await run(["cvms", "get", `app_${receipt.appId}`, "--json"]),
    );
    if (detail.app_id !== receipt.appId || detail.vm_uuid !== receipt.vmUuid)
      throw new Error("Identity mismatch");
    const urls = [
      target.publicUrl,
      ...Object.values(detail.endpoints ?? {}).map((value) =>
        typeof value === "object" ? value?.app : value,
      ),
      ...(detail.public_urls ?? []).map((value) => value?.app),
      detail.public_url,
      detail.publicUrl,
    ];
    const url = urls.find(
      (value) => typeof value === "string" && /^https:\/\//.test(value),
    );
    if (!url) throw new Error("No public HTTPS URL");
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      /[\r\n]/.test(url)
    )
      throw new Error("Invalid URL");
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `deployment-url=${url.replace(/\/$/, "")}\n`,
    );
  } else if (phase === "ready") {
    const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
    fs.writeFileSync(
      receiptFile,
      JSON.stringify({ ...receipt, status: "ready" }, null, 2) + "\n",
      { mode: 0o600 },
    );
  } else {
    throw new Error("Invalid phase");
  }
} catch {
  // Upstream output may contain private configuration; never echo it.
  console.error(
    "Phala setup failed. Check invocation, policy and platform inventory; recover the exact identity in the public setup receipt if one exists. Upstream output withheld.",
  );
  process.exitCode = 1;
}
