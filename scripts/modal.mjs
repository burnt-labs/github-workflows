import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { parseTree, getNodeValue } from "jsonc-parser";

// Modal 1.6.3 config._SETTINGS plus meta-options. Review with every SDK bump.
const modalControls = new Set(
  `ASYNC_WARNINGS BUILD_VALIDATION CUDA_CHECKPOINT_PATH DEFAULT_CLOUD DEV_SUFFIX DISABLE_API_PROXY ENVIRONMENT FORCE_BUILD FUNCTION_RUNTIME FUNCTION_RUNTIME_DEBUG HEARTBEAT_INTERVAL IGNORE_CACHE IMAGE_BUILDER_VERSION IMAGE_ID LOGLEVEL LOGS_TIMEOUT LOG_FORMAT LOG_PATTERN MAX_THROTTLE_WAIT OAUTH_CLIENT_ID OAUTH_CLIENT_SECRET OAUTH_JWT_KEY OAUTH_REFRESH_TOKEN OVERRIDE_HEADERS PAYLOAD_FORMAT RESTORE_STATE_PATH RUNTIME_PERF_RECORD SANDBOX_CHANNEL_IDLE_TIMEOUT SANDBOX_V2 SERVER_URL SERVE_TIMEOUT SNAPSHOT_DEBUG SYNC_ENTRYPOINT TASK_ID TOKEN_ID TOKEN_SECRET TRACEBACK USE_CONTROL_PLANE_SIDECAR_CREATE VOLUME_BLOCK_READ_TIMEOUT WORKER_ID CONFIG_PATH PROFILE IS_REMOTE`
    .split(" ")
    .map((name) => `MODAL_${name}`),
);

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const controlName =
  /(?:^|_)(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|ACCESS_KEY)(?:_|$)/;

function object(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Modal ${label} must be an object`);
  if (keys && Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error(`Modal ${label} has unknown fields`);
}

function text(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value))
    throw new Error(`Modal ${label} is invalid`);
}

function relative(value, label) {
  text(value, /^(?:\.|[A-Za-z0-9_.][A-Za-z0-9_.\/-]*)$/, label);
  if (value.split("/").includes(".."))
    throw new Error(`Modal ${label} must not traverse parents`);
}

function variable(name) {
  text(name, /^[A-Z][A-Z0-9_]*$/, "variable name");
  if (
    controlName.test(name) ||
    modalControls.has(name) ||
    /^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE)$/.test(
      name,
    ) ||
    /^(?:PATH|HOME|SHELL|ENV|BASH_ENV|IFS|CDPATH|NODE_OPTIONS|NODE_PATH|VIRTUAL_ENV|MODAL_ENVIRONMENT|MODAL_CONFIG_PATH|MODAL_PROFILE)$/.test(
      name,
    ) ||
    /^(?:PYTHON|PIP_|LD_|DYLD_|GITHUB_|ACTIONS_|RUNNER_)/.test(name)
  )
    throw new Error(
      "Modal variables must not override control configuration or credentials",
    );
}

export function validateModalPolicy(policy) {
  object(
    policy,
    [
      "schemaVersion",
      "workingDirectory",
      "entrypoint",
      "pythonVersion",
      "image",
      "targets",
    ],
    "policy",
  );
  if (policy.schemaVersion !== 1)
    throw new Error("Modal schemaVersion must equal 1");
  relative(policy.workingDirectory, "workingDirectory");
  relative(policy.entrypoint, "entrypoint");
  if (!policy.entrypoint.endsWith(".py"))
    throw new Error("Modal entrypoint must name a Python file");
  text(policy.pythonVersion, /^3\.(?:10|11|12|13|14)$/, "pythonVersion");
  object(
    policy.image,
    ["repository", "repositoryVariable", "tagVariable"],
    "image",
  );
  text(
    policy.image.repository,
    /^[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/,
    "image.repository",
  );
  for (const name of [
    policy.image.repositoryVariable,
    policy.image.tagVariable,
  ])
    variable(name);
  if (policy.image.repositoryVariable === policy.image.tagVariable)
    throw new Error("Modal image variable names must differ");
  object(policy.targets, null, "targets");
  if (
    Object.keys(policy.targets).length < 1 ||
    Object.keys(policy.targets).length > 16
  )
    throw new Error("Modal requires 1-16 targets");
  for (const [name, target] of Object.entries(policy.targets)) {
    text(name, slug, "target name");
    object(target, ["githubEnvironment", "variables"], "target");
    text(
      target.githubEnvironment,
      /^[A-Za-z0-9][A-Za-z0-9_. -]{0,254}$/,
      "githubEnvironment",
    );
    if (/^preview(?:-|$)/i.test(target.githubEnvironment))
      throw new Error("Modal preview-specific environments are forbidden");
    object(target.variables, null, "variables");
    if (Object.keys(target.variables).length > 64)
      throw new Error("Modal supports at most 64 public variables per target");
    for (const [key, value] of Object.entries(target.variables)) {
      variable(key);
      if (
        [policy.image.repositoryVariable, policy.image.tagVariable].includes(
          key,
        )
      )
        throw new Error(
          "Modal image variables cannot overlap target variables",
        );
      text(value, /^[^\x00-\x1f\x7f]{1,4096}$/, "variable value");
    }
  }
  return policy;
}

function inside(root, relativePath, label) {
  relative(relativePath, label);
  let current = fs.realpathSync(root);
  for (const part of relativePath.split("/")) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink())
      throw new Error(`Modal ${label} must not contain symlinks`);
  }
  return current;
}

export function loadModalPolicy(
  root,
  policyPath = ".github/modal-policy.jsonc",
) {
  const file = inside(root, policyPath, "policy path");
  if (!file.endsWith(".jsonc"))
    throw new Error("Modal policy path must name a .jsonc file");
  const errors = [];
  const tree = parseTree(fs.readFileSync(file, "utf8"), errors, {
    allowTrailingComma: true,
  });
  if (errors.length || !tree) throw new Error("Modal policy is invalid JSONC");
  function rejectDuplicates(node) {
    if (node.type === "object") {
      const names = node.children.map((property) => property.children[0].value);
      if (new Set(names).size !== names.length)
        throw new Error("Modal policy has duplicate keys");
    }
    for (const child of node.children ?? []) rejectDuplicates(child);
  }
  rejectDuplicates(tree);
  return validateModalPolicy(getNodeValue(tree));
}

export function assertReviewedSource(
  root,
  { eventName, ref, defaultBranch, sourceSha },
) {
  if (!["push", "workflow_dispatch"].includes(eventName))
    throw new Error(
      "Modal deployment requires push or workflow_dispatch, never PR events",
    );
  text(ref, /^refs\/(?:heads|tags)\/[^\s]+$/, "source ref");
  text(sourceSha, /^[0-9a-f]{40}$/, "source SHA");
  text(defaultBranch, /^[A-Za-z0-9_][A-Za-z0-9_.\/-]*$/, "default branch");
  const git = (...args) =>
    spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (git("check-ref-format", `refs/heads/${defaultBranch}`).status !== 0)
    throw new Error("Modal default branch is invalid");
  const head = git("rev-parse", "HEAD");
  if (head.status !== 0 || head.stdout.trim() !== sourceSha)
    throw new Error("Modal checkout does not match the invocation SHA");
  if (
    git(
      "merge-base",
      "--is-ancestor",
      sourceSha,
      `refs/remotes/origin/${defaultBranch}`,
    ).status !== 0
  )
    throw new Error(
      "Modal source must be reviewed: an ancestor of the protected default branch",
    );
}

export function deployModal(plan, { python, tokenId, tokenSecret }) {
  if (
    typeof tokenId !== "string" ||
    !tokenId.trim() ||
    typeof tokenSecret !== "string" ||
    !tokenSecret.trim()
  )
    throw new Error(
      "Modal credentials MODAL_TOKEN_ID and MODAL_TOKEN_SECRET are required",
    );
  for (const name of Object.keys(plan.variables)) variable(name);
  // No caller secrets/vars context, persisted Modal profile, Python injection
  // variables, GitHub job token or install hook environment reaches the app.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "burnt-modal-"));
  try {
    const result = spawnSync(
      python,
      ["-m", "modal", "deploy", plan.entrypoint],
      {
        cwd: plan.cwd,
        stdio: "inherit",
        env: {
          PATH: process.env.PATH,
          LANG: "C.UTF-8",
          HOME: home,
          PYTHONNOUSERSITE: "1",
          MODAL_CONFIG_PATH: path.join(home, "modal.toml"),
          ...plan.variables,
          MODAL_TOKEN_ID: tokenId,
          MODAL_TOKEN_SECRET: tokenSecret,
        },
      },
    );
    if (result.error || result.status !== 0)
      throw new Error("Modal deploy failed");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

export function resolveModalDeployment(root, policy, target, imageTag) {
  validateModalPolicy(policy);
  if (!Object.hasOwn(policy.targets, target))
    throw new Error("Modal target does not exist");
  text(imageTag, /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/, "image tag (required)");
  const cwd = inside(root, policy.workingDirectory, "workingDirectory");
  if (!fs.statSync(cwd).isDirectory())
    throw new Error("Modal workingDirectory must be a directory");
  const entrypoint = inside(cwd, policy.entrypoint, "entrypoint");
  if (!fs.statSync(entrypoint).isFile())
    throw new Error("Modal entrypoint must be a file");
  return {
    cwd,
    entrypoint,
    pythonVersion: policy.pythonVersion,
    githubEnvironment: policy.targets[target].githubEnvironment,
    variables: {
      ...policy.targets[target].variables,
      [policy.image.repositoryVariable]: policy.image.repository,
      [policy.image.tagVariable]: imageTag,
    },
  };
}
