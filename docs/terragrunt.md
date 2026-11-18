# Terragrunt plan and apply

`terragrunt-pr.yml` plans a Terragrunt stack on a pull request and posts the
summary to the pull request. `terragrunt-main.yml` plans the default branch and
applies that plan after one approval on a protected GitHub Environment. Both
read one capped JSONC policy, `.github/terragrunt-policy.jsonc`, and keep every
decision in `scripts/terragrunt.mjs` (bundled as `terragrunt.bundle.mjs`).

They do not create AWS roles, GitHub Environments, secrets or state buckets,
and they do not run `required-quality.yml`: Terraform repositories have no
quality toolchain in the shared quality workflow yet.

## Policy

```jsonc
{
  "schemaVersion": 1,
  "stacks": {
    // The key is the `stack` input. Lowercase slug.
    "cloudflare-account": {
      // Where `terragrunt plan` runs. Relative, no `..`, no symlinks.
      "workingDirectory": "cloudflare/account",
      "awsRegion": "us-east-1",
      // Optional. Name of the secret that becomes CLOUDFLARE_API_TOKEN.
      "credentials": { "cloudflareApiTokenSecret": "CLOUDFLARE_API_TOKEN" },
      "plan": {
        "githubEnvironment": "cloudflare-account-plan",
        "awsRoleArn": "arn:aws:iam::669419973271:role/<plan role>",
        // Optional, default true. false passes -lock=false to the plan.
        "lock": true,
        // Optional, default true. The plan job fails on any destroy or replace.
        "failOnDestroyOrReplace": true,
        // Optional. Terraform variable name -> secret name, as TF_VAR_<name>.
        "variableSecrets": {},
      },
      "apply": {
        "githubEnvironment": "cloudflare-account",
        "awsRoleArn": "arn:aws:iam::669419973271:role/<apply role>",
        "variableSecrets": {
          "satya_proof_index_catalog_token": "SATYA_PROOF_INDEX_CATALOG_TOKEN",
        },
      },
    },
  },
}
```

The Terraform and Terragrunt versions are not in the policy. They come from
the nearest `.terraform-version` and `.terragrunt-version` at or above the
working directory, the files tfenv and tgenv already read. Both are required
and must be plain `X.Y.Z`.

Validation rejects unknown fields, duplicate keys, a plan and apply that share
one GitHub Environment, `preview` environments, malformed role ARNs and
regions, `GITHUB_`/`ACTIONS_`/`RUNNER_` secret names, and a variable secret
that names the Cloudflare credential. `lock` and `failOnDestroyOrReplace` are
normalized to literal booleans before any `if:` could read them.

`examples/terragrunt/iac-terraform-cloudflare-account.jsonc` is the proposed
declaration for `burnt-labs/iac-terraform`.

## Callers

Config only. `secrets: inherit` is needed because the credentials are GitHub
Environment secrets, which only reach a job that names the environment.

`.github/workflows/terraform-cloudflare-account-pr.yml`

```yaml
name: Terraform cloudflare/account PR
on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened, ready_for_review]
    paths:
      - "cloudflare/account/**"
      - "cloudflare/terragrunt.hcl"
      - ".terraform-version"
      - ".terragrunt-version"
      - ".github/terragrunt-policy.jsonc"
permissions:
  contents: read
  id-token: write
  pull-requests: write
jobs:
  terragrunt:
    uses: burnt-labs/github-workflows/.github/workflows/terragrunt-pr.yml@<released-full-sha> # vX.Y.Z
    with:
      stack: cloudflare-account
    secrets: inherit
```

`.github/workflows/terraform-cloudflare-account-main.yml`

```yaml
name: Terraform cloudflare/account apply
on:
  push:
    branches: [main]
    paths:
      - "cloudflare/account/**"
      - "cloudflare/terragrunt.hcl"
      - ".terraform-version"
      - ".terragrunt-version"
      - ".github/terragrunt-policy.jsonc"
  workflow_dispatch:
    inputs:
      allow-destroy:
        description: Apply a plan that destroys or replaces resources
        type: boolean
        default: false
permissions:
  contents: read
  id-token: write
jobs:
  terragrunt:
    uses: burnt-labs/github-workflows/.github/workflows/terragrunt-main.yml@<released-full-sha> # vX.Y.Z
    with:
      stack: cloudflare-account
      allow-destroy: ${{ inputs.allow-destroy == true }}
    secrets: inherit
```

A caller that wants apply only by dispatch drops the `push` trigger. Either
way the apply waits for the apply environment's reviewers.

## Inputs, secrets and outputs

| Workflow          | Input                    | Default                           |
| ----------------- | ------------------------ | --------------------------------- |
| both              | `stack` (required)       |                                   |
| both              | `terragrunt-policy-path` | `.github/terragrunt-policy.jsonc` |
| `terragrunt-pr`   | `comment`                | `true`                            |
| `terragrunt-main` | `allow-destroy`          | `false`                           |

Secret `cloudflare-api-token` is optional. When given it wins over the
policy-named secret for both stages; with `secrets: inherit` each environment's
own `CLOUDFLARE_API_TOKEN` is used, which is what lets plan hold a read token
and apply an edit token.

Outputs: `terragrunt-pr` returns `has-changes` and `destructive`;
`terragrunt-main` returns `has-changes` and `applied`.

## How a run works

**Pull request.** Drafts, forks and Dependabot are skipped, as in the
Cloudflare PR flow. The `policy` job validates the policy and the stack. The
`plan` job binds the plan environment, assumes the plan role through GitHub
OIDC, installs the pinned Terraform (wrapper off) and the Terragrunt release
binary checked against that release's `SHA256SUMS`, then runs the helper:

1. `terragrunt init -input=false -lockfile=readonly` (the committed provider
   lock file is enforced, never rewritten);
2. `terragrunt plan -input=false -out=$RUNNER_TEMP/terragrunt-<stack>.tfplan`
   (plus `-lock=false` when `plan.lock` is false);
3. `terragrunt show -json` on that file, summarized in memory.

The summary goes to the job summary and, through the `comment` job, to one
sticky comment per stack (marker `<!-- burnt-terragrunt-plan:<stack> -->`).
The comment job holds `pull-requests: write` and nothing else; the plan job
holds no pull request permission. The plan job fails after writing its outputs
when the plan destroys or replaces and `failOnDestroyOrReplace` is true, so the
comment still explains why.

**Default branch.** The main flow accepts `push` and `workflow_dispatch` on the
default branch only. Its `plan` job is the same as above. When the plan changes
nothing, the `apply` job is skipped and nobody is asked to approve. Otherwise
`apply` waits for the apply environment's reviewers, assumes the apply role,
plans again into a saved plan file, and refuses unless:

- the new plan's fingerprint equals the reviewed plan's fingerprint from the
  plan job of the same run, and
- it has no destroy or replace, or `allow-destroy` is true (accepted only on a
  `workflow_dispatch`).

Then it runs `terragrunt apply -input=false <that plan file>`. Terraform itself
rejects a saved plan whose state changed in between.

### Why the plan file is not passed between jobs

A plan file embeds a copy of the state and every variable value, sensitive
ones included. An Actions artifact is readable by anyone who can read the
repository, so passing it would widen state access from the state role to
every reader. Instead the apply job makes its own saved plan and proves it is
the reviewed one: the fingerprint is a SHA-256 over every resource change
(address, actions, action reason, before, after, unknowns, replace paths,
import ids) and every output change, sorted by address, with values Terraform
marks sensitive replaced by a marker. Sensitive values are masked so the plan
stage does not need the apply stage's write-only secrets to produce the same
fingerprint.

## Destroy and replace detection

From `terraform show -json`, per `resource_changes[].change.actions`:

| Actions                                      | Counted as |
| -------------------------------------------- | ---------- |
| `["create"]`                                 | add        |
| `["update"]`                                 | change     |
| `["delete"]`                                 | destroy    |
| `["delete","create"]`, `["create","delete"]` | replace    |
| `["forget"]` (a `removed` block)             | forget     |
| `["no-op"]`, `["read"]`                      | nothing    |
| anything else                                | unknown    |

`change.importing` counts an import. Destroy, replace and unknown are
destructive: an action list a later Terraform adds fails closed until the
helper is taught it. An errored plan, or JSON with a format version other than
`1.x`, is refused.

## Credential boundary

Each helper step receives the whole secrets context as `ALL_SECRETS`, the same
pattern as the Phala flow (zizmor reports it as `overprovisioned-secrets`). The
helper builds the only environment Terragrunt sees: `PATH`, `HOME`, `TMPDIR`,
the AWS session the OIDC step exported, `AWS_REGION`, the declared Cloudflare
token, `TF_VAR_<name>` for each declared variable secret, `TF_IN_AUTOMATION=1`,
`TG_NON_INTERACTIVE=true` and `TG_DISABLE_BUCKET_UPDATE=true`. Nothing else
from the job, including `GITHUB_TOKEN` or `TF_VAR_` values set elsewhere, gets
through. Every forwarded value is passed to `::add-mask::` first. A declared
secret that is missing fails the run before Terragrunt starts.

`TG_DISABLE_BUCKET_UPDATE` is fixed because a state-only role has no bucket
administration rights; see the Roles Anywhere README in iac-terraform for why
no `remote_state` setting does the same in Terragrunt 0.75.

The summary and comment carry counts, actions and resource addresses only.
Addresses come from the planned branch and are rendered as inert code spans.

**A pull-request plan runs the branch's Terraform with the plan stage's
credentials.** Terraform configuration can run programs (the `external` data
source, provisioners on apply). Anyone who can push a branch can therefore use
the plan role and the plan environment's secrets. Keep those read-only where
the provider allows it, and keep the state role scoped to the one state object.
This is why plan and apply must use distinct environments: apply credentials
never reach a pull request.

## Concurrency

Jobs are never cancelled, because a cancelled Terraform run can leave the
DynamoDB lock held.

- PR plans: one group per repository, working directory and pull request.
  Different pull requests are serialized by the state lock.
- Main plans and applies: separate groups per repository and working directory.
  GitHub drops an older _pending_ job when a newer one joins its group, so
  main plans are kept apart from PR plans; a dropped main plan would skip its
  apply. A dropped pending apply is always superseded by a newer default-branch
  run that plans everything it would have applied.

## Release and adoption

Not released. The helper checkout `ref:` in both workflows must name the commit
containing `terragrunt.bundle.mjs`, set in a separate pin-advance commit. A
consumer adopts only a released full SHA. Before the first run the consumer
needs the two GitHub Environments (the apply one with required reviewers and a
`main` branch rule), the two OIDC roles trusted for exactly those environments'
`sub` claims, and the environment secrets the policy names.
