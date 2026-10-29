import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveTargetConfiguration,
  validateTargetConfiguration,
} from "../scripts/phala-configuration.mjs";
const target = {
  cvmName: "service-production",
  configuration: {
    secret: "SERVICE_CONFIG_JSON",
    runtimeValues: {
      SERVICE_ENV: { value: "production" },
      METRICS_URL: { field: "metricsUrl" },
    },
  },
};
const names = ["SERVICE_ENV", "METRICS_URL"];
const bundle = {
  osImage: "dstack-0.6.1",
  instanceType: "tdx.small",
  region: "us-west-1",
  metricsUrl: "https://metrics.example",
};
test("configuration resolves declared values and infrastructure without changing legacy targets", () => {
  validateTargetConfiguration({ cvmName: "legacy-service" }, names);
  const result = resolveTargetConfiguration(
    target,
    JSON.stringify(bundle),
    names,
  );
  assert.deepEqual(result.values, {
    SERVICE_ENV: "production",
    METRICS_URL: "https://metrics.example",
  });
  assert.deepEqual(result.target.setup, {
    osImage: "dstack-0.6.1",
    instanceType: "tdx.small",
    region: "us-west-1",
  });
  assert.equal(target.setup, undefined);
});
test("bundle and declarations reject missing, extra, malformed and non-string data without disclosing it", () => {
  for (const raw of [
    "private-malformed-sentinel",
    JSON.stringify({ ...bundle, extra: "secret" }),
    JSON.stringify({ ...bundle, metricsUrl: 5 }),
    JSON.stringify({ ...bundle, osImage: "latest" }),
    JSON.stringify({}),
  ]) {
    assert.throws(
      () => resolveTargetConfiguration(target, raw, names),
      (error) => !error.message.includes("private-malformed-sentinel"),
    );
  }
  assert.throws(() =>
    validateTargetConfiguration({ ...target, setup: {} }, names),
  );
  assert.throws(() =>
    validateTargetConfiguration(target, [...names, "UNKNOWN"]),
  );
});

test("public measured values reject YAML injection and unsafe HTTPS sources", () => {
  const secure = structuredClone(target);
  secure.configuration.runtimeValues.METRICS_URL.https = true;
  for (const metricsUrl of [
    "http://metrics.example",
    "https://u:p@metrics.example",
    "https://metrics.example?q=private",
    "https://metrics.example\nBAD: yes",
  ])
    assert.throws(() =>
      resolveTargetConfiguration(
        secure,
        JSON.stringify({ ...bundle, metricsUrl }),
        names,
      ),
    );
});
