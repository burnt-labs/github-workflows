---
title: Phala reseals replace the complete allowed sealed environment
type: gotcha
scope: scripts/phala-reseal*.mjs
confidence: 0.99
sources: [66, 67]
updated: 2026-11-21
---
Phala's sealed-environment update replaces the entire environment; resealing a rotated credential is not a partial patch.
`resealEnvironment` derives the output names from the live CVM's `compose_file.allowed_envs`, supplying each from policy runtime declarations or the three `DSTACK_DOCKER_*` sources.
An allowed name absent from policy, an empty value, or a partially allowed registry-login triple fails closed; policy names outside `allowed_envs` are deliberately omitted.
`phala-reseal-cli.mjs` overlays 1Password-loaded runtime values before this resolution and proves registry access before updating the CVM.
`resealCvm` waits for settlement, replaces the environment, waits again, then restarts without changing compose; the workflow checks health afterward.
Tests in `tests/phala-reseal.test.mjs` cover exact-name selection and fail-closed cases. Preserve this complete-replacement contract when adding configuration sources or credential rotation paths.
