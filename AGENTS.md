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
- Store repository-specific configuration in JSONC policy files.
- Open pull requests as drafts.

## The flows

Nine workflows. Seven are entry points; two are internal.

| Workflow                 | Called by                   | Purpose                                        |
| ------------------------ | --------------------------- | ---------------------------------------------- |
| `required-quality.yml`   | org ruleset, and every flow | Validate policies, run the quality gates       |
| `cloudflare-pr.yml`      | consumer, on `pull_request` | Quality, candidate preview, PR comment         |
| `cloudflare-main.yml`    | consumer, on push to main   | Quality, candidate deploy, release drafts      |
| `cloudflare-release.yml` | consumer, on `release`      | Preview or deploy the release target           |
| `npm-pr.yml`             | consumer, on `pull_request` | Quality, package dry run                       |
| `npm-main.yml`           | consumer, on push to main   | Publish the candidate dist-tag, release drafts |
| `npm-release.yml`        | consumer, on `release`      | Publish the release dist-tag                   |
| `cloudflare-version.yml` | internal                    | One `wrangler versions upload` or `deploy`     |
| `npm-publish.yml`        | internal                    | One `npm publish` via OIDC trusted publishing  |

Consumers never call `cloudflare-version.yml` or `npm-publish.yml` directly.

## Policy files

A consumer must have `.github/quality-policy.jsonc`. It additionally needs
`.github/deployment-policy.jsonc` for Cloudflare flows and
`.github/npm-policy.jsonc` for npm flows. All are validated by
`scripts/policy.mjs`; an invalid policy fails the run before anything executes.

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
  "topology": "chain", // "standard" or "chain"
  "promotionMode": "manual", // "manual" or "automatic"
  "packageManager": "pnpm", // "npm", "pnpm", or "yarn"
  "workingDirectory": ".", // passed to wrangler-action
  "versionFile": "package.json", // seeds versioning when no release tags exist
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

Topology fixes the environment names. `standard` maps candidate to `staging`
and release to `production`; `chain` maps them to `testnet` and `mainnet`.
`githubEnvironment` must equal `wranglerEnv`, and neither may be `preview` or
start with `preview-`.

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
never accepts an npm token — do not add one.

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

Encode new invariants as tests in `tests/`. The existing tests assert things
like "no workflow creates commits" and "every action is SHA-pinned" precisely
because those are easy to regress and quiet when they break.
