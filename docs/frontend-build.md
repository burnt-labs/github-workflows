# Public frontend build inputs

Cloudflare policies may declare per-target `buildVariables` and shared
`buildAssets`. This serves the licensed fonts and frontend configuration needed
by both xion-dashboard-app and xion-frontends. Neither declaration runs a
consumer script with Cloudflare credentials.

```jsonc
{
  "buildAssets": {
    "bucket": "brand-assets",
    "objects": [
      {
        "key": "fonts/heading.woff2",
        "sha256": "<64 lowercase hexadecimal characters>",
        "destinations": ["public/fonts/heading.woff2"],
      },
    ],
  },
  "targets": {
    "candidate": {
      "buildVariables": {
        "VITE_NETWORK": { "value": "testnet" },
        "VITE_SITE_KEY": { "variable": "SITE_KEY" },
        "VITE_PUBLIC_TOKEN": {
          "secret": ["VITE_PUBLIC_TOKEN", "VITE_DEFAULT_PUBLIC_TOKEN"],
        },
        "VITE_APP_VERSION": { "metadata": "version-tag" },
      },
    },
  },
}
```

The snippet shows optional fields only; normal topology, promotion and target
fields are still required. Build variables have exactly one source: a string
constant, a GitHub Environment/repository variable, the first nonempty entry in
an explicit public-token secret list, or the shared `version-tag` metadata.
Missing declared values fail before build. Destinations and secret source names
must use public frontend prefixes (`VITE_`, `NEXT_PUBLIC_`, `NUXT_PUBLIC_`, or
`PUBLIC_`). These values are deliberately available to consumer preparation and
build commands and may be embedded into public browser assets. Never declare a
private runtime credential as a public build input. Secret-backed public values
are masked in logs; the full secrets context never reaches consumer commands.

The central helper fetches assets using the existing Cloudflare account/token,
with a fixed API origin, redirects disabled and a 30-second timeout per object.
SHA-256 is mandatory. All objects are downloaded and verified before files are
published; failures stop the workflow. A policy supports at most 32 objects,
each up to 10 MiB, with a 64 MiB total download limit and up to eight destinations
per object. Paths are relative to the deployment working directory, must be in
static `public` directories and may not traverse or contain symlinks, hidden
segments or node_modules. Existing Worker configuration and resource identities
are not changed. The font license remains the consumer's responsibility.

Assets are mandatory whenever declared, including previews. The shared PR flow
already skips credentialed previews for fork, draft and Dependabot PRs; quality
runs without deployment credentials. There is no soft font fallback for a
production artifact.

These fields do not change release routing or the main/candidate/release
lifecycle. The helper and policy bundles must be present at their immutable tool
pin, and consumers must wait for a reviewed stable platform release before
advancing deployment callers.
