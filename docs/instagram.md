# Instagram publishing integration

The code implements **Instagram Graph API with Facebook Login** for professional Instagram accounts connected to a Facebook Page. It does not implement the separate Instagram Login API. Credentials and a real professional account are not connected in this environment. All provider tests use an injected fake transport; no Meta OAuth, post, live verification or insight call has been performed against a real account.

## Implemented workflow

1. An owner or account manager starts a connection for a brand. OAuth requests basic Instagram, content publishing, insights, Page listing and Page engagement permissions. The actual grants are checked through Meta's token-debug endpoint and must belong to the configured app.
2. OAuth state expires after ten minutes, is stored as a hash, is bound to a separate HttpOnly/Secure/SameSite=Lax browser cookie, and can be consumed once. The initiating authenticated session must still exist. This works even when the main SameSite=Strict session cookie is absent on the cross-site callback. Removed operator access and logout prevent completion.
3. The callback exchanges the code and requests extended authorisation. It lists up to three pages of 100 accessible Facebook Pages and their linked professional Instagram accounts. The operator explicitly selects the account; it is verified again before binding. An account cannot silently move to another brand.
4. Page tokens and pending account selections are encrypted with AES-256-GCM using a deployment-supplied 256-bit key. Each ciphertext is bound to its record context. Tokens, app secrets and signed media URLs are never returned in workspace JSON. Temporary OAuth selections expire and are cleared after binding.
5. A configured, explicitly enabled operator can schedule one immutable approved package per deliverable. A second identical request returns the existing job; a different package/account/time conflicts. The same deliverable cannot accumulate competing provider jobs.
6. The worker obtains checksum-bound, version-pinned private S3 video and cover URLs, then creates a Reel container. It polls the container, rechecks account identity, authorisation, latest version, brief, technical checks, approvals, rights, operator access and the approved window immediately before calling `media_publish`.
7. The approved caption, hashtags, mentions and disclosure are combined in that order. A disclosure already present in the caption is not appended again. Combined text must fit 2,200 characters. Feed sharing is explicitly off. Human approval covers all these package fields; there is no model-generated caption rewrite in the publishing path.
8. A successful publish response records the media ID, then the worker reads Meta's live media record. Account username, media ID, exact caption, Reel type, canonical permalink and publication time must match before the job becomes **Verified**. This verifies provider evidence, not a new frame-by-frame comparison of the final video/cover; those remain part of the human approval contract.
9. Verified posts populate the existing `live_posts` table. Insight refreshes populate `metric_snapshots` with provider-owned linkage through `instagram_metric_syncs`. Unsupported or absent metrics remain `null`, never invented zero values. Request keys prevent duplicate snapshot recording. Queries collect views, reach, likes, comments, saved and shares separately so an unsupported metric does not discard the available ones.

## Duplicate protection and uncertain outcomes

Jobs persist the container ID and media ID. A database lease protects each worker step. The code records **CreatingContainer** or **Publishing** before the respective network action. A timeout, unreadable response or interrupted lease during a side effect moves the job to **Container unknown** or **Publish unknown**; it does not automatically repeat that action. This is deliberately conservative, including for provider rejections whose outcome must be inspected.

Publishing uncertainty can be resolved by an operator supplying the exact live media ID and confirming they inspected the approved video and cover. Meta must independently report the original container as `PUBLISHED`, and the live media must match account, caption, Reel type and approved time window. The record retains **operator-associated after uncertain publish** as its provenance. The reconciliation route never calls `media_publish`.

A container creation without a returned ID cannot be reconciled reliably from application data alone. That job stays held for operator/provider investigation. Cancellation only applies before a known/uncertain publish action. Cancelled or failed records are retained and cannot currently be recycled through the UI into a second publishing attempt for the same deliverable. Add an explicitly reviewed attempt-history workflow only after validating provider semantics; do not erase these records to make retries possible.

Long-running containers are polled within a bounded allowance. Once the allowance or approved window is exhausted, the job is held. Signed media URLs last 15 minutes and must retain at least two minutes when submitted to Meta. If Meta cannot fetch/process the object in time, investigate the container and media before another reviewed attempt.

Disconnect removes local credentials and blocks queued work. Meta code `190` is treated as revoked authorisation and clears the stored token. Revoke the application in Meta Business Integrations when provider-side revocation is required. The app does not claim that deleting its local token revokes Meta's grant. Expired connections require fresh OAuth; silent background token renewal is not implemented.

## Configuration and activation

Provide these through secure environment settings, never source files or chat:

- `META_APP_ID`: the Meta application ID.
- `META_APP_SECRET`: its secret.
- `META_GRAPH_VERSION`: an explicit version such as the version verified for your app in Meta's current documentation. There is intentionally no default and no claim that a hard-coded version is current.
- `META_REDIRECT_URI`: the exact registered HTTPS callback ending in `/api/instagram/oauth/callback`.
- `INTEGRATION_TOKEN_KEY`: 64 hexadecimal characters representing a randomly generated 32-byte encryption key. Keep it stable for existing encrypted connections and separate from database backups. Losing or rotating it requires reconnecting accounts unless a deliberate re-encryption procedure is used.
- `INSTAGRAM_PUBLISH_ENABLED=1`: the explicit runtime switch permitting worker-side provider publishing. It defaults off. Keep it off while validating credentials, permissions, content types and recovery behavior.

The backend makes Graph requests only to `graph.facebook.com`, and OAuth redirects only to `www.facebook.com`. Preserve the managed environment's proxy and CA trust. Root startup uses Node's environment proxy support. Configure these destinations through the supported network policy workflow before a real integration test.

Meta app review, business verification, live/development mode, Page roles, professional-account eligibility, granted permissions and current API/content limitations must be checked with the actual account. The code cannot supply these permissions. The required release evidence—a supported approved Reel published and live status independently verified—remains blocked until account access and explicit approval of the real post are available.

## Application integration

`createInstagram` accepts the common database/API helpers plus `delivery`, `operations` and `mediaURL`:

```js
const instagram = createInstagram({
  db, row, rows, run, id, now, transaction, requireThat, textField,
  send, body, delivery, operations,
  mediaURL: cloud.publishingMedia
});
```

- Call `instagram.handlePublic(req,res,path)` for the OAuth callback before normal auth; it validates its own state and original session.
- Call `instagram.handler(req,res,path,user)` after auth for `/api/instagram` routes.
- `start()` and `stop()` manage the optional worker; `tick()` supports controlled tests. `start`/`tick` do nothing when publishing is disabled or configuration is incomplete.
- `operations.inspectReady(deliverable,versionId,timestamp)` supplies the existing review/rights checks. The media adapter receives `(version,kind,{expiresIn:900,purpose:'instagram'})` and must return `{url,expires_at,sha256}` for the immutable approved object, not an unscoped public bucket URL.
- Tests may supply `config` and an async `transport({method,path,token,params})`. The fake provider is only in tests; production never silently falls back to simulated posting.

`public/instagram.js` exports `instagramUI(ctx)` with the same helper pattern as Operations. It provides `render`, `action`, `submit`, and `invalidate`; the view ID is `instagram`, action/form prefix is `ig-`. Navigation is useful for owner/manager/reviewer/brand/creator; finance is rejected by the API. Only owner/manager can connect, schedule, reconcile or collect insights.

For reporting, do not trust source text alone. A provider-verified live post has a matching `instagram_jobs` row with `state='Verified'`, matching deliverable/version/permalink and a media ID. A connected metric snapshot has a matching `instagram_metric_syncs.snapshot_id`, whose job is verified. User-entered manual evidence may contain arbitrary words and must retain manual provenance.

Backups must delete `instagram_oauth_states` and clear `instagram_connections.token_cipher`, marking those connections disconnected. Preserve job IDs and histories for reconciliation after restoring; reconnect and inspect previously uncertain actions before enabling the worker. Restoring an old queued job must never cause an already-published Reel to be posted again.

## Validation

Tests use real SQLite transactions, existing delivery/operations readiness checks and a fake Meta transport. They verify disabled operation, role/tenant scope, one-use browser/session-bound OAuth, encrypted token storage, approved-package binding, immutable media hashes, exactly one publish call, provider live evidence, insight deduplication and missing metrics, edited-version blocking, unknown-outcome reconciliation, expired worker leases, revoked tokens and disconnect behavior. Live provider compatibility is explicitly unverified until credentials and a real authorised account are supplied.
