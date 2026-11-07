---
title: Only frontend assets require a pre-build deployment directory
type: module
scope: scripts/frontend-build*
confidence: 0.99
sources: [60]
updated: 2026-11-07
---
`cloudflare-version.yml` prepares public frontend inputs from the workspace before Build, which runs in the quality-policy directory.
`runFrontendBuild` writes `buildVariables` only to `GITHUB_ENV`; variables-only policies must allow a deployment working directory created later by Build.
Only declared `buildAssets` trigger working-directory validation, symlink checks, and R2 downloads; their deployment directory must already exist as a real directory before Build.
Keep directory traversal inside the asset branch rather than making it a shared prerequisite for variables.
The workflow executes the committed bundle through a separate pinned helper checkout; see [[cloudflare-transitive-workflow-pins]].
