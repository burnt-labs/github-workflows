import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parse } from "yaml";
import * as terragrunt from "../scripts/terragrunt.mjs";

const examplePath =
  "examples/terragrunt/iac-terraform-cloudflare-account.jsonc";

function policy() {
  return {
    schemaVersion: 1,
    stacks: {
      "cloudflare-account": {
        workingDirectory: "cloudflare/account",
        awsRegion: "us-east-1",
        credentials: { cloudflareApiTokenSecret: "CLOUDFLARE_API_TOKEN" },
        plan: {
          githubEnvironment: "cloudflare-account-plan",
          awsRoleArn: "arn:aws:iam::669419973271:role/plan",
        },
        apply: {
          githubEnvironment: "cloudflare-account",
          awsRoleArn: "arn:aws:iam::669419973271:role/apply",
          variableSecrets: { catalog_token: "CATALOG_TOKEN" },
        },
      },
    },
  };
}

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terragrunt-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function consumer(t, declaration = policy()) {
  const root = temporary(t);
  fs.mkdirSync(path.join(root, ".github"));
  fs.mkdirSync(path.join(root, "cloudflare/account"), { recursive: true });
  fs.writeFileSync(path.join(root, ".terraform-version"), "1.9.5\n");
  fs.writeFileSync(path.join(root, ".terragrunt-version"), "0.75.3\n");
  fs.writeFileSync(
    path.join(root, ".github/terragrunt-policy.jsonc"),
    `// comment\n${JSON.stringify(declaration, null, 2)}`,
  );
  return root;
}

function change(address, actions, extra = {}) {
  return {
    address,
    mode: "managed",
    change: {
      actions,
      before: null,
      after: null,
      before_sensitive: false,
      after_sensitive: false,
      after_unknown: {},
      ...extra,
    },
  };
}

function plan(resourceChanges, outputChanges = {}) {
  return {
    format_version: "1.2",
    terraform_version: "1.9.5",
    variables: { catalog_token: { value: "never-summarize-this" } },
    resource_changes: resourceChanges,
    output_changes: outputChanges,
    errored: false,
  };
}

const base = {
  PATH: "/usr/bin",
  HOME: "/home/runner",
  AWS_ACCESS_KEY_ID: "id",
  AWS_SECRET_ACCESS_KEY: "key",
  AWS_SESSION_TOKEN: "session",
  GITHUB_TOKEN: "never-forward-this",
  TF_VAR_injected: "never-forward-this",
};

test("Terragrunt example policy validates and keeps plan and apply apart", () => {
  const loaded = terragrunt.loadTerragruntPolicy(".", examplePath);
  const stack = loaded.stacks["cloudflare-account"];
  assert.equal(stack.workingDirectory, "cloudflare/account");
  assert.notEqual(stack.plan.githubEnvironment, stack.apply.githubEnvironment);
  assert.equal(stack.plan.lock, true);
  assert.equal(stack.plan.failOnDestroyOrReplace, true);
  assert.deepEqual(stack.plan.variableSecrets, {});
  assert.deepEqual(stack.apply.variableSecrets, {
    satya_proof_index_catalog_token: "SATYA_PROOF_INDEX_CATALOG_TOKEN",
  });
});

test("Terragrunt policy normalizes optional booleans to literals", () => {
  const stack =
    terragrunt.validateTerragruntPolicy(policy()).stacks["cloudflare-account"];
  assert.equal(stack.plan.lock, true);
  assert.equal(stack.plan.failOnDestroyOrReplace, true);
  const relaxed = policy();
  relaxed.stacks["cloudflare-account"].plan.lock = false;
  relaxed.stacks["cloudflare-account"].plan.failOnDestroyOrReplace = false;
  const normalized =
    terragrunt.validateTerragruntPolicy(relaxed).stacks["cloudflare-account"];
  assert.equal(normalized.plan.lock, false);
  assert.equal(normalized.plan.failOnDestroyOrReplace, false);
  const optionalCredentials = policy();
  delete optionalCredentials.stacks["cloudflare-account"].credentials;
  assert.equal(
    terragrunt.validateTerragruntPolicy(optionalCredentials).stacks[
      "cloudflare-account"
    ].cloudflareApiTokenSecret,
    null,
  );
});

test("Terragrunt policy is capped and rejects unsafe configuration", () => {
  const cases = [
    [(p) => (p.extra = true), /unknown fields/],
    [(p) => (p.schemaVersion = 2), /schemaVersion/],
    [(p) => (p.stacks = {}), /1-32 stacks/],
    [
      (p) => (p.stacks["Bad_Name"] = p.stacks["cloudflare-account"]),
      /stack name/,
    ],
    [(p) => (p.stacks["cloudflare-account"].command = "x"), /unknown fields/],
    [
      (p) => (p.stacks["cloudflare-account"].workingDirectory = "../other"),
      /traverse/,
    ],
    [
      (p) => (p.stacks["cloudflare-account"].workingDirectory = "/abs"),
      /workingDirectory/,
    ],
    [
      (p) => (p.stacks["cloudflare-account"].awsRegion = "us east"),
      /awsRegion/,
    ],
    [
      (p) =>
        (p.stacks["cloudflare-account"].plan.awsRoleArn =
          "arn:aws:iam::1:user/x"),
      /awsRoleArn/,
    ],
    [
      (p) =>
        (p.stacks["cloudflare-account"].plan.githubEnvironment =
          "cloudflare-account"),
      /distinct GitHub Environments/,
    ],
    [
      (p) =>
        (p.stacks["cloudflare-account"].apply.githubEnvironment = "preview-x"),
      /preview/,
    ],
    [(p) => (p.stacks["cloudflare-account"].plan.lock = "false"), /boolean/],
    [
      (p) =>
        (p.stacks["cloudflare-account"].apply.variableSecrets = {
          token: "CLOUDFLARE_API_TOKEN",
        }),
      /Cloudflare credential/,
    ],
    [
      (p) =>
        (p.stacks["cloudflare-account"].apply.variableSecrets = {
          token: "GITHUB_TOKEN",
        }),
      /GitHub-reserved/,
    ],
    [
      (p) =>
        (p.stacks["cloudflare-account"].apply.variableSecrets = {
          "bad-name": "X",
        }),
      /variable name/,
    ],
    [
      (p) =>
        (p.stacks["cloudflare-account"].apply.variableSecrets =
          Object.fromEntries(
            Array.from({ length: 33 }, (_, index) => [
              `v${index}`,
              `S${index}`,
            ]),
          )),
      /at most 32/,
    ],
    [
      (p) =>
        (p.stacks["cloudflare-account"].credentials = {
          cloudflareApiTokenSecret: "lower",
        }),
      /cloudflareApiTokenSecret/,
    ],
  ];
  for (const [mutate, pattern] of cases) {
    const candidate = policy();
    mutate(candidate);
    assert.throws(
      () => terragrunt.validateTerragruntPolicy(candidate),
      pattern,
      String(mutate),
    );
  }
});

test("Terragrunt policy loading rejects duplicates, symlinks and non-JSONC paths", (t) => {
  const root = consumer(t);
  assert.ok(terragrunt.loadTerragruntPolicy(root).stacks["cloudflare-account"]);
  fs.writeFileSync(
    path.join(root, ".github/duplicate.jsonc"),
    '{"schemaVersion": 1, "schemaVersion": 1, "stacks": {}}',
  );
  assert.throws(
    () => terragrunt.loadTerragruntPolicy(root, ".github/duplicate.jsonc"),
    /duplicate keys/,
  );
  fs.writeFileSync(path.join(root, ".github/broken.jsonc"), "{");
  assert.throws(
    () => terragrunt.loadTerragruntPolicy(root, ".github/broken.jsonc"),
    /invalid JSONC/,
  );
  fs.symlinkSync(
    path.join(root, ".github/terragrunt-policy.jsonc"),
    path.join(root, ".github/link.jsonc"),
  );
  assert.throws(
    () => terragrunt.loadTerragruntPolicy(root, ".github/link.jsonc"),
    /symlinks/,
  );
  assert.throws(
    () => terragrunt.loadTerragruntPolicy(root, ".github/policy.json"),
    /jsonc|ENOENT/,
  );
});

test("tool versions come from the nearest version files at or above the stack", (t) => {
  const root = consumer(t);
  const resolved = terragrunt.resolveStack(
    root,
    terragrunt.loadTerragruntPolicy(root),
    "cloudflare-account",
  );
  assert.equal(resolved.terraformVersion, "1.9.5");
  assert.equal(resolved.terragruntVersion, "0.75.3");
  fs.writeFileSync(
    path.join(root, "cloudflare/account/.terraform-version"),
    "1.10.0\n",
  );
  assert.equal(
    terragrunt.readToolVersion(
      root,
      "cloudflare/account",
      ".terraform-version",
    ),
    "1.10.0",
  );
  fs.writeFileSync(path.join(root, ".terragrunt-version"), "latest\n");
  assert.throws(
    () =>
      terragrunt.readToolVersion(
        root,
        "cloudflare/account",
        ".terragrunt-version",
      ),
    /\.terragrunt-version is invalid/,
  );
  fs.rmSync(path.join(root, ".terragrunt-version"));
  assert.throws(
    () =>
      terragrunt.readToolVersion(
        root,
        "cloudflare/account",
        ".terragrunt-version",
      ),
    /requires \.terragrunt-version/,
  );
  assert.throws(
    () =>
      terragrunt.resolveStack(
        root,
        terragrunt.loadTerragruntPolicy(root),
        "other",
      ),
    /not declared/,
  );
});

test("PR flow plans pull requests only; main flow applies only the default branch", () => {
  const main = { ref: "refs/heads/main", defaultBranch: "main" };
  terragrunt.assertInvocation("pr", { eventName: "pull_request" });
  assert.throws(
    () => terragrunt.assertInvocation("pr", { eventName: "push" }),
    /pull_request only/,
  );
  assert.throws(
    () =>
      terragrunt.assertInvocation("pr", {
        eventName: "pull_request",
        allowDestroy: true,
      }),
    /cannot allow destroy/,
  );
  terragrunt.assertInvocation("main", { eventName: "push", ...main });
  terragrunt.assertInvocation("main", {
    eventName: "workflow_dispatch",
    allowDestroy: true,
    ...main,
  });
  for (const eventName of ["pull_request", "pull_request_target", "release"])
    assert.throws(
      () => terragrunt.assertInvocation("main", { eventName, ...main }),
      /never PR events/,
    );
  assert.throws(
    () =>
      terragrunt.assertInvocation("main", {
        eventName: "workflow_dispatch",
        ref: "refs/heads/feature",
        defaultBranch: "main",
      }),
    /only the default branch/,
  );
  assert.throws(
    () =>
      terragrunt.assertInvocation("main", {
        eventName: "push",
        allowDestroy: true,
        ...main,
      }),
    /manual workflow_dispatch/,
  );
  assert.throws(
    () => terragrunt.assertInvocation("deploy", { eventName: "push" }),
    /pr or main/,
  );
});

test("destroy and replace are detected from show -json action lists", () => {
  const summary = terragrunt.summarizePlan(
    plan([
      change("a.create", ["create"]),
      change("b.update", ["update"]),
      change("c.delete", ["delete"]),
      change("d.replace", ["delete", "create"]),
      change("e.cbd", ["create", "delete"]),
      change("f.noop", ["no-op"]),
      change("g.read", ["read"]),
      change("h.import", ["no-op"], { importing: { id: "x" } }),
      change("i.import-update", ["update"], { importing: { id: "y" } }),
      change("j.forget", ["forget"]),
      change("k.future", ["delete", "transmogrify"]),
    ]),
  );
  assert.deepEqual(summary.counts, {
    add: 1,
    change: 2,
    destroy: 1,
    replace: 2,
    import: 2,
    forget: 1,
    unknown: 1,
  });
  assert.deepEqual(summary.destructive, [
    "c.delete",
    "d.replace",
    "e.cbd",
    "k.future",
  ]);
  assert.equal(summary.hasChanges, true);
  assert.deepEqual(
    summary.changes.find((entry) => entry.address === "h.import"),
    { address: "h.import", action: "import", importing: true },
  );
  const quiet = terragrunt.summarizePlan(
    plan([change("f.noop", ["no-op"])], {
      out: { actions: ["no-op"], before: "a", after: "a" },
    }),
  );
  assert.equal(quiet.hasChanges, false);
  assert.deepEqual(quiet.destructive, []);
  const outputOnly = terragrunt.summarizePlan(
    plan([], { out: { actions: ["update"], before: "a", after: "b" } }),
  );
  assert.equal(outputOnly.hasChanges, true);
  assert.equal(outputOnly.outputsChanged, 1);
});

test("plan JSON that errored or is not a plan is refused", () => {
  assert.throws(
    () => terragrunt.summarizePlan({ ...plan([]), errored: true }),
    /errored/,
  );
  assert.throws(
    () => terragrunt.summarizePlan({ ...plan([]), format_version: "2.0" }),
    /unsupported/,
  );
  assert.throws(
    () => terragrunt.summarizePlan(plan([{ change: { actions: ["create"] } }])),
    /without an address/,
  );
  assert.throws(() => terragrunt.summarizePlan([]), /must be an object/);
});

test("the fingerprint binds every planned value but masks sensitive ones", () => {
  const sensitive = (value) =>
    plan([
      change("sink", ["update"], {
        before: { token: null, name: "a" },
        after: { token: value, name: "b" },
        before_sensitive: { token: true },
        after_sensitive: { token: true },
      }),
    ]);
  const one = terragrunt.summarizePlan(sensitive("one"));
  const two = terragrunt.summarizePlan(sensitive("two"));
  assert.match(one.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(one.fingerprint, two.fingerprint);
  const differentName = sensitive("one");
  differentName.resource_changes[0].change.after.name = "c";
  assert.notEqual(
    terragrunt.summarizePlan(differentName).fingerprint,
    one.fingerprint,
  );
  const reordered = terragrunt.summarizePlan(
    plan([change("b", ["create"]), change("a", ["create"])]),
  );
  const ordered = terragrunt.summarizePlan(
    plan([change("a", ["create"]), change("b", ["create"])]),
  );
  assert.equal(reordered.fingerprint, ordered.fingerprint);
  const imported = terragrunt.summarizePlan(
    plan([change("a", ["no-op"], { importing: { id: "1" } })]),
  );
  const otherImport = terragrunt.summarizePlan(
    plan([change("a", ["no-op"], { importing: { id: "2" } })]),
  );
  assert.notEqual(imported.fingerprint, otherImport.fingerprint);
});

test("the summary carries counts and addresses only, never values", () => {
  const summary = terragrunt.summarizePlan(
    plan([
      change('cloudflare_r2_bucket.x["`evil`\n| injected |"]', ["delete"], {
        before: { secret: "never-summarize-this" },
      }),
      ...Array.from({ length: 60 }, (_, index) =>
        change(`terraform_data.n${index}`, ["create"], {
          after: { input: "never-summarize-this" },
        }),
      ),
    ]),
  );
  const markdown = terragrunt.renderSummary(summary, {
    stack: "cloudflare-account",
    workingDirectory: "cloudflare/account",
    sha: "abc",
    runUrl: "https://github.com/o/r/actions/runs/1",
    heading: "Terragrunt plan",
  });
  assert.doesNotMatch(markdown, /never-summarize-this/);
  assert.match(markdown, /\| 60 \| 0 \| 1 \| 0 \| 0 \| 0 \| 0 \|/);
  assert.match(markdown, /destroys or replaces 1 resource/);
  assert.match(markdown, /11 more change\(s\) are in the run log/);
  assert.match(markdown, /`cloudflare_r2_bucket.x\["evil\| injected \|"\]`/);
  assert.equal(
    terragrunt
      .renderSummary(terragrunt.summarizePlan(plan([])), {
        stack: "s",
        workingDirectory: ".",
        sha: "abc",
        runUrl: "u",
        heading: "h",
      })
      .includes("No changes."),
    true,
  );
});

test("Terragrunt sees only the AWS session, declared credentials and fixed flags", () => {
  const resolved =
    terragrunt.validateTerragruntPolicy(policy()).stacks["cloudflare-account"];
  const secrets = JSON.stringify({
    CLOUDFLARE_API_TOKEN: "cf-token",
    CATALOG_TOKEN: "catalog",
    UNRELATED: "never-forward-this",
  });
  const { env, masks } = terragrunt.credentialEnvironment(resolved, "apply", {
    allSecrets: secrets,
    base,
  });
  assert.deepEqual(Object.keys(env).sort(), [
    "AWS_ACCESS_KEY_ID",
    "AWS_DEFAULT_REGION",
    "AWS_REGION",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "CLOUDFLARE_API_TOKEN",
    "HOME",
    "PATH",
    "TF_IN_AUTOMATION",
    "TF_VAR_catalog_token",
    "TG_DISABLE_BUCKET_UPDATE",
    "TG_NON_INTERACTIVE",
  ]);
  assert.equal(env.CLOUDFLARE_API_TOKEN, "cf-token");
  assert.equal(env.TF_VAR_catalog_token, "catalog");
  assert.equal(env.TG_DISABLE_BUCKET_UPDATE, "true");
  assert.deepEqual(masks, ["cf-token", "catalog"]);
  const planEnv = terragrunt.credentialEnvironment(resolved, "plan", {
    allSecrets: secrets,
    base,
  }).env;
  assert.equal(planEnv.TF_VAR_catalog_token, undefined);
  assert.equal(
    terragrunt.credentialEnvironment(resolved, "plan", {
      allSecrets: "{}",
      namedCloudflareToken: "named",
      base,
    }).env.CLOUDFLARE_API_TOKEN,
    "named",
  );
  assert.throws(
    () =>
      terragrunt.credentialEnvironment(resolved, "plan", {
        allSecrets: "{}",
        base,
      }),
    /CLOUDFLARE_API_TOKEN is not set on cloudflare-account-plan/,
  );
  assert.throws(
    () =>
      terragrunt.credentialEnvironment(resolved, "apply", {
        allSecrets: JSON.stringify({ CLOUDFLARE_API_TOKEN: "cf" }),
        base,
      }),
    /CATALOG_TOKEN is not set on cloudflare-account/,
  );
  assert.throws(
    () =>
      terragrunt.credentialEnvironment(resolved, "plan", {
        allSecrets: secrets,
        base: { PATH: "/usr/bin" },
      }),
    /AWS OIDC session/,
  );
  assert.throws(
    () =>
      terragrunt.credentialEnvironment(resolved, "plan", {
        allSecrets: "not json",
        base,
      }),
    /not JSON/,
  );
});

test("an apply refuses a plan that differs from the reviewed one or destroys", () => {
  const safe = terragrunt.summarizePlan(plan([change("a", ["create"])]));
  terragrunt.assertApplicable(safe, {
    reviewedFingerprint: safe.fingerprint,
    allowDestroy: false,
  });
  assert.throws(
    () =>
      terragrunt.assertApplicable(safe, {
        reviewedFingerprint: "0".repeat(64),
        allowDestroy: false,
      }),
    /differs from the reviewed plan/,
  );
  assert.throws(
    () =>
      terragrunt.assertApplicable(safe, {
        reviewedFingerprint: "",
        allowDestroy: false,
      }),
    /reviewed plan fingerprint/,
  );
  const destructive = terragrunt.summarizePlan(
    plan([change("a", ["delete", "create"])]),
  );
  assert.throws(
    () =>
      terragrunt.assertApplicable(destructive, {
        reviewedFingerprint: destructive.fingerprint,
        allowDestroy: false,
      }),
    /refuses to apply a plan that destroys or replaces: a/,
  );
  terragrunt.assertApplicable(destructive, {
    reviewedFingerprint: destructive.fingerprint,
    allowDestroy: true,
  });
});

function fakeTerragrunt(root, showJson) {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  const record = path.join(root, "calls.jsonl");
  const fixture = path.join(root, "show.json");
  fs.writeFileSync(fixture, JSON.stringify(showJson));
  fs.writeFileSync(
    path.join(bin, "terragrunt"),
    `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: process.env }) + "\\n");
if (process.argv[2] === "show") process.stdout.write(fs.readFileSync(${JSON.stringify(fixture)}, "utf8"));
`,
    { mode: 0o700 },
  );
  return { bin, record, fixture };
}

function cli(root, bin, command, flow, additions = {}) {
  return spawnSync(
    process.execPath,
    [path.resolve("scripts/terragrunt.bundle.mjs"), command, flow],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...base,
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: path.join(root, "tmp"),
        GITHUB_OUTPUT: path.join(root, "output"),
        GITHUB_STEP_SUMMARY: path.join(root, "summary"),
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "burnt-labs/iac-terraform",
        GITHUB_RUN_ID: "1",
        TERRAGRUNT_STACK: "cloudflare-account",
        SOURCE_SHA: "abc",
        DEFAULT_BRANCH: "main",
        ALL_SECRETS: JSON.stringify({
          CLOUDFLARE_API_TOKEN: "cf-token",
          CATALOG_TOKEN: "catalog",
        }),
        ...additions,
      },
    },
  );
}

test("bundled CLI plans a PR, reports outputs and fails on destroy after reporting", (t) => {
  const root = consumer(t);
  fs.mkdirSync(path.join(root, "tmp"));
  const { bin, record, fixture } = fakeTerragrunt(
    root,
    plan([change("a", ["create"], { after: { v: "value" } })]),
  );
  const pr = { SOURCE_EVENT: "pull_request", SOURCE_REF: "refs/pull/1/merge" };
  const resolved = cli(root, bin, "resolve", "pr", pr);
  assert.equal(resolved.status, 0, resolved.stderr);
  const stack = JSON.parse(
    fs.readFileSync(path.join(root, "output"), "utf8").split("\n")[1],
  );
  assert.equal(stack.plan.githubEnvironment, "cloudflare-account-plan");
  assert.equal(stack.terragruntVersion, "0.75.3");
  assert.equal(fs.existsSync(record), false, "resolve never runs Terragrunt");

  const planned = cli(root, bin, "plan", "pr", pr);
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /::add-mask::cf-token/);
  assert.doesNotMatch(planned.stdout, /catalog/);
  const calls = fs
    .readFileSync(record, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const planFile = path.join(
    root,
    "tmp",
    "terragrunt-cloudflare-account.tfplan",
  );
  assert.deepEqual(
    calls.map((call) => call.argv),
    [
      ["init", "-input=false", "-lockfile=readonly"],
      ["plan", "-input=false", `-out=${planFile}`],
      ["show", "-json", planFile],
    ],
  );
  for (const call of calls) {
    assert.equal(
      call.cwd,
      fs.realpathSync(path.join(root, "cloudflare/account")),
    );
    assert.equal(call.env.GITHUB_TOKEN, undefined);
    assert.equal(call.env.TF_VAR_injected, undefined);
    assert.equal(call.env.TF_VAR_catalog_token, undefined);
    assert.equal(call.env.ALL_SECRETS, undefined);
    assert.equal(call.env.CLOUDFLARE_API_TOKEN, "cf-token");
  }
  const outputs = fs.readFileSync(path.join(root, "output"), "utf8");
  assert.match(outputs, /has-changes<<EOF_[0-9a-f]+\ntrue\n/);
  assert.match(outputs, /destructive<<EOF_[0-9a-f]+\nfalse\n/);
  assert.match(outputs, /fingerprint<<EOF_[0-9a-f]+\n[0-9a-f]{64}\n/);
  assert.doesNotMatch(outputs, /value|cf-token/);
  assert.match(
    fs.readFileSync(path.join(root, "summary"), "utf8"),
    /\| add \| `a` \|/,
  );

  fs.writeFileSync(fixture, JSON.stringify(plan([change("a", ["delete"])])));
  fs.writeFileSync(path.join(root, "output"), "");
  const refused = cli(root, bin, "plan", "pr", pr);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /plan destroys or replaces: a/);
  assert.match(
    fs.readFileSync(path.join(root, "output"), "utf8"),
    /summary<<EOF_[0-9a-f]+\n### Terragrunt plan/,
    "the summary is written before the refusal so the PR comment can explain it",
  );
  const forged = cli(root, bin, "plan", "pr", {
    ...pr,
    TERRAGRUNT_ALLOW_DESTROY: "true",
  });
  assert.equal(forged.status, 1);
  assert.match(forged.stderr, /cannot allow destroy/);
});

test("bundled CLI honours the plan lock setting and applies only the saved plan", (t) => {
  const declaration = policy();
  declaration.stacks["cloudflare-account"].plan.lock = false;
  const root = consumer(t, declaration);
  fs.mkdirSync(path.join(root, "tmp"));
  const { bin, record } = fakeTerragrunt(root, plan([change("a", ["update"])]));
  const main = { SOURCE_EVENT: "push", SOURCE_REF: "refs/heads/main" };
  const planned = cli(root, bin, "plan", "main", main);
  assert.equal(planned.status, 0, planned.stderr);
  const fingerprint = /fingerprint<<EOF_[0-9a-f]+\n([0-9a-f]{64})\n/.exec(
    fs.readFileSync(path.join(root, "output"), "utf8"),
  )[1];
  const planFile = path.join(
    root,
    "tmp",
    "terragrunt-cloudflare-account.tfplan",
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(record, "utf8").trim().split("\n")[1]).argv,
    ["plan", "-input=false", `-out=${planFile}`, "-lock=false"],
  );
  fs.rmSync(record);

  const missing = cli(root, bin, "apply", "main", {
    ...main,
    REVIEWED_FINGERPRINT: fingerprint,
    ALL_SECRETS: JSON.stringify({ CLOUDFLARE_API_TOKEN: "cf-token" }),
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /CATALOG_TOKEN is not set/);
  assert.equal(
    fs.existsSync(record),
    false,
    "no Terragrunt call without credentials",
  );

  const stale = cli(root, bin, "apply", "main", {
    ...main,
    REVIEWED_FINGERPRINT: "f".repeat(64),
  });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /differs from the reviewed plan/);
  assert.equal(
    fs
      .readFileSync(record, "utf8")
      .trim()
      .split("\n")
      .some((line) => JSON.parse(line).argv[0] === "apply"),
    false,
  );
  fs.rmSync(record);

  const applied = cli(root, bin, "apply", "main", {
    ...main,
    REVIEWED_FINGERPRINT: fingerprint,
  });
  assert.equal(applied.status, 0, applied.stderr);
  const calls = fs
    .readFileSync(record, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    calls.map((call) => call.argv),
    [
      ["init", "-input=false", "-lockfile=readonly"],
      // Apply always locks, whatever the plan stage's setting.
      ["plan", "-input=false", `-out=${planFile}`],
      ["show", "-json", planFile],
      ["apply", "-input=false", planFile],
    ],
  );
  assert.equal(calls[3].env.TF_VAR_catalog_token, "catalog");
  assert.match(applied.stdout, /::add-mask::catalog/);

  const pr = cli(root, bin, "apply", "pr", {
    SOURCE_EVENT: "pull_request",
  });
  assert.equal(pr.status, 1);
  assert.match(pr.stderr, /apply main/);
});

const workflows = Object.fromEntries(
  ["terragrunt-pr.yml", "terragrunt-main.yml"].map((name) => {
    const source = fs.readFileSync(`.github/workflows/${name}`, "utf8");
    return [name, { source, workflow: parse(source) }];
  }),
);

test("Terragrunt workflows are reusable, read-only by default and validate first", () => {
  for (const [name, { workflow }] of Object.entries(workflows)) {
    assert.deepEqual(Object.keys(workflow.on), ["workflow_call"], name);
    assert.deepEqual(workflow.permissions, { contents: "read" }, name);
    assert.equal(workflow.on.workflow_call.inputs.stack.required, true, name);
    assert.equal(
      workflow.on.workflow_call.secrets["cloudflare-api-token"].required,
      false,
      name,
    );
    assert.equal(workflow.jobs.policy["runs-on"], "ubicloud-standard-2", name);
    assert.equal(workflow.jobs.plan.needs, "policy", name);
  }
  const pr = workflows["terragrunt-pr.yml"].workflow;
  assert.equal(pr.on.workflow_call.inputs.comment.default, true);
  assert.match(pr.jobs.policy.if, /draft == false/);
  assert.match(
    pr.jobs.policy.if,
    /head\.repo\.full_name == github\.repository/,
  );
  assert.match(pr.jobs.policy.if, /dependabot/);
  const main = workflows["terragrunt-main.yml"].workflow;
  assert.equal(main.on.workflow_call.inputs["allow-destroy"].default, false);
  assert.equal(main.on.workflow_call.inputs["allow-destroy"].type, "boolean");
});

test("Terragrunt permissions are least privilege per job", () => {
  const pr = workflows["terragrunt-pr.yml"].workflow;
  assert.equal(pr.jobs.policy.permissions, undefined);
  assert.deepEqual(pr.jobs.plan.permissions, {
    contents: "read",
    "id-token": "write",
  });
  assert.deepEqual(pr.jobs.comment.permissions, {
    contents: "read",
    "pull-requests": "write",
  });
  assert.equal(
    JSON.stringify(pr.jobs.comment).includes("secrets."),
    false,
    "the comment job holds no credentials",
  );
  const main = workflows["terragrunt-main.yml"].workflow;
  for (const job of ["plan", "apply"])
    assert.deepEqual(main.jobs[job].permissions, {
      contents: "read",
      "id-token": "write",
    });
  assert.equal(main.jobs.comment, undefined);
});

test("Terragrunt plan and apply bind the policy's distinct environments and roles", () => {
  for (const [name, { workflow }] of Object.entries(workflows))
    assert.equal(
      workflow.jobs.plan.environment.name,
      "${{ fromJSON(needs.policy.outputs.stack).plan.githubEnvironment }}",
      name,
    );
  const main = workflows["terragrunt-main.yml"].workflow;
  assert.equal(
    main.jobs.apply.environment.name,
    "${{ fromJSON(needs.policy.outputs.stack).apply.githubEnvironment }}",
  );
  for (const [name, { workflow }] of Object.entries(workflows))
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      const aws = (job.steps ?? []).filter((step) =>
        step.uses?.startsWith("aws-actions/configure-aws-credentials@"),
      );
      if (!["plan", "apply"].includes(jobName)) {
        assert.equal(aws.length, 0, `${name}/${jobName}`);
        continue;
      }
      assert.equal(aws.length, 1, `${name}/${jobName}`);
      assert.equal(
        aws[0].with["role-to-assume"],
        `\${{ fromJSON(needs.policy.outputs.stack).${jobName}.awsRoleArn }}`,
      );
      assert.equal(aws[0].with["aws-access-key-id"], undefined);
    }
});

test("Terragrunt jobs never cancel and keep main plans apart from PR plans", () => {
  const pr = workflows["terragrunt-pr.yml"].workflow;
  const main = workflows["terragrunt-main.yml"].workflow;
  const jobs = [pr.jobs.plan, main.jobs.plan, main.jobs.apply];
  for (const job of jobs) {
    assert.equal(job.concurrency["cancel-in-progress"], false);
    assert.match(job.concurrency.group, /workingDirectory/);
    assert.match(job.concurrency.group, /github\.repository/);
  }
  assert.equal(
    new Set(jobs.map((job) => job.concurrency.group.split("$")[0])).size,
    3,
  );
  assert.match(pr.jobs.plan.concurrency.group, /pull_request\.number/);
});

test("the apply job applies only after the reviewed plan, and only when it changes something", () => {
  const main = workflows["terragrunt-main.yml"].workflow;
  assert.deepEqual(main.jobs.apply.needs, ["policy", "plan"]);
  assert.equal(main.jobs.apply.if, "needs.plan.outputs.has-changes == 'true'");
  const step = main.jobs.apply.steps.at(-1);
  assert.equal(
    step.run,
    "node .burnt-workflows/scripts/terragrunt.bundle.mjs apply main",
  );
  assert.equal(
    step.env.REVIEWED_FINGERPRINT,
    "${{ needs.plan.outputs.fingerprint }}",
  );
  assert.equal(
    main.jobs.plan.steps.at(-1).run,
    "node .burnt-workflows/scripts/terragrunt.bundle.mjs plan main",
  );
  assert.equal(
    workflows["terragrunt-pr.yml"].workflow.jobs.plan.steps.at(-1).run,
    "node .burnt-workflows/scripts/terragrunt.bundle.mjs plan pr",
  );
  for (const { source } of Object.values(workflows)) {
    assert.doesNotMatch(
      source,
      /upload-artifact|download-artifact/,
      "plan files embed state and secrets",
    );
    assert.doesNotMatch(source, /-auto-approve/);
  }
});

test("Terragrunt credentials reach only the helper step", () => {
  for (const [name, { workflow, source }] of Object.entries(workflows)) {
    for (const [jobName, job] of Object.entries(workflow.jobs))
      for (const step of job.steps ?? []) {
        const env = JSON.stringify(step.env ?? {});
        const withs = JSON.stringify(step.with ?? {});
        assert.equal(withs.includes("secrets."), false, `${name}/${jobName}`);
        if (!env.includes("secrets")) continue;
        assert.match(
          step.run,
          /terragrunt\.bundle\.mjs (plan|apply) /,
          `${name}/${jobName}`,
        );
        assert.deepEqual(
          Object.keys(step.env).filter((key) =>
            step.env[key].includes("secrets"),
          ),
          ["ALL_SECRETS", "NAMED_CLOUDFLARE_API_TOKEN"],
        );
      }
    assert.equal(
      (source.match(/toJSON\(secrets\)/g) ?? []).length,
      name === "terragrunt-main.yml" ? 2 : 1,
    );
    assert.doesNotMatch(source, /toJSON\(vars\)|GITHUB_ENV/);
  }
});

test("Terragrunt tools are pinned: helper revision, wrapper off, verified binary", () => {
  const refs = new Set();
  for (const [name, { workflow }] of Object.entries(workflows))
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith("actions/checkout@"))
          assert.equal(step.with["persist-credentials"], false, name);
        if (step.with?.repository === "burnt-labs/github-workflows") {
          assert.match(step.with.ref, /^[0-9a-f]{40}$/);
          refs.add(step.with.ref);
        }
        if (step.uses?.startsWith("hashicorp/setup-terraform@")) {
          assert.equal(step.with.terraform_wrapper, false);
          assert.match(step.with.terraform_version, /terraformVersion/);
        }
        if (step.name === "Install Terragrunt") {
          assert.match(step.run, /SHA256SUMS/);
          assert.match(step.run, /sha256sum -c/);
          assert.match(step.env.TERRAGRUNT_VERSION, /terragruntVersion/);
        }
      }
      if (job.steps) {
        const reserve = job.steps.findIndex(
          (step) => step.name === "Reserve central tools directory",
        );
        const tools = job.steps.findIndex(
          (step) => step.with?.repository === "burnt-labs/github-workflows",
        );
        if (tools >= 0) assert.ok(reserve >= 0 && reserve < tools, name);
      }
    }
  assert.equal(
    refs.size,
    1,
    "both Terragrunt workflows check out one helper revision",
  );
});
