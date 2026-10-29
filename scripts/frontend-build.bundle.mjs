// scripts/frontend-build.mjs
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
var object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
var publicName = /^(?:VITE_|NEXT_PUBLIC_|NUXT_PUBLIC_|PUBLIC_)[A-Z0-9_]+$/;
var digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
var safePath = (value) =>
  typeof value === "string" &&
  /^[A-Za-z0-9_./-]+$/.test(value) &&
  !value.startsWith("/") &&
  value
    .split("/")
    .every(
      (part) =>
        part &&
        part !== "." &&
        part !== ".." &&
        !part.startsWith(".") &&
        !["node_modules"].includes(part),
    );
function validateBuildInputs({ buildVariables, buildAssets } = {}) {
  if (buildVariables !== void 0) {
    if (!object(buildVariables) || Object.keys(buildVariables).length > 32)
      throw new Error(
        "buildVariables must be an object with at most 32 entries",
      );
    for (const [name, source] of Object.entries(buildVariables)) {
      if (!publicName.test(name))
        throw new Error("buildVariables may export only public frontend names");
      if (!object(source) || Object.keys(source).length !== 1)
        throw new Error("Each build variable must declare exactly one source");
      const [kind] = Object.keys(source);
      if (kind === "value") {
        if (typeof source.value !== "string" || source.value.length > 16384)
          throw new Error("Build variable value must be a bounded string");
      } else if (kind === "variable") {
        if (!/^[A-Z][A-Z0-9_]*$/.test(source.variable))
          throw new Error("Build variable source must name a GitHub variable");
      } else if (kind === "secret") {
        if (
          !Array.isArray(source.secret) ||
          source.secret.length < 1 ||
          source.secret.length > 4 ||
          source.secret.some(
            (name2) => typeof name2 !== "string" || !publicName.test(name2),
          )
        )
          throw new Error(
            "Build secret sources must name public tokens, never a control credential",
          );
      } else if (kind !== "metadata" || source.metadata !== "version-tag") {
        throw new Error("Unknown build variable source");
      }
    }
  }
  if (buildAssets === void 0) return;
  if (
    !object(buildAssets) ||
    Object.keys(buildAssets).sort().join(",") !== "bucket,objects" ||
    typeof buildAssets.bucket !== "string" ||
    !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(buildAssets.bucket) ||
    !Array.isArray(buildAssets.objects) ||
    buildAssets.objects.length < 1 ||
    buildAssets.objects.length > 32
  )
    throw new Error(
      "buildAssets must declare an R2 bucket and 1\u201332 objects",
    );
  const destinations = /* @__PURE__ */ new Set();
  for (const asset of buildAssets.objects) {
    if (
      !object(asset) ||
      Object.keys(asset).sort().join(",") !== "destinations,key,sha256" ||
      !safePath(asset.key)
    )
      throw new Error("Invalid build asset object key");
    if (!/^[a-f0-9]{64}$/.test(asset.sha256))
      throw new Error("Build assets require SHA-256 checksums");
    if (
      !Array.isArray(asset.destinations) ||
      asset.destinations.length < 1 ||
      asset.destinations.length > 8
    )
      throw new Error("Build assets require 1\u20138 destinations");
    for (const destination of asset.destinations) {
      if (
        !safePath(destination) ||
        !destination.split("/").slice(0, -1).includes("public") ||
        destinations.has(destination)
      )
        throw new Error("Invalid or duplicate static build asset path");
      destinations.add(destination);
    }
  }
}
function resolveBuildVariables(
  spec = {},
  { variables = {}, secrets = {}, versionTag = "" } = {},
) {
  validateBuildInputs({ buildVariables: spec });
  const result = {};
  for (const [name, source] of Object.entries(spec)) {
    let value;
    if (Object.hasOwn(source, "value")) value = source.value;
    else if (source.variable) value = variables[source.variable];
    else if (source.secret)
      value = source.secret.map((key) => secrets[key]).find((value2) => value2);
    else value = versionTag;
    if (
      typeof value !== "string" ||
      value === "" ||
      value.length > 16384 ||
      value.includes("\0")
    )
      throw new Error(`Missing build input or invalid value for ${name}`);
    result[name] = value;
  }
  return result;
}
function destinationPath(root, relative) {
  const base = fs.realpathSync(root);
  let current = base;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink())
      throw new Error("Build asset path contains a symlink");
    if (current !== path.join(base, relative) && !stat.isDirectory())
      throw new Error("Build asset parent is not a directory");
    if (current === path.join(base, relative) && !stat.isFile())
      throw new Error("Build asset destination is not a file");
  }
  return current;
}
async function fetchBuildAssets(
  spec,
  { root, accountId, token, fetcher = fetch } = {},
) {
  validateBuildInputs({ buildAssets: spec });
  if (!spec) return;
  if (
    !/^[a-f0-9]{32}$/.test(accountId || "") ||
    typeof token !== "string" ||
    !token
  )
    throw new Error("Build assets require Cloudflare credentials");
  for (const asset of spec.objects)
    for (const destination of asset.destinations)
      destinationPath(root, destination);
  let total = 0;
  const pending = [];
  for (const asset of spec.objects) {
    const key = asset.key.split("/").map(encodeURIComponent).join("/");
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${spec.bucket}/objects/${key}`;
    let response;
    try {
      response = await fetcher(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(3e4),
      });
    } catch {
      throw new Error("R2 asset request failed");
    }
    if (!response.ok)
      throw new Error(`R2 asset request failed: HTTP ${response.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      total += chunk.length;
      if (size > 10 * 1024 * 1024 || total > 64 * 1024 * 1024) {
        throw new Error("R2 build asset size limit exceeded");
      }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (digest(bytes) !== asset.sha256)
      throw new Error("R2 build asset checksum mismatch");
    pending.push({ asset, bytes });
  }
  for (const { asset, bytes } of pending) {
    for (const relative of asset.destinations) {
      const destination = destinationPath(root, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${randomUUID()}`;
      try {
        fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 420 });
        fs.renameSync(temporary, destination);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    }
  }
}
async function runFrontendBuild() {
  const policy = JSON.parse(process.env.DEPLOYMENT_POLICY);
  const target = policy.targets[process.env.TARGET];
  if (!target) throw new Error("Unknown build target");
  validateBuildInputs({
    buildVariables: target.buildVariables,
    buildAssets: policy.buildAssets,
  });
  const values = resolveBuildVariables(target.buildVariables, {
    variables: JSON.parse(process.env.BUILD_VARIABLES || "{}"),
    secrets: JSON.parse(process.env.BUILD_SECRETS || "{}"),
    versionTag: process.env.VERSION_TAG,
  });
  const workspace = fs.realpathSync(process.cwd());
  const directory = policy.workingDirectory;
  if (directory !== "." && !safePath(directory))
    throw new Error("Invalid build working directory");
  let root = workspace;
  for (const segment of directory === "." ? [] : directory.split("/")) {
    root = path.join(root, segment);
    if (
      !fs.lstatSync(root).isDirectory() ||
      fs.lstatSync(root).isSymbolicLink()
    )
      throw new Error("Invalid build directory or symlink");
  }
  await fetchBuildAssets(policy.buildAssets, {
    root,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
  });
  for (const [name, value] of Object.entries(values)) {
    if (target.buildVariables[name].secret) {
      const escaped = value
        .replaceAll("%", "%25")
        .replaceAll("\r", "%0D")
        .replaceAll("\n", "%0A");
      process.stdout.write(`::add-mask::${escaped}
`);
    }
    const delimiter = `BUILD_${randomUUID()}`;
    fs.appendFileSync(
      process.env.GITHUB_ENV,
      `${name}<<${delimiter}
${value}
${delimiter}
`,
    );
  }
}

// scripts/frontend-build-cli.mjs
try {
  await runFrontendBuild();
} catch {
  process.stderr.write(
    "Frontend build input preparation failed; check declared public inputs, assets and credentials.\n",
  );
  process.exitCode = 1;
}
