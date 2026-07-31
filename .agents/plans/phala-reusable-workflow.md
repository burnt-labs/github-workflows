# Phala reusable deployment workflow

1. Add and validate a consumer-owned `.github/phala-policy.jsonc` contract.
2. Add one reusable workflow that runs required quality, builds and pushes a
   commit-addressed GHCR image, deploys it to the selected Phala CVM, resolves
   and health-checks the public URL, and optionally synchronizes that URL.
3. Encode credential allowlisting, missing-secret failure, SHA pinning, target
   environment, and no-fallback behavior in tests.
4. Rebuild the bundled policy validator and run the full repository check.
5. Document the cue-api caller and policy shape. Pin advancement, signed
   commits, and a release remain separate delivery steps because workflow
   self-references must point at an existing commit.
