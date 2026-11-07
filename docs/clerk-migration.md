# Clerk migration

The user approved this migration on 7 November 2026. The production linking screen is now deployed at <https://voqro.vercel.app/account/clerk>, and password authentication remains active. Owner linking and the final authentication cutover are still pending. Existing credentials, memberships and business records are preserved.

Selected application: **`app_3LljzexYxBFra4ABtFTXCRmtg6q`**. Verified production instance: **`ins_3Lll8Mm5fD4YE9A3q4SdmAQ4iX8`**. The user chose to keep **`voqro.vercel.app`**. Clerk's supported Frontend API proxy is configured at **`https://voqro.vercel.app/__clerk`**, and live discovery reports that exact URL as issuer. No custom domain purchase or DNS changes are needed for this configured proxy route. Earlier guidance that a separate domain was always required was too broad.

The GitHub Student Pack lists Clerk Pro while eligible; redemption remains unverified. Automatic Vercel Git deployments remain disabled for the staging branch, but explicit production deployments were authorized and performed. Main must receive this tested integration before future unrelated main pushes, or those deployments would remove the proxy route.

## Implemented behavior

- Next.js uses the official SDK, an explicit opt-in provider inside `<body>`, Next16 `proxy.ts`, and `/account/clerk` with sign-in, sign-up and account controls. Clerk does not initialize when disabled.
- Express verifies session JWTs with the official `@clerk/backend` SDK: signature, exact issuer, authorized frontend origin, expiration, session ID and user ID. Pending sessions, impersonation claims and machine identities are rejected. Token role claims never assign Voqro permissions.
- Linking requires an existing local session, current Voqro password, active account and matching verified primary Clerk email. The session and password record are rechecked inside the transaction after asynchronous verification. Existing emails never silently merge.
- `users.id`, roles, brand/creator scope and business records remain unchanged. Password salts/hashes remain for rollback. The existing raw binary-salt scrypt format is not a straightforward Clerk hash import; no production hashes were exported.
- Once activated, a verified Clerk session is exchanged for a Secure HttpOnly Voqro cookie. This preserves same-origin private image/video requests through the Vercel-to-Express rewrite. Each protected request checks the Clerk session and account before applying current database permissions.
- Only owner-issued invitations admit new verified emails. Clerk signup alone grants no membership and cannot bootstrap another owner. Existing members must be explicitly linked.
- Logout blocks reuse of that provider session. Owner revocation and membership changes record a cutoff against the provider session's original creation time, so refreshed tokens cannot bypass revocation. Users must sign out of Clerk and sign in again. Provider termination, banned/locked accounts and changed verified emails deny access.
- Local sessions last at most one hour, after which users reopen their workspace through Clerk. The initial implementation makes two provider API requests per protected request. Outages/rate limits fail closed with a retryable error. Assess latency and traffic before a larger rollout; any future cache needs an explicit revocation policy.

## Current connection and release

The user saved production keys in Azure Key Vault `voqro-setup-14829c4d` as `clerk-prod-publishable-key` and `clerk-prod-secret-key`. Their live-key formats and production instance were verified with the official Clerk SDK. A generic Python HTTP request was rejected by Cloudflare; the official SDK worked without altered security settings.

The keys were transferred privately to Vercel Production; the secret key uses Vercel's Secret type and the publishable key uses Config because it is intentionally public. The backend secret is stored in root-owned mode0600 `/etc/voqro/backend.env`. No production keys were written to local development `.env` files, printed, or committed. The VM received temporary Key Vault Secrets User access to the single Clerk secret for provisioning; that role assignment was removed and absence verified after installation.

The backend runs exact release **`631858a0d8cc85f69a8ac5a65e7fff78e242254e`** with password login and Clerk linking enabled. A verified pre-migration backup was created under `/var/lib/voqro/backups/before-clerk-link-631858a`. The new container passed its health and identity checks; bootstrap remains closed. The final frontend deployment **`dpl_4Bju8ufwTpXuqLcCzAADfu7yxiaN`** is Ready and aliased to `https://voqro.vercel.app`.

Clerk's production domain **`dmn_3Lll8I0pu4ul3wyf01M9K3BTYMj`** already had the proxy configured. The SDK's `frontendApiProxy` route is now deployed, including static Clerk asset paths. OIDC discovery, frontend environment and client endpoints return200. The frontend's configured issuer contains `/__clerk`; both backend verification and the deployment guard accept only this exact same-origin proxy path or a normal HTTPS issuer origin.

`instance.update({enhancedEmailDeliverability:true})` was accepted to request Clerk-hosted verification delivery without custom sender DNS. The legacy public `auth_config.enhanced_email_deliverability` field still reported false afterward, so actual email arrival remains a live acceptance check; do not claim verification/recovery email delivery has been tested. No test user, impersonated session or email was created by the agent.

CLI account-level authorization remains absent because its localhost OAuth callback is inaccessible from the user's browser. Do not rerun init or create an accountless application. SDK credentials and live proxy checks do not establish CLI login. For future isolated automated provider tests, request separate development keys rather than reusing production credentials.

### Configuration

Backend during linking:

```text
AUTH_PROVIDER=password
CLERK_MIGRATION_ENABLED=1
CLERK_ISSUER=https://voqro.vercel.app/__clerk
CLERK_SECRET_KEY=<private-instance-secret>
APP_BASE_URL=https://voqro.vercel.app
```

Frontend:

```text
NEXT_PUBLIC_CLERK_ENABLED=1
CLERK_FRONTEND_API_PROXY_ENABLED=1
NEXT_PUBLIC_CLERK_PROXY_URL=https://voqro.vercel.app/__clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<matching-instance-publishable-key>
CLERK_SECRET_KEY=<private-matching-instance-secret>
VOQRO_BACKEND_ORIGIN=<persistent-backend-origin>
```

Never prefix the secret key with `NEXT_PUBLIC_`. Leave the enable flag unset/`0` until both keys are available. Enabled builds with missing keys fail instead of generating an accountless app. Backend `AUTH_ALLOW_INSECURE_LOCAL=1` is only for an explicit local HTTP origin in isolated development; keep it disabled on Azure. Optional backend `CLERK_JWT_KEY` supports SDK verification but does not replace the secret or live session checks.

## Production rollout

1. Keep the current Vercel hostname and verified proxy configuration. If a custom domain is added later, verify its ownership/DNS/HTTPS, update Clerk and the exact canonical origin deliberately, and migrate issuer bindings before switching. Cookies do not transfer between hosts.
2. Keep email/password verification and recovery as the current configured sign-in methods. Additional OAuth providers need their own production credentials. Verify real email delivery with the owner; the agent must not manufacture production accounts or impersonate users.
3. Store production keys separately in host secrets. Use the exact production issuer and matching public/secret keys. Do not overwrite local development keys.
4. Deploy migration code with **password mode retained** and linking enabled against the **production** instance. For each existing member, sign into Voqro, open Account → Connect Clerk sign-in, verify the matching email and reauthenticate with the current Voqro password. Development bindings do not transfer to production.
5. Confirm all active members, including the owner, have production bindings. `infra/azure/install-app.sh` refuses Clerk activation with development keys, a bootstrap secret, missing owner binding or any unlinked active member. Disabled members need migration before reactivation.
6. Back up the persistent database/uploads. Set `AUTH_PROVIDER=clerk`, recreate the backend with reviewed configuration and verify the owner reaches the same records. Legacy sessions and password login/registration/change endpoints are rejected in Clerk mode. Password records are not deleted.
7. Verify real provider sign-in, recovery, invitations, brand/creator isolation, private media, last-owner protection, provider sign-out, owner revocation and backend restart. Fixture-based tests do not replace these live checks.

Rollback: restore `AUTH_PROVIDER=password`, disable the frontend Clerk flag if needed and recreate/redeploy the hosts. Password users retain their credentials; Clerk-minted cookies are rejected in password mode. Do not delete identity tables or restore an old business database merely to roll back authentication. New Clerk-only members have no password credentials, so coordinate their access before rollback.

## Verification

Official SDK tests use locally signed RSA fixtures. Backend tests cover signature, issuer, origin, time, session type, explicit linking, wrong passwords, unverified/mismatched emails, session changes during linking, immutable bindings, invitation-only membership, ignored role claims, revocation, disabled memberships, provider outages, rollback and disabled integration.

The full backend suite passed 149 tests before the final rollback-session hardening; all nine focused Clerk tests passed again after it. Next typecheck and production build pass with Clerk disabled. A real-browser Next/Express test passed owner setup, invitations and the core agency workflow against an isolated database. A second browser test confirmed the disabled Clerk route preserves password sign-in without provider requests or accountless application creation.

Live browser verification now confirms the real production Clerk sign-in component renders on `/account/clerk` with no page errors or failed Voqro requests, and the original password form remains usable on `/login`. Anonymous linking is rejected with401. All nine Clerk backend tests passed again with the exact proxy issuer and rejection of altered/wrong-origin issuer paths; Next typecheck and production builds passed.

The owner must sign in at `/login`, then open `/account/clerk` in the same browser, create/sign into Clerk using the same email, and confirm their existing Voqro password inside the app. Verify the resulting binding and all-active-member coverage before setting `AUTH_PROVIDER=clerk`. Real authenticated linking, private media under Clerk, verification/recovery delivery, additional OAuth and student-plan activation remain unverified. No final authentication cutover has occurred.
