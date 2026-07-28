import assert from "node:assert/strict";
import test from "node:test";
import {
  parseJsonc,
  validateDeploymentPolicy,
  validateNpmPolicy,
  validateQualityPolicy,
} from "../scripts/policy.mjs";

function qualityPolicy() {
  return {
    schemaVersion: 1,
    workingDirectory: ".",
    commands: {
      install: "pnpm install --frozen-lockfile",
      lint: "pnpm lint",
      prettier: "pnpm prettier",
      typeCheck: "pnpm type-check",
      test: "pnpm test",
      coverage: "pnpm coverage",
      build: "pnpm build",
    },
  };
}

function npmPolicy() {
  return {
    schemaVersion: 1,
    promotionMode: "manual",
    workingDirectory: ".",
    versionFile: "package.json",
    access: "public",
    candidateDistTag: "next",
    releaseDistTag: "latest",
  };
}

function deploymentPolicy(topology = "standard") {
  const environments =
    topology === "chain"
      ? { candidate: "testnet", release: "mainnet" }
      : { candidate: "staging", release: "production" };
  return {
    schemaVersion: 1,
    topology,
    promotionMode: "manual",
    workingDirectory: ".",
    versionFile: "package.json",
    packageManager: "pnpm",
    targets: Object.fromEntries(
      Object.entries(environments).map(([role, environment]) => [
        role,
        {
          wranglerEnv: environment,
          githubEnvironment: environment,
          url: `https://${environment}.example.com`,
        },
      ]),
    ),
  };
}

test("quality requires every independent gate", () => {
  assert.deepEqual(validateQualityPolicy(qualityPolicy()), qualityPolicy());
  for (const command of ["lint", "prettier", "test", "coverage", "build"]) {
    const policy = qualityPolicy();
    policy.commands[command] = "";
    assert.throws(
      () => validateQualityPolicy(policy),
      new RegExp(`commands\\.${command}`),
    );
  }
});

test("deployment accepts only exact topology environments", () => {
  for (const topology of ["standard", "chain"]) {
    assert.deepEqual(
      validateDeploymentPolicy(deploymentPolicy(topology)),
      deploymentPolicy(topology),
    );
  }
});

test("deployment rejects preview-specific environments", () => {
  const policy = deploymentPolicy();
  policy.targets.candidate.githubEnvironment = "preview-staging";
  assert.throws(
    () => validateDeploymentPolicy(policy),
    /must equal wranglerEnv|preview-specific/,
  );
});

test("JSONC supports comments and trailing commas", () => {
  assert.deepEqual(parseJsonc('{ // comment\n"ok": true,\n}', "test"), {
    ok: true,
  });
});

test("npm requires distinct candidate and latest release tags", () => {
  assert.deepEqual(validateNpmPolicy(npmPolicy()), npmPolicy());
  const sameTag = npmPolicy();
  sameTag.candidateDistTag = "latest";
  assert.throws(() => validateNpmPolicy(sameTag), /must differ/);
  const restricted = npmPolicy();
  restricted.access = "restricted";
  assert.throws(() => validateNpmPolicy(restricted), /must be public/);
});
