# Phala reusable deployment workflow

1. Add and validate a consumer-owned `.github/phala-policy.jsonc` contract.
2. Add one application-neutral reusable workflow that requires policy, runs
   quality, builds and pushes a commit-addressed GHCR image, serializes updates
   to the selected Phala CVM, and returns its health-checked public URL.
3. Encode credential allowlisting, missing-secret failure, SHA pinning, target
   environment, and no-fallback behavior in tests.
4. Rebuild the bundled policy validator and run the full repository check.
5. Keep application-specific secret aggregation, URL propagation, and dependent
   workflow dispatch in consumer callers. Pin advancement, signed commits, and
   a release remain separate delivery steps because workflow self-references
   must point at an existing commit.
