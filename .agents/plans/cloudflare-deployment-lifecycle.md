# Cloudflare deployment lifecycle

Support the explicitly requested SATYA migration through the organization's shared workflows.

- Keep staging/production GitHub Environments; permit distinct existing Wrangler environment slugs.
- Select the approved container runner when policy declares containers.
- Validate target lifecycle commands and generated Wrangler config paths.
- Prepare public JSONC configuration before build, validate secrets before mutations, provision/cut over before D1/deploy, and verify afterwards.
- Serialize the whole lifecycle without cancellation. Previews never run deploy hooks.
- Rebuild policy bundle, run policy/workflow tests and actionlint, and advance internal immutable pins in separate signed commits.
- Open a draft shared-workflow PR. Consumer adoption stays draft and explicitly unreleased until this capability ships; no deployment or secret/configuration mutation is part of this work.
