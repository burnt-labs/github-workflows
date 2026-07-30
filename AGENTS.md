# Agent Guidance

- Keep every commit signed.
- Workflows must never create commits or push branches.
- Reusable deployment jobs must use the caller repository's actual target
  environment. Do not introduce `preview` or `preview-*` environments.
- Candidate and release are semantic roles, mapped by repository policy.
- Require lint, Prettier, type-check, tests, coverage, and build as independent
  quality gates.
- Pin every `uses:` reference to a full commit SHA with a trailing version
  comment. Dependabot advances the pins.
- Store repository-specific configuration in JSONC policy files.
- Open pull requests as drafts.
