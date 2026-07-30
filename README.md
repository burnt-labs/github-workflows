# Burnt GitHub Workflows

Central organization-required and reusable GitHub Actions workflows.

## Repository Policies

Consumers define:

- `.github/quality-policy.jsonc`
- `.github/deployment-policy.jsonc` for Cloudflare deployments
- `.github/npm-policy.jsonc` for npm packages

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

| Topology   | Candidate | Release      |
| ---------- | --------- | ------------ |
| `standard` | `staging` | `production` |
| `chain`    | `testnet` | `mainnet`    |

Preview deployments use the actual target environment. `preview` and
`preview-*` GitHub Environments are invalid.

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
repository. Pin callers to a full commit SHA.

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
