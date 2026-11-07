# Voqro release status — 7 November 2026

## Live architecture

- Website: https://voqro.vercel.app, Next.js 16, React 19, Tailwind CSS 4.
- Backend: Express 5 / Node.js 24 on Azure, HTTPS with Caddy, persistent SQLite and private uploads.
- Identity: Clerk-only sign-in, profile menu and visible logout. Clerk Organizations is disabled. Local invitations and roles control business access.
- Business structure: one agency, Voqro; one imported client, Veda Munch; five imported campaign collaborators. Historical child-workspace rows are archived and inaccessible, preserving audit history and campaign data.
- AI: Azure OpenAI `gpt-4.1-mini` via VM managed identity. Requests require campaign allowances and reserve estimated cost; uncertain requests are held for reconciliation. AWS remains paused.

## Dashboard deployment failures

Historical branch previews failed because the Next.js build required `VOQRO_BACKEND_ORIGIN`, while the project has only a production backend configuration. Production deployment `dpl_DFE3fQ84rVWKnZapi5V66Gam2zKJ` was Ready when investigated. Old Error entries remain history and are not the live production deployment.

An unconnected Next.js branch preview now builds a clear notice linking to production, with no login or business workflow. `/api/*` and `/__clerk*` return 503. Production still refuses to build without a valid public HTTPS backend origin. To exercise an actual preview workflow, provision an isolated test backend and test Clerk configuration in the Preview environment; do not reuse production data or credentials.

## What is implemented

Sales and proposal acceptance; campaign briefs, tasks and role-scoped creator assignments; private media and versioned approval/revision workflows; ledger records and immutable reports; AI job controls; Instagram OAuth/publishing/reconciliation adapters; matching and experiments. Local tests exercise workflows and authorization with isolated data and fake provider transports where needed.

The Veda Munch pack contains the supplied scripts, captions, creator links, planning stock allocation and follow-up tasks. Missing commercial amounts, shipment confirmations, publishing outcomes and metrics remain unknown. Saying creators worked with the brand does not establish a signed agreement, shipped package or verified publication.

## Gates that still need real provider or campaign inputs

1. **Instagram:** create a professional account and Meta developer app, configure the documented redirect/permissions, connect the account, then approve a specific real post for the first live verification. No real post has been published by this deployment.
2. **Signing:** select a signing provider and securely configure its credentials. Current exact-version acknowledgements are not provider-certified signatures. GitHub Student Pack ownership alone does not connect a signing provider.
3. **Payments:** manual invoices, receipts and payouts are available; no payment processor is connected. A real campaign must be reconciled against actual settlement evidence.
4. **Campaign acceptance:** invited client/creator onboarding and a real approval/revision cycle need those participants. Real observed metrics are required for optimization results.
5. **Operations:** backup/verify/restore tooling and pre-release local backups exist; scheduled off-site backups, restore drills and monitoring delivery remain outstanding.

These are distinct from the deployed app being available. Do not mark the entire release complete by changing status labels or fabricating provider outcomes.
