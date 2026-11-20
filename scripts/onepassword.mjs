// Runtime configuration read straight from a 1Password item, one custom field per
// declared name: the field label is the environment name, a concealed field is a
// secret and any other field type is a public value. The item is the readable,
// reviewable source of truth; nothing is synchronized into GitHub first.

// Vault and item names may contain spaces, never a slash, a control character
// or surrounding whitespace.
const segment = "[^/\\s](?:[^/\\t\\n\\r]*[^/\\s])?";
const referencePattern = new RegExp(`^op://(${segment})/(${segment})$`);
const namePattern = /^[A-Z][A-Z0-9_]*$/;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** `op://<vault>/<item>`: one whole item, never a single field reference. */
export function parseItemReference(reference) {
  const match =
    typeof reference === "string" ? reference.match(referencePattern) : null;
  check(
    match,
    "1Password configuration must be an op://<vault>/<item> reference",
  );
  return { vault: match[1], item: match[2] };
}

/** Validate a policy-declared item reference and return it unchanged. */
export function validateItemReference(reference, label) {
  try {
    parseItemReference(reference);
  } catch {
    throw new Error(`${label} must be an op://<vault>/<item> reference`);
  }
  return reference;
}

/**
 * Exactly the declared names, from the item's custom fields. Built-in fields
 * (username, password, notes) carry a purpose and are ignored. A missing,
 * mistyped, duplicated or undeclared field fails, naming fields, never values.
 */
export function itemValues(item, { secrets, variables }) {
  check(
    item && typeof item === "object" && Array.isArray(item.fields),
    "1Password configuration item is malformed",
  );
  const fields = new Map();
  for (const field of item.fields) {
    if (!field || field.purpose) continue;
    const label = field.label;
    check(
      typeof label === "string" && namePattern.test(label),
      "1Password configuration fields must be labelled with uppercase environment names",
    );
    check(!fields.has(label), `1Password configuration lists ${label} twice`);
    fields.set(label, field);
  }
  const declared = new Set([...secrets, ...variables]);
  const undeclared = [...fields.keys()].filter((name) => !declared.has(name));
  check(
    undeclared.length === 0,
    `1Password configuration has undeclared fields: ${undeclared.join(" ")}`,
  );
  const missing = [...declared].filter((name) => !fields.has(name));
  check(
    missing.length === 0,
    `1Password configuration is missing fields: ${missing.join(" ")}`,
  );
  const result = { vars: {}, secrets: {} };
  for (const name of secrets) {
    const field = fields.get(name);
    check(
      field.type === "CONCEALED",
      `1Password field ${name} must be concealed: it is a secret`,
    );
    check(
      typeof field.value === "string" && field.value.trim() !== "",
      `1Password secret ${name} is empty`,
    );
    result.secrets[name] = field.value;
  }
  for (const name of variables) {
    const field = fields.get(name);
    check(
      field.type !== "CONCEALED",
      `1Password field ${name} must not be concealed: it is a public value`,
    );
    result.vars[name] = typeof field.value === "string" ? field.value : "";
  }
  return result;
}

/** Read one item through the 1Password CLI; `run` returns the CLI's stdout. */
export async function loadItem(run, reference) {
  const { vault, item } = parseItemReference(reference);
  let parsed;
  try {
    parsed = JSON.parse(
      await run([
        "item",
        "get",
        item,
        "--vault",
        vault,
        "--format",
        "json",
        "--reveal",
      ]),
    );
  } catch {
    throw new Error("Unable to read the 1Password configuration item");
  }
  return parsed;
}

/** Workflow-command masks for every secret value, line by line. */
export function maskCommands(values) {
  return Object.values(values.secrets)
    .flatMap((value) => value.split(/\r?\n/))
    .filter((line) => line.trim() !== "")
    .map((line) => `::add-mask::${line}`);
}
