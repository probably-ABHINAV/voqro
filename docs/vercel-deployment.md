# Deploy the Voqro website on Vercel

There are two explicit deployment modes. The default connected mode serves `public/` from Vercel and forwards `/api/` requests to a separately hosted, persistent Voqro backend. The existing application features, authorization, database, private uploads and workers remain in that backend. The Vercel artifact contains static assets and routing configuration; it contains no workspace database, uploaded media, secrets or backend source.

Connected mode requires the backend. The build deliberately fails when `VOQRO_BACKEND_ORIGIN` is missing or invalid so that an apparently successful deployment cannot silently lose its workspace API. Preparing this configuration does not provision or verify a backend. The separately selected product-preview mode below works entirely with illustrative browser-local records.

## Interactive product preview

Set `VOQRO_PREVIEW=1` for an explicit sample preview. It does not require a backend or credentials:

```bash
VOQRO_PREVIEW=1 npm run build:vercel
```

The build copies the existing public assets and only the four required files from `preview/`: the entry module, browser API adapter, stylesheet and sample fixtures. It changes the generated HTML entrypoint to initialize the preview adapter before loading the existing application. It leaves the production HTML source unchanged. The normal application API helper delegates to that adapter only when the preview entrypoint installs it; production builds do not include preview files or fixtures.

Visitors can explore sample workspaces and supported local workflows. A permanent notice identifies the preview and explains that edits stay in that browser. The adapter stores changes in browser storage, with a clearly indicated in-memory fallback if storage is unavailable. Reset Demo returns to the original samples. Every visitor starts independently; there are no real accounts or shared server-side records. Provider operations, actual publishing, messages, payments, media processing and file downloads require a connected workspace and remain unavailable in this preview. All direct `/api/` requests return an explicit JSON 503 response; they never fall through to an HTML page or a nonexistent external backend. Preview CSP permits only the same origin, including when an S3 origin is configured for connected mode.

`preview/fixtures.json` is generated from a fresh `DEMO_MODE=1`, `DB_PATH=:memory:` application with a new temporary uploads directory and all provider operations disabled. The generator adds explicitly illustrative campaign briefs, scoped tasks and sample brand knowledge through that isolated application's API. It captures role-scoped GET responses and separate denied-response statuses. It never reads `.env`, the existing `.data` directory or production credentials. To intentionally regenerate those samples:

```bash
node --disable-warning=ExperimentalWarning scripts/generate-preview-fixtures.mjs
```

Fixed dates in the source demo are normalized to the generation date; the browser adapter subsequently keeps the relative sample timeline useful when a new preview starts. Regeneration changes sample IDs and timestamps, so review the fixture diff and rerun preview tests.

To deploy a connected application later, remove `VOQRO_PREVIEW` or set it to `0`, supply the real backend origin, and complete the connected release checks below. The build never falls back to sample mode when backend configuration is missing. A sample preview is not evidence that production accounts, persistence, integrations or commercial plan requirements are ready.

## Why the backend stays on a persistent host

`server.mjs` uses Node's synchronous SQLite API with WAL transactions. Delivery stores private media on disk, and the existing workers use the same database and uploads directory for durable job claims, FFmpeg/ffprobe processing, reminders and optional provider calls. [Vercel documents that local SQLite is unsuitable for its ephemeral, independently scaled runtime](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel).

Vercel offers container-based [Daemons](https://vercel.com/kb/guide/vercel-daemons), but they do not supply persistent local storage. Hosting the entire app on Vercel would require a separate migration to a remote database, object storage and workers that share those stores. Replacing the database with `/tmp` or an in-memory demo would discard the current persistence guarantees.

## Required configuration

### On the Vercel project

| Variable | Value |
| --- | --- |
| `VOQRO_PREVIEW` | Set exactly `1` only for the browser-local sample preview. Leave unset or use `0` for the connected application. |
| `VOQRO_BACKEND_ORIGIN` | The backend's public HTTPS origin, for example `https://api.your-domain.com`. No path, query, credentials or nonstandard port. |
| `VOQRO_S3_UPLOAD_ORIGIN` | Optional: one exact Mumbai S3 bucket origin, such as `https://your-media-bucket.s3.ap-south-1.amazonaws.com`, when direct S3 uploads are enabled on the backend. |

The origin validator accepts public DNS hostname syntax and rejects IP literals and known local/private hostname suffixes. It does not verify DNS ownership, resolve hostnames or prove that the backend is reachable. Use a trusted hostname you control and verify the live connection before releasing the site. Never point this setting back to the Vercel frontend, which would create a rewrite loop.

Add each variable to the intended Vercel environment. Backend credentials and provider secrets belong on the backend host and must not be exposed in static assets. The optional S3 origin only controls the frontend's exact-origin Content Security Policy; it does not enable AWS or change bucket permissions.

### On the persistent backend

- Node.js 24+ with the repository's locked dependencies, FFmpeg and ffprobe.
- A persistent `DB_PATH` and `UPLOAD_PATH`, with backups and one application instance using the SQLite database. Preserve both across restarts and releases.
- `NODE_ENV=production`, `DEMO_MODE=0`, `COOKIE_SECURE=1`.
- `APP_BASE_URL` equal to the exact public Vercel/custom-domain origin visitors use, even though the backend has its own origin.
- The existing production identity configuration. Cognito's allowed callback must be `APP_BASE_URL/api/identity/callback`; Meta's callback, if enabled, must use the same public frontend origin.

Keep existing external-service opt-ins disabled until separately configured and verified. AWS setup is paused. This deployment preparation does not create cloud resources, enable paid AI/email/publishing, or replace the identity provider.

Requests remain same-origin from the browser's perspective. Backend `Set-Cookie` values, OAuth redirects, query strings, upload bodies and media `Range` responses must pass through the external rewrite. The backend checks mutation origins against `APP_BASE_URL`; do not weaken this to accept every preview hostname or trust arbitrary forwarded headers.

The existing anonymous request limiter uses the directly connected network peer. Behind Vercel, several visitors can share one proxy peer and consequently share its conservative source limit. Before scaling, use a deliberately trusted ingress design and validate its forwarded-client identity; do not unconditionally trust a browser-supplied `X-Forwarded-For` header.

## Build and deploy

Vercel's [Hobby plan is restricted to non-commercial personal use](https://vercel.com/docs/plans/hobby). This agency application needs a suitable commercial plan before a commercial deployment. Creating/linking a project does not establish plan eligibility or authorize an upgrade. No plan change is part of this deployment preparation.

1. Host the backend on a persistent Node/container service and verify its health and production identity configuration. Configure its `APP_BASE_URL` for the chosen public frontend domain.
2. Import `probably-ABHINAV/voqro` into the intended Vercel account/team, or use `vercel link` after CLI authentication. Use the repository root and the **Other** framework preset. `vercel.json` supplies `npm ci` and `npm run build:vercel`; use Node.js 24.x and the automatically detected output setting.
3. Add the Vercel environment variables above, then build/deploy the intended environment. The build emits the standard [Build Output API v3](https://vercel.com/docs/build-output-api) directory at `.vercel/output`. It does not turn `server.mjs` into a Function.
4. Inspect the live checks below before promoting a preview or releasing a production deployment.

For a local build against an already hosted backend:

```bash
VOQRO_BACKEND_ORIGIN=https://api.your-domain.com npm run build:vercel
node --test tests/vercel-build.test.mjs
```

Use an isolated backend and identity callbacks for a functional preview. A random preview URL cannot complete production sign-in against a backend whose trusted `APP_BASE_URL` names another origin. Do not reuse production sessions or enable shared demo accounts to work around this check.

## Routing and release checks

The static build preserves the application's existing security headers and exact optional S3 origin policy. All `/api/` responses explicitly disable browser/CDN caching and [external-rewrite caching](https://vercel.com/docs/rewrites#disabling-caching-for-rewrites-to-external-origins), including errors and private media. Unknown paths return 404; API paths never fall back to the HTML application.

The external rewrite routes directly to the backend rather than through a Vercel Function. This avoids adding the [Function request/response payload limit](https://vercel.com/docs/functions/limitations) to the app's private video response path. Vercel routing/network limits and the backend's limits still apply and require live validation.

Before release, verify through the public frontend origin:

- `/api/health` reports the expected backend and `demo: false`; `/api/public` is fresh and uncached.
- A verified identity can sign in and out; cookies remain Secure/HttpOnly and the callback lands on the public origin. Brand/creator access remains scoped.
- A controlled enquiry reaches persistent storage and survives a backend restart. Confirm untrusted origins remain rejected.
- A private media upload can complete, video playback returns correct range responses, and unauthorized users cannot read it. Confirm private responses never report a CDN cache hit.
- Workers process an authorized local job, survive a restart without duplicate completion, and restore correctly from the existing backup process.

The build tests verify artifact isolation, explicit preview selection, rejection of unmarked sample workspaces, origin rejection, route coverage and cache/security policy. Browser-preview tests exercise the static preview separately from backend tests. These checks do not establish live backend reachability, proxy cookie/range behavior or production release readiness.
