---
title: Cloudflare fixes must propagate through transitive SHA pins
type: convention
scope: .github/workflows/cloudflare-*.yml
confidence: 0.99
sources: [60, 61, 62, 63, 64]
updated: 2026-11-07
---
Cloudflare consumers execute a pinned dependency chain, not necessarily the helper code at their selected outer workflow revision.
`cloudflare-version.yml` checks out central helper bundles at its own fixed `ref`; helper changes require updating that checkout to a commit containing the rebuilt bundle.
The outer PR/main/release workflows have six SHA-pinned calls to `cloudflare-version.yml` (one/three/two); propagate version-workflow changes to those call sites using a commit containing the fix.
Review release readiness across both pin layers: merely tagging a revision containing changed source does not update code executed by nested pins.
PRs #61–62 propagated the frontend helper fix in successive commits; #64 propagated the environment resolver fix.
Related contracts: [[frontend-build-directory-lifecycle]], [[wrangler-environment-resolution]].
