# Central GitHub Workflows

## Objective

Provide organization-required quality checks and reusable deployment workflows
for Burnt repositories without permitting repository-local workflow drift.

## Contract

- Organization rulesets execute the central quality workflow for pull requests
  and merge groups.
- Repository quality policy defines commands and working directory.
- Repository deployment policy maps candidate/release roles to real GitHub and
  Cloudflare environments.
- Standard topology maps to staging/production.
- Chain topology maps to testnet/mainnet.
- No preview-specific GitHub Environments are permitted.
- Workflows never create commits or push branches.
