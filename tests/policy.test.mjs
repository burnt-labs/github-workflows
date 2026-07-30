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
    coverageThresholds: {
      lines: 80,
      functions: 75,
      branches: 70,
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

test("quality requires repository-owned coverage thresholds", () => {
  for (const metric of ["lines", "functions", "branches"]) {
    for (const threshold of [-1, 50.5, 101, "80"]) {
      const policy = qualityPolicy();
      policy.coverageThresholds[metric] = threshold;
      assert.throws(
        () => validateQualityPolicy(policy),
        new RegExp(`coverageThresholds\\.${metric}`),
      );
    }
  }

  const missing = qualityPolicy();
  delete missing.coverageThresholds;
  assert.throws(
    () => validateQualityPolicy(missing),
    /coverageThresholds must be an object/,
  );
});

test("deployment accepts only exact topology environments", () => {
  for (const topology of ["standard", "chain"]) {
    assert.deepEqual(validateDeploymentPolicy(deploymentPolicy(topology)), {
      ...deploymentPolicy(topology),
      previewReleaseOnMain: true,
    });
  }
});

test("deployment normalizes previewReleaseOnMain to an explicit boolean", () => {
  // Workflow `if:` conditions read this directly, and GitHub casts a missing
  // key (null) and false to the same value, so the default must be explicit.
  assert.equal(
    validateDeploymentPolicy(deploymentPolicy()).previewReleaseOnMain,
    true,
  );

  const disabled = deploymentPolicy();
  disabled.previewReleaseOnMain = false;
  assert.equal(validateDeploymentPolicy(disabled).previewReleaseOnMain, false);

  for (const invalid of ["false", 0, null]) {
    const policy = deploymentPolicy();
    policy.previewReleaseOnMain = invalid;
    assert.throws(
      () => validateDeploymentPolicy(policy),
      /previewReleaseOnMain must be a boolean/,
    );
  }
});

test("quality accepts an optional validate command", () => {
  const withValidate = qualityPolicy();
  withValidate.commands.validate = "pnpm validate:deps";
  assert.equal(
    validateQualityPolicy(withValidate).commands.validate,
    "pnpm validate:deps",
  );

  const empty = qualityPolicy();
  empty.commands.validate = "";
  assert.throws(() => validateQualityPolicy(empty), /commands\.validate/);
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
