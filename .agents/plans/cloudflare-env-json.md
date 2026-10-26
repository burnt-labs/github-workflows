# Cloudflare service environment bundles

Stack on the deployment lifecycle foundation. Reuse Cue's existing `{vars,secrets}`
GitHub Environment secret shape, declaring its name and exact runtime allowlists
in JSONC policy. Central code validates and materializes public target vars before
app preparation/build. Validate secrets early; write0600 secrets file only after
build on deploy, consumed by pinned Wrangler action and always cleaned up.
Authenticated after-deploy probes receive only an explicit verificationSecrets
subset through a0600 file, created after successful deploy and always removed.
Preserve all infrastructure identities and relative paths. No deploy or GitHub
configuration/secret mutation is part of this implementation.

Verify strict bundle types/keys, generic parse errors, target isolation, JSONC,
path protection, source immutability, deploy/preview ordering and failure cleanup.
Rebuild both bundled CLIs. Use signed commits and advance immutable script,
internal workflow, and entrypoint pins in order. Publish a separate draft PR
against feat/cloudflare-deployment-lifecycle after root review.
