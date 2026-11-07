# Voqro

Voqro is an agency operating system with a Next.js 16 / React 19 / Tailwind CSS 4 frontend in `apps/web` and an Express 5 backend on Node.js 24. It includes real password accounts, scoped invitations, sales, campaign delivery, private media review, workflow, finance and reporting. Read [the full-app guide](docs/full-app.md) for development and deployment. Live external-provider verification and the blueprint’s real-campaign completion evidence remain outstanding.

## Full application

Run `npm ci`, `npm run install:web`, then configure the private `.env.fullstack` from [.env.fullstack.example](.env.fullstack.example) and use `npm run dev:fullstack`. This starts Next.js and Express with a separate persistent local database. Owner setup is at `/setup`; brands and creators join with owner-issued invitations. The new application uses the real backend and has no browser-only business database.

Production uses Vercel for `apps/web` and a persistent backend host. [Azure for Students preparation](infra/azure/README.md) keeps the subscription spending limit enabled. Creating these deployment files does not provision a backend or establish a live account connection. The existing public sample site remains separate until the full backend is connected and verified.

## Run and verify

The tested environment uses Node.js **24.22.1**, FFmpeg/ffprobe **7.1.5**, Python 3.12 for optional AWS tooling, and Chromium at `/usr/bin/chromium`. Use Node **24.x**, supporting `--use-env-proxy` and the built-in SQLite backup API. The package pins this major version so Vercel does not automatically select a newer, untested major.

```sh
cd /workspace/voqro
npm ci
# Copy only when .env does not exist:
cp .env.example .env
npm start
```

The app listens on port 3000. `npm run dev` enables watch mode. Startup uses Node's environment-proxy support; retain the managed proxy, CA trust and TLS verification. AWS SDK dependencies load only for explicitly configured cloud operations. No model, posting, payment or email provider is silently substituted with a simulation in production.

```sh
npm run check
npm test
npm run test:browser
```

API tests use isolated memory/temporary databases. Browser tests start a separate in-memory app on port 3001; run the suite centrally rather than launching competing servers on that port. Set `CHROMIUM_PATH` for another trusted Chromium installation. Tests cover real local video playback and ffmpeg extraction, signed identity fixtures, fake AWS/Meta/SES transports, recovery, privacy, money, reporting, matching and desktop/mobile workflows. Mocked provider tests establish application behavior, not live service compatibility.

Each cloud task already has an isolated checkout. Do not create a worktree unless explicitly requested. Preserve `.env`, `.data/voqro.sqlite`, `.data/uploads` and any configured `DB_PATH` / `UPLOAD_PATH`. No reset, commit, deployment or environment publication is part of normal startup.

## Vercel website and persistent backend

### Interactive product preview

Set `VOQRO_PREVIEW=1` in the Vercel **Preview** environment to build the explicitly labelled, static product preview. This mode runs on Vercel without a backend or a computer left running. It includes seven sample personas, creator shortlists, enquiries, proposals and acceptance, campaign views, and tasks. Each browser keeps its own sample changes; **Reset demo** starts a fresh workspace. Other visitors cannot see those changes.

```sh
npm run test:preview
```

The preview never sends enquiries, connects real accounts, uploads private media, publishes posts, executes payments or calls paid AI/email providers. Unsupported actions explain that they need the connected application. It is a product demonstration, not a shared business database. Browser storage can be cleared; its contents are not backed up or synchronized across devices. Fresh fixtures are generated in memory by `scripts/generate-preview-fixtures.mjs`, without reading the local working database.

### Connected application

The deployment target is a **Vercel website with a separate persistent Node backend**. [Vercel deployment instructions](docs/vercel-deployment.md) cover the static build and same-origin API proxy. [Backend hosting instructions](docs/backend-hosting.md) cover the Node 24 container, FFmpeg, private uploads and SQLite storage. The backend remains responsible for authentication, private data and background work.

Set `VOQRO_BACKEND_ORIGIN` to the backend's real HTTPS origin in Vercel. Set the backend's `APP_BASE_URL` to the public website origin, enable secure cookies, and configure production identity. Vercel builds fail if the backend origin is missing or invalid. Backend secrets, databases and uploads are not bundled into the website.

AWS setup is paused at the user's request. Its historical setup notes are not prerequisites for building the Vercel website. Live optional AWS integrations and the existing Cognito production sign-in still need their own configuration before use.

## Demonstration and production are separate

`DEMO_MODE=1` enables seven clearly labelled shared identities and seeds fictional brands, creators and campaigns. These server-backed accounts are useful for local walkthroughs only; do not expose that shared demo backend publicly or enter real confidential records. The opt-in static preview above instead isolates sample changes in each visitor's browser and never connects to that backend.

Production defaults to demo mode off. A fresh production database starts empty. Startup refuses to use a database containing the shared demo identities in production mode, and refuses demo mode for a database containing production identities. Select new persistent `DB_PATH` and `UPLOAD_PATH` locations or perform a reviewed migration; the application does not erase source data to change modes.

[Cognito identity instructions](docs/identity.md) describe verified-email bootstrap, PKCE sign-in, invitation allowlisting, tenant roles, secure cookies and revocation. The pool's users must be provisioned through its administrative controls; an app invitation alone neither creates a Cognito user nor sends email. Configure a trusted HTTPS origin before external sign-in. Live owner and external-brand onboarding still need to be exercised against the real pool.

## Release status and required evidence

| Release | Implemented and locally tested | Still required for the original completion milestone |
| --- | --- | --- |
| 1 · Foundation and sales | Editable brands/approved creator profiles, public services/case studies, enquiries, shortlists, versioned proposals, exact-version acceptance, roles and Cognito identity adapter | Live external-user onboarding and an accepted proposal using real identities |
| 2 · Campaign delivery | Versioned briefs/knowledge, scoped assignments, tasks/dependencies, chunked local and optional S3 multipart uploads, playback, comments, revisions, exact-package approvals, rights and dispatch | Live private-cloud upload/download and a real creator/brand revision cycle; production media safety/decoder isolation review |
| 3 · AI and Instagram | Durable technical checks, real bounded frame/audio preparation, allowance-controlled Transcribe/Bedrock adapters, Meta OAuth, approved-package publishing/reconciliation, provider-linked insights, trends and reminders | Actual AWS model/language/permissions validation; Meta professional account and a specifically approved real post published and verified live |
| 4 · Commercial operations | Operational invoices, planned milestones, recorded costs, manual receipts/payouts, corrections, contribution, versioned agreements/acknowledgements and scoped report exports | One real paid campaign reconciled against real records; provider-backed payments/signing and statutory tax accounting if required |
| 5 · Optimisation | Explained hard-filtered matching, configurable weights, evidence/overrides, reliability corrections, comparable history and registered baseline experiments | Actual measured campaign outcomes against an agreed baseline; synthetic uplift is not evidence of improvement |

These remaining gates cannot be satisfied by setting connection flags, generating fake data or calling a mock provider. The user's first production milestone remains one brand, two creators and a complete paid campaign.

## Public website, sales and catalogue

1. A visitor submits **Let's work together** with a brief and indicative budget. The enquiry is stored in the agency pipeline.
2. The owner/manager creates an immutable, itemised proposal with creators, services, quantities, prices, revisions, rights, expiry and payment terms. Revisions create new versions; expired or stale versions cannot be accepted.
3. The matching brand accepts the exact latest proposal. One transaction creates the campaign, creator assignments and deliverables and marks the lead won. Retries return the existing campaign. An accepted proposal cannot be rewritten.
4. **Catalogue & website** lets the agency create brands, edit creator profiles, and publish services or evidenced case studies in this app. Profiles start as drafts. Only approved profiles appear publicly; planning fees and audit payloads stay private.
5. Creator statistics are unknown until supplied. Numbers require a dated source; engagement requires a defined sample. Sponsored/organic/mixed samples stay distinguishable. Manually entered figures cannot claim connected verification. Portfolio/evidence links are never fetched automatically.

A case-study source reference documents the team's evidence; it does not independently validate the claim. Public artwork is illustrative. No fake campaign results are seeded. Protected operations enforce permissions on the server, regardless of hidden navigation controls. [Public request guards](docs/request-guards.md) bound enquiry and authentication-start traffic using persistent per-source/global windows; proxy aggregation, further bot protection and deployment monitoring still require operational review.

## Delivery, knowledge and the review studio

Open an assigned campaign, save a brief, record usage channels/territory/dates and supporting agreement reference, set deadlines and track dispatch/receipt. [Tasks & knowledge](docs/workflow.md) adds versioned brand facts/claims/disclosures, dependent tasks, scoped discussions, reminders and escalation rules.

Creators upload a video and cover and submit an immutable package containing their hashes, caption, hashtags, mentions, disclosure, account, posting window and brief version. Local upload chunks are 1MB, with size/signature/hash verification and exact retry checks. Limits are 200MB video and 10MB cover. Originals remain outside public static assets.

The agency reviews first; only released versions become visible to the matching brand. Review comments can reference timestamps; agency-only notes stay private. A revision or change to any approved package field requires a new version. Brief edits also require fresh content and approvals. Historical decisions remain historical. File reads require the appropriate tenant/assignment and release access, including direct URLs and byte-range requests.

The studio shows exact-version technical and AI evidence with source, coverage and uncertainty. AI findings do not create approvals. Human review remains required, including judgement on claims, music rights, sampled-frame blind spots and final publication eligibility.

[Cloud media and AI](docs/cloud.md) provides optional direct S3 multipart uploads and version-pinned signed access. Provider completion alone is insufficient: the worker downloads and verifies the full object into the private local cache before making it usable. The upload selector defaults local and does not silently switch providers after an uncertain mutation. Exact-origin bucket CORS and exact-bucket CSP are required.

The local protocol supports chunk retry; full cross-session resume/orphan maintenance remains limited. Expired/incomplete files need an operational retention policy. Format checks, ffprobe and sampled frames are not a malware scan, full transcode or sandboxed media-security guarantee.

## Processing, publishing and notifications

Technical jobs use transactional claims, ownership tokens, leases, bounded retries and expired-lease recovery. ffprobe output is bounded and source hashes are verified. Local frame/audio preparation uses bounded ffmpeg subprocesses, up to three sampled frames and clips no longer than three minutes. Preparation is not semantic analysis.

Optional AWS reviews require the owner to configure campaign allowances and verified pricing assumptions. Reservations are integer USD cents, separate from the INR ledger. Requests are deduplicated by immutable version/mode. Uncertain model requests retain their reservation and are never automatically invoked twice. Reservations and AWS Budgets alerts are spending controls/estimates, **not a guaranteed billing cap**. See [cloud configuration and recovery](docs/cloud.md).

[Instagram integration](docs/instagram.md) supports the Facebook Login route for linked professional accounts. Its worker rechecks exact approvals, brief, account, operator access, rights and time window immediately before side effects. Container creation, publication, live verification and insight snapshots have durable states. Unknown outcomes are held for reconciliation; they do not trigger blind reposting. Provider verification requires matching job/snapshot records, not a user-entered source label. Live publishing is disabled by default and no real post has been made.

Manual handoff remains available. A manually entered Instagram URL or metric snapshot is labelled team-reported and unverified. Missing metrics remain unknown; per-post reach is never summed as unique audience. Trend evidence retains dated sources, geography/language, relevance and limitations without claiming a viral score.

In-app notifications cover tasks and actual exceptions with deduplication and current-access checks. [Notification delivery](docs/notifications.md) describes the optional SES outbox: verified production recipients, explicit activation, stable event/recipient identity and held uncertain sends. No email has been sent from this environment. Cognito provisioning mail, Meta grants and a payment provider are distinct integrations.

## Finance, reports and agreements

**Finance** supports immutable draft invoices, line-level tax rounding, explicit issue, partial manual receipts, recorded costs, creator payables and partial payouts. Currency is INR and all amounts are integer paise; the UI shows two decimals. Invoice/cost creation keys and unique external settlement references prevent duplicate recording. Overpayment is rejected transactionally. Corrections append reversing entries instead of rewriting payment history. Voiding preserves records and requires recorded settlements to be reversed first.

Only owner/finance can mutate the ledger. Brands see their issued invoices; creators see their own fee/payout records. Internal evidence notes and agency margins are excluded from external views. Managers/reviewers do not receive private reconciliation data. Drafts, including voided unissued drafts, remain private.

Contribution equals issued invoice subtotal excluding tax less all recorded costs, including unpaid obligations. Cash movement equals recorded receipts less payouts and can include tax. Planning budgets/catalogue fees are not revenue or actual cost. Unknown expenses/overhead are not guessed.

[Reports & agreements](docs/reporting.md) snapshots goals, deliverables, approval state, evidence-labelled post metrics, tracking references, lessons and role-appropriate finances. Reports are immutable versions and require explicit sharing before external access. Protected HTML/CSV downloads escape user input and neutralise spreadsheet formulas. Agreement terms/parties are versioned; acknowledgements belong to the exact version and are not certified signatures. Plans never alter ledger balances; linking exposes the matching invoice/cost and its recorded settlement state.

The app does not execute charges, bank transfers, refunds, statutory credit notes, GST/TDS accounting or provider-backed signing. Manual settlement records are not bank verification. Have the relevant accounting/legal requirements reviewed before using exports as real statutory invoices or agreements.

## Matching and experiments

[Matching & experiments](docs/optimization.md) is internal to owner/managers. Apply geography, language, niche, availability and fee filters before weighted ranking. Scores distinguish dated human fit evidence, reference pricing, recorded reliability and comparable observed results. Missing dimensions are shown explicitly; users record the reasons for selections or overrides.

History uses distinct posts at comparable observation ages, separates sponsored/organic samples, and returns unknown when the sample is insufficient. Empirical ranges are not guaranteed forecasts. Experiments register baseline/treatment, metric, observation age, sample requirement and target before publication. Observations link to existing snapshots; repeated snapshots cannot inflate the sample. Results can remain inconclusive and do not establish causality or future superiority.

## Backup and recovery

```sh
npm run backup -- create .data/backups/pilot-001
npm run backup -- verify .data/backups/pilot-001
npm run backup -- restore .data/backups/pilot-001 .data/restores/pilot-001
```

SQLite's online backup API includes committed WAL data. The snapshot copies completed original media, checks SHA-256/size, verifies database integrity/foreign keys and checks package references. It excludes sessions, OAuth flows, partial uploads and usable Meta tokens from the copy; source records remain unchanged. Restores go into a new directory and never overwrite a live workspace. Unfinished provider work is held for review, retaining potentially spent reservations. Reconnect accounts and reconcile uncertain outcomes before enabling workers after restoration.

Derived frame/audio files are not copied; completed reports retain their coverage while unfinished derived work is held. Checksums detect corruption but do not authenticate an untrusted backup. Automated off-site upload/scheduling, cross-account recovery, production RPO/RTO, monitoring and alarm delivery still require an operational setup and drill.

## AWS and toolkit setup

The [AWS foundation](infra/aws/README.md) targets **Mumbai (`ap-south-1`) and under US$50/month**. It defines private versioned encrypted media/backup buckets, optional exact-origin CORS, SQS/DLQ, invite-only Cognito with software-token MFA, and account-wide budget alerts. It provisions no compute, GPU, NAT gateway, load balancer, RDS or model capacity. It is linted locally and **undeployed**. Application workers currently use the durable local SQLite queues; an SQS runtime adapter is not connected.

Use [read-only inventory tooling](scripts/aws-inventory.py) once a secure IAM identity is connected. It distinguishes denied reads from absent resources and makes no mutations or paid model calls. Current environment inspection found no usable AWS identity.

The [AWS Agent Toolkit investigation](docs/aws-toolkit-setup.md) is **paused at the user's request**. AWS CLI v2.39.5 is installed, but authenticated account access and Toolkit verification remain incomplete. The AWS account is on the Free account plan; do not create an organization or change its plan to unblock authentication. No AWS resources or account-plan changes have been made. Current deployment preparation uses Vercel for the website and a separate persistent backend.

## Main implementation files

- `server.mjs`: core HTTP API, SQLite, application integration, production/demo separation and scoped workspace data.
- `catalog.mjs`, `identity.mjs`: public profile/content controls and production identity.
- `delivery.mjs`, `operations.mjs`: immutable delivery/review, private files, technical jobs, schedules and observations.
- `cloud.mjs`, `instagram.mjs`, `notifications.mjs`: optional real-provider adapters, durable outcomes and uncertainty handling.
- `workflow.mjs`: knowledge versions, tasks, inbox, rules and derived exceptions.
- `commerce.mjs`, `reporting.mjs`: operational finance, scoped snapshots, milestones and agreements.
- `optimization.mjs`: matching evidence, reliability and baseline experiments.
- `public/`: responsive UI modules, local artwork and role-aware navigation.
- `scripts/`, `infra/aws/`, `tests/`, `docs/`: recovery/tooling, undeployed infrastructure, automated verification and detailed boundaries.
