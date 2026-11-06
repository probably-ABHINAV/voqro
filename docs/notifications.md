# Transactional email outbox

The in-app Inbox works without an external provider. `notifications.mjs` adds an optional Amazon SES delivery adapter for existing notifications. **No external email has been sent in this development task.** The adapter is disabled by default, and demonstration identities cannot activate or use it.

## Supported behavior

- A verified, active production owner explicitly chooses an existing unread and unresolved notification. The request must come from a current production owner session. The owner cannot supply a recipient address, subject or replacement message body.
- The recipient address comes only from an active `identity_accounts` record. Those records are created by the identity module only after Cognito returns a verified email claim. This verification is distinct from SES sandbox verification.
- Owner access, recipient identity, current role/brand/creator scope, notification visibility and its unread/unresolved state are checked on enqueue and again immediately before sending. A changed email or notification content cancels the queued record instead of sending stale information.
- A unique `(user_id,event_key)` key and unique notification ID prevent repeat requests from duplicating an email. The same notification cannot be resent after cancellation, provider acceptance or operator closure; its history remains.
- The worker uses SES `GetAccount` and `GetEmailIdentity` before attempting delivery. Sending must be enabled for the account and the sender identity must be verified. In the SES sandbox, the recipient must also be SES-verified; a Cognito-verified email alone is insufficient.
- Content is plain text, generated from the existing title/detail and a fixed HTTPS application link. Subject newlines are removed. An internal application action is never treated as a URL. No HTML interpolation or arbitrary recipient lists are supported.
- The message includes a `voqro_outbox` SES tag for event correlation. A successful API response stores the SES message ID and marks the internal state `Sent`; the UI calls this **Accepted by SES**, not delivered to an inbox.
- Defaults allow 25 notification reservations per day and 200 per month. Configuration is bounded to at most 100/day and 1,000/month. Send attempts, including uncertain and operator-closed outcomes, remain counted against runtime allowances. These are usage controls, not a guaranteed AWS dollar cap.

## Failure and recovery

SES does not provide an idempotency key for `SendEmail`. The worker stores `Sending` before making that API call and disables AWS SDK automatic retries. Any error after invoking it, a missing message ID, or a worker crash with an expired Sending lease becomes **Unknown**. The worker never automatically resends that record.

A failure before any `SendEmail` attempt becomes **Failed** and can be explicitly retried by the owner after fixing sender verification, account permissions, quota or connectivity. Recheck failures caused by removed identity access, changed recipients, resolved/read notifications or changed content are cancelled. A queued unclaimed record can also be cancelled explicitly.

For an Unknown outcome, correlate the outbox tag with SES configuration-set events and record the investigation. An operator can record evidence of acceptance (with the SES message ID), that no send occurred, or that the result remains unknown. This produces an explicitly labelled operator report. It never invokes another send and never converts an operator report into proof of inbox delivery.

A verified delivery/bounce/complaint event receiver and automatic suppression-list management are not implemented. The deployment needs SES event destinations and operational monitoring before real mail volume is enabled. The code does not create identities, verify domains, request sandbox removal, configure DNS, send verification emails or alter provider limits.

## Secure configuration

Supply through secure environment settings:

| Variable | Purpose |
| --- | --- |
| `NOTIFICATION_EMAIL_ENABLED=1` | Explicitly enables provider sending. Omit or set `0` until readiness is verified. |
| `AWS_REGION=ap-south-1` | Mumbai; other regions are rejected by this adapter's configuration check. |
| `SES_FROM_EMAIL` | Plain verified sender email, such as your agency's notifications address. |
| `SES_VERIFIED_IDENTITY` | The SES-verified email or exact sender domain. Defaults to the sender email. Set the domain when domain verification is used. |
| `APP_BASE_URL` | The production HTTPS application origin. Paths, query strings, credentials and fragments are rejected. |
| `SES_CONFIGURATION_SET` | Optional existing configuration set for provider events. |
| `EMAIL_DAILY_LIMIT` | 1–100, default 25. |
| `EMAIL_MONTHLY_LIMIT` | 1–1,000, default 200. |
| `DEMO_MODE=0` | Required. Shared demonstration identities are forbidden from sending. |

Use the managed AWS identity and normal SDK credential chain. No AWS key is stored in the application database or API. The lazy SES client uses the inherited HTTP/HTTPS proxy and CA trust through the shared AWS SDK transport pattern, with finite connection/request timeouts and one SDK attempt. Do not bypass the managed network policy. Allow the regional SES API endpoint through the supported environment settings when the account is connected.

The runtime IAM role needs the narrow SES account/identity read permissions and `ses:SendEmail` for the approved sender identity. Confirm those permissions, the identity's region and SES production/sandbox status with the actual account. No live SES compatibility or delivery verification is claimed by tests.

## Application hooks

```js
const notifications = createNotifications({
  db, row, rows, run, id, now, transaction, requireThat, textField,
  send, body, workflow
});
```

Instantiate after the workflow notification schema exists. Register `notifications.handler` after authenticated session handling. Its API prefix is `/api/notifications/email`. Use `start` and `stop` with the server lifecycle; `tick` supports deterministic tests. `status` reports local configuration only and performs no remote calls.

`public/notifications.js` exports `notificationsUI(ctx)` using the existing UI helper pattern. View ID: `email-delivery`; action/form prefix: `ntf-`; methods: `render`, `action`, `submit`, `invalidate`. The owner can queue notification emails and inspect delivery history. API reads by other verified members include only their currently accessible records. Demo sessions see configuration state but no production delivery history.

Tests inject `transport({action,input})` for `GetAccount`, `GetEmailIdentity` and `SendEmail`. Production lazily imports `@aws-sdk/client-sesv2`; there is no simulation fallback.

For backups, preserve historical records but move any copied `Queued`, `Sending` or preflight `Failed` records to `Unknown`, clear leases, and add a restored-snapshot investigation reason. A restored old snapshot must not replay an email already accepted by SES after the snapshot was taken. Explicitly inspect provider events before re-enabling background delivery after recovery.

## Validation

Seven tests cover disabled/demo behavior, production-owner permission, identity-bound recipients, event deduplication, SES acceptance provenance, cross-brand history scope, uncertain sends, restart recovery, owner/recipient access changes, scope changes during remote preflight, changed addresses, resolved notifications, sender and sandbox verification, safe preflight retry, cancellation and bounded allowances. Every provider response is simulated; no messages were sent by these tests.
