import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse, printParseErrorCode } from "jsonc-parser";

const QUALITY_PATH = ".github/quality-policy.jsonc";
const DEPLOYMENT_PATH = ".github/deployment-policy.jsonc";
const NPM_PATH = ".github/npm-policy.jsonc";
const REQUIRED_COMMANDS = [
  "install",
  "lint",
  "prettier",
  "typeCheck",
  "test",
  "coverage",
  "build",
];
const TOPOLOGIES = {
  standard: { candidate: "staging", release: "production" },
  chain: { candidate: "testnet", release: "mainnet" },
};

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
    throw new Error("deployment topology must be standard or chain");
  }
  if (!["manual", "automatic"].includes(policy.promotionMode)) {
    throw new Error("promotionMode must be manual or automatic");
  }
  if (!["npm", "pnpm", "yarn"].includes(policy.packageManager)) {
    throw new Error("packageManager must be npm, pnpm, or yarn");
  }
  requireString(policy.workingDirectory, "deployment workingDirectory");
  requireString(policy.versionFile, "deployment versionFile");

  const expected = TOPOLOGIES[policy.topology];
  for (const role of ["candidate", "release"]) {
    const target = policy.targets?.[role];
    if (!target || typeof target !== "object") {
      throw new Error(`deployment targets.${role} must be an object`);
    }
    for (const field of ["wranglerEnv", "githubEnvironment", "url"]) {
      requireString(target[field], `deployment targets.${role}.${field}`);
    }
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
    if (
      target.githubEnvironment === "preview" ||
      target.githubEnvironment.startsWith("preview-")
    ) {
      throw new Error("preview-specific GitHub Environments are forbidden");
    }
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

export function loadPolicies(
  root = process.cwd(),
  deploymentRequired = false,
  npmRequired = false,
) {
  const qualityFile = path.join(root, QUALITY_PATH);
  const quality = validateQualityPolicy(
    parseJsonc(fs.readFileSync(qualityFile, "utf8"), qualityFile),
  );
  let deployment;
  const deploymentFile = path.join(root, DEPLOYMENT_PATH);
  if (deploymentRequired || fs.existsSync(deploymentFile)) {
    deployment = validateDeploymentPolicy(
      parseJsonc(fs.readFileSync(deploymentFile, "utf8"), deploymentFile),
    );
  }
  let npm;
  const npmFile = path.join(root, NPM_PATH);
  if (npmRequired || fs.existsSync(npmFile)) {
    npm = validateNpmPolicy(
      parseJsonc(fs.readFileSync(npmFile, "utf8"), npmFile),
    );
  }
  return { quality, deployment, npm };
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
  const { quality, deployment, npm } = loadPolicies(
    process.env.POLICY_ROOT ?? process.cwd(),
    deploymentRequired,
    npmRequired,
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
}
