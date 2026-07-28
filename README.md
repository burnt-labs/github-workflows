# Burnt GitHub Workflows

Central organization-required and reusable GitHub Actions workflows.

## Repository Policies

Consumers define:

- `.github/quality-policy.jsonc`
- `.github/deployment-policy.jsonc` for Cloudflare deployments

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
