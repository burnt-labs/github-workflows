import fs from "node:fs";
import path from "node:path";
import { parseJsonc, validateDeploymentPolicy } from "./policy.mjs";

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateEnvironmentBundle(raw, policy) {
  let bundle;
  try {
    bundle = JSON.parse(raw);
  } catch {
    throw new Error("Environment bundle is not valid JSON");
  }
  if (
    !object(bundle) ||
    Object.keys(bundle).sort().join(",") !== "secrets,vars" ||
    !object(bundle.vars) ||
    !object(bundle.secrets)
  ) {
    throw new Error(
      "Environment bundle must contain only vars and secrets objects",
    );
  }
  for (const [section, names] of [
    ["vars", policy.workerVariables],
    ["secrets", policy.workerSecrets],
  ]) {
    if (
      Object.keys(bundle[section]).some((name) => !names.includes(name)) ||
      names.some((name) => !Object.hasOwn(bundle[section], name))
    ) {
      throw new Error(
        `Environment bundle ${section} must match the declared names exactly`,
      );
    }
    for (const value of Object.values(bundle[section])) {
      if (
        typeof value !== "string" ||
        (section === "secrets" && value.trim() === "")
      ) {
        throw new Error(
          `Environment bundle ${section} values must be ${section === "secrets" ? "nonempty strings" : "strings"}`,
        );
      }
    }
  }
  return bundle;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      "Generated Wrangler configuration must stay inside the repository",
    );
  }
}

export function configurationPaths(root, policy, target) {
  const repository = fs.realpathSync(root);
  const working = path.resolve(repository, policy.workingDirectory);
  inside(repository, working);
  // Reject symlink traversal even if a link happens to point back inside the repo.
  const configured = path.resolve(working, target.wranglerConfig);
  inside(repository, configured);
  const directory = path.dirname(configured);
  if (fs.realpathSync(directory) !== directory)
    throw new Error(
      "Generated Wrangler configuration must not use symlink paths",
    );
  const source = path.join(directory, "wrangler.jsonc");
  if (configured === source)
    throw new Error("Refusing to overwrite source wrangler.jsonc");
  if (fs.lstatSync(source).isSymbolicLink())
    throw new Error("Source Wrangler configuration must not be a symlink");
  const destination = fs.lstatSync(configured, { throwIfNoEntry: false });
  if (destination?.isSymbolicLink())
    throw new Error("Generated Wrangler configuration must not be a symlink");
  const original = fs.statSync(source);
  if (
    destination &&
    destination.dev === original.dev &&
    destination.ino === original.ino
  )
    throw new Error("Refusing to overwrite source Wrangler configuration");
  return { source, generated: configured };
}

function inputs({ policy: rawPolicy, target, bundle, root }) {
  const policy = validateDeploymentPolicy(structuredClone(rawPolicy));
  if (!policy.environmentSecret)
    throw new Error("environmentSecret is required for bundle materialization");
  if (!["candidate", "release"].includes(target))
    throw new Error("Unknown environment bundle target");
  return {
    policy,
    selected: policy.targets[target],
    values: validateEnvironmentBundle(bundle, policy),
    root,
  };
}

/** Validate both sections before consumer code runs; persist public vars only. */
export function materializePublicConfiguration(options) {
  const { policy, selected, values, root } = inputs(options);
  const files = configurationPaths(root, policy, selected);
  const config = parseJsonc(
    fs.readFileSync(files.source, "utf8"),
    "source Wrangler configuration",
  );
  if (!object(config))
    throw new Error("Source Wrangler configuration must be an object");
  const scope =
    policy.topology === "single" ? config : config.env?.[selected.wranglerEnv];
  if (!object(scope))
    throw new Error(
      "Source Wrangler configuration does not contain the selected environment",
    );
  // Complete replacement prevents stale source vars from winning over GitHub.
  scope.vars = values.vars;
  fs.writeFileSync(files.generated, `${JSON.stringify(config, null, 2)}\n`, {
    flag: "wx",
  });
  return files.generated;
}

export function removeSecretsFile(runnerTemp) {
  fs.rmSync(path.join(runnerTemp, "worker-secrets.json"), { force: true });
}

/** Called only after build, only for deploy; never creates preview secret files. */
export function materializeWorkerSecrets(options) {
  const { runnerTemp, operation } = options;
  const output = path.join(runnerTemp, "worker-secrets.json");
  try {
    removeSecretsFile(runnerTemp);
    if (operation !== "deploy")
      throw new Error("Runtime secrets may be materialized only for deploy");
    const { values } = inputs(options);
    fs.writeFileSync(output, `${JSON.stringify(values.secrets)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    return output;
  } catch (error) {
    removeSecretsFile(runnerTemp);
    throw error;
  }
}
