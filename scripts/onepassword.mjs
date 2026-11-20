// One 1Password Environment supplies exactly the runtime names in the policy.
const environmentIdPattern = /^[a-z2-7]{26}$/;
const namePattern = /^[A-Z][A-Z0-9_]*$/;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateEnvironmentId(id, label) {
  check(
    typeof id === "string" && environmentIdPattern.test(id),
    `${label} must be a 26-character 1Password Environment ID`,
  );
  return id;
}

/** Validate names and concealment without printing any stored values. */
export function environmentValues(entries, { secrets, variables }) {
  check(Array.isArray(entries), "1Password Environment response is malformed");
  const byName = new Map();
  for (const entry of entries) {
    check(
      entry && typeof entry.name === "string" && namePattern.test(entry.name),
      "1Password entries must use uppercase environment names",
    );
    const { name } = entry;
    check(!byName.has(name), `1Password Environment lists ${name} twice`);
    byName.set(name, entry);
  }
  const declared = new Set([...secrets, ...variables]);
  const undeclared = [...byName.keys()].filter((name) => !declared.has(name));
  check(
    undeclared.length === 0,
    `1Password Environment has undeclared entries: ${undeclared.join(" ")}`,
  );
  const missing = [...declared].filter((name) => !byName.has(name));
  check(
    missing.length === 0,
    `1Password Environment is missing entries: ${missing.join(" ")}`,
  );
  const result = { vars: {}, secrets: {} };
  for (const name of secrets) {
    const { concealed, value } = byName.get(name);
    check(
      concealed === true,
      `1Password entry ${name} must be concealed: it is a secret`,
    );
    check(
      typeof value === "string" && value.trim() !== "",
      `1Password secret ${name} is empty`,
    );
    result.secrets[name] = value;
  }
  for (const name of variables) {
    const { concealed, value } = byName.get(name);
    check(
      concealed === false,
      `1Password entry ${name} must not be concealed: it is a public value`,
    );
    check(
      value === undefined || typeof value === "string",
      `1Password public value ${name} is malformed`,
    );
    result.vars[name] = value ?? "";
  }
  return result;
}

/** Read the Environment through the pinned CLI without logging its output. */
export async function loadEnvironment(run, id) {
  validateEnvironmentId(id, "The 1Password configuration");
  try {
    return JSON.parse(
      await run([
        "environment",
        "secret",
        "list",
        id,
        "--reveal",
        "--format",
        "json",
      ]),
    );
  } catch {
    throw new Error("Unable to read the 1Password Environment");
  }
}

/** Workflow-command masks for every secret value, line by line. */
export function maskCommands(values) {
  return Object.values(values.secrets)
    .flatMap((value) => value.split(/\r?\n/))
    .filter((line) => line.trim() !== "")
    .map(
      (line) =>
        `::add-mask::${line.replaceAll("%", "%25").replaceAll("\r", "%0D")}`,
    );
}
