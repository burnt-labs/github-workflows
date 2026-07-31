import assert from "node:assert/strict";
import test from "node:test";
import {
  parseJsonc,
  validateDeploymentPolicy,
  validateNpmPolicy,
  validatePhalaPolicy,
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

function singleDeploymentPolicy() {
  const target = {
    githubEnvironment: "production",
    url: "https://worker.example.com",
  };
  return {
    schemaVersion: 1,
    topology: "single",
    promotionMode: "manual",
    workingDirectory: ".",
    versionFile: "package.json",
    packageManager: "pnpm",
    targets: { candidate: { ...target }, release: { ...target } },
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

function phalaPolicy() {
  return {
    schemaVersion: 1,
    workingDirectory: ".",
    composeFile: "service/docker-compose.phala.yaml",
    healthcheckPath: "/health",
    image: {
      registry: "ghcr.io",
      context: "service",
      dockerfile: "service/Dockerfile",
      name: "service",
      composeVariable: "APP_IMAGE",
      registryUsername: "registry-user",
    },
    credentials: {
      phalaApiKeySecret: "PHALA_CLOUD_API_KEY",
      registryPasswordSecret: "REGISTRY_PASSWORD",
    },
    runtimeSecrets: ["SERVICE_API_KEY"],
    runtimeVariables: ["LOG_LEVEL"],
    targets: {
      candidate: { githubEnvironment: "staging", cvmName: "service-staging" },
      release: {
        githubEnvironment: "production",
        cvmName: "service-production",
      },
    },
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
      workerSecrets: [],
    });
  }
});

test("workerSecrets defaults to none and accepts uppercase names", () => {
  assert.deepEqual(
    validateDeploymentPolicy(deploymentPolicy()).workerSecrets,
    [],
  );

  const named = deploymentPolicy();
  named.workerSecrets = ["API_KEY", "WEBHOOK_SECRET_2"];
  assert.deepEqual(validateDeploymentPolicy(named).workerSecrets, [
    "API_KEY",
    "WEBHOOK_SECRET_2",
  ]);
});

test("workerSecrets rejects malformed and duplicated names", () => {
  for (const [name, pattern] of [
    ["lowercase", /uppercase environment-variable name/],
    ["1LEADING_DIGIT", /uppercase environment-variable name/],
    ["HAS-HYPHEN", /uppercase environment-variable name/],
    ["", /workerSecrets entry/],
  ]) {
    const policy = deploymentPolicy();
    policy.workerSecrets = [name];
    assert.throws(() => validateDeploymentPolicy(policy), pattern);
  }

  const duplicated = deploymentPolicy();
  duplicated.workerSecrets = ["API_KEY", "API_KEY"];
  assert.throws(
    () => validateDeploymentPolicy(duplicated),
    /lists API_KEY twice/,
  );

  const notArray = deploymentPolicy();
  notArray.workerSecrets = "API_KEY";
  assert.throws(() => validateDeploymentPolicy(notArray), /must be an array/);
});

test("workerSecrets cannot forward the deployment credential", () => {
  // The publish step sees every secret the caller inherits. Naming the token
  // here would write it into the Worker, where anything running in it has it.
  for (const reserved of [
    "BURNT_CLOUDFLARE_API_TOKEN",
    "BURNT_CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    // GitHub supplies this one automatically, so nothing has to be configured
    // for it to be present and pass the missing-secret check.
    "GITHUB_TOKEN",
  ]) {
    const policy = deploymentPolicy();
    policy.workerSecrets = [reserved];
    assert.throws(
      () => validateDeploymentPolicy(policy),
      /that is the deployment credential/,
    );
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

test("single topology models one Worker with no wrangler environment", () => {
  const validated = validateDeploymentPolicy(singleDeploymentPolicy());
  assert.equal(validated.targets.candidate.wranglerEnv, undefined);
  assert.equal(validated.targets.release.wranglerEnv, undefined);
  assert.equal(validated.targets.candidate.githubEnvironment, "production");
  assert.equal(validated.targets.release.githubEnvironment, "production");
});

test("single topology forbids naming a wrangler environment", () => {
  // These repositories have no `env` block, and cloudflare-version.yml omits
  // --env for this topology. Accepting the key would let a policy declare
  // something the deploy silently ignores.
  for (const role of ["candidate", "release"]) {
    const policy = singleDeploymentPolicy();
    policy.targets[role].wranglerEnv = "production";
    assert.throws(
      () => validateDeploymentPolicy(policy),
      new RegExp(`single topology forbids targets\\.${role}\\.wranglerEnv`),
    );
  }
});

test("single topology fixes the GitHub Environment to production", () => {
  const policy = singleDeploymentPolicy();
  policy.targets.candidate.githubEnvironment = "staging";
  assert.throws(
    () => validateDeploymentPolicy(policy),
    /single topology requires targets\.candidate\.githubEnvironment=production/,
  );
});

test("single topology defaults previewReleaseOnMain to false and rejects true", () => {
  // One Worker, and the main flow already uploads it as the candidate. A
  // release preview would upload the same build to the same place twice.
  assert.equal(
    validateDeploymentPolicy(singleDeploymentPolicy()).previewReleaseOnMain,
    false,
  );

  const explicit = singleDeploymentPolicy();
  explicit.previewReleaseOnMain = true;
  assert.throws(
    () => validateDeploymentPolicy(explicit),
    /single topology cannot set previewReleaseOnMain/,
  );

  // Explicit false stays false rather than being treated as an error.
  const off = singleDeploymentPolicy();
  off.previewReleaseOnMain = false;
  assert.equal(validateDeploymentPolicy(off).previewReleaseOnMain, false);
});

test("single topology requires both roles to address the same Worker", () => {
  const policy = singleDeploymentPolicy();
  policy.targets.release.url = "https://elsewhere.example.com";
  assert.throws(
    () => validateDeploymentPolicy(policy),
    /targets\.candidate\.url and targets\.release\.url to match/,
  );
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

test("Phala accepts a generic GHCR deployment policy", () => {
  assert.deepEqual(validatePhalaPolicy(phalaPolicy()), phalaPolicy());
});

test("Phala requires concrete deployment and image fields", () => {
  for (const [mutate, pattern] of [
    [(policy) => (policy.healthcheckPath = "api/health"), /must start with/],
    [(policy) => (policy.image.registry = "docker.io"), /must equal ghcr\.io/],
    [(policy) => (policy.image.name = "Cue TEE"), /lowercase container/],
    [(policy) => (policy.image.name = "service/"), /lowercase container/],
    [(policy) => (policy.image.name = "service//api"), /lowercase container/],
    [(policy) => (policy.image.name = "service..api"), /lowercase container/],
    [
      (policy) => (policy.targets.candidate.cvmName = "Cue_TEE"),
      /5-63 characters/,
    ],
    [(policy) => (policy.targets.candidate.cvmName = "cvm"), /5-63 characters/],
    [
      (policy) => (policy.targets.candidate.cvmName = "cue--tee"),
      /5-63 characters/,
    ],
    [
      (policy) => (policy.targets.candidate.githubEnvironment = "preview-demo"),
      /preview-specific/,
    ],
    [
      (policy) => (policy.targets.candidate.githubEnvironment = "PREVIEW-demo"),
      /preview-specific/,
    ],
  ]) {
    const policy = phalaPolicy();
    mutate(policy);
    assert.throws(() => validatePhalaPolicy(policy), pattern);
  }
});

test("Phala environment forwarding is explicit and cannot include credentials", () => {
  for (const name of [
    "PHALA_CLOUD_API_KEY",
    "REGISTRY_PASSWORD",
    "GITHUB_TOKEN",
    "DSTACK_DOCKER_PASSWORD",
    "APP_IMAGE",
  ]) {
    const policy = phalaPolicy();
    policy.runtimeSecrets = [name];
    assert.throws(() => validatePhalaPolicy(policy), /reserved name/);
  }

  const duplicate = phalaPolicy();
  duplicate.runtimeVariables.push("LOG_LEVEL");
  assert.throws(() => validatePhalaPolicy(duplicate), /lists .* twice/);

  const crossed = phalaPolicy();
  crossed.runtimeVariables.push("SERVICE_API_KEY");
  assert.throws(
    () => validatePhalaPolicy(crossed),
    /both a secret and a variable/,
  );
});

test("Phala credentials are named explicitly and cannot overlap", () => {
  for (const field of ["phalaApiKeySecret", "registryPasswordSecret"]) {
    const policy = phalaPolicy();
    policy.credentials[field] = "lowercase";
    assert.throws(() => validatePhalaPolicy(policy), /Phala credentials/);
  }

  const same = phalaPolicy();
  same.credentials.registryPasswordSecret = "PHALA_CLOUD_API_KEY";
  assert.throws(() => validatePhalaPolicy(same), /must differ/);
});

test("Phala rejects the cue-specific legacy policy surface", () => {
  for (const field of ["environmentSecrets", "environmentVariables", "sync"]) {
    const policy = phalaPolicy();
    policy[field] = {};
    assert.throws(() => validatePhalaPolicy(policy), /belongs in the caller/);
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
