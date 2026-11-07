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

For Vercel, set the project root directory to `apps/web`, use the Next.js framework, install with `npm ci`, and build with `npm run build`. Set `VOQRO_BACKEND_ORIGIN` to the real backend's HTTPS origin. The old repository-root static build and `VOQRO_PREVIEW=1` do not configure the full application. Do not switch the live project to the Next.js root until that backend is connected and checked.

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
