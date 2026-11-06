# Private media and evidence-based AI review

`cloud.mjs` adds an optional AWS adapter to the existing local delivery workflow. It is **implemented and tested with injected provider responses**, but **no AWS identity, bucket or model has been connected or exercised live**. The local frame/audio preparation path runs real ffprobe and ffmpeg. Creating a configuration is not evidence of successful AWS authentication, permissions, model access, CORS or regional language support.

## Available workflows

- **Media & AI → Prepare a package → Local frames and audio** checks the exact original hashes, extracts up to three 512px JPEG samples and, when present, mono 16kHz audio. It records duration, sample timestamps and coverage against the immutable content version. Evidence dialogs show scoped, checksum-verified sample previews; other brands and unreleased brand drafts cannot read those images. It does not interpret footage or transcribe speech. Videos are limited to three minutes.
- **AWS review** requires an explicit agency action and allowance. The worker prepares media, starts/reconciles a uniquely named Amazon Transcribe job when audio exists, then calls Bedrock Converse with the transcript, sampled images, immutable brief, snapshotted brand knowledge and package fields. The model response is schema-validated and saved as findings in the three blueprint layers. Findings never create an approval. Confidence values come from the model and are uncalibrated.
- **Private cloud upload** creates a scoped multipart S3 upload. Only the owning creator/agency user can obtain signed part URLs or complete/reconcile it. Parts use checksums, fixed 8MB boundaries and five-minute signatures. Final provider metadata, version ID, byte count, whole-file SHA-256, format signature and ffprobe visual stream are checked. The original is cached in the existing private local store before `uploads.status='Complete'`. Existing playback, worker, versioning and backup behavior continue to work.
- The review studio offers a **storage selector only when AWS media is configured**. Local storage stays the default. Choosing AWS uses direct multipart transfer and never silently falls back after an uncertain provider action. The studio's **Media & AI evidence** button opens findings for that exact version.
- `publishingMedia(version, kind, {expiresIn})` mirrors an existing local original to private S3 on an explicitly requested publishing operation, or reuses its recorded object. It checks the package checksum and returns a signed URL pinned to the exact S3 `VersionId`, expiry and SHA-256. It never makes a bucket public. The publisher must still recheck current approvals, account, rights and posting window immediately before use.

Cloud uploads are limited to 200MB for video and 10MB for covers, with 100 new upload records per user per day. These are abuse bounds, **not storage-spending limits**. The client computes the complete checksum using WebCrypto; a 200MB source needs browser memory. Direct uploads require the exact application origin in bucket CORS and the exact bucket endpoint in application CSP. There is no wildcard CORS requirement.

## Configuration

Keep AWS credentials in the environment's secure IAM identity connection, not these variables or application records. The SDK uses the configured AWS credential chain/profile and inherited HTTPS proxy. TLS verification stays enabled and the environment's CA trust is preserved.

| Variable | Purpose / default |
| --- | --- |
| `AWS_REGION` | `ap-south-1`; other regions are rejected for this pilot |
| `AWS_MEDIA_ENABLED` | `1` enables explicit S3 operations; otherwise disabled |
| `AWS_MEDIA_BUCKET` | Private, versioned DNS-safe bucket name, without dots |
| `AWS_AI_ENABLED` | `1` enables explicit paid analysis; otherwise disabled |
| `BEDROCK_MODEL_ID` | A model explicitly approved and available in Mumbai; no guessed default |
| `AWS_AI_PRICING_VERIFIED` | Set `1` only after reviewing live provider/model prices and the reservation amount |
| `AWS_AI_JOB_RESERVATION_CENTS` | USD-cent estimate retained per requested AWS review; default `50` |
| `AWS_AI_MONTHLY_LIMIT_CENTS` | Application reservation target; default/max `500` ($5), within the overall $50 pilot target |

The owner must additionally set a campaign allowance in **Media & AI**. Reservations are integer **USD cents**, separate from the commercial ledger's INR paise. Campaign reservations are cumulative and the monthly cap applies to jobs created in the current UTC month. A repeated request for the same version/mode returns the same job and does not reserve or invoke twice. At most 20 preparations/reviews per user per day are admitted.

The amount reserved is an **operator-reviewed estimate, not measured AWS cost or a billing cap**. A failed job can still incur provider charges. Reservations are released only when preparation fails before any provider work. Transcription/model errors after provider work retain the reservation. No exchange rate is invented and no AWS estimate is automatically posted as an actual INR campaign cost. AWS Budgets alerts also do not stop spending. Live billing reconciliation, storage/transfer metering and provider quota validation remain prerequisites for a dependable production cost ceiling.

AWS permissions must be scoped to the selected bucket's `originals/` and `processing/` prefixes, multipart operations and the approved model. The Transcribe service needs access to the selected media/output bucket according to its current service policy requirements. Model subscription/availability and language support require a live test. No administrator keys or application IAM roles are created by this module.

## Reliability and privacy

Every cloud object key is generated server-side; callers never supply arbitrary keys or URLs. Uploads that time out during provider creation/completion become **Needs reconciliation**. Reconciliation looks up the existing object/upload and does not blindly repeat completion. A successful multipart request alone cannot create a usable media record. Objects without a real S3 version ID are rejected.

Analysis jobs are durable SQLite records with leases and claim tokens. Interrupted local preparation can resume. Transcription uses a stable provider job name and polls that name before another submission. Bedrock requests have automatic SDK retries disabled. A failed/uncertain model response or an interrupted in-flight model call becomes **Needs reconciliation**, retains its reservation and is never automatically invoked again. There is currently no UI action that asserts an uncertain provider bill has been reconciled or safely reruns that same paid request. An administrator must inspect the provider record before deciding on further work.

Local subprocesses run with bounded timeouts, bounded output, one thread, and file/pipe protocols. Source bytes are hash-checked before processing; derived frame/audio checksums are checked before provider use. Evidence states precisely which timestamps were sampled and that other moments were not assessed. Decoder metadata and frame extraction are not a full malware scanner, full-video transcode, music-rights determination or Instagram eligibility guarantee.

Brand visibility follows existing agency-release checks; another brand cannot obtain files or findings. Creators see findings for their assignments but do not receive agency cost reservations or private worker errors. Finance users do not access delivery media/AI APIs. Model reports never replace human approvals and stay attached to historical versions when content changes.

Prepared local frame/audio artifacts are under `uploads/.analysis/<job-id>/`. The original backup tool includes completed original media and persisted reports, but does not copy this derived directory. A restore must fail unfinished AI jobs safely, retain reservations for potentially charged work, and reconcile unfinished cloud uploads before retrying. Completed reports retain their evidence timestamps even if derived samples are not present after restore.

## Integration contract

```js
const cloud = createCloud({...helpers, delivery});
// After authentication, before generic API fallback:
if (await cloud.handler(req, res, path, user)) return;
// Start/stop with the application worker lifecycle:
delivery.analysisFor = cloud.analysisFor; // Exact-version findings in the review studio.
cloud.start();
cloud.stop();
// The publishing integration receives this private helper:
const mediaURL = cloud.publishingMedia;
```

Frontend `cloudUI(ctx)` supplies `render`, `action`, `submit`, `invalidate`, and `uploadFile(file, kind, deliverableId, onProgress)`. Use the `cloud` view, `cloud-` action/form prefix, and `/cloud.js` static asset. Inject `cloudUpload: cloudPanel.uploadFile` into `deliveryUI`. The latter checks backend storage status before showing its explicit storage selector.

Tests cover owner/scoped multipart access, full-file integrity and pinned object versions, recovery after an uncertain completion, budget admission/deduplication, real ffmpeg evidence, model-result validation, private scopes, and retained reservations after an uncertain model invocation. A successful live AWS upload → verify → signed download and an actual transcript/model response remain required completion evidence for the external integration.
