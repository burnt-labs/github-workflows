# Burnt GitHub Workflows

Central organization-required and reusable GitHub Actions workflows.

[AGENTS.md](./AGENTS.md) is the full reference: every workflow's contract, the
complete policy schemas, copy-pasteable caller templates, and the failure modes
worth knowing before changing anything here.

## Repository Policies

Consumers define:

- `.github/quality-policy.jsonc`
- `.github/deployment-policy.jsonc` for Cloudflare deployments
- `.github/npm-policy.jsonc` for npm packages
- `.github/phala-policy.jsonc` for Phala CVM deployments

Quality policy commands are mandatory and independently run: install, lint,
Prettier, type-check, tests, coverage, and build. Each repository also owns
integer `coverageThresholds` for `lines`, `functions`, and `branches` from 0 to 100. The repository's coverage command must enforce those declared values;
the central workflow does not impose a universal percentage.

Example quality policy:

```jsonc
{
  "schemaVersion": 1,
  "workingDirectory": ".",
  "commands": {
    "install": "pnpm install --frozen-lockfile",
    "lint": "pnpm lint",
    "prettier": "pnpm prettier",
    "typeCheck": "pnpm type-check",
    "test": "pnpm test",
    "coverage": "pnpm test:coverage",
    "build": "pnpm build",
  },
  "coverageThresholds": {
    "lines": 80,
    "functions": 80,
    "branches": 80,
  },
}
```

`commands.validate` is the one optional command. It runs last, after build, and
exists for repository-specific gates that do not fit the seven standard ones —
dependency compatibility matrices, generated-artifact drift, schema checks. Omit
the key and the step is skipped.

Deployment policy uses semantic `candidate` and `release` roles:

| Topology   | Candidate    | Release      |
| ---------- | ------------ | ------------ |
| `standard` | `staging`    | `production` |
| `chain`    | `testnet`    | `mainnet`    |
| `single`   | `production` | `production` |

Preview deployments use the actual target environment. `preview` and
`preview-*` GitHub Environments are invalid.

### The `single` topology

For Workers that have no wrangler `env` block and no second environment to
promote through. Rather than inventing a staging environment nobody deploys to,
`single` keeps both roles on the one Worker and splits promotion by **traffic**
instead of by environment:

| Event                    | What happens                                |
| ------------------------ | ------------------------------------------- |
| Pull request to `main`   | `versions upload` — exists at 0% traffic    |
| Push to `main`           | `versions upload` — the candidate, still 0% |
| GitHub release published | `deploy` — this is what serves traffic      |

Its policy names no `wranglerEnv`, because there is no wrangler environment to
name — the deploy omits `--env` entirely. Both roles must declare
`githubEnvironment: "production"` and the same `url`.

```jsonc
{
  "schemaVersion": 1,
  "topology": "single",
  "promotionMode": "manual",
  "packageManager": "pnpm",
  "workingDirectory": ".",
  "versionFile": "package.json",
  "targets": {
    "candidate": {
      "githubEnvironment": "production",
      "url": "https://worker.burnt.workers.dev",
    },
    "release": {
      "githubEnvironment": "production",
      "url": "https://worker.burnt.workers.dev",
    },
  },
}
```

Two consequences to weigh before adopting it:

- **Merging stops being live.** A merge to `main` no longer serves. Repositories
  that want merge-to-live set `promotionMode: "automatic"`, which deploys and
  publishes the release in the same run.
- **Every preview runs against `production`.** There is only one GitHub
  Environment, so pull-request previews and candidate uploads both use it —
  they inherit its secrets and are subject to its protection rules.

`previewReleaseOnMain` is rejected under `single`. There is one Worker and the
main flow already uploads it, so a release preview would upload the same build
to the same place twice.

### When the release target is previewed

By default every push to main uploads a release-target preview at 0% traffic, so
the release build is exercised before it is cut. Repositories that would rather
not touch the release environment on ordinary merges set:

```jsonc
{
  "previewReleaseOnMain": false,
}
```

Those repositories can validate at release time instead by passing `operation`
to `cloudflare-release.yml` — `preview` on `release: created`, `deploy` on
`release: published`. `operation` defaults to `deploy`, and an unrecognized
value fails the run rather than silently skipping every job.

Note that a preview inherits the target environment's secrets and bindings and,
where `preview_urls` is enabled, is reachable at a public URL. Previewing the
release target on main is therefore a deliberate choice, not a neutral default.

## Enforcement

Use `.github/workflows/required-quality.yml` as an organization ruleset required
workflow. It supports `pull_request` and `merge_group` without path filters.

Repository deployment trigger files call the reusable workflows from this
repository. Pin callers to a full commit SHA **with a trailing version comment**
naming the release that SHA belongs to:

```yaml
uses: burnt-labs/github-workflows/.github/workflows/cloudflare-pr.yml@921f1f27… # v1.0.0
```

The comment is not decoration. Dependabot resolves the version from it and
opens bump pull requests; without it, and without releases here, a caller's pin
never moves. That is not hypothetical — before `v1.0.0` this repository had no
tags, so consumers silently kept resolving pre-pinning snapshots: a floating
`cloudflare/wrangler-action` in the job holding `cloudflare-api-token`, and
Node 20 actions months after these workflows had moved to Node 24. The
`actions/*` pins inside the workflows advanced automatically the whole time,
because those publish releases and this repository did not.

**Cut a release for any change consumers should pick up.** A merge to `main` no
consumer can resolve a version for is a change that will not reach them.

Every `uses:` reference inside this repository is itself pinned to a full commit
SHA with a trailing version comment, so a compromised upstream tag cannot reach
the jobs that hold deployment credentials. Dependabot advances the pins weekly
and a test rejects any reference that is not a 40-character SHA.

Workflows in this repository never create commits or push branches.

## npm

The npm workflow family performs a package dry run on pull requests, publishes
`v<version>-rc.<run>` with the `next` dist-tag from main, and publishes the
stable version with `latest` after manual or automatic promotion. Publishing
uses npm trusted publishing through GitHub OIDC with provenance. It does not
accept an npm token and does not create version-bump commits.

Example policy:

```jsonc
{
  "schemaVersion": 1,
  "promotionMode": "manual",
  "workingDirectory": ".",
  "versionFile": "package.json",
  "access": "public",
  "candidateDistTag": "next",
  "releaseDistTag": "latest",
}
```

npm's deprecation of 2FA-bypass granular access tokens — no 2FA skipping for
account operations from early August 2026, no publishing at all around January
2027 — requires no migration here. These workflows never held a token, and a
test keeps it that way.

### Install-time security

Every job that runs a consumer's `install` command pins the npm CLI to npm 12,
which changed what an install does by default: dependency lifecycle scripts
(`preinstall`, `install`, `postinstall`, `node-gyp` builds) are default-denied
unless allowlisted, and `allow-git` and `allow-remote` default to `none`.

npm **warns** rather than failing when it skips a script, so an unbuilt native
module surfaces later — in the build, the tests, or production. Repositories
that depend on install scripts should run `npm approve-scripts` and commit the
resulting `allowScripts` field before advancing their pin;
`npm approve-scripts --allow-scripts-pending` lists what is unreviewed without
writing anything.

The pin exists so this arrives on a schedule someone chose. Node's `lts/*` still
bundles npm 11, which only warns about the new defaults, and will roll to an
npm 12 Node on its own timing — unpinned, every consumer's install semantics
would change on a day nobody picked. A consumer's own `.npmrc` still wins;
these workflows set no npm config.

pnpm 10 already default-denies build scripts, so pnpm consumers see no change.

## Phala

`phala-deploy.yml` is an application-neutral deployment primitive. It requires
the repository's quality gates, builds a commit-addressed private GHCR image,
deploys or updates the selected Phala CVM, resolves and health-checks its public
HTTPS endpoint, and returns that URL to the caller. It does not know about a
consumer's service names, secret bundle format, GitHub variables, or dependent
workflows.

Example `.github/phala-policy.jsonc`:

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

The consumer trigger stays thin:

```yaml
name: Deploy Phala
on:
  push:
    branches: [main]
    paths: [service/**, .github/phala-policy.jsonc]
  workflow_dispatch:
    inputs:
      target:
        required: true
        type: choice
        options: [candidate, release]
permissions:
  contents: read
  deployments: write
  packages: write
jobs:
  phala:
    uses: burnt-labs/github-workflows/.github/workflows/phala-deploy.yml@<sha> # vX.Y.Z
    with:
      target: ${{ inputs.target || 'candidate' }}
    secrets: inherit
```

The credential fields and `runtimeSecrets` select exact names from the target
GitHub Environment's inherited secrets; `runtimeVariables` selects exact names
from its variables. A missing declared value fails before build or deploy. The
registry password must be a durable read-package credential because Phala pulls
the private image again after the Actions job token expires.

The workflow's `deployment-url` output is the boundary for consumer-specific
orchestration. A caller that needs to store the URL or redeploy another service
does so in its own downstream job; the reusable workflow never mutates those
resources itself.
