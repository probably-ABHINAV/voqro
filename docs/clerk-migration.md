# Clerk authentication

Clerk is the only production sign-in provider at **https://voqro.vercel.app/login**. The user explicitly requested removal of the two-sign-in migration flow. Sign-in opens the workspace automatically; no additional Voqro password or “open workspace” confirmation is required. `/setup` and `/account/clerk` redirect to `/login`; `/register` redirects to Clerk signup. Signup alone does not grant an agency membership.

The website and workspace headers show Clerk's profile menu and a visible **Log out** button when signed in. Profile settings use Clerk's modal; the existing account menu also links to `/login?manage=1`. Logout ends the local cookie when possible and signs out the Clerk session. Clerk handles identity, verification and account settings; Voqro retains database-controlled agency/brand/creator permissions.

## Production configuration

- Selected Clerk application: `app_3LljzexYxBFra4ABtFTXCRmtg6q`.
- Production instance: `ins_3Lll8Mm5fD4YE9A3q4SdmAQ4iX8`.
- Domain record: `dmn_3Lll8I0pu4ul3wyf01M9K3BTYMj`.
- Frontend API proxy and exact issuer: `https://voqro.vercel.app/__clerk`.
- Backend release for the cutover: `2d40b049fc127751988d3bdabfee20df88881c14`.

The official Next.js Frontend API proxy supports the existing Vercel hostname. A separate purchased domain is not required for this configured route. Public discovery, frontend environment and client endpoints work through the proxy. Never substitute the publishable key's encoded `clerk.voqro.vercel.app` hostname for the verified proxy issuer.

Backend:

```text
AUTH_PROVIDER=clerk
CLERK_MIGRATION_ENABLED=0
CLERK_ISSUER=https://voqro.vercel.app/__clerk
CLERK_SECRET_KEY=<private-production-secret>
APP_BASE_URL=https://voqro.vercel.app
```

Vercel Production:

```text
NEXT_PUBLIC_CLERK_ENABLED=1
CLERK_FRONTEND_API_PROXY_ENABLED=1
NEXT_PUBLIC_CLERK_PROXY_URL=https://voqro.vercel.app/__clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<production-publishable-key>
CLERK_SECRET_KEY=<private-production-secret>
VOQRO_BACKEND_ORIGIN=https://voqro-api-14829c4d.centralindia.cloudapp.azure.com
```

The keys originate from Azure Key Vault `voqro-setup-14829c4d`, secrets `clerk-prod-publishable-key` and `clerk-prod-secret-key`. The Vercel secret key uses Secret type; the public key uses Config because it is intentionally included in the browser. Backend configuration remains root-owned mode0600. Keys were never committed, printed or put in local development env files. Temporary VM access to the single vault secret was removed after provisioning. CLI account-level OAuth remains unavailable; normal official SDK access works. Do not rerun init or create an accountless application.

## Completed membership migration

The owner completed the original explicit linking flow and its binding was verified in the database. At final import, three active memberships existed: one already linked and two requiring migration. `scripts/migrate-clerk-users.mjs` imported those two through Clerk's official API with stable external IDs and **reserved, unverified email identifiers**. No passwords or hashes were copied, and no application IDs, roles, scopes or business records changed. Private provider metadata records migration provenance for safe retries; it grants no application permissions.

The administrative importer defaults to a read-only preflight and requires `--apply` plus the exact selected production instance for writes. It refuses unrelated pre-existing provider users, even when email addresses match; only its own trusted external-ID/provenance records can resume an interrupted import. It rechecks membership records inside the binding transaction after provider calls. It is not exposed as an HTTP route. Future new members should use owner-issued invitations, not this one-time migration tool.

Imported members must verify their email through Clerk before the backend grants access. Clerk's email-code preference was configured with `preferredSignInStrategyWhenPasswordRequired: 'otp'`. No test users, impersonated sessions or agent-triggered verification emails were created. The production `enhancedEmailDeliverability:true` update was accepted, although a legacy public flag continued reporting false; actual email/recovery delivery remains a user acceptance check.

All three active memberships were mapped before cutover. The installer independently enforces an active mapped owner and zero unmapped active memberships. The pre-cutover backup is `/var/lib/voqro/backups/before-clerk-only-2d40b04`; the earlier linking backup remains at `/var/lib/voqro/backups/before-clerk-link-631858a`.

## Session and authorization contract

The official backend SDK verifies signature, exact issuer, authorized frontend origin, expiry and session/user IDs. Pending sessions, impersonation claims and machine identities are rejected. A verified Clerk token is automatically exchanged for a Secure HttpOnly local cookie, preserving same-origin private images/videos through the Vercel rewrite. Each protected request verifies the provider session/account and current local membership; token organization/role claims never grant agency access.

Local sessions last at most one hour. On expiry, an existing valid Clerk session reopens the workspace automatically through `/login`. Owner revocation and membership changes record a cutoff against the provider session's original creation time, preventing refreshed JWTs from bypassing revocation. Provider termination, locked/banned users and changed verified emails deny access. The initial implementation makes two provider API requests per protected request and fails closed on outages/rate limits; assess latency before scaling.

Legacy password login, registration and bootstrap return503 in Clerk mode. Demo login remains disabled. The old linking endpoint rejects new links. Password records remain private for operational rollback but cannot authenticate users while `AUTH_PROVIDER=clerk`.

Rollback must be a deliberate operational change, not another login choice offered in the product. Existing password users retain credentials, but new Clerk-only members do not have local passwords. Do not delete identity tables or restore an old business database merely to revert authentication.

## Verification

- 154 backend tests passed, including controlled import, conflicts, partial failures/resume, reserved identifiers, token verification, binding, invitation privacy, revocation, disabled membership and rollback.
- 41 source/script syntax checks and Next typecheck/build passed.
- The production container passed explicit Clerk-only configuration, legacy-login-disabled and anonymous-workspace-denied checks.
- Live Chromium found exactly one Clerk sign-in widget at `/login`, no old password/linking prompts and no page errors. All legacy page redirects resolve to the same Clerk flow.
- Public checks confirmed provider `Clerk`, linking disabled, canonical `/login`, and503 responses for legacy login/register/bootstrap.

The owner’s pre-cutover link was verified. A new authenticated workspace visit, profile changes, logout and recovery/email receipt after the final cutover still need human acceptance; automated checks did not impersonate the owner. GitHub Student Pack redemption is unverified. No paid plan upgrade, domain purchase or environment publication occurred.

## Backend-managed workspaces

The user disabled Clerk Organizations and explicitly requested backend-owned workspace management. **Do not enable Clerk Organizations again.** Clerk handles identity, verification, sign-in and personal profiles only. Voqro stores the **agency → brand/creator workspace → campaigns/deliverables** hierarchy, grants and current workspace in its own database. Existing workspace IDs are retained (including historical IDs with an `org_` prefix), but no Clerk organization API or organization claim participates in authorization.

The app's **Workspaces** screen and header dropdown show readable names. New workspaces are created server-side with `workspace_` IDs. Invited users are automatically assigned to their existing agency/brand/creator workspace after verified sign-in; signup asks for no workspace name or ID. Signup without an owner-issued invitation does not grant business access. App invitations neither create provider organizations/accounts nor send email.

Agency staff keep their owner/manager/reviewer/finance roles in the agency workspace. A granted brand or creator workspace projects the current session into its restricted client role. Owner-issued membership changes clear previous workspace grants and queue the new default scope. Unknown workspace IDs are denied even when a signed Clerk token claims organization-admin privileges. Voqro membership revocation takes effect on the next request.

The local cookie is bound to the selected workspace. The Next workspace gate exchanges Clerk identity before rendering business data. Voqro's selector calls `/api/organizations/switch`; the backend validates the requested scope and updates the cookie binding without changing Clerk state. Exchanges preserve the previous authorized workspace, falling back to the assigned default. API requests carry the displayed workspace ID; stale-tab reads/writes and unscoped mutations are rejected. Native private media uses existing record authorization and the cookie. Logout remains available without a workspace header.

`scripts/setup-workspaces.mjs --owner <active-owner-id>` previews local setup; `--apply` synchronizes records and grants without network requests. Existing brand/creator records can be provisioned by an owner from Workspaces. Setup preserves business data and existing IDs. No custom Clerk roles, organization membership, billing feature or subscription upgrade is needed. Historical provider organization records are retained rather than deleted; the provider feature stays disabled.

## Imported planning packs

`campaign_reference_packs` stores private source documents and structured creator briefs. Campaign detail links to its pack, allocation, current captions and relative rollout. Agency staff can download escaped, script-free HTML. Assigned creators receive only their own script; other brands/creators cannot access the pack. Public catalogue endpoints expose none of it.

`scripts/import-campaign-pack.mjs --file <private-json> --owner <active-owner-id>` previews a prepared import; `--apply` writes it transactionally. The source ID and SHA256 make retries idempotent and prevent silent overwrite on a changed source. Existing creator handles/brands are reused without overwriting their profiles. Imported profiles start Draft; audience figures, availability, fees and campaign budget remain unknown unless supplied. Planning deliverables, pending shipments, knowledge, brief and open tasks do not create signed agreements, financial commitments, uploaded drafts or published posts. The full supplied Veda Munch text and prepared import are operational data and must not be committed to this public repository.
