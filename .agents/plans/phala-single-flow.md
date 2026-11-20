# One Phala flow for every repository

Decision (2026-11-20): every repository that runs a Phala CVM goes through
`phala-deploy.yml`, from one thin caller that offers its operations (`deploy`,
`update`, `setup`, `reseal`) as a choice. A new need becomes an operation of
this flow, never a second Phala workflow here or a Phala workflow in a consumer.

## Consumers and migration status

| Repository       | Before                                                   | Migration                                  |
| ---------------- | -------------------------------------------------------- | ------------------------------------------ |
| teels-internal   | already on the shared flow                               | rule recorded: teels-internal#124          |
| tls-app-attest   | bespoke workflow + `.github/actions/satya/phala` scripts | removed, one caller: tls-app-attest#393    |
| cue-app          | bespoke `deploy-tee.yml`                                 | one caller + URL follow-up job: cue-app#65 |
| oauth3           | bespoke workflow, new CVM per run                        | prebuilt image caller: oauth3#19           |
| dossier          | deployed by hand                                         | prebuilt image caller (draft)              |
| satya-tee-attest | legacy, CVM stopped                                      | nothing to migrate                         |

A repository still on a bespoke or by-hand path is migration debt. Do not add
to it or copy it; close the gap here and move the repository onto the flow.

## What the flow gained for this

- `operation: reseal`: re-apply an existing CVM's sealed environment from policy
  and restart it, without a build or compose change (a rotated
  `GHCR_READ_TOKEN` otherwise strands the CVM at `pre-launch` after a reboot).
- Prebuilt images: `image.repository` plus the `image-digest` input, for
  repositories that build their image in their own pipeline (oauth3, dossier).
