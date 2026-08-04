import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse, printParseErrorCode } from "jsonc-parser";

const QUALITY_PATH = ".github/quality-policy.jsonc";
const DEPLOYMENT_PATH = ".github/deployment-policy.jsonc";
const NPM_PATH = ".github/npm-policy.jsonc";
const PHALA_PATH = ".github/phala-policy.jsonc";
const REQUIRED_COMMANDS = [
  "install",
  "lint",
  "prettier",
  "typeCheck",
  "test",
  "coverage",
  "build",
];
const REQUIRED_COVERAGE_THRESHOLDS = ["lines", "functions", "branches"];
// Role to GitHub Environment name. For standard and chain this is also the
// wrangler environment name. `single` has no wrangler environment at all — see
// validateDeploymentPolicy.
const TOPOLOGIES = {
  standard: { candidate: "staging", release: "production" },
  chain: { candidate: "testnet", release: "mainnet" },
  single: null,
};

function resolvePolicyPath(root, configuredPath, defaultPath, label) {
  const relativePath = configuredPath || defaultPath;
  requireString(relativePath, label);
  if (path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be relative to the repository root`);
  }
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relativeToRoot = path.relative(resolvedRoot, resolvedPath);
  if (relativeToRoot === ".." || relativeToRoot.startsWith(`..${path.sep}`)) {
    throw new Error(`${label} must stay inside the repository root`);
  }
  if (path.extname(resolvedPath) !== ".jsonc") {
    throw new Error(`${label} must name a .jsonc file`);
  }
  return resolvedPath;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value !== value.trim()) {
    throw new Error(`${label} must not contain surrounding whitespace`);
  }
}

export function parseJsonc(source, sourceName) {
  const errors = [];
  const value = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length) {
    const details = errors
      .map(({ error, offset }) => `${printParseErrorCode(error)} at ${offset}`)
      .join(", ");
    throw new Error(`${sourceName} is invalid JSONC: ${details}`);
  }
  return value;
}

export function validateQualityPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("quality policy must be an object");
  }
  if (policy.schemaVersion !== 1) {
    throw new Error("quality schemaVersion must equal 1");
  }
  requireString(policy.workingDirectory, "quality workingDirectory");
  if (!policy.commands || typeof policy.commands !== "object") {
    throw new Error("quality commands must be an object");
  }
  for (const command of REQUIRED_COMMANDS) {
    requireString(policy.commands[command], `quality commands.${command}`);
  }
  if (policy.commands.validate !== undefined) {
    requireString(policy.commands.validate, "quality commands.validate");
  }
  if (
    !policy.coverageThresholds ||
    typeof policy.coverageThresholds !== "object" ||
    Array.isArray(policy.coverageThresholds)
  ) {
    throw new Error("quality coverageThresholds must be an object");
  }
  for (const metric of REQUIRED_COVERAGE_THRESHOLDS) {
    const threshold = policy.coverageThresholds[metric];
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
      throw new Error(
        `quality coverageThresholds.${metric} must be an integer from 0 to 100`,
      );
    }
  }
  return policy;
}

export function validateDeploymentPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("deployment policy must be an object");
  }
  if (policy.schemaVersion !== 1) {
    throw new Error("deployment schemaVersion must equal 1");
  }
  if (!(policy.topology in TOPOLOGIES)) {
    throw new Error("deployment topology must be standard, chain, or single");
  }
  if (!["manual", "automatic"].includes(policy.promotionMode)) {
    throw new Error("promotionMode must be manual or automatic");
  }
  if (!["npm", "pnpm", "yarn"].includes(policy.packageManager)) {
    throw new Error("packageManager must be npm, pnpm, or yarn");
  }
  requireString(policy.workingDirectory, "deployment workingDirectory");
  requireString(policy.versionFile, "deployment versionFile");
  if (policy.releasePrefix === undefined) {
    policy.releasePrefix = "";
  } else if (
    typeof policy.releasePrefix !== "string" ||
    (policy.releasePrefix !== "" &&
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(policy.releasePrefix))
  ) {
    throw new Error(
      "deployment releasePrefix must be empty or a lowercase letters-and-numbers slug",
    );
  }

  const single = policy.topology === "single";

  // GitHub Environment secret names to publish as Worker secrets before each
  // deploy. This exists because developers do not have Cloudflare access, so
  // `wrangler secret put` is not something they can run — GitHub is the only
  // place they can hold a secret, and the deploy has to carry it across.
  //
  // An explicit allowlist rather than "forward everything": the deploy job can
  // see every secret the caller inherits, which includes the Cloudflare API
  // token itself. Forwarding by default would publish that token into the
  // Worker.
  if (policy.workerSecrets === undefined) {
    policy.workerSecrets = [];
  } else if (!Array.isArray(policy.workerSecrets)) {
    throw new Error("deployment workerSecrets must be an array");
  } else {
    const seen = new Set();
    for (const name of policy.workerSecrets) {
      requireString(name, "deployment workerSecrets entry");
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
        throw new Error(
          `deployment workerSecrets entry ${name} must be an uppercase environment-variable name`,
        );
      }
      if (seen.has(name)) {
        throw new Error(`deployment workerSecrets lists ${name} twice`);
      }
      seen.add(name);
    }
    // Naming any of these would publish a credential into the Worker, where any
    // code in it — or anyone who can read a binding — has it. GITHUB_TOKEN is
    // on the list because GitHub puts the job token in the secrets context
    // automatically: nobody has to configure it, so the missing-secret check
    // would pass and the job's own token, carrying this job's permissions,
    // would be written into the Worker.
    for (const reserved of [
      "BURNT_CLOUDFLARE_API_TOKEN",
      "BURNT_CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
      "GITHUB_TOKEN",
    ]) {
      if (seen.has(reserved)) {
        throw new Error(
          `deployment workerSecrets must not include ${reserved}: that is the deployment credential`,
        );
      }
    }
  }

  // Normalized rather than read as an optional key, because a missing key
  // reaches workflow `if:` conditions as null, and GitHub casts both null and
  // false to 0 when comparing across types. Emitting an explicit boolean keeps
  // the condition unambiguous.
  if (policy.previewReleaseOnMain === undefined) {
    // Under single there is one Worker, and the main flow already uploads it as
    // the candidate. A release preview would upload the same build to the same
    // place a second time.
    policy.previewReleaseOnMain = !single;
  } else if (typeof policy.previewReleaseOnMain !== "boolean") {
    throw new Error("deployment previewReleaseOnMain must be a boolean");
  } else if (single && policy.previewReleaseOnMain) {
    // Rejected rather than quietly corrected. Flipping a value the author wrote
    // is the kind of silent divergence between declared and actual behaviour
    // this schema exists to prevent.
    throw new Error(
      "single topology cannot set previewReleaseOnMain: candidate and release are the same Worker",
    );
  }

  const expected = TOPOLOGIES[policy.topology];
  for (const role of ["candidate", "release"]) {
    const target = policy.targets?.[role];
    if (!target || typeof target !== "object") {
      throw new Error(`deployment targets.${role} must be an object`);
    }
    for (const field of ["githubEnvironment", "url"]) {
      requireString(target[field], `deployment targets.${role}.${field}`);
    }

    if (single) {
      // There is no wrangler environment to name. These repositories have no
      // `env` block, and cloudflare-version.yml omits `--env` entirely for this
      // topology — passing one would fail with "No environment found in
      // configuration".
      if (target.wranglerEnv !== undefined) {
        throw new Error(
          `single topology forbids targets.${role}.wranglerEnv: the Worker has no wrangler environment`,
        );
      }
    } else {
      requireString(
        target.wranglerEnv,
        `deployment targets.${role}.wranglerEnv`,
      );
      if (target.wranglerEnv !== expected[role]) {
        throw new Error(
          `${policy.topology} topology requires targets.${role}.wranglerEnv=${expected[role]}`,
        );
      }
      if (target.githubEnvironment !== target.wranglerEnv) {
        throw new Error(
          `targets.${role}.githubEnvironment must equal wranglerEnv`,
        );
      }
    }

    if (
      target.githubEnvironment === "preview" ||
      target.githubEnvironment.startsWith("preview-")
    ) {
      throw new Error("preview-specific GitHub Environments are forbidden");
    }
  }

  // One Worker means one address. Divergent urls would put a wrong link in the
  // GitHub deployment and the release notes.
  if (single && policy.targets.candidate.url !== policy.targets.release.url) {
    throw new Error(
      "single topology requires targets.candidate.url and targets.release.url to match",
    );
  }
  if (
    single &&
    policy.targets.candidate.githubEnvironment !==
      policy.targets.release.githubEnvironment
  ) {
    throw new Error(
      "single topology requires targets.candidate.githubEnvironment and targets.release.githubEnvironment to match",
    );
  }
  return policy;
}

export function validateNpmPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("npm policy must be an object");
  }
  if (policy.schemaVersion !== 1) {
    throw new Error("npm schemaVersion must equal 1");
  }
  if (!["manual", "automatic"].includes(policy.promotionMode)) {
    throw new Error("npm promotionMode must be manual or automatic");
  }
  requireString(policy.workingDirectory, "npm workingDirectory");
  requireString(policy.versionFile, "npm versionFile");
  if (policy.access !== "public") {
    throw new Error("npm access must be public");
  }
  requireString(policy.candidateDistTag, "npm candidateDistTag");
  requireString(policy.releaseDistTag, "npm releaseDistTag");
  if (policy.candidateDistTag === policy.releaseDistTag) {
    throw new Error("npm candidate and release dist-tags must differ");
  }
  if (policy.releaseDistTag !== "latest") {
    throw new Error("npm releaseDistTag must be latest");
  }
  return policy;
}

function validateEnvironmentNames(values, label, reserved = []) {
  if (!Array.isArray(values)) {
    throw new Error(`${label} must be an array`);
  }
  const seen = new Set();
  for (const name of values) {
    requireString(name, `${label} entry`);
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      throw new Error(
        `${label} entry ${name} must be an uppercase environment-variable name`,
      );
    }
    if (seen.has(name)) {
      throw new Error(`${label} lists ${name} twice`);
    }
    if (reserved.includes(name)) {
      throw new Error(`${label} must not include reserved name ${name}`);
    }
    seen.add(name);
  }
  return seen;
}

export function validatePhalaPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("Phala policy must be an object");
  }
  if (policy.schemaVersion !== 1) {
    throw new Error("Phala schemaVersion must equal 1");
  }
  requireString(policy.workingDirectory, "Phala workingDirectory");
  requireString(policy.composeFile, "Phala composeFile");
  requireString(policy.healthcheckPath, "Phala healthcheckPath");
  if (!policy.healthcheckPath.startsWith("/")) {
    throw new Error("Phala healthcheckPath must start with /");
  }

  if (!policy.image || typeof policy.image !== "object") {
    throw new Error("Phala image must be an object");
  }
  for (const field of [
    "context",
    "dockerfile",
    "name",
    "composeVariable",
    "registryUsername",
  ]) {
    requireString(policy.image[field], `Phala image.${field}`);
  }
  if (policy.image.registry !== "ghcr.io") {
    throw new Error("Phala image.registry must equal ghcr.io");
  }
  const imageComponent = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
  if (
    !policy.image.name.split("/").every((part) => imageComponent.test(part))
  ) {
    throw new Error(
      "Phala image.name must be a lowercase container image path",
    );
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(policy.image.composeVariable)) {
    throw new Error(
      "Phala image.composeVariable must be an uppercase environment-variable name",
    );
  }

  if (!policy.credentials || typeof policy.credentials !== "object") {
    throw new Error("Phala credentials must be an object");
  }
  for (const field of ["phalaApiKeySecret", "registryPasswordSecret"]) {
    requireString(policy.credentials[field], `Phala credentials.${field}`);
    if (!/^[A-Z][A-Z0-9_]*$/.test(policy.credentials[field])) {
      throw new Error(
        `Phala credentials.${field} must be an uppercase environment-variable name`,
      );
    }
  }
  if (
    policy.credentials.phalaApiKeySecret ===
    policy.credentials.registryPasswordSecret
  ) {
    throw new Error("Phala credential secret names must differ");
  }

  const reserved = [
    "GITHUB_TOKEN",
    "DSTACK_DOCKER_REGISTRY",
    "DSTACK_DOCKER_USERNAME",
    "DSTACK_DOCKER_PASSWORD",
    policy.image.composeVariable,
    policy.credentials.phalaApiKeySecret,
    policy.credentials.registryPasswordSecret,
  ];
  const secretNames = validateEnvironmentNames(
    policy.runtimeSecrets,
    "Phala runtimeSecrets",
    reserved,
  );
  const variableNames = validateEnvironmentNames(
    policy.runtimeVariables,
    "Phala runtimeVariables",
    reserved,
  );
  for (const name of secretNames) {
    if (variableNames.has(name)) {
      throw new Error(
        `Phala environment name ${name} cannot be both a secret and a variable`,
      );
    }
  }

  for (const role of ["candidate", "release"]) {
    const target = policy.targets?.[role];
    if (!target || typeof target !== "object") {
      throw new Error(`Phala targets.${role} must be an object`);
    }
    requireString(
      target.githubEnvironment,
      `Phala targets.${role}.githubEnvironment`,
    );
    requireString(target.cvmName, `Phala targets.${role}.cvmName`);
    if (!/^[a-z](?!.*--)[a-z0-9-]{3,61}[a-z0-9]$/.test(target.cvmName)) {
      throw new Error(
        `Phala targets.${role}.cvmName must be 5-63 characters, start with a lowercase letter, end with a letter or digit, and contain no consecutive hyphens`,
      );
    }
    const githubEnvironment = target.githubEnvironment.toLowerCase();
    if (
      githubEnvironment === "preview" ||
      githubEnvironment.startsWith("preview-")
    ) {
      throw new Error("preview-specific GitHub Environments are forbidden");
    }
  }

  if (
    policy.environmentSecrets !== undefined ||
    policy.environmentVariables !== undefined ||
    policy.sync !== undefined
  ) {
    throw new Error(
      "Phala policy uses runtimeSecrets/runtimeVariables; URL synchronization belongs in the caller",
    );
  }
  return policy;
}

export function loadPolicies(
  root = process.cwd(),
  deploymentRequired = false,
  npmRequired = false,
  phalaRequired = false,
  policyPaths = {},
) {
  const qualityFile = resolvePolicyPath(
    root,
    policyPaths.quality,
    QUALITY_PATH,
    "quality policy path",
  );
  const quality = validateQualityPolicy(
    parseJsonc(fs.readFileSync(qualityFile, "utf8"), qualityFile),
  );
  let deployment;
  const deploymentFile = resolvePolicyPath(
    root,
    policyPaths.deployment,
    DEPLOYMENT_PATH,
    "deployment policy path",
  );
  if (deploymentRequired || fs.existsSync(deploymentFile)) {
    deployment = validateDeploymentPolicy(
      parseJsonc(fs.readFileSync(deploymentFile, "utf8"), deploymentFile),
    );
  }
  let npm;
  const npmFile = resolvePolicyPath(
    root,
    policyPaths.npm,
    NPM_PATH,
    "npm policy path",
  );
  if (npmRequired || fs.existsSync(npmFile)) {
    npm = validateNpmPolicy(
      parseJsonc(fs.readFileSync(npmFile, "utf8"), npmFile),
    );
  }
  let phala;
  const phalaFile = resolvePolicyPath(
    root,
    policyPaths.phala,
    PHALA_PATH,
    "Phala policy path",
  );
  if (phalaRequired || fs.existsSync(phalaFile)) {
    phala = validatePhalaPolicy(
      parseJsonc(fs.readFileSync(phalaFile, "utf8"), phalaFile),
    );
  }
  return { quality, deployment, npm, phala };
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) {
    throw new Error("GITHUB_OUTPUT is required");
  }
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

export function runPolicy() {
  const deploymentRequired = process.argv.includes("--deployment");
  const npmRequired = process.argv.includes("--npm");
  const phalaRequired = process.argv.includes("--phala");
  const { quality, deployment, npm, phala } = loadPolicies(
    process.env.POLICY_ROOT ?? process.cwd(),
    deploymentRequired,
    npmRequired,
    phalaRequired,
    {
      quality: process.env.QUALITY_POLICY_PATH,
      deployment: process.env.DEPLOYMENT_POLICY_PATH,
      npm: process.env.NPM_POLICY_PATH,
      phala: process.env.PHALA_POLICY_PATH,
    },
  );
  writeOutput("quality", JSON.stringify(quality));
  if (deployment) {
    writeOutput("deployment", JSON.stringify(deployment));
    writeOutput("promotion-mode", deployment.promotionMode);
  }
  if (npm) {
    writeOutput("npm", JSON.stringify(npm));
    writeOutput("npm-promotion-mode", npm.promotionMode);
  }
  if (phala) {
    writeOutput("phala", JSON.stringify(phala));
  }
}
