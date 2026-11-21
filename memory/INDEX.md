# Team memory index

_Generated; do not edit by hand. Read full notes with memory_read._

## convention
- **Cloudflare fixes must propagate through transitive SHA pins** (`cloudflare-transitive-workflow-pins`) [.github/workflows/cloudflare-*.yml] — Cloudflare consumers execute a pinned dependency chain, not 

## gotcha
- **Phala reseals replace the complete allowed sealed environment** (`phala-reseal-environment-replacement`) [scripts/phala-reseal*.mjs] — Phala's sealed-environment update replaces the entire enviro
- **Wrangler environment flags depend on the directly read config** (`wrangler-environment-resolution`) [.github/workflows/cloudflare-version.yml] — `Resolve Wrangler environment` runs after Build and supplies

## module
- **Only frontend assets require a pre-build deployment directory** (`frontend-build-directory-lifecycle`) [scripts/frontend-build*] — `cloudflare-version.yml` prepares public frontend inputs fro
