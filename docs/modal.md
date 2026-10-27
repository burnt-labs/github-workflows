# Modal deployment contract and safe rollout

`modal-deploy.yml` centralizes **deployment of an existing registry image**.
It does not build/push Docker images, publish releases, preview applications,
change runtime code, create GitHub Environments, or dispatch downstream flows.

## Contract

A consumer supplies a schema-version-1 JSONC Modal policy and thin callers with
`target`, a **nonempty** `image-tag`, and optional `modal-policy-path` and
`quality-policy-path`. The seven independent required-quality gates must be real,
repository-owned commands with enforced coverage thresholds. There is no bypass
or invented Python quality policy in this change. The existing shared quality
workflow supports Node and Rust toolchain preparation, not Python setup.

The Modal policy is independently validated by `modal.bundle.mjs`, deliberately
not retrofitted into the other providers' policy loader. Required quality still
validates and runs its own policy before Modal can run. The capped Modal schema
has exactly `schemaVersion`, `workingDirectory`, `entrypoint`, `pythonVersion`,
`image`, and `targets`. Image declares a registry repository and the two public
environment-variable names the existing application reads. Each of 1–16 targets
names its real `githubEnvironment` and up to 64 string-valued public `variables`.
Unknown fields, duplicate JSONC keys, missing targets, malformed tags, control or
credential-shaped names, parent traversal and symlink paths are rejected.
No raw shell commands, SDK-version override, arbitrary secret lists, source-ref
override, environment creation, or runtime-secret forwarding are supported.

The reusable workflow has read-only contents permission. It first rejects events
other than `push` and `workflow_dispatch`, then checks out **github.sha**, with
full history and no persisted credentials. The helper requires that exact SHA to
be an ancestor of the fetched default branch. Tags and branch-selected dispatches
are accepted only when their commit is already on that history; arbitrary
feature commits and all PR/PR-target events fail. This relies on the caller's
default branch actually being protected/reviewed. An ancestry check does not
independently prove that branch protection or Environment approval is enforced.

Policy validation runs on Ubicloud 2; independent quality and deployment run on
Ubicloud 4. Deployment binds the actual target GitHub Environment (including
legacy → testnet), and serializes per repository/policy/target without
cancellation. Different targets intentionally remain independently schedulable.
The selected source/policy is validated again in the fresh deployment job.

Python comes from a full-SHA-pinned setup action. An isolated venv installs
`modal==1.6.3` with binary-only dependencies and pip isolated mode, without Modal
credentials, consumer requirements, build/install hooks, or floating pip upgrades.
This SDK version was read from PyPI on October 27, 2026, and its CLI was exercised
on Python 3.11. Dependencies remain resolver-selected; this is an exact top-level
SDK pin, **not** a transitive dependency lock or a live deployment compatibility
claim. The SDK's reserved configuration names in `modal.mjs` must be reviewed
when bumping it.

Only the final central helper receives `MODAL_TOKEN_ID` and
`MODAL_TOKEN_SECRET`. Put these in the exact target GitHub Environment; callers
may use `secrets: inherit` or explicitly map these two names. Missing values fail.
No whole secrets/vars context is serialized or forwarded. The child process gets
only declared public variables, the two Modal credentials, PATH, a temporary
empty HOME/config, and fixed Python/locale settings. Temporary config is removed
on success and failure. `python -m modal deploy <absolute-entrypoint>` necessarily
imports the **reviewed consumer Python** with the Modal tokens: this is inherent
to Modal deployment, not a sandbox. That code and the image must be trusted.
There is no extra credentialed consumer build step. An image tag still has its
existing mutability risk; digest promotion is outside this compatibility change.

## zk-email-prover: exact compatibility declaration

`examples/modal/zk-email-prover-policy.jsonc` preserves these current facts from
consumer main `8da73388af7cab752bce512a3d43e5c518e6dd7c`:

| target  | GitHub Environment | MODAL_APP_NAME          | MODAL_STORAGE_VOLUME        | GPU_TYPE | SCALEDOWN_WINDOW | TIMEOUT |
| ------- | ------------------ | ----------------------- | --------------------------- | -------- | ---------------- | ------- |
| legacy  | testnet            | zk-gpu-prover           | zk-prover-artifacts         | H100:2   | 900              | 60      |
| mainnet | mainnet            | zk-email-prover-mainnet | zk-prover-artifacts-mainnet | H100:2   | 900              | 300     |
| testnet | testnet            | zk-email-prover-testnet | zk-prover-artifacts-testnet | H100:2   | 300              | 300     |

All three keep Python 3.11, `modal_app.py`,
`DOCKER_REPO=docker.io/burntlabs/zk-email-prover`, and
`DOCKER_TAG=inputs.docker_tag`. App runtime code, the named Modal secret
`zk-prover-api-key`, local Python overlays, volume creation and all decorators
remain unchanged. Neither a new Modal workspace/environment nor a renamed
production Environment is introduced.

One intentional safety change: the old manual input was optional, but the
workflow exported an empty `DOCKER_TAG`, defeating Python's `os.getenv` fallback.
The new entrypoint rejects empty/missing image tags before quality/deployment
instead of silently choosing `latest` or accepting an invalid image reference.
Callers should make `docker_tag` required for both dispatch and workflow-call.

## Release and adoption prerequisites — not rolled out

1. Review the draft platform PR and get the `.github` code-owner approval. Merge
   only with owner authorization. This PR does **not** release anything.
2. The workflow's two central-tool checkout pins must name the signed commit
   containing the rebuilt `modal.bundle.mjs`, not an older release. The separate
   pin-advance commit in this PR establishes this two-hop relationship. Before
   releasing, verify both pins resolve byte-identical helper content and are
   ancestors of merged main. The independent quality workflow stays on the
   inspected v1.8.0 commit; no quality changes are smuggled in.
3. Obtain explicit owner approval for a **new signed stable platform release**
   containing this entrypoint and the valid tool pins. Select the actual version
   then; do not invent a release SHA/version or use this draft branch in a
   consumer. v1.8.0 has no Modal workflow and cannot serve this migration.
4. Re-inventory consumer main and all seven honest quality gates. zk-email-prover
   currently has no shared quality policy; Python quality preparation is not
   supported by required-quality. Establish genuine gates and any necessary
   separately reviewed Python toolchain support first. Never replace missing
   lint/type/test/coverage with `true`, repeated commands or fabricated floors.
5. Open a separate consumer PR copying the example policy to
   `.github/modal-policy.jsonc`, and replace only the three duplicated Modal jobs
   with callers pinned to the new release's **full 40-character commit SHA** plus
   its real version comment. Forward `target: legacy|mainnet|testnet` and
   `image-tag: ${{ inputs.docker_tag }}`; keep existing workflow names,
   `workflow_call`/`workflow_dispatch` triggers and `docker_tag` interface (required
   as noted), target secrets and source/image semantics. Use only `contents: read`
   for the Modal callers. Validate the policy using that exact released bundle.
6. Preserve `deploy-pipeline.yaml` routing exactly: only legacy is currently
   enabled after the Docker build; testnet/mainnet remain commented/disabled.
   Do not enable them, modify Docker build outputs, or change deployment ordering
   as part of adopting these callers. The Docker image build/push flow remains
   bespoke: this Modal entrypoint does not centralize it.
7. Confirm target Environment secrets and protections and protected-default-branch
   ancestry; validate every workflow with actionlint and exercise genuine quality
   commands locally. A consumer PR/draft must not deploy or upload a preview.
   No consumer pin is adopted until this separate PR is reviewed and merged.
   Any first testnet/legacy or mainnet deployment needs a separate authorization;
   no deployment is part of this platform PR or its tests.

Future thin job shape (placeholder is intentionally **not** a usable pin):

```yaml
jobs:
  deploy:
    uses: burnt-labs/github-workflows/.github/workflows/modal-deploy.yml@<released-full-sha> # <actual-version>
    with:
      target: legacy
      image-tag: ${{ inputs.docker_tag }}
    secrets: inherit
```

## Offline verification boundary

Node tests execute real helper planning, temporary Git ancestry repositories,
path/JSONC rejection, and a recorder child process to prove argv/environment,
credential omission, nonzero propagation and cleanup. No Modal token or network
deploy is needed. `modal --version`/`modal deploy --help` validate the installed
SDK interface only; no real application was imported or deployed. Platform
`pnpm check` (formatter, Node tests, actionlint) and deterministic `pnpm build`
remain the authoritative existing gates.
