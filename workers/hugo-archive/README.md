# Frozen Hugo archive Worker

This package builds the current Hugo site in archive mode and prepares it for the
`hugo.jaxplays.org` custom domain. Archive mode adds `noindex`, apex canonicals, a frozen-site
banner, and disables forms, analytics, ads, and service-worker registration.

Four legacy program PDFs exceed Cloudflare Workers' 25 MiB static-asset limit. The build stages
all oversized files under the ignored `.large-assets/` directory. The Worker streams those paths
from the dedicated `jaxplays-hugo-archive-large-assets` R2 bucket and serves all other files from
Workers Static Assets.

## Review gate

```sh
npm ci
npm run check
```

`npm run check` is non-deploying. It builds and validates the archive, runs the Worker tests, and
executes `wrangler deploy --dry-run`.

## Provision gate

Only after the Hugo PR is approved and merged:

1. Create the one-time R2 bucket with `npm run r2:create`.
2. Run `npm run deploy` with the JaxPlays Cloudflare credential.
3. Verify TLS, the archive banner, `X-Robots-Tag`, canonicals, disabled forms, representative deep
   links, and all staged PDFs before any apex routing change.

Deploying this package provisions only `hugo.jaxplays.org`; it does not change `jaxplays.org`,
`www.jaxplays.org`, `live.jaxplays.org`, or Payload.
