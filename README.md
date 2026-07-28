# Burnt GitHub Workflows

Central organization-required and reusable GitHub Actions workflows.

## Repository Policies

Consumers define:

- `.github/quality-policy.jsonc`
- `.github/deployment-policy.jsonc` for Cloudflare deployments
- `.github/npm-policy.jsonc` for npm packages

Quality policy commands are mandatory and independently run: install, lint,
Prettier, type-check, tests, coverage, and build.

Deployment policy uses semantic `candidate` and `release` roles:

| Topology   | Candidate | Release      |
| ---------- | --------- | ------------ |
| `standard` | `staging` | `production` |
| `chain`    | `testnet` | `mainnet`    |

Preview deployments use the actual target environment. `preview` and
`preview-*` GitHub Environments are invalid.

## Enforcement

Use `.github/workflows/required-quality.yml` as an organization ruleset required
workflow. It supports `pull_request` and `merge_group` without path filters.

Repository deployment trigger files call the reusable workflows from this
repository. Pin callers to a full commit SHA.

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
