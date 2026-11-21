import assert from "node:assert/strict";
import test from "node:test";
import {
  environmentValues,
  loadEnvironment,
  loadConfiguration,
  maskCommands,
  selectWorkflowVariables,
  validateEnvironmentId,
} from "../scripts/onepassword.mjs";

const id = "6ijsqfxvdxlwjcpsx7yrzs3tka";
const entry = (name, value, concealed = false) => ({
  name,
  value,
  concealed,
});
const names = { secrets: ["API_TOKEN"], variables: ["API_URL", "LOG_LEVEL"] };
const complete = [
  entry("API_TOKEN", "s3cret", true),
  entry("API_URL", "https://api.example.test"),
  entry("LOG_LEVEL", ""),
];

test("policy requires a 26-character Environment ID", () => {
  assert.equal(validateEnvironmentId(id, "label"), id);
  for (const value of [
    undefined,
    "",
    "staging",
    "op://deploy/item",
    id.toUpperCase(),
    `${id}a`,
    `0${id.slice(1)}`,
  ]) {
    assert.throws(
      () =>
        validateEnvironmentId(
          value,
          "targets.release.configurationEnvironment",
        ),
      /targets\.release\.configurationEnvironment must be a 26-character 1Password Environment ID/,
    );
  }
});

test("declared entries retain their exact values and concealment", () => {
  assert.deepEqual(environmentValues(complete, names), {
    secrets: { API_TOKEN: "s3cret" },
    vars: { API_URL: "https://api.example.test", LOG_LEVEL: "" },
  });
  assert.deepEqual(
    environmentValues([{ name: "LOG_LEVEL", concealed: false }], {
      secrets: [],
      variables: ["LOG_LEVEL"],
    }).vars,
    { LOG_LEVEL: "" },
  );
});

test("malformed or mismatched entries fail without echoing values", () => {
  for (const [entries, pattern] of [
    [null, /response is malformed/],
    [{}, /response is malformed/],
    [[null], /uppercase environment names/],
    [complete.slice(1), /missing entries: API_TOKEN$/],
    [[...complete, entry("EXTRA", "x")], /undeclared entries: EXTRA$/],
    [[...complete, entry("API_URL", "again")], /lists API_URL twice/],
    [[...complete, entry("lower_case", "x")], /uppercase environment names/],
    [
      [entry("API_TOKEN", "s3cret"), ...complete.slice(1)],
      /API_TOKEN must be concealed/,
    ],
    [
      [complete[0], entry("API_URL", "s3cret", true), complete[2]],
      /API_URL must not be concealed/,
    ],
    [
      [complete[0], { name: "API_URL", value: "s3cret" }, complete[2]],
      /API_URL must not be concealed/,
    ],
    [[complete[0], entry("API_URL", 123), complete[2]], /API_URL is malformed/],
    [
      [entry("API_TOKEN", "  ", true), ...complete.slice(1)],
      /secret API_TOKEN is empty/,
    ],
  ]) {
    assert.throws(
      () => environmentValues(entries, names),
      (error) => pattern.test(error.message) && !/s3cret/.test(error.message),
    );
  }
  assert.deepEqual(environmentValues([], { secrets: [], variables: [] }), {
    vars: {},
    secrets: {},
  });
});

test("the CLI reads the Environment by ID with values revealed", async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    return JSON.stringify(complete);
  };
  assert.deepEqual(await loadEnvironment(run, id), complete);
  assert.deepEqual(calls, [
    ["environment", "secret", "list", id, "--reveal", "--format", "json"],
  ]);
  await assert.rejects(
    loadEnvironment(async () => "not json", id),
    /Unable to read the 1Password Environment/,
  );
  await assert.rejects(
    loadEnvironment(async () => {
      throw new Error("token s3cret rejected");
    }, id),
    (error) =>
      /Unable to read/.test(error.message) && !/s3cret/.test(error.message),
  );
  await assert.rejects(
    loadEnvironment(run, "staging"),
    /26-character 1Password Environment ID/,
  );
  assert.equal(calls.length, 1);
});

test("every secret line is masked; public values are not", () => {
  assert.deepEqual(
    maskCommands({
      vars: { API_URL: "https://api.example.test" },
      secrets: {
        API_TOKEN: "s3cret%0A",
        PEM: "-----BEGIN-----\r\nabc\n\n-----END-----",
      },
    }),
    [
      "::add-mask::s3cret%250A",
      "::add-mask::-----BEGIN-----",
      "::add-mask::abc",
      "::add-mask::-----END-----",
    ],
  );
});

const networkId = "czahekt2sougvaklfeqwocb5si";
const target = {
  configurationEnvironment: id,
  networkConfiguration: {
    environment: networkId,
    variables: { CHAIN_ID: "XION_CHAIN_ID", API_URL: "XION_RPC_URL" },
  },
};
const combinedNames = { ...names, variables: [...names.variables, "CHAIN_ID"] };
const app = [complete[0], complete[2]];
const network = [
  entry("XION_CHAIN_ID", "xion-testnet-2"),
  entry("XION_RPC_URL", "https://rpc.example.test"),
  entry("XION_REST_URL", "https://rest.example.test"),
  { name: "OTHER_WORKLOAD_TOKEN", concealed: true },
];

function cli(appEntries = app, networkEntries = network) {
  return async (args) => {
    if (args[3] === id) {
      assert.ok(args.includes("--reveal"));
      return JSON.stringify(appEntries);
    }
    assert.equal(args[3], networkId);
    assert.ok(!args.includes("--reveal"));
    return JSON.stringify(networkEntries);
  };
}

test("composes app entries and selected network aliases with exact name matching", async () => {
  assert.deepEqual(await loadConfiguration(cli(), target, combinedNames), {
    secrets: { API_TOKEN: complete[0].value },
    vars: {
      LOG_LEVEL: "",
      CHAIN_ID: "xion-testnet-2",
      API_URL: "https://rpc.example.test",
    },
  });
  assert.deepEqual(
    await loadConfiguration(
      cli(),
      { networkConfiguration: target.networkConfiguration },
      { secrets: [], variables: ["CHAIN_ID", "API_URL"] },
    ),
    {
      secrets: {},
      vars: { CHAIN_ID: "xion-testnet-2", API_URL: "https://rpc.example.test" },
    },
  );
  assert.deepEqual(
    await loadConfiguration(
      async () => JSON.stringify(complete),
      { configurationEnvironment: id },
      names,
    ),
    environmentValues(complete, names),
  );
});

test("fails closed on source conflicts, missing and concealed network entries", async () => {
  for (const duplicate of ["CHAIN_ID", "XION_CHAIN_ID"]) {
    await assert.rejects(
      loadConfiguration(
        cli([...app, entry(duplicate, "old")]),
        target,
        combinedNames,
      ),
      /shadows a network value/,
    );
  }
  for (const [entries, message] of [
    [network.slice(1), /missing entry XION_CHAIN_ID/],
    [
      [entry("XION_CHAIN_ID", "hidden", true), ...network.slice(1)],
      /must be a public value/,
    ],
    [[entry("XION_CHAIN_ID", " "), ...network.slice(1)], /empty or malformed/],
    [[...network, network[0]], /lists XION_CHAIN_ID twice/],
  ]) {
    await assert.rejects(
      loadConfiguration(cli(app, entries), target, combinedNames),
      message,
    );
  }
  await assert.rejects(
    loadConfiguration(
      async (args) => {
        if (args[3] === networkId) throw new Error("internal denied context");
        return JSON.stringify(app);
      },
      target,
      combinedNames,
    ),
    /Unable to read the 1Password Environment/,
  );
});

test("Broker authenticates separately for app and network and preserves the SDK's masked flags", async () => {
  const { readBrokerConfiguration } =
    await import("../scripts/onepassword-broker/reader.mjs");
  const workEnv = {
    OP_INTEGRATION_KEY: "fixture-key==",
    OP_WORKLOAD_ID: "app-workload",
    OP_NETWORK_WORKLOAD_ID: "network-workload",
    CONFIGURATION_ENVIRONMENT: id,
    NETWORK_CONFIGURATION: JSON.stringify(target.networkConfiguration),
    SECRET_NAMES: JSON.stringify(combinedNames.secrets),
    VARIABLE_NAMES: JSON.stringify(combinedNames.variables),
  };
  const calls = [];
  const createClient = async ({ workloadDetails, oidcFetcher }) => ({
    environments: {
      async getVariables(environmentId) {
        calls.push([
          workloadDetails,
          environmentId,
          await oidcFetcher("test-audience"),
        ]);
        const rows = environmentId === id ? app : network;
        return {
          variables: rows.map(({ name, value, concealed }) => ({
            name,
            value,
            masked: concealed,
          })),
        };
      },
    },
  });
  const identity = async (audience, env) => {
    assert.equal(audience, "test-audience");
    assert.equal(env, workEnv);
    return "synthetic-identity";
  };
  const values = await readBrokerConfiguration(workEnv, createClient, identity);
  assert.deepEqual(
    values,
    await loadConfiguration(cli(), target, combinedNames),
  );
  assert.deepEqual(calls, [
    [
      { workloadUuid: "app-workload", customerManagedSecret: "fixture-key" },
      id,
      "synthetic-identity",
    ],
    [
      {
        workloadUuid: "network-workload",
        customerManagedSecret: "fixture-key",
      },
      networkId,
      "synthetic-identity",
    ],
  ]);
  await assert.rejects(
    readBrokerConfiguration(
      { ...workEnv, OP_INTEGRATION_KEY: "" },
      createClient,
      identity,
    ),
    /OP_INTEGRATION_KEY is missing/,
  );
  await assert.rejects(
    readBrokerConfiguration(
      workEnv,
      async () => {
        throw new Error("internal hidden credential");
      },
      identity,
    ),
    (error) =>
      /Broker could not read/.test(error.message) &&
      !error.message.includes("hidden credential"),
  );
});

test("Phala validates declared workflow values without sealing them into the CVM", () => {
  const workflowVariables = ["APP_PUBLIC_URL"];
  const entries = [
    ...complete,
    entry("APP_PUBLIC_URL", "https://app.example.test"),
  ];
  assert.deepEqual(
    environmentValues(entries, { ...names, workflowVariables }),
    environmentValues(complete, names),
  );
  assert.throws(
    () => environmentValues(complete, { ...names, workflowVariables }),
    /missing entries: APP_PUBLIC_URL/,
  );
  for (const value of [
    entry("APP_PUBLIC_URL", "wrong", true),
    entry("APP_PUBLIC_URL", ""),
  ]) {
    assert.throws(
      () =>
        environmentValues([...complete, value], {
          ...names,
          workflowVariables,
        }),
      /workflow variable APP_PUBLIC_URL/,
    );
  }
});

test("public workflow selection releases only the requested non-concealed values", () => {
  assert.deepEqual(selectWorkflowVariables(complete, ["API_URL"]), {
    API_URL: "https://api.example.test",
  });
  assert.throws(
    () => selectWorkflowVariables(complete, ["API_TOKEN"]),
    /must be public/,
  );
  assert.throws(
    () => selectWorkflowVariables(complete, ["LOG_LEVEL"]),
    /empty or malformed/,
  );
  assert.throws(
    () => selectWorkflowVariables(complete, ["ABSENT"]),
    /missing entry ABSENT/,
  );
  assert.throws(
    () => selectWorkflowVariables(complete, ["API_URL", "API_URL"]),
    /unique uppercase names/,
  );
});

test("workflow Broker reader restricts the result to the requested public input", async () => {
  const { readBrokerWorkflowVariables } =
    await import("../scripts/onepassword-broker/reader.mjs");
  const env = {
    OP_INTEGRATION_KEY: "example",
    OP_WORKLOAD_ID: "app-workload",
    CONFIGURATION_ENVIRONMENT: id,
    WORKFLOW_VARIABLE_NAMES: '["API_URL"]',
  };
  const createClient = async ({ workloadDetails }) => {
    assert.equal(workloadDetails.workloadUuid, "app-workload");
    return {
      environments: {
        async getVariables(environmentId) {
          assert.equal(environmentId, id);
          return {
            variables: complete.map(({ name, value, concealed }) => ({
              name,
              value,
              masked: concealed,
            })),
          };
        },
      },
    };
  };
  const fetchIdentity = async () => "synthetic-identity";
  assert.deepEqual(
    await readBrokerWorkflowVariables(env, createClient, fetchIdentity),
    { API_URL: "https://api.example.test" },
  );
  await assert.rejects(
    readBrokerWorkflowVariables(
      { ...env, WORKFLOW_VARIABLE_NAMES: '["API_TOKEN"]' },
      createClient,
      fetchIdentity,
    ),
    /must be public/,
  );
});
