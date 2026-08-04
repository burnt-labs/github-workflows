# Agent Guidance

This repository holds the organization's required quality workflow and the
reusable deployment and publishing workflows. Consumer repositories contribute
policy files and thin trigger workflows; everything else lives here.

## Invariants

These are not preferences. Changes that break them will be rejected.

- Keep every commit signed.
- Workflows must never create commits or push branches. Version numbers are
  derived from release tags, never written back to the repository.
- Reusable deployment jobs must use the caller repository's actual target
  environment. Do not introduce `preview` or `preview-*` environments.
- Candidate and release are semantic roles, mapped by repository policy.
- Require lint, Prettier, type-check, tests, coverage, and build as independent
  quality gates.
- Pin every `uses:` reference to a full commit SHA with a trailing version
  comment. Dependabot advances the pins.
- Pin the npm CLI in every job that runs a consumer's `install`, and never
  accept an npm token anywhere.
- Cut a release for any change consumers should pick up. Consumers pin by SHA
  and Dependabot resolves the version from the trailing comment, so an
  unreleased change on `main` cannot reach them.
- Store repository-specific configuration in JSONC policy files.
- Open pull requests as drafts.

## The flows

Ten workflows. Eight are entry points; two are internal.

| Workflow                 | Called by                   | Purpose                                        |
| ------------------------ | --------------------------- | ---------------------------------------------- |
| `required-quality.yml`   | org ruleset, and every flow | Validate policies, run the quality gates       |
| `cloudflare-pr.yml`      | consumer, on `pull_request` | Quality, candidate preview, PR comment         |
| `cloudflare-main.yml`    | consumer, on push to main   | Quality, candidate deploy, release drafts      |
| `cloudflare-release.yml` | consumer, on `release`      | Preview or deploy the release target           |
| `npm-pr.yml`             | consumer, on `pull_request` | Quality, package dry run                       |
| `npm-main.yml`           | consumer, on push to main   | Publish the candidate dist-tag, release drafts |
| `npm-release.yml`        | consumer, on `release`      | Publish the release dist-tag                   |
| `phala-deploy.yml`       | consumer                    | Build and deploy a Phala CVM target            |
| `cloudflare-version.yml` | internal                    | One `wrangler versions upload` or `deploy`     |
| `npm-publish.yml`        | internal                    | One `npm publish` via OIDC trusted publishing  |

Consumers never call `cloudflare-version.yml` or `npm-publish.yml` directly.

## Policy files

A consumer must have `.github/quality-policy.jsonc`. It additionally needs
`.github/deployment-policy.jsonc` for Cloudflare flows and
`.github/npm-policy.jsonc` for npm flows, or `.github/phala-policy.jsonc` for
Phala flows. All are validated by
`scripts/policy.mjs`; an invalid policy fails the run before anything executes.
Reusable workflow callers may select alternate repository-relative `.jsonc`
paths through the `quality-policy-path` and product-specific policy-path inputs.
This is intended for monorepos; omitted inputs retain the root paths above.

### phala-policy.jsonc

Phala deployment follows the same semantic candidate/release boundary without
inventing infrastructure environments. Each role names its actual GitHub
Environment and CVM. The policy also owns the Docker build paths, compose file,
health endpoint, deployment credential names, and exact runtime configuration
allowlists. It contains no application-specific names or downstream workflow
orchestration.

```jsonc
{
  "schemaVersion": 1,
  "workingDirectory": ".",
  "composeFile": "service/docker-compose.phala.yaml",
  "healthcheckPath": "/health",
  "image": {
    "registry": "ghcr.io",
    "context": "service",
    "dockerfile": "service/Dockerfile",
    "name": "service",
    "composeVariable": "APP_IMAGE",
    "registryUsername": "registry-user",
  },
  "credentials": {
    "phalaApiKeySecret": "PHALA_CLOUD_API_KEY",
    "registryPasswordSecret": "REGISTRY_PASSWORD",
  },
  "runtimeSecrets": ["SERVICE_API_KEY"],
  "runtimeVariables": ["LOG_LEVEL"],
  "targets": {
    "candidate": {
      "githubEnvironment": "staging",
      "cvmName": "service-staging",
    },
    "release": {
      "githubEnvironment": "production",
      "cvmName": "service-production",
    },
  },
}
```

The image is always tagged with the deploying commit SHA and pushed to GHCR.
The Actions job token pushes it. The secret named by
`credentials.registryPasswordSecret` is a separate durable read-package
credential sealed into the CVM for future pulls. Never substitute the ephemeral
job token for that credential.

Callers pass `secrets: inherit`. The workflow selects only the names declared by
`credentials` and `runtimeSecrets`; it never forwards the whole secrets context
to Phala. `runtimeVariables` selects from the target GitHub Environment's vars.
Missing declared values fail before build or deploy. Credential names, dstack
registry variables, and `image.composeVariable` are reserved and cannot also be
runtime configuration.

The workflow returns `deployment-url` and does not mutate GitHub variables or
dispatch another workflow. Application-specific URL propagation belongs in a
caller job that consumes this output.

### quality-policy.jsonc

```jsonc
{
  "schemaVersion": 1, // must be 1
  "workingDirectory": ".", // where the commands run
  "commands": {
    // All seven are required and run as independent, separately-reported steps.
    "install": "pnpm install --frozen-lockfile",
    "lint": "pnpm lint",
    "prettier": "pnpm format:check",
    "typeCheck": "pnpm type-check",
    "test": "pnpm test",
    "coverage": "pnpm test:coverage",
    "build": "pnpm build",
    // Optional eighth command, runs last. For repository-specific gates that do
    // not fit the seven: dependency compatibility matrices, generated-artifact
    // drift, schema checks. Omit the key and the step is skipped.
    "validate": "pnpm validate:deps",
  },
  // Integers 0-100. The repository's own coverage command must enforce these;
  // the central workflow does not impose a percentage or cross-check the two.
  "coverageThresholds": { "lines": 80, "functions": 80, "branches": 80 },
}
```

### deployment-policy.jsonc

```jsonc
{
  "schemaVersion": 1,
  "topology": "chain", // "standard", "chain", or "single"
  "promotionMode": "manual", // "manual" or "automatic"
  "packageManager": "pnpm", // "npm", "pnpm", or "yarn"
  "workingDirectory": ".", // passed to wrangler-action
  "versionFile": "package.json", // seeds versioning when no release tags exist
  // Optional lowercase slug. Namespaces release tags in a monorepo, for example
  // "web" produces "web-v1.2.3". Omit for the existing "v1.2.3" format.
  "releasePrefix": "web",
  // Optional. GitHub Environment secret names published as Worker secrets
  // before each deploy. See "Worker secrets" below.
  "workerSecrets": ["STYTCH_SECRET"],
  // Optional, defaults to true. See "Where the release target is previewed".
  "previewReleaseOnMain": false,
  "targets": {
    "candidate": {
      "wranglerEnv": "testnet",
      "githubEnvironment": "testnet",
      "url": "https://aa-api.testnet.example.com",
    },
    "release": {
      "wranglerEnv": "mainnet",
      "githubEnvironment": "mainnet",
      "url": "https://aa-api.mainnet.example.com",
    },
  },
}
```

Topology fixes the environment names for `standard` and `chain`. `standard`
maps candidate to `staging` and release to `production`; `chain` maps them to
`testnet` and `mainnet`.
`githubEnvironment` must equal `wranglerEnv`, and neither may be `preview` or
start with `preview-`.

`single` is the third topology, for Workers with no wrangler `env` block. Both
roles are the same Worker, so promotion splits by traffic rather than by
environment: the main flow uploads the candidate at 0% and publishing a release
deploys it. Its targets omit `wranglerEnv` entirely — there is no environment to
name and `cloudflare-version.yml` drops `--env` — and both must declare the same
real `githubEnvironment` and an identical `url`. `previewReleaseOnMain`
is rejected rather than defaulted, because a release preview would upload the
same build to the same Worker twice. Note that this puts pull-request previews
on that GitHub Environment, inheriting its secrets and protection rules; that
is the cost of modelling one environment honestly.

### npm-policy.jsonc

```jsonc
{
  "schemaVersion": 1,
  "promotionMode": "manual",
  "workingDirectory": ".",
  "versionFile": "package.json",
  "access": "public", // only "public" is accepted
  "candidateDistTag": "next",
  "releaseDistTag": "latest", // must be "latest", and must differ from candidate
}
```

Publishing uses npm trusted publishing through GitHub OIDC with provenance. It
never accepts an npm token — do not add one. `npm-publish.yml` fails before it
installs anything if no OIDC token is available, because a caller that forgot
`id-token: write` otherwise fails much later inside `npm publish`, as an
authentication error that reads like a registry problem.

That posture is also the answer to npm's deprecation of 2FA-bypass granular
access tokens: from early August 2026 they stop skipping 2FA for account
operations, and around January 2027 they lose publishing entirely. Nothing here
has to migrate, because nothing here holds a token. Keep it that way — a test
rejects any workflow that names `NPM_TOKEN` or `NODE_AUTH_TOKEN` outside the
guard that refuses to run when one is present.

## npm install-time security

Every job that runs a consumer's `install` command pins the npm CLI:

```yaml
- name: Pin the npm CLI
  run: npm install --global npm@12
```

npm 12 changed what an install does by default, and the change is invisible
rather than loud:

- **Dependency lifecycle scripts do not run.** `preinstall`, `install`,
  `postinstall`, and implicit `node-gyp` builds are default-denied unless the
  package is listed in the consumer's `allowScripts`. npm _warns_ and carries
  on, so the symptom is not the install failing — it is a native module that
  was never built, surfacing later in the build or at runtime.
- **`allow-git` and `allow-remote` default to `none`.** Dependencies pointing at
  a git repository or a tarball URL no longer resolve.

The pin exists because `lts/*` currently bundles npm 11, which only warns about
all of this, and will roll to an npm 12 Node on Node's schedule rather than
ours. Unpinned, every consumer's install semantics would change on a day nobody
picked, in the same run as whatever else that Node bump brought. Pinned, the
change arrives when a consumer advances its SHA — reviewable, revertable, and
attributable. The step asserts what actually landed on `PATH` rather than
trusting the install, since a pin that silently loses to a shim buys nothing.

Consumers keep the escape hatches, and should reach for them in this order:

```jsonc
// package.json — the reviewed allowlist. Generate it with
// `npm approve-scripts`, and see what is pending with
// `npm approve-scripts --allow-scripts-pending`.
{ "allowScripts": { "esbuild@0.28.1": true, "some-other-package": false } }
```

```ini
# .npmrc — for git or URL dependencies, and for CI-only script allowances.
allow-git=root
allow-scripts=sharp,canvas
```

An `.npmrc` in the consumer repository is deliberately not overridden by these
workflows. Setting `npm_config_allow_git` at the job level would have made the
policy uniform and taken the decision away from the repository that owns it.

pnpm 10 already default-denies build scripts through `onlyBuiltDependencies`,
so pnpm consumers are unaffected by the pin. Yarn is the gap: it has no
equivalent default, and `enableScripts` in `.yarnrc.yml` is the knob.

### Worker secrets

Developers do not have Cloudflare access, so `wrangler secret put` is not
something they can run and GitHub is the only place they can hold a secret. The
deploy carries the declared ones across:

```jsonc
{
  "workerSecrets": ["STYTCH_SECRET", "WEBHOOK_SIGNING_KEY"],
}
```

Each name must exist as a secret on the target GitHub Environment. Before
creating the version, `cloudflare-version.yml` collects them and runs
`wrangler secret bulk`, so the version picks them up.

**The allowlist is the entire safety property.** `toJSON(secrets)` in that step
contains every secret the caller inherited, the Cloudflare API token included.
Only names listed in the policy are forwarded, and the validator rejects the
credential names outright so a policy cannot publish the token into the Worker.

A declared name that is not set on the environment **fails the deploy**. It does
not skip the secret and carry on — absent configuration that degrades quietly is
how a Worker ends up running without a credential it needs and reporting
success.

**Secrets are published on deploy, never on preview.** `wrangler secret bulk`
creates a Worker version and deploys it immediately, so running it on a preview
would serve an intermediate version — on a `chain` repository that means mainnet
starts serving from a job whose entire purpose is not to serve. A preview
therefore runs against whatever secrets are already on the Worker, the same way
it inherits its bindings. A brand-new secret is live from the first deploy that
publishes it, not from the preview before it.

**Removing a name from `workerSecrets` does not revoke it.** The list is an
upsert, not a reconciliation: the deploy sets what it names and leaves
everything else alone. A secret dropped from the policy stays on the Worker and
stays readable by Worker code. Deleting instead would mean the workflow removing
secrets it did not set, which is worse — plenty of Workers have secrets set
outside this policy. Revoke deliberately with `wrangler secret delete`, and note
that this needs Cloudflare access, which is the thing the rest of this section
exists to avoid. Treat a removal as unfinished until someone with access has
done it.

Callers that use this must pass `secrets: inherit` rather than the two named
secrets, because inherited secrets arrive under their own names. Both forms
work: `cloudflare-version.yml` resolves `cloudflare-api-token` first and falls
back to `BURNT_CLOUDFLARE_API_TOKEN`, and fails loudly if neither is present.

```yaml
jobs:
  cloudflare:
    uses: burnt-labs/github-workflows/.github/workflows/cloudflare-pr.yml@<sha> # vX.Y.Z
    secrets: inherit
```

Note what `inherit` widens: the deploy job can then see every secret the calling
repository holds, not just the Cloudflare ones. That job already runs consumer
code alongside the deployment credential, so this does not cross a new boundary
— but it does enlarge what a compromised consumer build can reach.

## Wiring a consumer repository

Callers are thin: a trigger, a permissions ceiling, and secrets. Put no logic in
them. Pin every `uses:` to a full commit SHA of this repository.

**Permissions matter.** A called workflow cannot hold more permission than its
caller grants, so the caller must grant the union of what the flow's jobs
declare. Granting less silently breaks the jobs that need it.

### Cloudflare

`.github/workflows/pull-request.yml`

```yaml
name: Pull Request
on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened, ready_for_review]
permissions:
  contents: read
  deployments: write
  issues: write # publish-preview comments on the PR
  pull-requests: write
jobs:
  cloudflare:
    uses: burnt-labs/github-workflows/.github/workflows/cloudflare-pr.yml@<sha>
    secrets:
      cloudflare-account-id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      cloudflare-api-token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

Include `ready_for_review` in `types`. Draft and fork pull requests skip the
whole flow, so without it a draft marked ready never runs.

`.github/workflows/push-main.yml`

```yaml
name: Push to Main
on:
  push:
    branches: [main]
permissions:
  contents: write # create-releases writes release drafts
  deployments: write
jobs:
  cloudflare:
    uses: burnt-labs/github-workflows/.github/workflows/cloudflare-main.yml@<sha>
    secrets:
      cloudflare-account-id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      cloudflare-api-token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

`.github/workflows/release.yml`

```yaml
name: Release
on:
  release:
    types: [created, published]
permissions:
  contents: write # annotate-release edits release notes
  deployments: write
jobs:
  cloudflare:
    uses: burnt-labs/github-workflows/.github/workflows/cloudflare-release.yml@<sha>
    with:
      release-tag: ${{ github.event.release.tag_name }}
      release-url: ${{ github.event.release.html_url }}
      prerelease: ${{ github.event.release.prerelease }}
      # preview on created, deploy on published. Omit entirely to only ever
      # deploy, and trigger on [published] alone.
      operation: ${{ github.event.action == 'created' && 'preview' || 'deploy' }}
    secrets:
      cloudflare-account-id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      cloudflare-api-token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

### npm

Same shape. `npm-pr.yml` and `npm-main.yml` take no inputs; `npm-release.yml`
takes `release-tag` and `prerelease` — note it has no `release-url` input, unlike
the Cloudflare equivalent. Any caller reaching `npm-publish.yml` needs
`id-token: write` for OIDC.

```yaml
permissions:
  contents: write
  id-token: write
jobs:
  npm:
    uses: burnt-labs/github-workflows/.github/workflows/npm-main.yml@<sha>
```

### The required quality workflow

Register `required-quality.yml` as an organization ruleset required workflow. It
supports `pull_request` and `merge_group` with no path filters, which is what
rulesets need.

It will then run twice on a pull request in a repository that also uses a flow
workflow — once from the ruleset, once nested inside the flow. That is expected.
Do not try to deduplicate it by adding path filters or conditions; the ruleset
run is the one that gates merging.

## Versioning and promotion

`scripts/release-metadata.mjs` computes the next version by taking the highest
existing stable `v*.*.*` release tag and incrementing its patch. `versionFile`
seeds this only when no stable release tags exist yet. Nothing is written back —
a consumer's `package.json` version is not maintained by CI and will lag its
tags. If a repository reports its version at runtime, read it from somewhere
else.

Each push to main produces:

- `v<next>-rc.<run_number>` — a prerelease, published/deployed immediately
- `v<next>` — a draft release, retargeted to the current commit

`promotionMode` decides what happens to the draft:

- `manual` — nothing, until a human publishes it. Publishing fires the consumer's
  release trigger, which deploys or publishes the release target.
- `automatic` — the main flow deploys the release target and marks the draft
  published in the same run.

## Where the release target is previewed

By default every push to main uploads a release-target preview at 0% traffic, so
the release build is exercised before it is cut.

A preview inherits the target environment's secrets and bindings, and where
`preview_urls` is enabled it is reachable at a public URL. On a `chain`
repository the release target is mainnet. Previewing it on every merge is a
deliberate choice, not a neutral default — treat it as a posture decision when
onboarding a repository.

Repositories that would rather not touch the release environment on ordinary
merges set `previewReleaseOnMain: false`, and can validate at release time
instead by passing `operation: preview` on `release: created`.

## Failure modes to know

**A skipped job skips its dependents.** This is why `create-releases` has an
explicit `if` naming `needs.preview-release.result == 'skipped'`. Anything made
conditional must have its dependents audited, or gating a job will silently
disable everything downstream while the run still reports success.

**GitHub casts across types in `if:`.** A missing policy key reaches a condition
as `null`, and `null` and `false` both cast to `0`. Optional booleans that a
workflow reads must be normalized to an explicit value in `scripts/policy.mjs`,
not left to default at the point of use. `previewReleaseOnMain` does this.

**`&&` / `||` return an operand, not a boolean, and `''` is falsy.** So
`cond && '' || other` evaluates to `other` for _every_ value of `cond` — the
empty branch can never be selected. Any ternary whose intended result is an
empty string must be written with the condition negated and `''` on the right:
`!cond && other || ''`. `cloudflare-version.yml` builds its optional `--env`
fragment this way, and a test asserts the shape, because the broken form fails
only under `single` topology and only at deploy time.

**Mutually exclusive conditions can select nothing.** If every branch is
conditional and none matches, the run succeeds having done nothing. Guard the
input instead — `cloudflare-release.yml` has a `validate` job that fails on an
unrecognized `operation` for exactly this reason.

**Command strings are interpolated into `run:`.** Policy commands come from the
consumer's checked-out branch, so on a pull request they are attacker-controlled
to the extent that opening a PR is. Fork PRs are excluded and receive no secrets,
which is the boundary this relies on. Never pass a branch name, PR title, or any
other free-text field into `version-message` or a `command:` input; PR numbers
and URLs are safe.

**A blocked install script does not fail the install.** npm 12 default-denies
dependency lifecycle scripts and warns rather than erroring, so the install goes
green and the missing native build surfaces somewhere downstream — a build step,
a test, or production. Read the install log's warnings when a consumer's build
breaks for no visible reason after advancing its pin. See "npm install-time
security".

**Previews still run consumer code with credentials.** `cloudflare-version.yml`
runs the consumer's `install` and `build` in the same job that holds the
Cloudflare API token. Write access to a consumer repository therefore implies
access to its deployment credentials.

## Changing this repository

Run `pnpm run check` — Prettier, `node --test`, and `actionlint`. All must pass.

**Rebuild the bundle.** `required-quality.yml` executes
`scripts/policy.bundle.mjs`, not `scripts/policy.mjs`. After editing the policy
source run `pnpm run build`, or the change will validate locally and do nothing
in CI.

**Advance pins in lockstep.** Workflows here reference each other by SHA, and
`required-quality.yml` checks this repository out by SHA to get the policy
scripts. Editing a workflow or a script means every reference to it must move to
the new commit, including that `ref:`. A stale pin does not error — it silently
runs the old version. Commit the pin advance separately so it is reviewable, and
bump again to the merge commit afterwards.

This has bitten twice, both times silently, and both times the symptom appeared
in a consumer rather than here: a caller pinned before the SHA-pinning work kept
resolving a floating `cloudflare/wrangler-action` in the job holding
`cloudflare-api-token`, and a caller pinned before a Dependabot bump kept
resolving Node 20 actions. Green runs throughout. When you touch a pin, check
what the _old_ SHA actually resolved to rather than assuming it was equivalent.

**Then cut a release.** Consumers pin by SHA with a version comment, and
Dependabot resolves the version from the release list. Merging to `main` without
tagging leaves consumers on the previous SHA indefinitely, which is how both
failures above persisted.

Encode new invariants as tests in `tests/`. The existing tests assert things
like "no workflow creates commits" and "every action is SHA-pinned" precisely
because those are easy to regress and quiet when they break.
