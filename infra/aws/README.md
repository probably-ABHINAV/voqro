# AWS plan for Voqro

Target: **Mumbai (`ap-south-1`), under US$50/month**. The template is prepared and locally linted; **nothing has been deployed or connected**. The running demo still uses local SQLite, local files, local workers and demonstration identities. Optional Cognito, S3, Transcribe/Bedrock, Meta and SES adapters now have implementation and injected-provider tests; they have not been validated live. AWS CLI inspection currently fails because no usable identity is configured.

## Use AWS where it adds the most value

| Order | Service | Value for this app | Current status |
| --- | --- | --- | --- |
| 1 | S3 | Private immutable video/cover objects; consistent database + media backups | Two private buckets defined; local recovery and optional S3 multipart adapter implemented |
| 2 | Cognito | Verified invitations, sign-in and authenticator MFA | Invite-only pool/client and tested sign-in/membership adapter; provider-user provisioning and live onboarding pending |
| 3 | SQS | Separate slow media work from requests; retries and failed-job recovery | Queue and dead-letter queue defined; worker still uses SQLite |
| 4 | SES | Proposal, review and invoice notifications | Verified-recipient outbox implemented and tested; sender/domain and live SES verification pending |
| 5 | Transcribe + Bedrock | Speech transcripts, claims/disclosure review and selected-frame checks, retaining human approval | Bounded transcription and sampled-frame model adapter implemented; off by default; live access unverified |
| 6 | Small persistent compute | Run the Node app, SQLite and ffprobe on one server during a pilot | Reuse suitable existing capacity first; no compute provisioned |

AWS does not supply Meta professional-account authorisation, Instagram publishing permissions, payment settlement or electronic-signature services for this app. Those integrations still need their own providers.

## Spending design

These are **allocation targets**, not verified AWS prices or a bill estimate. No Free Tier eligibility, credits or reserved discounts are assumed. Confirm current Mumbai prices, taxes, transfer rates, active resources and workload before deployment.

| Allocation | Monthly target |
| --- | ---: |
| Small persistent compute, including its disk/IP allowance | $15 |
| Media, backups, S3 requests and transfer | $10 |
| Identity, queues, email and bounded logs | $5 |
| Optional limited AI/transcription trials, initially disabled | $5 |
| Unallocated headroom for taxes and variable usage | $15 |
| Total ceiling target | **$50** |

Planned service spend is $35 with $15 headroom. If an existing resource already consumes that budget, reuse it or adjust the design before adding anything. A large media library or frequent full backup copies can exceed this allocation. Measure upload volume, backup size and external playback/download traffic. Full backups duplicate completed media; use them for a small pilot, then add deduplicated immutable object backups before growing.

The foundation creates no NAT gateway, load balancer, RDS database, OpenSearch cluster, GPU, provisioned model capacity or running compute. SQLite requires a persistent disk and a single writing application instance. Do not put its database on an ephemeral Lambda/Fargate filesystem or S3. A small Lightsail/EC2 host may fit a pilot after actual pricing and existing capacity are checked. Production availability and larger traffic may require a larger budget and a different database.

Budget alerts cover the **whole AWS account**, including existing resources: actual spend above 50%, 80% and 100% of the target, plus forecast above 100%. AWS billing data and alerts can lag. **Alerts do not cap or stop charges.** No automatic shutdown or account policy change is configured. For later AI integration, enforce job count, duration, token and retry limits in application code, reserve estimated cost before enqueueing, and reject work over its campaign allowance. Only enable providers after those controls and provider-side limits are tested.

Pricing references to check at deployment time: [AWS calculator](https://calculator.aws/), [S3](https://aws.amazon.com/s3/pricing/), [Cognito](https://aws.amazon.com/cognito/pricing/), [SQS](https://aws.amazon.com/sqs/pricing/), [Lightsail](https://aws.amazon.com/lightsail/pricing/), [Transcribe](https://aws.amazon.com/transcribe/pricing/), [Bedrock](https://aws.amazon.com/bedrock/pricing/). These pages have not been used to claim a current quote.

## Secure connection and read-only discovery

Connect an AWS IAM role through the cloud environment's secure identity settings; do not put keys in chat, source code or `.env`. Start with the actions in [inventory-policy.json](inventory-policy.json). It has no resource-writing permissions. A deployment role is a separate, later step. If this environment supplies an AWS profile alias and config path in `OIC_MANIFEST_PATH`, use those supplied selectors exactly. Do not guess an alias or inspect credential contents.

Install optional local tooling from trusted package sources:

```sh
python -m venv .data/aws-tools
.data/aws-tools/bin/pip install -r infra/aws/tools-requirements.txt
.data/aws-tools/bin/cfn-lint --region ap-south-1 --template infra/aws/foundation.yaml
python scripts/aws-inventory.py
```

The inventory script inherits the configured AWS identity. It does not unset profiles or fall back to instance metadata. `AWS_CLI` can select a trusted CLI executable. It reads resource metadata for compute, NAT gateways, public IP allocations, load balancers, databases, buckets, queues, Cognito, stacks, Bedrock's catalogue, SES capability and existing budgets. Its private report is `.data/aws-inventory.json`; denied reads are recorded as unknown. It does not fetch user lists, object contents, secrets, invoke AI, query paid Cost Explorer APIs, change resources or publish anything. Regional inventory covers Mumbai; buckets and budgets are account-wide. Existing services in other regions are not fully inventoried.

With restricted egress, allow only the needed regional AWS API endpoints after the role is connected. Budget APIs use `budgets.us-east-1.amazonaws.com`; Mumbai services use their specific AWS endpoints. Keep the session proxy and CA trust enabled. An access-denied response needs IAM review; a blocked-domain response needs the environment's allowlist updated. Neither is evidence that a service has no resources.

## Review the foundation before deployment

[foundation.yaml](foundation.yaml) defines:

- Two S3 buckets with encryption, blocked public access, ACLs disabled, TLS-only access and versioning. Current media objects do not expire automatically; replaced versions expire after 30 days. Incomplete multipart uploads are abandoned after seven days.
- A separate backup bucket. Objects under `snapshots/` expire after 90 days, and noncurrent versions after 30 days. This is an explicit pilot retention policy; change it before deployment if a longer recovery history is needed.
- An encrypted standard SQS queue, 20-second long polling, 120-second visibility and a three-receive dead-letter policy. Main queue retention is four days; dead letters retain 14 days. Standard queues may deliver duplicates. The future adapter must keep existing job idempotency and ownership checks, extend visibility during long jobs and delete messages only after durable completion.
- An invite-only Cognito Lite user pool with case-insensitive email usernames, verified email recovery, required software-token MFA, 12-character passwords, deletion protection and short-lived tokens. No SMS MFA costs. The public client uses no embedded secret. Hosted login configuration stays disabled unless `LoginCallbackURL` is supplied; a user-pool domain and live configuration of the implemented sign-in flow are still needed. Default Cognito email sending limits are unsuitable for unrestricted production invitations.
- Account-wide $50 budget alerts to the required `BudgetEmail` parameter. No budget email or AWS resources have been created. Optional `AppOrigin` configures exact-origin CORS on the media bucket; leave it empty until the HTTPS app origin is known.

Buckets and the identity pool are **retained** if the stack is deleted or replaced. Retained data can continue to cost money; stack deletion is not a cleanup or cost-stop mechanism. Versioning is not immutable/Object-Lock protection, and this template is not a cross-account disaster-recovery solution.

Keep the stack name short (for example `voqro-pilot`) because it is included in the queue name. Region is selected by the deployment command; use `ap-south-1`. Before executing a reviewed change set, supply a real billing contact, verify current prices and existing resources, review lifecycle retention and confirm the required deployment permissions. No deployment command has been executed in this task.

The template creates no IAM users, access keys or application roles. Later, attach only the necessary actions to the selected runtime role: media reads/writes limited to the media bucket and object prefix; backup writes limited to `snapshots/`; queue operations limited to the processing queue. Keep restore/delete permissions and Cognito invitation administration separate. JWT verification uses the pool's public signing keys; tenant membership and roles must come from trusted server records, never a self-editable profile attribute.

## Connect the application in this order

1. Inventory the account and confirm budget, email and existing hosting. Review the CloudFormation change set before creating resources.
2. Upload one verified local backup to the private backup bucket, download it to a new directory and run verification plus a restore drill. Automate only after the drill succeeds. Local backup tooling does not currently upload or schedule backups.
3. Configure and live-test the implemented Cognito authorisation-code + PKCE adapter and its issuer, audience, signature, expiry and nonce checks. Provision memberships through trusted invitations, rotate sessions, and disable `DEMO_MODE` before external use. Creating a pool alone does not secure the existing app.
4. Activate and live-test the implemented S3 multipart adapter, including short-lived scoped access, immutable version-pinned keys, checksums, user limits and approval-version binding. Keep originals private. Add file safety/decoding checks and test cross-brand access. The local upload path stays available; the review studio explicitly selects optional direct AWS upload when configured.
5. Add an outbox-backed SQS adapter and reconcile retry/visibility semantics with the local durable worker. Start with deterministic ffprobe checks. Add bounded logs, queue monitoring and restore alerts.
6. Verify SES and Meta capabilities, then activate their implemented notification/publishing adapters independently. Enable the implemented, narrowly budgeted Transcribe/Bedrock adapter last; retain provider job IDs, exact evidence, cost records, and human review. Catalogue visibility does not establish model invocation permission or language suitability.

## Local backup and recovery

The backup CLI uses SQLite's online backup API, so committed WAL records are included. It snapshots the database first, copies only the immutable completed media referenced by that snapshot, verifies SHA-256 and byte counts, checks SQLite integrity/foreign keys and verifies content-package references. Each snapshot removes sessions, OAuth flows, partial uploads and usable Meta tokens **from the copy only**, and holds uncertain/incomplete provider work without releasing possibly spent reservations. Credentials and `.env` are excluded. Checksums detect corruption; they do not authenticate a backup supplied by an untrusted party.

```sh
# Uses DB_PATH and UPLOAD_PATH from .env when set; otherwise standard .data paths.
npm run backup -- create .data/backups/pilot-001
npm run backup -- verify .data/backups/pilot-001
npm run backup -- restore .data/backups/pilot-001 .data/restores/pilot-001
```

Create and restore refuse an existing destination. Originals are never overwritten. A restore goes to a new directory with `voqro.sqlite`, `uploads/` and `manifest.json`. Start a separate local app instance using those paths and a spare port to inspect it. Log in again because old sessions are revoked. Partial uploads must be restarted. Restore the matching application code/schema version, keep the backup private and encrypt any transport to external storage. Do not merge a restored database into a running server; a production cutover needs a deliberate maintenance step.

Automated tests cover a live WAL snapshot, retained financial records, media references, session exclusion, incomplete uploads, refusing overwrite and rejecting corrupt database/media files. The existing worker recovers expired processing leases after restart. Scheduling, off-site transfer, cross-account recovery, production RPO/RTO and alarm delivery remain future operational work.


Implementation references: [identity](../../docs/identity.md), [cloud media/AI](../../docs/cloud.md), [Instagram](../../docs/instagram.md), [SES outbox](../../docs/notifications.md), and [current AWS Agent Toolkit setup blocker](../../docs/aws-toolkit-setup.md). These tests do not establish live provider access.
