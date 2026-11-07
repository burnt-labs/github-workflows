---
title: Wrangler environment flags depend on the directly read config
type: gotcha
scope: .github/workflows/cloudflare-version.yml
confidence: 0.99
sources: [63, 64]
updated: 2026-11-07
---
`Resolve Wrangler environment` runs after Build and supplies the same `env-flag` to D1 migrations and upload/deploy.
A directly read config with matching top-level `targetEnvironment` is already environment-resolved; omit `--env` to avoid suffixing the resolved Worker name again and deploying to a different Worker without its secrets.
A `.wrangler/deploy/config.json` redirect alone keeps `--env`: deploy/upload follow it, while D1 reads the source config and needs the environment to select the correct database.
The resolver checks redirected and direct `targetEnvironment` values against the requested environment before migrations; a mismatch fails early.
Explicit `wranglerConfig` selects the direct file via `--config` and bypasses redirects. Single topology emits no environment flag.
Review changes to config discovery or command construction together; do not independently reconstruct `--env` from policy in a Wrangler command.
