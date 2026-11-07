# Full application: Next.js and Express

The full application lives in `apps/web` (Next.js, React, TypeScript and Tailwind CSS) and the repository root (Express on Node.js 24). Screens call the real `/api` endpoints. Accounts, permissions, enquiries, proposals, campaigns, approvals, tasks and the financial ledger are enforced by the backend and stored in its database. The browser-only sample at `preview/` is a separate deployment mode.

## Development

Install the backend and frontend independently:

```sh
npm ci
npm run install:web
cp .env.fullstack.example .env.fullstack
```

Set the intended owner email and a random setup key in the private `.env.fullstack` file. Generate the key locally with a cryptographic generator; never commit it. Run `npm run dev:fullstack`, then open `http://127.0.0.1:3100/setup` and create the owner account. The key is only for initial provisioning. Passwords are hashed and sessions are stored on the server; this is not a sample role selector.

The launcher binds both servers to loopback, uses ports 3100/3101 and keeps its SQLite database and private uploads under `.data/fullstack`. It does not reuse the old demonstration database. Stop it with Ctrl+C. Restarting it preserves records. `AUTH_ALLOW_INSECURE_LOCAL=1` is only for local HTTP development; real deployments require HTTPS.

An owner creates brands and creators, then issues scoped invitations from Team access. Share each invitation privately with its intended recipient. The registration link carries its one-time token in the URL fragment; it is not a reusable login link. Password-based accounts do not prove mailbox ownership. Outbound verified-recipient email remains unavailable for these accounts until email verification is implemented.

## Hosting

Keep the Next.js frontend on Vercel and deploy the Express Docker image to a host with a persistent volume. The volume contains the SQLite database and private uploads; video workers run beside the backend. Use one backend instance for this SQLite architecture. A backend deployed on ephemeral storage will lose records and is not supported.

For the backend, set through secure runtime settings:

- `AUTH_PROVIDER=password`, `DEMO_MODE=0`, `COOKIE_SECURE=1`.
- `APP_BASE_URL` to the exact HTTPS frontend origin.
- `IDENTITY_BOOTSTRAP_EMAIL` and a random `IDENTITY_BOOTSTRAP_SECRET` for first owner setup.
- `DB_PATH=/var/lib/voqro/production.sqlite`, `UPLOAD_PATH=/var/lib/voqro/uploads` on the persistent volume.
- Optional providers remain disabled until intentionally configured and verified.

Cognito is still supported when selected; password mode does not require an AWS account. See `docs/identity.md` for the existing provider integration and `docs/backend-hosting.md` for storage and backup operations.

For Vercel, set the project root directory to `apps/web`, use the Next.js framework, install with `npm ci`, build with `npm run build`, leave the output directory automatic (`null`), and use Node.js 24.x. `apps/web/vercel.json` records the frontend build settings. The repository-root `vercel.json` is retained only for the older static-preview build; it must not select the full application’s build. Run Vercel CLI from the repository root and explicitly select `--local-config apps/web/vercel.json` for both production and preview deployments.

Do not switch the live project until the persistent backend’s TLS, fresh production database, uploads volume and health have been checked. For this deployment, the backend origin is `https://voqro-api-14829c4d.centralindia.cloudapp.azure.com` and its `APP_BASE_URL` must be exactly `https://voqro.vercel.app`. Keep `AUTH_ALLOW_INSECURE_LOCAL` unset in production. Password cookies are Secure, HttpOnly, host-only and SameSite=Strict; the external `/api` rewrite must preserve these cookies and the browser’s Origin header. No wildcard CORS or broad trusted-origin exception is required.

### Switch the existing Vercel project

After backend checks pass, apply these project settings from the repository root:

```sh
cat > /tmp/voqro-vercel-next-project.json <<'JSON'
{
  "rootDirectory": "apps/web",
  "framework": "nextjs",
  "installCommand": "npm ci",
  "buildCommand": "npm run build",
  "outputDirectory": null,
  "nodeVersion": "24.x",
  "enableExternalRewriteCaching": false,
  "sourceFilesOutsideRootDirectory": false
}
JSON
vercel api /v9/projects/prj_zWI3ldHAAxa1ZzNRdEB75Re8MTBR --method PATCH --input /tmp/voqro-vercel-next-project.json --silent --scope xoxogroovy-7398s-projects
vercel env add VOQRO_BACKEND_ORIGIN --environment production --value https://voqro-api-14829c4d.centralindia.cloudapp.azure.com --no-sensitive --yes --scope xoxogroovy-7398s-projects
vercel env remove VOQRO_PREVIEW --environment production --yes --scope xoxogroovy-7398s-projects
```

If `VOQRO_BACKEND_ORIGIN` already exists, update its production value instead of adding a duplicate. No backend password, bootstrap secret, storage credential or provider secret belongs in this frontend project. Preserve the existing deployment protection setting: the primary production domain is public while preview and generated deployment URLs remain protected.

Ensure the Git production branch contains `apps/web` and this configuration before relying on future pushes. The earlier `main` static-preview revision does not contain the Next.js application; merge the reviewed full-app release into the production branch as part of the switch. Changing the Vercel root directory alone does not change a Git branch.

Deploy the reviewed full-app commit:

```sh
vercel deploy --prod --yes --no-wait --local-config apps/web/vercel.json --scope xoxogroovy-7398s-projects
vercel inspect <deployment-url> --scope xoxogroovy-7398s-projects
```

Wait for **Ready**, confirm the build log detected Next.js and ran the frontend’s `npm run build`, and test through `https://voqro.vercel.app`. A generated deployment URL or the secondary production alias is not the canonical application origin; password and other protected mutations from those origins are intentionally rejected by the backend. The main application should be opened at its canonical URL.

### Preview deployments of the full application

A working authentication preview requires a **separate persistent backend and database**, with its own `APP_BASE_URL` set to the exact stable preview frontend origin. Supply that backend’s actual HTTPS origin as `VOQRO_BACKEND_ORIGIN` in the Vercel Preview environment, then run from the repository root:

```sh
vercel deploy --environment preview --yes --no-wait --local-config apps/web/vercel.json --scope xoxogroovy-7398s-projects
vercel inspect <deployment-url> --scope xoxogroovy-7398s-projects
```

Use the configured stable preview hostname for browser checks. Do not reuse the production database, loosen the production Origin check to accept arbitrary preview URLs, or set `VOQRO_PREVIEW=1` as a substitute for a backend. That flag only belongs to the legacy browser-only sample build. The Next.js Vercel build refuses a missing backend origin, and a configured origin does not prove backend reachability.

### Checks after deployment

Verify `/api/health` through the frontend returns `demo: false`; unauthenticated `/api/workspace` must return JSON 401. API responses must retain `Cache-Control: no-store` and must not be served as a shared cached response. Verify a fresh browser can open the public site without Vercel authentication, and sign-in cookies survive a workspace reload through the canonical frontend origin. Test private media access and range responses through the same rewrite.

Complete a first owner login through the frontend, create a brand and creator, invite their real users, send and accept a proposal, then test a private upload, revision, approval, invoice and reload. Restart the backend and check records and files again. A green Vercel build cannot establish these capabilities by itself.

## Validation

```sh
npm run check
npm test
npm run check:web
npm run build:web
npm run test:modern
```

The modern browser suite uses isolated real password accounts and a fresh temporary database; it does not use the sample adapter. Existing API tests continue covering permissions, immutable approvals, uploads, reconciliation and recovery. External Instagram, AI, payment, signing and email provider verification remains separate from application tests.

### Branch previews without a backend

The deployed Next.js project has a production backend configuration. A Vercel Preview build with no `VOQRO_BACKEND_ORIGIN` now renders a disconnected-preview notice linking to the live website. It disables Clerk UI/proxy and returns JSON 503 for API requests. It is a build preview, not an interactive app with saved records. Production builds still reject a missing or invalid backend origin. A functional branch preview needs a separately provisioned backend/database and matching test identity configuration.
