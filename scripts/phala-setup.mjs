import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

export const PHALA_SETUP_CLI = "1.1.22";
export const PHALA_SETUP_API = "2026-06-23";
const appIdPattern = /^[a-f0-9]{40}$/;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function check(condition, message) {
  if (!condition) throw new Error(message);
}
export function requireSetupInvocation(env, defaultBranch) {
  check(
    typeof defaultBranch === "string" &&
      defaultBranch.length > 0 &&
      env.GITHUB_ACTIONS === "true" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REF === `refs/heads/${defaultBranch}`,
    "Phala setup requires a manual run from the caller's default branch",
  );
}
export function validateInfrastructure(value) {
  check(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(",") === "instanceType,osImage,region" &&
      /^dstack-\d+\.\d+\.\d+$/.test(value.osImage ?? "") &&
      /^tdx\.[a-z0-9.-]+$/.test(value.instanceType ?? "") &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.region ?? ""),
    "Explicit Phala setup infrastructure requires osImage, instanceType and lowercase region",
  );
  return value;
}
export async function appInventory(run) {
  const apps = [],
    ids = new Set();
  let expected;
  for (let page = 1; page <= 100; page++) {
    let payload;
    try {
      payload = JSON.parse(
        await run([
          "api",
          "/apps",
          "--method",
          "GET",
          "-f",
          `page=${page}`,
          "-f",
          "page_size=100",
        ]),
      );
    } catch {
      throw new Error("Unable to read complete Phala app inventory");
    }
    check(
      payload &&
        Array.isArray(payload.dstack_apps) &&
        payload.page === page &&
        payload.page_size === 100 &&
        Number.isInteger(payload.total) &&
        payload.total >= 0 &&
        Number.isInteger(payload.total_pages) &&
        payload.total_pages <= 100 &&
        (payload.total_pages >= page ||
          (page === 1 && payload.total_pages === 0 && payload.total === 0)),
      "Invalid raw Phala app pagination",
    );
    const metadata = JSON.stringify([payload.total, payload.total_pages]);
    check(
      expected === undefined || expected === metadata,
      "Phala app inventory changed during pagination",
    );
    expected = metadata;
    for (const app of payload.dstack_apps) {
      check(
        app &&
          typeof app.name === "string" &&
          app.name.length > 0 &&
          appIdPattern.test(app.app_id ?? "") &&
          !ids.has(app.app_id),
        "Invalid or duplicate Phala app identity",
      );
      if (app.current_cvm != null)
        check(
          typeof app.current_cvm.name === "string",
          "Malformed current Phala VM metadata",
        );
      if (app.cvms !== undefined)
        check(
          Array.isArray(app.cvms) &&
            app.cvms.every((cvm) => cvm && typeof cvm.name === "string"),
          "Malformed retained Phala VM metadata",
        );
      ids.add(app.app_id);
      apps.push(app);
    }
    if (page >= payload.total_pages) {
      check(apps.length === payload.total, "Incomplete Phala app inventory");
      return apps;
    }
  }
  throw new Error("Incomplete Phala app inventory");
}
export function requireAbsentApp(apps, name) {
  check(
    !apps.some(
      (app) =>
        app.name === name ||
        app.current_cvm?.name === name ||
        app.cvms?.some((cvm) => cvm.name === name),
    ),
    "Existing or pending Phala app requires recovery of its exact identity; setup cannot create another app",
  );
}
export async function setupCvm({
  name,
  infrastructure,
  image,
  revision,
  composeFile,
  envFile,
  receiptFile,
  run,
  wait = sleep,
  attempts = 120,
}) {
  validateInfrastructure(infrastructure);
  check(
    /^[a-z](?!.*--)[a-z0-9-]{3,61}[a-z0-9]$/.test(name ?? ""),
    "Invalid Phala setup name",
  );
  check(
    /^ghcr\.io\/[a-z0-9/._-]+@sha256:[a-f0-9]{64}$/.test(image ?? "") &&
      /^[a-f0-9]{40}$/.test(revision ?? ""),
    "Immutable image and commit identity required",
  );
  check(!fs.existsSync(receiptFile), "Refusing to overwrite a setup receipt");
  requireAbsentApp(await appInventory(run), name);
  // Do not wait in deploy: capture the newly allocated identity before polling.
  const created = JSON.parse(
    await run([
      "deploy",
      "--name",
      name,
      "--compose",
      composeFile,
      "--env",
      envFile,
      "--image",
      infrastructure.osImage,
      "--instance-type",
      infrastructure.instanceType,
      "--region",
      infrastructure.region,
      "--no-dev-os",
      "--no-public-logs",
      "--no-public-sysinfo",
      "--no-listed",
      "--json",
    ]),
  );
  check(
    created &&
      appIdPattern.test(created.app_id ?? "") &&
      uuidPattern.test(created.vm_uuid ?? ""),
    "Invalid created Phala identity; inspect platform inventory before retrying",
  );
  const receipt = {
    schemaVersion: 1,
    status: "pending",
    cvmName: name,
    appId: created.app_id,
    vmUuid: created.vm_uuid,
    image,
    revision,
    infrastructure,
  };
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  check(
    created.success === true && created.name === name,
    "Created Phala identity mismatch; recover the saved identity",
  );
  for (let attempt = 0; attempt < attempts; attempt++) {
    let detail;
    try {
      detail = JSON.parse(
        await run(["cvms", "get", `app_${receipt.appId}`, "--json"]),
      );
    } catch {
      if (attempt + 1 < attempts) await wait(10000);
      continue;
    }
    check(
      detail &&
        detail.app_id === receipt.appId &&
        detail.vm_uuid === receipt.vmUuid &&
        detail.name === name,
      "Created Phala identity mismatch; recover the saved identity",
    );
    if (detail.status === "running") {
      check(
        detail.os?.name === infrastructure.osImage &&
          detail.os?.is_dev === false &&
          detail.resource?.instance_type === infrastructure.instanceType &&
          typeof detail.node_info?.region === "string" &&
          detail.node_info.region.toLowerCase() === infrastructure.region &&
          detail.listed === false &&
          detail.public_logs === false &&
          detail.public_sysinfo === false,
        "Created Phala infrastructure differs from the declared OS, size, region or privacy policy",
      );
      return receipt;
    }
    if (attempt + 1 < attempts) await wait(10000);
  }
  throw new Error(
    "Phala readiness timed out; recover the exact identity in the pending setup receipt",
  );
}
