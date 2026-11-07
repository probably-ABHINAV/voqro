# Clerk migration

The user approved this migration on 7 November 2026. Integration is implemented on `clerk-migration`; the live release remains on password authentication. Automatic Vercel deployments are disabled for this staging branch until its isolated backend and keys are configured; main keeps its existing deployment behavior. Existing credentials, memberships and business records are preserved. The GitHub Student Developer Pack lists Clerk Pro while eligible; benefit redemption has not been verified.

The latest user-supplied Dashboard instructions select **`app_3LljzexYxBFra4ABtFTXCRmtg6q`**. This supersedes the earlier application ID, which was never connected. Do not initialize an accountless app or replace working keys. The requested domain is **`voqro.social`**; public DNS returned NXDOMAIN and Vercel did not list it under the existing team when checked. Registration/registrar status is pending user clarification.

## Implemented behavior

- Next.js uses the official SDK, an explicit opt-in provider inside `<body>`, Next16 `proxy.ts`, and `/account/clerk` with sign-in, sign-up and account controls. Clerk does not initialize when disabled.
- Express verifies session JWTs with the official `@clerk/backend` SDK: signature, exact issuer, authorized frontend origin, expiration, session ID and user ID. Pending sessions, impersonation claims and machine identities are rejected. Token role claims never assign Voqro permissions.
- Linking requires an existing local session, current Voqro password, active account and matching verified primary Clerk email. The session and password record are rechecked inside the transaction after asynchronous verification. Existing emails never silently merge.
- `users.id`, roles, brand/creator scope and business records remain unchanged. Password salts/hashes remain for rollback. The existing raw binary-salt scrypt format is not a straightforward Clerk hash import; no production hashes were exported.
- Once activated, a verified Clerk session is exchanged for a Secure HttpOnly Voqro cookie. This preserves same-origin private image/video requests through the Vercel-to-Express rewrite. Each protected request checks the Clerk session and account before applying current database permissions.
- Only owner-issued invitations admit new verified emails. Clerk signup alone grants no membership and cannot bootstrap another owner. Existing members must be explicitly linked.
- Logout blocks reuse of that provider session. Owner revocation and membership changes record a cutoff against the provider session's original creation time, so refreshed tokens cannot bypass revocation. Users must sign out of Clerk and sign in again. Provider termination, banned/locked accounts and changed verified emails deny access.
- Local sessions last at most one hour, after which users reopen their workspace through Clerk. The initial implementation makes two provider API requests per protected request. Outages/rate limits fail closed with a retryable error. Assess latency and traffic before a larger rollout; any future cache needs an explicit revocation policy.

## Connect the selected application

The user has chat and a browser, but no terminal attached to this environment. CLI login requires a localhost OAuth callback their browser cannot reach. The unused listener was stopped. `clerk doctor --json` confirmed host execution passed, but CLI login and linking are missing. SDK installation does not authenticate the CLI or configure production.

Use the supported manual SDK configuration path:

1. Open <https://dashboard.clerk.com/>, select the application above, choose **Development**, then **API keys**. Do not rely on guessed direct application URLs.
2. In Azure Key Vault `voqro-setup-14829c4d`, choose **Objects → Secrets → Generate/Import → Manual**. Save the development values as `clerk-dev-publishable-key` and `clerk-dev-secret-key`. Do not paste values in chat, commits or screenshots.
3. Retrieve them only through an authenticated process that writes private configuration without printing values. Do not inspect existing `.env` or `.clerk` claim files. Production keys must not replace development keys.
4. Verify the issuer from the selected instance's metadata/public key and verify API reachability. Test against a disposable database. Instance keys enable the SDK, but do not grant account-level CLI access to configure production.

### Configuration

Backend during linking:

```text
AUTH_PROVIDER=password
CLERK_MIGRATION_ENABLED=1
CLERK_ISSUER=https://<exact-selected-instance-host>
CLERK_SECRET_KEY=<private-instance-secret>
APP_BASE_URL=<exact-frontend-origin>
```

Frontend:

```text
NEXT_PUBLIC_CLERK_ENABLED=1
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<matching-instance-publishable-key>
CLERK_SECRET_KEY=<private-matching-instance-secret>
VOQRO_BACKEND_ORIGIN=<persistent-backend-origin>
```

Never prefix the secret key with `NEXT_PUBLIC_`. Leave the enable flag unset/`0` until both keys are available. Enabled builds with missing keys fail instead of generating an accountless app. Backend `AUTH_ALLOW_INSECURE_LOCAL=1` is only for an explicit local HTTP origin in isolated development; keep it disabled on Azure. Optional backend `CLERK_JWT_KEY` supports SDK verification but does not replace the secret or live session checks.

## Production rollout

1. Confirm domain ownership, attach the chosen domain to the existing Vercel project, and verify DNS/HTTPS before changing the canonical origin. The backend accepts exactly `APP_BASE_URL`; old-host cookies do not transfer to the new host. Redirect the old hostname only after the new origin works.
2. Configure a production instance in the selected Clerk application, its DNS, allowed URLs, verified email/recovery and intended sign-in methods. Use Dashboard while CLI authorization is unavailable. If account-level CLI access becomes possible, link the selected app, follow `deploy --mode agent --domain voqro.social` and its `nextAction`, then require `deploy status --mode agent` to pass. Dashboard login does not authenticate this environment's CLI.
3. Store production keys separately in host secrets. Use the exact production issuer and matching public/secret keys. Do not overwrite local development keys.
4. Deploy migration code with **password mode retained** and linking enabled against the **production** instance. For each existing member, sign into Voqro, open Account → Connect Clerk sign-in, verify the matching email and reauthenticate with the current Voqro password. Development bindings do not transfer to production.
5. Confirm all active members, including the owner, have production bindings. `infra/azure/install-app.sh` refuses Clerk activation with development keys, a bootstrap secret, missing owner binding or any unlinked active member. Disabled members need migration before reactivation.
6. Back up the persistent database/uploads. Set `AUTH_PROVIDER=clerk`, recreate the backend with reviewed configuration and verify the owner reaches the same records. Legacy sessions and password login/registration/change endpoints are rejected in Clerk mode. Password records are not deleted.
7. Verify real provider sign-in, recovery, invitations, brand/creator isolation, private media, last-owner protection, provider sign-out, owner revocation and backend restart. Fixture-based tests do not replace these live checks.

Rollback: restore `AUTH_PROVIDER=password`, disable the frontend Clerk flag if needed and recreate/redeploy the hosts. Password users retain their credentials; Clerk-minted cookies are rejected in password mode. Do not delete identity tables or restore an old business database merely to roll back authentication. New Clerk-only members have no password credentials, so coordinate their access before rollback.

## Verification

Official SDK tests use locally signed RSA fixtures. Backend tests cover signature, issuer, origin, time, session type, explicit linking, wrong passwords, unverified/mismatched emails, session changes during linking, immutable bindings, invitation-only membership, ignored role claims, revocation, disabled memberships, provider outages, rollback and disabled integration.

The full backend suite passed 149 tests before the final rollback-session hardening; all nine focused Clerk tests passed again after it. Next typecheck and production build pass with Clerk disabled. A real-browser Next/Express test passed owner setup, invitations and the core agency workflow against an isolated database. A second browser test confirmed the disabled Clerk route preserves password sign-in without provider requests or accountless application creation.

Real Clerk sign-in, recovery/OAuth, production DNS and student-plan activation remain unverified. No production cutover has occurred.
