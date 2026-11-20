import assert from "node:assert/strict";
import test from "node:test";
import {
  environmentValues,
  loadEnvironment,
  maskCommands,
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
