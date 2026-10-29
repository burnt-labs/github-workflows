import { validateInfrastructure } from "./phala-setup.mjs";

export function validateTargetConfiguration(target, names) {
  const config = target.configuration;
  if (config === undefined) return;
  if (
    !config ||
    Object.keys(config).sort().join() !== "runtimeValues,secret" ||
    !/^[A-Z][A-Z0-9_]*$/.test(config.secret ?? "") ||
    !config.runtimeValues ||
    Object.keys(config.runtimeValues).sort().join() !==
      [...names].sort().join() ||
    target.setup !== undefined
  )
    throw new Error(
      "Phala configuration requires one secret, exact runtimeValues and no static setup",
    );
  for (const source of Object.values(config.runtimeValues)) {
    if (
      !source ||
      !["field", "field,https", "value"].includes(
        Object.keys(source).sort().join(),
      ) ||
      (source.https !== undefined && source.https !== true) ||
      !(
        typeof source.value === "string" ||
        (typeof source.field === "string" &&
          /^[A-Za-z][A-Za-z0-9_]*$/.test(source.field))
      )
    )
      throw new Error(
        "Phala configuration values require a literal value or bundle field",
      );
  }
}
export function resolveTargetConfiguration(target, raw, names) {
  validateTargetConfiguration(target, names);
  let bundle;
  try {
    bundle = JSON.parse(raw);
  } catch {
    throw new Error("Invalid Phala configuration bundle");
  }
  const fields = new Set([
    "osImage",
    "instanceType",
    "region",
    ...Object.values(target.configuration.runtimeValues).flatMap((source) =>
      source.field ? [source.field] : [],
    ),
  ]);
  if (
    !bundle ||
    typeof bundle !== "object" ||
    Array.isArray(bundle) ||
    Object.keys(bundle).sort().join() !== [...fields].sort().join()
  )
    throw new Error("Phala configuration bundle keys differ from policy");
  const setup = validateInfrastructure({
    osImage: bundle.osImage,
    instanceType: bundle.instanceType,
    region: bundle.region,
  });
  const values = Object.fromEntries(
    Object.entries(target.configuration.runtimeValues).map(([name, source]) => [
      name,
      source.field ? bundle[source.field] : source.value,
    ]),
  );
  if (
    !Object.values(values).every(
      (value) =>
        typeof value === "string" &&
        value.trim().length > 0 &&
        /^[A-Za-z0-9._:/%+@-]+$/.test(value),
    )
  )
    throw new Error("Phala configuration values must be non-empty strings");
  for (const [name, source] of Object.entries(
    target.configuration.runtimeValues,
  )) {
    if (source.https) {
      let url;
      try {
        url = new URL(values[name]);
      } catch {
        throw new Error("Invalid public HTTPS configuration URL");
      }
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        /\s/.test(values[name])
      )
        throw new Error("Invalid public HTTPS configuration URL");
    }
  }
  return { target: { ...target, setup }, values };
}
