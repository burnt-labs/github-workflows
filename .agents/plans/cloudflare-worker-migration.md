# Migrating Burnt Cloudflare Workers to the Central Workflows

## Objective

Move every Cloudflare Worker repository in `burnt-labs` onto the reusable
workflows in this repository, so deployment logic lives here once rather than
being copied per repository. Where a repository does not fit the shape these
workflows provide, say so explicitly rather than bending either side quietly.

`account-abstraction-api` is migrated and is the reference implementation.

## How this inventory was produced

Reproducible, and worth re-running before acting on any section — the org moves.

```bash
# Active repositories
gh api "orgs/burnt-labs/repos?per_page=100" --paginate --jq '.[] | select(.archived==false) | .name'

# Root-level Workers: probe each for wrangler.jsonc / wrangler.json / wrangler.toml
gh api "repos/burnt-labs/<repo>/contents/wrangler.jsonc"

# Nested Workers in monorepos
gh api "search/code?q=repo:burnt-labs/<repo>+filename:wrangler"

# Wrangler environments (parse as JSONC — a regex truncates at the first brace)
gh api "repos/burnt-labs/<repo>/contents/wrangler.jsonc" --jq .content | base64 -d

# GitHub Environments, which must match the wrangler environment names
gh api "repos/burnt-labs/<repo>/environments" --jq '[.environments[].name]|join(",")'
```

Counts at time of writing: **166 active repositories, 36 root-level Workers,
15 more nested in two monorepos — 51 Worker deployments in total.**

## What the central shape requires

A repository fits when all of these hold. Each is enforced by
`scripts/policy.mjs` and fails the run before anything executes.

1. **Exactly two deploy targets**, named by topology — `chain` → `testnet` and
   `mainnet`, `standard` → `staging` and `production`. No third environment is
   expressible, and the names are fixed.
2. **`githubEnvironment` equals `wranglerEnv`**, and neither may be `preview`
   or start with `preview-`.
3. **One Worker per repository.** The deployment policy has a single
   `workingDirectory` and a single `targets` pair.
4. **Seven quality commands**, all mandatory and all non-empty: `install`,
   `lint`, `prettier`, `typeCheck`, `test`, `coverage`, `build`. Plus optional
   `validate`.
5. **Integer `coverageThresholds`** that the repository's own coverage command
   actually enforces.
6. **Releases drive promotion.** CI never commits, so any repository that
   relies on a CI-authored version bump changes behaviour on migration.

## Fit summary

| Tier  | Meaning                                                              | Count |
| ----- | -------------------------------------------------------------------- | ----- |
| **A** | Migrate as-is or near enough                                         | 3     |
| **B** | Fits the shape; needs quality commands added or environments renamed | 9     |
| **C** | Environment model does not map — needs a product decision first      | 9     |
| **D** | Does not fit today; needs an upstream change or is out of scope      | 30    |

Tier D is the majority. That is the headline finding: **most Burnt Workers are
single-environment or have no environments at all**, and the central shape
mandates two.

## Tier A — migrate first

| Repository                | Envs                | Gates | Notes                                                                                                                                            |
| ------------------------- | ------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `account-abstraction-api` | testnet, mainnet    | 6/6   | **Done.** Reference implementation                                                                                                               |
| `cloudflare-app-template` | staging, production | 5/6   | Missing `prettier`. **Migrate early — it is the template new repos are cut from, so fixing it here is the highest-leverage change in this plan** |
| `treasury-worker`         | testnet, mainnet    | 5/6   | Missing `typeCheck`. GitHub Environments already exactly `mainnet,testnet`                                                                       |

## Tier B — small, mechanical gaps

Environments already map, or are one rename away. The work is adding missing
quality commands.

| Repository                      | Envs                  | Gates | Gap                                                                                                                                                              |
| ------------------------------- | --------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cue-api`                       | demo, production      | 6/6   | `demo` → `staging` rename for `standard` topology                                                                                                                |
| `cue-app`                       | demo, production      | 5/6   | As above, plus `prettier`                                                                                                                                        |
| `xion-staking`                  | testnet, mainnet      | 5/6   | Has `lint`, `lint:prettier`, `type-check`, `test`, `build`; needs a `coverage` command. Remove `preview-testnet`/`preview-mainnet`/`staging` GitHub Environments |
| `xion-stytch-proxy`             | testnet, mainnet      | 2/6   | Needs lint, prettier, coverage, build. Remove `preview-*` Environments                                                                                           |
| `xion-explorer`                 | testnet, mainnet      | 2/6   | Needs lint, prettier, test, coverage. Uses **yarn** — supported, set `packageManager: "yarn"`. Remove `preview`/`production` Environments                        |
| `zk-email-worker`               | testnet, mainnet      | 1/6   | Needs five gates. Clean up `preview-pr-*` Environments (40, 41, 43 — leftovers the central per-PR preview replaces)                                              |
| `oauth2-api-service`            | dev, testnet, mainnet | 2/6   | Third environment `dev` is not expressible; decide whether it stays outside CI. Remove `preview-*` Environments                                                  |
| `burnt-verify-real-estate`      | demo, staging, live   | 6/6   | Three environments; `live` → `production` and drop or externalise `demo`                                                                                         |
| `burnt-verify-insurance-claims` | demo, staging, live   | 6/6   | As above. These two are near-identical and should move together                                                                                                  |

## Tier C — environment model does not map

These need a decision about what their environments _mean_ before any workflow
change. Do not migrate them by inventing a mapping.

| Repository                                                                                                                        | Envs                                                        | Problem                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `xion-dashboard-app`                                                                                                              | mainnet, mainnet-apple, testnet, testnet-beta, mainnet-beta | Five environments encoding a build-variant matrix (Apple, beta). The topology has room for two                                |
| `eth-kms-signer`                                                                                                                  | eth-signer-mainnet, eth-signer-testnet                      | Prefixed names; topology requires bare `testnet`/`mainnet`. No `package.json` scripts at all (0/6) and no GitHub Environments |
| `verona-website`                                                                                                                  | demo                                                        | Single environment. Needs a second target or it cannot express candidate → release                                            |
| `xion-analytics`, `demo-nft-viewer`, `plunk-cf-worker`, `service-marketplace-demo-ui`, `xion-deposit-webhooks`, `acme-dns-worker` | none                                                        | Have a usable gate set (2–4/6) but **no wrangler environments**, so there is nothing to map candidate and release onto        |

## Tier D — needs an upstream change, or is out of scope

### Multi-Worker repositories — the clearest structural gap

| Repository             | Workers                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloudflare-workers`   | 12 — `api-proxy`, `rpc-proxy`, `basic-auth`, `whitepaper`, `shared-env`, `truth-proxy`, `linear-agent`, `alpine-pub-key`, `proposals-hack`, `faucet-reloader`, `circulating-supply`, `abstraxion-simulate` |
| `xion-frontends`       | 3 — `apps/faucet`, `apps/xion-app`, `apps/xion-admin`                                                                                                                                                      |
| `workers-aws-services` | 3 services × 2 chains = 6 envs (`aws-sdk-*`, `kms-service-*`, `aws-session-*`)                                                                                                                             |

The deployment policy is single-Worker by construction: one `workingDirectory`,
one `targets` pair. **These 21 Worker deployments cannot migrate without an
upstream change.** Two options, and this is the main decision this plan asks
for:

- **A caller per Worker.** Each Worker gets its own trigger workflow and its own
  policy file, using `workingDirectory` to scope it. No upstream change; N
  callers per repository, and N× quality runs on every pull request touching
  anything.
- **Matrix support upstream.** `deployment-policy.jsonc` grows a list of
  Workers, and `cloudflare-version.yml` fans out. One quality run, one policy
  file. Larger change, and it makes the release model ambiguous — one release
  per repository covering several Workers.

The second is better if `cloudflare-workers` is expected to keep growing.

### Single-environment or no-environment Workers

Twenty repositories have no wrangler `env` block: `ai-gateway`, `burnt-website`,
`burnt-www`, `coinflow-demo`, `indexer-proxy`, `node-monitor`, `provider-monitor`,
`redacted`, `signdoc-parser-frontend`, `sweep-monitor`, `theconstruct`,
`xion-account-lookup-dashboard`, `xion-assets`, `xion-indexer-proxy`, and others
listed in Tier C.

They deploy a single Worker with no promotion step. The central shape has no
single-target topology. Either they gain a staging environment, or the shape
gains a `single` topology where `candidate == release`. **Recommend the latter
if more than a handful of these should be on shared CI** — inventing a staging
environment nobody uses is worse than modelling reality.

### Static asset sites

`burnt-website` (0/6), `burnt-www` (1/6), `xion-assets` (2/6),
`signdoc-parser-frontend` (2/6), `theconstruct` (1/6, and the only
`wrangler.toml` in the org).

These have little or no test surface, and `test` and `coverage` are mandatory
and must be non-empty. A repository _can_ satisfy them with a placeholder and
`coverageThresholds` of `0`, but that makes the gate decorative and the policy
misleading. Decide deliberately: either these stay off the central quality
workflow, or the workflow gains a way to declare "no test surface" honestly.

## Recommended sequence

**Wave 0 — unblock.** Migrate `cloudflare-app-template` (Tier A). Every new
Worker is cut from it, so this stops the problem growing while the rest is
worked through. Add its missing `prettier` command first.

**Wave 1 — prove the pattern.** `treasury-worker`. Chain topology, GitHub
Environments already correct, one missing command. Should be a near-copy of the
`account-abstraction-api` migration.

**Wave 2 — mechanical.** Tier B, in this order: `cue-api` + `cue-app` together
(same shape), then `burnt-verify-real-estate` + `burnt-verify-insurance-claims`
together, then `xion-staking`, `xion-stytch-proxy`, `xion-explorer`,
`zk-email-worker`, `oauth2-api-service`. Each is: add missing quality commands,
rename environments, delete stale `preview-*` GitHub Environments, add the two
policy files, replace workflows with callers.

**Wave 3 — decisions.** Tier C, one product conversation per repository.

**Wave 4 — upstream first.** Tier D. Do not start until the multi-Worker and
single-topology questions above are settled here.

## Per-repository procedure

Established during the `account-abstraction-api` migration. Follow it in order;
several steps exist because skipping them failed silently there.

1. **Audit before changing anything.** Run each of the seven commands against a
   clean checkout and record which pass. Do not trust the presence of a script
   name — `account-abstraction-api`'s `lint` was declared and had been broken
   long enough that CI had disabled it.
2. **Verify environment parity.** Wrangler environment names, GitHub
   Environment names, and the topology mapping must agree exactly.
3. **Check for duplicated configuration.** `account-abstraction-api` had 35
   GitHub environment variables byte-identical to `wrangler.jsonc`. Confirm
   which source is authoritative before removing either.
4. **Move credentials out of config.** Anything secret becomes a Cloudflare
   secret (`wrangler secret put`), not a committed var and not a `--var`
   injection — the central deploy has no `--var` mechanism.
5. **Fix the gates in their own pull request**, separate from the migration, so
   a failure is attributable.
6. **Add the two policy files**, then replace the workflows with thin callers
   pinned to a released SHA with a version comment.
7. **Confirm the version model.** CI stops bumping `package.json`. If anything
   reads that version at runtime, fix it first.
8. **Set the repository's `ci-profile` custom property** so the
   `burnt-required-node-quality` org ruleset applies.
9. **Verify after merge**, do not assume: check that the first `push-main` run
   shows the expected jobs _and the expected skips_.

## Known traps

Each of these cost time during the first migration.

- **A skipped job skips its dependents.** Gating a job silently disables
  everything downstream while the run still reports success.
- **Stale pins do not error.** A caller pinned to an old SHA keeps resolving the
  old workflow indefinitely. This shipped a floating `wrangler-action` next to
  `cloudflare-api-token`, and Node 20 actions months after the actions had moved
  to Node 24 — all green. Pin to a released SHA with a version comment so
  Dependabot can advance it.
- **Absent configuration can degrade silently.** A missing `NUMIA_API_TOKEN`
  disabled an indexer at `info` level with no failure. Check what a value's
  absence _does_ before removing it.
- **Coverage thresholds may not be doing anything.** `account-abstraction-api`
  declared 100% nested under a `global` key, which Vitest 3 treats as a glob
  matching no files. Verify the gate fails when it should before declaring the
  numbers in policy.

## Open questions

1. **Multi-Worker support** — caller-per-Worker, or matrix support upstream?
   Blocks 21 of 51 Worker deployments.
2. **A `single` topology** for the ~20 Workers with one environment and no
   promotion step?
3. **Repositories with no test surface** — stay off central quality, or add an
   honest way to declare it?
4. **`oauth2-api-service`'s `dev`** and `xion-dashboard-app`'s build variants —
   are these real deploy targets, or should they move outside CI?
