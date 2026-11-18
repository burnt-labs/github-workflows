import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseTree, getNodeValue } from "jsonc-parser";

// Everything this helper decides is decided here, not in workflow YAML:
// policy validation, the invocation guard, which credentials reach Terragrunt,
// destroy/replace detection, the reviewed-plan fingerprint and the summary.

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semver = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const secretName = /^[A-Z_][A-Z0-9_]{0,127}$/;
const variableName = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const roleArn = /^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]{1,512}$/;
const region = /^[a-z]{2}(?:-gov|-iso[a-z]*)?-[a-z]+-\d$/;
const environment = /^[A-Za-z0-9][A-Za-z0-9_. -]{0,254}$/;
const maxListedChanges = 50;

function object(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Terragrunt ${label} must be an object`);
  if (keys && Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error(`Terragrunt ${label} has unknown fields`);
}

function text(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value))
    throw new Error(`Terragrunt ${label} is invalid`);
}

function optionalBoolean(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean")
    throw new Error(`Terragrunt ${label} must be a boolean`);
  return value;
}

function relative(value, label) {
  text(value, /^(?:\.|[A-Za-z0-9_.][A-Za-z0-9_.\/-]*)$/, label);
  if (value.split("/").includes(".."))
    throw new Error(`Terragrunt ${label} must not traverse parents`);
}

function githubEnvironment(value, label) {
  text(value, environment, label);
  if (/^preview(?:-|$)/i.test(value))
    throw new Error("Terragrunt preview-specific environments are forbidden");
}

function variableSecrets(value, label) {
  if (value === undefined) return {};
  object(value, null, label);
  const entries = Object.entries(value);
  if (entries.length > 32)
    throw new Error(`Terragrunt ${label} supports at most 32 variables`);
  for (const [name, secret] of entries) {
    text(name, variableName, `${label} variable name`);
    text(secret, secretName, `${label} secret name`);
    if (/^(?:GITHUB_|ACTIONS_|RUNNER_)/.test(secret))
      throw new Error(`Terragrunt ${label} cannot read GitHub-reserved names`);
  }
  return { ...value };
}

function stage(value, label, keys) {
  object(value, keys, label);
  githubEnvironment(value.githubEnvironment, `${label}.githubEnvironment`);
  text(value.awsRoleArn, roleArn, `${label}.awsRoleArn`);
  return {
    githubEnvironment: value.githubEnvironment,
    awsRoleArn: value.awsRoleArn,
    variableSecrets: variableSecrets(
      value.variableSecrets,
      `${label}.variableSecrets`,
    ),
  };
}

export function validateTerragruntPolicy(policy) {
  object(policy, ["schemaVersion", "stacks"], "policy");
  if (policy.schemaVersion !== 1)
    throw new Error("Terragrunt schemaVersion must equal 1");
  object(policy.stacks, null, "stacks");
  const names = Object.keys(policy.stacks);
  if (names.length < 1 || names.length > 32)
    throw new Error("Terragrunt requires 1-32 stacks");
  const stacks = {};
  for (const name of names) {
    text(name, slug, "stack name");
    const stack = policy.stacks[name];
    object(
      stack,
      ["workingDirectory", "awsRegion", "credentials", "plan", "apply"],
      `stack ${name}`,
    );
    relative(stack.workingDirectory, `${name}.workingDirectory`);
    text(stack.awsRegion, region, `${name}.awsRegion`);
    let cloudflareApiTokenSecret = null;
    if (stack.credentials !== undefined) {
      object(
        stack.credentials,
        ["cloudflareApiTokenSecret"],
        `${name}.credentials`,
      );
      text(
        stack.credentials.cloudflareApiTokenSecret,
        secretName,
        `${name}.credentials.cloudflareApiTokenSecret`,
      );
      cloudflareApiTokenSecret = stack.credentials.cloudflareApiTokenSecret;
    }
    const plan = stage(stack.plan, `${name}.plan`, [
      "githubEnvironment",
      "awsRoleArn",
      "variableSecrets",
      "lock",
      "failOnDestroyOrReplace",
    ]);
    plan.lock = optionalBoolean(stack.plan.lock, true, `${name}.plan.lock`);
    plan.failOnDestroyOrReplace = optionalBoolean(
      stack.plan.failOnDestroyOrReplace,
      true,
      `${name}.plan.failOnDestroyOrReplace`,
    );
    const apply = stage(stack.apply, `${name}.apply`, [
      "githubEnvironment",
      "awsRoleArn",
      "variableSecrets",
    ]);
    // Pull-request plans run the branch's Terraform with the plan stage's
    // credentials. Sharing an environment would hand those branches the apply
    // credentials, or make every plan wait for the apply approval.
    if (plan.githubEnvironment === apply.githubEnvironment)
      throw new Error(
        "Terragrunt plan and apply must use distinct GitHub Environments",
      );
    for (const secrets of [plan.variableSecrets, apply.variableSecrets])
      if (Object.values(secrets).includes(cloudflareApiTokenSecret))
        throw new Error(
          "Terragrunt variableSecrets cannot forward the Cloudflare credential",
        );
    stacks[name] = {
      workingDirectory: stack.workingDirectory,
      awsRegion: stack.awsRegion,
      cloudflareApiTokenSecret,
      plan,
      apply,
    };
  }
  return { schemaVersion: 1, stacks };
}

function inside(root, relativePath, label) {
  relative(relativePath, label);
  let current = fs.realpathSync(root);
  if (relativePath === ".") return current;
  for (const part of relativePath.split("/")) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink())
      throw new Error(`Terragrunt ${label} must not contain symlinks`);
  }
  return current;
}

export function loadTerragruntPolicy(
  root,
  policyPath = ".github/terragrunt-policy.jsonc",
) {
  const file = inside(root, policyPath, "policy path");
  if (!file.endsWith(".jsonc"))
    throw new Error("Terragrunt policy path must name a .jsonc file");
  const errors = [];
  const tree = parseTree(fs.readFileSync(file, "utf8"), errors, {
    allowTrailingComma: true,
  });
  if (errors.length || !tree)
    throw new Error("Terragrunt policy is invalid JSONC");
  (function rejectDuplicates(node) {
    if (node.type === "object") {
      const names = node.children.map((property) => property.children[0].value);
      if (new Set(names).size !== names.length)
        throw new Error("Terragrunt policy has duplicate keys");
    }
    for (const child of node.children ?? []) rejectDuplicates(child);
  })(tree);
  return validateTerragruntPolicy(getNodeValue(tree));
}

// The nearest .terraform-version / .terragrunt-version at or above the stack,
// never above the repository root: the same files tfenv and tgenv read.
export function readToolVersion(root, workingDirectory, file) {
  const top = fs.realpathSync(root);
  let current = inside(root, workingDirectory, "workingDirectory");
  if (!fs.statSync(current).isDirectory())
    throw new Error("Terragrunt workingDirectory must be a directory");
  for (;;) {
    const candidate = path.join(current, file);
    if (fs.existsSync(candidate)) {
      if (fs.lstatSync(candidate).isSymbolicLink())
        throw new Error(`Terragrunt ${file} must not be a symlink`);
      const version = fs.readFileSync(candidate, "utf8").trim();
      text(version, semver, file);
      return version;
    }
    if (current === top) break;
    current = path.dirname(current);
  }
  throw new Error(`Terragrunt requires ${file} in the stack or above it`);
}

export function resolveStack(root, policy, name) {
  text(name, slug, "stack input");
  if (!Object.hasOwn(policy.stacks, name))
    throw new Error("Terragrunt stack is not declared in the policy");
  const stack = policy.stacks[name];
  return {
    stack: name,
    ...stack,
    terraformVersion: readToolVersion(
      root,
      stack.workingDirectory,
      ".terraform-version",
    ),
    terragruntVersion: readToolVersion(
      root,
      stack.workingDirectory,
      ".terragrunt-version",
    ),
  };
}

// flow "pr" plans a same-repository pull request. flow "main" plans and
// applies the default branch only, on push or a manual dispatch from it.
export function assertInvocation(
  flow,
  { eventName, ref, defaultBranch, allowDestroy },
) {
  if (flow === "pr") {
    if (eventName !== "pull_request")
      throw new Error("Terragrunt PR flow runs on pull_request only");
    if (allowDestroy)
      throw new Error("Terragrunt PR flow cannot allow destroy");
    return;
  }
  if (flow !== "main") throw new Error("Terragrunt flow must be pr or main");
  if (!["push", "workflow_dispatch"].includes(eventName))
    throw new Error(
      "Terragrunt main flow requires push or workflow_dispatch, never PR events",
    );
  text(defaultBranch, /^[A-Za-z0-9_][A-Za-z0-9_.\/-]*$/, "default branch");
  if (ref !== `refs/heads/${defaultBranch}`)
    throw new Error("Terragrunt applies only the default branch");
  if (allowDestroy && eventName !== "workflow_dispatch")
    throw new Error(
      "Terragrunt allow-destroy is accepted only on a manual workflow_dispatch",
    );
}

const actionsOf = (change) => change?.change?.actions ?? [];

function classify(change) {
  const actions = actionsOf(change);
  const key = actions.join(",");
  if (key === "delete,create" || key === "create,delete") return "replace";
  if (key === "delete") return "destroy";
  if (key === "create") return "add";
  if (key === "update") return "change";
  if (key === "forget") return "forget";
  if (key === "no-op" || key === "read" || key === "") return null;
  // An action list Terraform adds later is treated as destructive until this
  // helper is taught otherwise: unknown must never read as safe.
  return "unknown";
}

function mask(value, sensitive) {
  if (sensitive === true) return "(sensitive)";
  if (Array.isArray(value))
    return value.map((item, index) =>
      mask(item, Array.isArray(sensitive) ? sensitive[index] : false),
    );
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort())
      result[key] = mask(
        value[key],
        sensitive && typeof sensitive === "object" ? sensitive[key] : false,
      );
    return result;
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value === undefined ? null : value);
}

// Summarizes `terraform show -json <planfile>`. Counts, addresses and actions
// only: no attribute values leave this function except inside the fingerprint
// hash, and sensitive values are masked before they are hashed.
export function summarizePlan(plan) {
  object(plan, null, "plan JSON");
  if (
    typeof plan.format_version !== "string" ||
    !/^1\./.test(plan.format_version)
  )
    throw new Error("Terragrunt plan JSON format is unsupported");
  if (plan.errored === true)
    throw new Error("Terragrunt plan errored; nothing can be applied");
  const resourceChanges = Array.isArray(plan.resource_changes)
    ? plan.resource_changes
    : [];
  const counts = {
    add: 0,
    change: 0,
    destroy: 0,
    replace: 0,
    import: 0,
    forget: 0,
    unknown: 0,
  };
  const changes = [];
  const fingerprintChanges = [];
  for (const change of resourceChanges) {
    if (typeof change?.address !== "string")
      throw new Error("Terragrunt plan JSON has a change without an address");
    const kind = classify(change);
    const importing = Boolean(change.change?.importing);
    if (kind) counts[kind] += 1;
    if (importing) counts.import += 1;
    if (kind || importing)
      changes.push({
        address: change.address,
        action: kind ?? "import",
        importing,
      });
    fingerprintChanges.push({
      address: change.address,
      previous_address: change.previous_address ?? null,
      actions: actionsOf(change),
      action_reason: change.action_reason ?? null,
      before: mask(change.change?.before, change.change?.before_sensitive),
      after: mask(change.change?.after, change.change?.after_sensitive),
      after_unknown: change.change?.after_unknown ?? null,
      replace_paths: change.change?.replace_paths ?? null,
      importing: change.change?.importing ?? null,
    });
  }
  const outputChanges = {};
  let outputsChanged = 0;
  for (const [name, change] of Object.entries(plan.output_changes ?? {})) {
    const actions = change?.actions ?? [];
    if (!(actions.length === 1 && actions[0] === "no-op")) outputsChanged += 1;
    outputChanges[name] = {
      actions,
      before: mask(change?.before, change?.before_sensitive),
      after: mask(change?.after, change?.after_sensitive),
      after_unknown: change?.after_unknown ?? null,
    };
  }
  fingerprintChanges.sort((a, b) => (a.address < b.address ? -1 : 1));
  const fingerprint = crypto
    .createHash("sha256")
    .update(
      canonical({
        resource_changes: fingerprintChanges,
        output_changes: outputChanges,
      }),
    )
    .digest("hex");
  const destructive = changes
    .filter((change) =>
      ["destroy", "replace", "unknown"].includes(change.action),
    )
    .map((change) => change.address);
  return {
    counts,
    outputsChanged,
    changes,
    destructive,
    hasChanges: changes.length > 0 || outputsChanged > 0,
    fingerprint,
  };
}

function code(value) {
  // Addresses come from the planned branch. Keep them inert in Markdown.
  return `\`${String(value).replace(/[`\r\n]/g, "")}\``;
}

export function renderSummary(
  summary,
  { stack, workingDirectory, sha, runUrl, heading },
) {
  const { counts } = summary;
  const lines = [
    `### ${heading}: ${code(stack)}`,
    "",
    `Working directory ${code(workingDirectory)} at ${code(sha)}.`,
    "",
    "| Add | Change | Destroy | Replace | Import | Forget | Outputs |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    `| ${counts.add} | ${counts.change} | ${counts.destroy} | ${counts.replace} | ${counts.import} | ${counts.forget} | ${summary.outputsChanged} |`,
    "",
  ];
  if (summary.destructive.length)
    lines.push(
      `**This plan destroys or replaces ${summary.destructive.length} resource(s).**`,
      "",
    );
  if (!summary.hasChanges) lines.push("No changes.", "");
  else if (summary.changes.length) {
    lines.push("| Action | Address |", "| --- | --- |");
    for (const change of summary.changes.slice(0, maxListedChanges))
      lines.push(
        `| ${change.action}${change.importing && change.action !== "import" ? " (import)" : ""} | ${code(change.address)} |`,
      );
    if (summary.changes.length > maxListedChanges)
      lines.push(
        "",
        `${summary.changes.length - maxListedChanges} more change(s) are in the run log.`,
      );
    lines.push("");
  }
  lines.push(
    `Plan fingerprint ${code(summary.fingerprint.slice(0, 16))}. [Run](${runUrl})`,
  );
  return lines.join("\n");
}

// Builds the only environment Terragrunt sees: the AWS session the OIDC step
// exported, the declared Cloudflare token, the declared TF_VAR_ values and
// fixed automation flags. Nothing else from the job or the secrets context.
export function credentialEnvironment(
  resolved,
  stageName,
  { allSecrets, namedCloudflareToken, base },
) {
  const stageConfig = resolved[stageName];
  let secrets = {};
  if (allSecrets) {
    try {
      secrets = JSON.parse(allSecrets);
    } catch {
      throw new Error("Terragrunt secrets context is not JSON");
    }
  }
  const env = {};
  for (const name of [
    "PATH",
    "HOME",
    "TMPDIR",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
  ])
    if (base[name]) env[name] = base[name];
  if (
    !env.AWS_ACCESS_KEY_ID ||
    !env.AWS_SECRET_ACCESS_KEY ||
    !env.AWS_SESSION_TOKEN
  )
    throw new Error(
      "Terragrunt requires the AWS OIDC session; the role was not assumed",
    );
  env.AWS_REGION = resolved.awsRegion;
  env.AWS_DEFAULT_REGION = resolved.awsRegion;
  env.TF_IN_AUTOMATION = "1";
  env.TG_NON_INTERACTIVE = "true";
  // The state role has no bucket-administration rights by design; this skips
  // Terragrunt's bucket checks, which no remote_state setting does in 0.75.
  env.TG_DISABLE_BUCKET_UPDATE = "true";
  const masks = [];
  if (resolved.cloudflareApiTokenSecret) {
    const token =
      namedCloudflareToken || secrets[resolved.cloudflareApiTokenSecret];
    if (typeof token !== "string" || !token.trim())
      throw new Error(
        `Terragrunt Cloudflare credential ${resolved.cloudflareApiTokenSecret} is not set on ${stageConfig.githubEnvironment}`,
      );
    env.CLOUDFLARE_API_TOKEN = token;
    masks.push(token);
  }
  for (const [variable, secret] of Object.entries(
    stageConfig.variableSecrets,
  )) {
    const value = secrets[secret];
    if (typeof value !== "string" || !value.length)
      throw new Error(
        `Terragrunt variable secret ${secret} is not set on ${stageConfig.githubEnvironment}`,
      );
    env[`TF_VAR_${variable}`] = value;
    masks.push(value);
  }
  return { env, masks };
}

export function terragrunt(
  args,
  { cwd, env, binary = "terragrunt", capture = false },
) {
  const result = spawnSync(binary, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: capture
      ? ["ignore", "pipe", "inherit"]
      : ["ignore", "inherit", "inherit"],
  });
  if (result.error || result.status !== 0)
    throw new Error(`Terragrunt ${args[0]} failed`);
  return result.stdout;
}

// init, plan to a saved file, read it back as JSON and summarize it. The plan
// file stays on this runner: it embeds variable values and a state snapshot.
export function planStack(root, resolved, { env, planFile, lock, binary }) {
  const cwd = inside(root, resolved.workingDirectory, "workingDirectory");
  terragrunt(["init", "-input=false", "-lockfile=readonly"], {
    cwd,
    env,
    binary,
  });
  terragrunt(
    [
      "plan",
      "-input=false",
      `-out=${planFile}`,
      ...(lock ? [] : ["-lock=false"]),
    ],
    { cwd, env, binary },
  );
  const json = terragrunt(["show", "-json", planFile], {
    cwd,
    env,
    binary,
    capture: true,
  });
  let plan;
  try {
    plan = JSON.parse(json);
  } catch {
    throw new Error("Terragrunt show -json did not return plan JSON");
  }
  return summarizePlan(plan);
}

export function assertApplicable(
  summary,
  { reviewedFingerprint, allowDestroy },
) {
  text(reviewedFingerprint, /^[0-9a-f]{64}$/, "reviewed plan fingerprint");
  if (summary.fingerprint !== reviewedFingerprint)
    throw new Error(
      "Terragrunt plan differs from the reviewed plan; state or config changed since it was made. Re-run the workflow.",
    );
  if (summary.destructive.length && !allowDestroy)
    throw new Error(
      `Terragrunt refuses to apply a plan that destroys or replaces: ${summary.destructive.join(", ")}`,
    );
}

export function applyStack(root, resolved, { env, planFile, binary }) {
  const cwd = inside(root, resolved.workingDirectory, "workingDirectory");
  terragrunt(["apply", "-input=false", planFile], { cwd, env, binary });
}
