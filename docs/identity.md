# Production identity and invitations

`identity.mjs` implements a Cognito authorization-code flow with PKCE, independent production sessions, invitation-based app membership and owner-managed access. `public/identity.js` supplies the sign-in action and the owner-only **People & access** page. Provider behavior is tested with signed fixture tokens and injected transport; **live Cognito onboarding has not been verified**. There is no configured identity provider in this environment.

## Deployment configuration

Configure these non-secret runtime values through the environment settings:

```text
DEMO_MODE=0
APP_BASE_URL=https://your-verified-app-domain.example
COGNITO_ISSUER=https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_YOURPOOL
COGNITO_CLIENT_ID=YOUR_PUBLIC_CLIENT_ID
COGNITO_DOMAIN=https://YOURDOMAIN.auth.ap-south-1.amazoncognito.com
IDENTITY_BOOTSTRAP_EMAIL=your-verified-owner-email@example.com
```

Use actual values from the reviewed AWS deployment. `APP_BASE_URL` and `COGNITO_DOMAIN` must be HTTPS origins with no path, credentials, query or fragment. Register the exact callback `${APP_BASE_URL}/api/identity/callback` with a **public client without a client secret**, enable authorization-code grant and the `openid email profile` scopes, and configure the user-pool domain. The prepared CloudFormation pool alone does not configure a working hosted domain or callback unless supplied and completed. No secret or password belongs in the browser bundle.

Run Node with `--use-env-proxy` in this managed environment so `fetch` uses the inherited proxy. Keep configured CA trust and TLS verification enabled. The provider's domain and Cognito issuer/JWKS endpoints must be allowed by environment network policy. Do not bypass the proxy when a destination is blocked.

Terminate HTTPS at the trusted application ingress. Production cookies always use `Secure`, `HttpOnly`, `Path=/` and `__Host-` names, with no Domain attribute. The authorization-state cookie uses `SameSite=Lax` for the cross-site callback; the authenticated app cookie uses `SameSite=Strict`. HTTPS-origin POST validation must compare to the explicit `APP_BASE_URL` origin when the ingress forwards requests to an HTTP backend; never trust an arbitrary forwarded host.

## First owner and invitations

1. Provision the owner in the invite-only Cognito pool using its administrative controls, complete verified email and authenticator MFA, and set `IDENTITY_BOOTSTRAP_EMAIL` to that exact verified address. The app does not create a provider user, send email or distribute a temporary password.
2. Disable demo mode and start the app with valid provider settings. **Sign in securely** sends the browser to Cognito. Only the configured verified email can create the first owner, and only when no production accounts or bootstrap marker exist. There is no “first arbitrary user becomes admin” behavior.
3. Create the target brand or creator profile. As the verified owner, open **People & access → New invitation**, enter the exact email, role, tenant and expiry (1–30 days). Agency roles have no brand/creator assignment; a brand role requires an existing brand; a creator role requires an existing creator.
4. Provision that person's provider account through your Cognito administrative process. The app invitation records permitted membership only; it sends no email. The owner may share the displayed public sign-in address through their normal process. Possession of that URL does not grant membership.
5. At sign-in, the verified provider email must match an active invitation. A successful first sign-in consumes it and permanently binds the provider issuer/subject to the app user. Token-supplied role or brand attributes are ignored. Expired/revoked invitations and unverified emails cannot join.

Owners can change role or tenant, disable a member and revoke their app sessions. Every role/status change revokes existing sessions immediately; disabled memberships cannot sign in again. The last active owner cannot be demoted or disabled. Revoke-sessions alone permits a new verified sign-in. Emails and provider identities are not silently reassigned: a changed verified email or conflicting subject requires an explicit administrative recovery procedure, which is not implemented here.

Demo identity IDs are fixed. Once any production identity exists, `isDemoUser` rejects all shared demo identities, even if demo mode is accidentally re-enabled. Both demo login and demo session resolution must use that check. Production identity itself is disabled while `DEMO_MODE=1`; never combine real records with a shared demo database.

## Verification and session behavior

- A random, single-use state is stored as a hash and bound to a random HttpOnly browser cookie. State expires after ten minutes; starting again replaces that browser's pending flow. Expired records are removed and active flows are capped at 1,000.
- The authorization request uses PKCE S256 and a distinct nonce. The callback consumes state before exchanging the code; a failed exchange requires a new sign-in, avoiding ambiguous code reuse.
- ID tokens require an RS256 signature from the configured issuer's fixed JWKS URL, a unique matching RSA key of at least 2,048 bits, exact issuer/client audience, `token_use=id`, the expected nonce, valid expiry/issued-at times, a provider subject, and `email_verified=true`. Untrusted `jku`/key URLs and token role attributes are not used. JWKS keys cache for ten minutes and refresh for an unfamiliar key ID.
- Production session tokens are random and only their SHA-256 hashes are stored, separately from demo sessions. They expire at the earlier of one hour or the ID token expiry. A fresh sign-in rotates the current browser's app session. Provider access/refresh/ID tokens are never persisted.
- Logout revokes the current production/demo app session and clears local cookies. It does not sign the user out of Cognito globally. The provider session may permit another verified login; disable membership to deny app access.
- Access audit records retain bootstrap, sign-in, invitation, acceptance, revocation and membership-change events. Provider errors are sanitized; access tokens, authorization codes and passwords must not be logged.

## Root integration contract

Instantiate after the core users/brands/creators/session tables and helpers exist:

```js
import {createIdentity} from './identity.mjs';
const identity = createIdentity({db,row,rows,run,id,now,transaction,requireThat,textField,send,body});
```

In API routing, call `await identity.handlePublic(req,res,path)` before requiring a session. Resolve the authenticated principal as `identity.session(req) || demoSession(req)`, where `demoSession` requires both `DEMO_MODE === '1'` and `identity.isDemoUser(user.id)`. Demo login must also require `isDemoUser`. After authentication, call `identity.handleAuthed(req,res,path,u)`. Delegate `/api/logout` to `identity.logout(req,res)` so both cookie types are cleared. Expose `identity.publicConfig()` in the public response or retrieve `/api/identity/config`.

Frontend: import/instantiate `identityUI` with existing `api,esc,icon,tag,btn,heading,openModal,closeModal,toast,date,state,view,render` helpers. Add owner navigation `access`, route that view to `.render()`, dispatch `identity-` actions/forms to `.action()`/`.submit()`, and invalidate on navigation/account changes. The public login modal should display `.signInButton(publicConfig)` when the provider is available and use demo selection only for demo mode. Add `/identity.js` to static assets. No new runtime dependencies are required.

Backups must remove **`identity_sessions` and `identity_flows` from the snapshot**, alongside legacy `sessions`, without changing the source database. Preserve memberships, invitations, audits and the bootstrap marker. Removing the marker would weaken the one-time bootstrap rule.

## Tests and remaining live evidence

Run `node --disable-warning=ExperimentalWarning --test tests/identity.test.mjs`. Tests use generated RSA keys and an injected fake provider; they cover signature/claim rejection, PKCE/state/browser binding, callback replay, explicit bootstrap, verified-email invitations, forged role/tenant claims, expiry/revocation, immediate session invalidation, last-owner protection and production/demo separation.

Before external launch, complete a real owner and external brand sign-in through the configured hosted Cognito domain, enroll MFA, test invitation provisioning/recovery, verify HTTPS cookies and callback proxy behavior, and verify revoked users lose application access. These live checks require the actual pool, client, domain, permitted endpoints and user participation. They have not been replaced by mocked tests or a claim that Cognito is connected.
