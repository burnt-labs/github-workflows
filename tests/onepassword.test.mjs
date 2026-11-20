import assert from "node:assert/strict";
import test from "node:test";
import {
  itemValues,
  loadItem,
  maskCommands,
  parseItemReference,
  validateItemReference,
} from "../scripts/onepassword.mjs";

const field = (label, value, type = "STRING", extra = {}) => ({
  id: label.toLowerCase(),
  label,
  type,
  value,
  ...extra,
});
const item = (...fields) => ({
  category: "SECURE_NOTE",
  fields: [
    field("notesPlain", "operator notes", "STRING", { purpose: "NOTES" }),
    ...fields,
  ],
});
const names = { secrets: ["API_TOKEN"], variables: ["API_URL", "LOG_LEVEL"] };

test("an item reference names one vault and one item", () => {
  assert.deepEqual(parseItemReference("op://Deploy Config/cue-tee staging"), {
    vault: "Deploy Config",
    item: "cue-tee staging",
  });
  assert.deepEqual(parseItemReference("op://deploy/satya-verifier-staging"), {
    vault: "deploy",
    item: "satya-verifier-staging",
  });
  for (const reference of [
    undefined,
    "",
    "deploy/item",
    "op://deploy",
    "op://deploy/item/API_TOKEN",
    "op:///item",
    "op://deploy/",
    "op://de ploy\n/item",
  ])
    assert.throws(
      () => parseItemReference(reference),
      /op:\/\/<vault>\/<item>/,
      String(reference),
    );
  assert.equal(
    validateItemReference("op://deploy/item", "label"),
    "op://deploy/item",
  );
  assert.throws(
    () =>
      validateItemReference(
        "op://deploy/item/FIELD",
        "targets.release.configurationItem",
      ),
    /targets\.release\.configurationItem must be an op:\/\/<vault>\/<item> reference/,
  );
});

test("declared names come from custom fields by type", () => {
  assert.deepEqual(
    itemValues(
      item(
        field("API_TOKEN", "s3cret", "CONCEALED"),
        field("API_URL", "https://api.example.test", "URL"),
        field("LOG_LEVEL", ""),
      ),
      names,
    ),
    {
      secrets: { API_TOKEN: "s3cret" },
      vars: { API_URL: "https://api.example.test", LOG_LEVEL: "" },
    },
  );
  // Built-in fields carry a purpose and never count as configuration.
  assert.deepEqual(
    itemValues(
      {
        fields: [
          field("username", "operator", "STRING", { purpose: "USERNAME" }),
          field("password", "unused", "CONCEALED", { purpose: "PASSWORD" }),
          field("API_TOKEN", "s3cret", "CONCEALED"),
        ],
      },
      { secrets: ["API_TOKEN"], variables: [] },
    ),
    { secrets: { API_TOKEN: "s3cret" }, vars: {} },
  );
  // A field with no value is an empty public value.
  assert.deepEqual(
    itemValues(
      { fields: [{ label: "LOG_LEVEL", type: "STRING" }] },
      { secrets: [], variables: ["LOG_LEVEL"] },
    ).vars,
    { LOG_LEVEL: "" },
  );
});

test("the item must match the declaration exactly and never echoes values", () => {
  const complete = [
    field("API_TOKEN", "s3cret", "CONCEALED"),
    field("API_URL", "https://api.example.test"),
    field("LOG_LEVEL", "info"),
  ];
  for (const [fields, pattern] of [
    [complete.slice(1), /missing fields: API_TOKEN$/],
    [[...complete, field("EXTRA", "x")], /undeclared fields: EXTRA$/],
    [[...complete, field("API_URL", "again")], /lists API_URL twice/],
    [[...complete, field("lower_case", "x")], /uppercase environment names/],
    [
      [field("API_TOKEN", "s3cret"), ...complete.slice(1)],
      /API_TOKEN must be concealed/,
    ],
    [
      [complete[0], field("API_URL", "https://x", "CONCEALED"), complete[2]],
      /API_URL must not be concealed/,
    ],
    [
      [field("API_TOKEN", "  ", "CONCEALED"), ...complete.slice(1)],
      /secret API_TOKEN is empty/,
    ],
  ]) {
    assert.throws(
      () => itemValues(item(...fields), names),
      (error) => pattern.test(error.message) && !/s3cret/.test(error.message),
    );
  }
  for (const broken of [null, {}, { fields: "x" }])
    assert.throws(() => itemValues(broken, names), /malformed/);
  assert.deepEqual(
    itemValues({ fields: [null] }, { secrets: [], variables: [] }),
    {
      vars: {},
      secrets: {},
    },
  );
});

test("items are read whole through the CLI with values revealed", async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    return JSON.stringify(item());
  };
  assert.deepEqual(
    await loadItem(run, "op://Deploy Config/cue-tee staging"),
    item(),
  );
  assert.deepEqual(calls, [
    [
      "item",
      "get",
      "cue-tee staging",
      "--vault",
      "Deploy Config",
      "--format",
      "json",
      "--reveal",
    ],
  ]);
  await assert.rejects(
    loadItem(async () => "not json", "op://deploy/item"),
    /Unable to read the 1Password configuration item/,
  );
  await assert.rejects(
    loadItem(async () => {
      throw new Error("token s3cret rejected");
    }, "op://deploy/item"),
    (error) =>
      /Unable to read/.test(error.message) && !/s3cret/.test(error.message),
  );
  await assert.rejects(loadItem(run, "deploy/item"), /op:\/\/<vault>\/<item>/);
});

test("every secret line is masked; public values are not", () => {
  assert.deepEqual(
    maskCommands({
      vars: { API_URL: "https://api.example.test" },
      secrets: {
        API_TOKEN: "s3cret",
        PEM: "-----BEGIN-----\r\nabc\n\n-----END-----",
      },
    }),
    [
      "::add-mask::s3cret",
      "::add-mask::-----BEGIN-----",
      "::add-mask::abc",
      "::add-mask::-----END-----",
    ],
  );
});
