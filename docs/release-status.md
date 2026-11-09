# Voqro release status — 9 November 2026

## Live architecture

- Website: https://voqro.vercel.app, Next.js 16, React 19, Tailwind CSS 4.
- Backend: Express 5 / Node.js 24 on Azure, HTTPS with Caddy, persistent SQLite and private uploads.
- Identity: Clerk-only sign-in, profile menu and visible logout. Clerk Organizations is disabled. Signup is open to verified emails: new users enter with a personal account immediately and can optionally choose Brand or Creator later. Local roles control business access; invitations can assign existing records or staff roles.
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
5. **Operations:** daily private Azure Blob backups have full readback/isolated restore verification and owner status; see [backup operations](azure-backups.md). The release automation adds backend/type/browser/build checks, public availability probes, and restored-application acceptance using synthetic accounts. External alert delivery, a real production-identity recovery exercise and cross-region recovery remain outstanding. See [release checks](release-checks.md) for coverage and limits.

## AI client team

The URL-based client team adds public-source audits, editable outreach/reply drafts, manual review/send records, opt-outs and qualified-prospect conversion inside the enquiry pipeline. It uses the existing Azure deployment and a shared media/sales spending ceiling. Search, messaging and booking providers are not connected by this feature. See [client-team operations](ai-client-team.md).

## Release automation

GitHub release checks run on main pushes and pull requests using isolated data without production credentials. A separate read-only availability workflow checks the live website, login, both API origins, Clerk open-signup configuration and private workspace protection twice an hour. These checks do not automatically gate Vercel deployment, and GitHub notifications depend on the owner's account settings.

These are distinct from the deployed app being available. Do not mark the entire release complete by changing status labels or fabricating provider outcomes.
