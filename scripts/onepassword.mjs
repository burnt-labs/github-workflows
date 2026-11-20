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

/** Validate the allocation of runtime keys between app and public network data. */
export function validateConfigurationSources(target, names, label) {
  const { configurationEnvironment, networkConfiguration } = target;
  if (networkConfiguration === undefined) {
    validateEnvironmentId(
      configurationEnvironment,
      `${label}.configurationEnvironment`,
    );
    return;
  }
  const networkLabel = `${label}.networkConfiguration`;
  check(
    networkConfiguration !== null &&
      typeof networkConfiguration === "object" &&
      !Array.isArray(networkConfiguration),
    `${networkLabel} must be an object`,
  );
  const { environment, variables } = networkConfiguration;
  validateEnvironmentId(environment, `${networkLabel}.environment`);
  check(
    variables &&
      typeof variables === "object" &&
      !Array.isArray(variables) &&
      Object.keys(variables).length > 0,
    `${networkLabel}.variables must be a non-empty map of runtime names to network keys`,
  );
  const appNames = [
    ...names.secrets,
    ...names.variables.filter((name) => !Object.hasOwn(variables, name)),
  ];
  for (const [name, key] of Object.entries(variables)) {
    check(
      names.variables.includes(name),
      `${networkLabel}.variables must map a declared public runtime name: ${name}`,
    );
    check(
      typeof key === "string" && namePattern.test(key),
      `${networkLabel}.variables must use uppercase network keys`,
    );
    check(
      !appNames.includes(key),
      `App runtime name ${key} shadows a network key`,
    );
  }
  if (configurationEnvironment !== undefined || appNames.length > 0) {
    validateEnvironmentId(
      configurationEnvironment,
      `${label}.configurationEnvironment`,
    );
    check(
      configurationEnvironment !== environment,
      `${label} app and network Environments must differ`,
    );
  }
}

function indexEntries(entries) {
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
  return byName;
}

/** Validate names and concealment without printing any stored values. */
export function environmentValues(entries, { secrets, variables }) {
  const byName = indexEntries(entries);
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
export async function loadEnvironment(run, id, reveal = true) {
  validateEnvironmentId(id, "The 1Password configuration");
  try {
    return JSON.parse(
      await run([
        "environment",
        "secret",
        "list",
        id,
        ...(reveal ? ["--reveal"] : []),
        "--format",
        "json",
      ]),
    );
  } catch {
    throw new Error("Unable to read the 1Password Environment");
  }
}

/** Read and compose independent sources without letting either override the other. */
export async function loadConfiguration(
  run,
  target,
  names,
  read = (id, reveal) => loadEnvironment(run, id, reveal),
) {
  validateConfigurationSources(target, names, "The 1Password configuration");
  const { configurationEnvironment, networkConfiguration } = target;
  if (!networkConfiguration) {
    return environmentValues(await read(configurationEnvironment), names);
  }

  const mappings = networkConfiguration.variables;
  const appNames = {
    secrets: names.secrets,
    variables: names.variables.filter((name) => !Object.hasOwn(mappings, name)),
  };
  const ignored = new Set([
    ...Object.keys(mappings),
    ...Object.values(mappings),
  ]);
  const appEntries = configurationEnvironment
    ? await read(configurationEnvironment)
    : [];
  for (const name of indexEntries(appEntries).keys()) {
    check(
      !ignored.has(name),
      `App Environment entry ${name} shadows a network value`,
    );
  }
  const result = environmentValues(appEntries, appNames);
  // Fetch the shared Environment without revealing concealed fields, then copy
  // only the public keys this target declares.
  const networkEntries = indexEntries(
    await read(networkConfiguration.environment, false),
  );
  for (const [name, key] of Object.entries(mappings)) {
    const entry = networkEntries.get(key);
    check(entry, `Network Environment is missing entry ${key}`);
    check(
      entry.concealed === false,
      `Network entry ${key} must be a public value`,
    );
    check(
      typeof entry.value === "string" && entry.value.trim() !== "",
      `Network entry ${key} is empty or malformed`,
    );
    result.vars[name] = entry.value;
  }
  return result;
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
