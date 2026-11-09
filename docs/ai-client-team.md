# AI client team — URL-based first release

Open **Enquiry pipeline → Open AI client team**. This release adds private prospect research, source-linked audit suggestions, editable outreach/reply drafts, exact-revision approval, user-reported sends, opt-outs, suggested follow-up dates and conversion to the existing enquiry pipeline.

## Use

1. The owner reviews **Service profile & sales allowance**. Enter actual services, target customers, offer boundaries, writing tone and only proof approved for public outreach.
2. Add a business name and public HTTPS website. Optionally paste at least 80 characters of public page text. Duplicate canonical URLs open the existing prospect.
3. Choose **Research & draft outreach**. Work runs on the persistent backend, and the open panel polls only while a selected job is active. Leaving the page does not cancel the job.
4. Read the source, its date, each quoted passage and the suggested opportunity. The model has only page text and the approved profile: it cannot verify performance, broken forms, audience metrics, losses or commercial intent.
5. Edit and save the message, then approve that exact version. Editing clears approval. Send it yourself outside Voqro; **Record manual send** stores your report, channel, recipient and current time. Voqro sends nothing and does not claim provider-confirmed delivery.
6. Suggested follow-up dates appear 3 and 7 days after an outreach send. These are in-app date suggestions, not queued messages, delivered notifications or confirmed meetings. Recording a reply stops the introductory suggestions. An opt-out suppresses generation, sending records and promotion.
7. Record an actual reply to request a reply draft. A new reply invalidates older unsent drafts. Add a qualified prospect to the ordinary pipeline only after supplying a verified contact, opportunity and planning budget; no contact or budget is invented by AI.

There is no automatic business discovery/search API, mailbox sync, Instagram messaging, calendar booking or autonomous closing in this release. These remain later integrations. The feature does not require Claude or any new subscription.

## Model and allowance

The text adapter uses the existing Azure OpenAI resource/deployment and VM managed identity. It is separate from the media review response schema, uses no tools, accepts at most 24,000 serialized input characters and requests at most 1,400 output tokens. Parsed output must have a bounded summary, at most three findings with exact source quotations, and a message no longer than 80 words. Human-edited messages can be longer. The prompt version, deployment, model token usage and original output are retained with the job; original evidence and provider output are not silently rewritten when a draft is edited.

A fresh installation starts with a zero sales allowance until allocated by the owner or a reviewed deployment migration. Sales and media jobs now count toward the **same existing `AI_MONTHLY_LIMIT_CENTS` ceiling**. `AI_JOB_RESERVATION_CENTS` is reserved before enqueue, and a daily per-user ceiling of 20 sales jobs also applies. Sales allocation cannot increase the shared ceiling or drop below current-month sales reservations. A deployment allocation, if made, must be recorded in release notes.

Reservations are conservative estimates, not actual billing. Success retains its reservation; token usage is stored but is not misrepresented as invoiced cost. Research failure/cancellation before model work releases it. Errors or rejected responses after the model stage begins retain it as **Unknown**, with no automatic model retry. A new explicit generation is a separate billable attempt. Existing media campaign allowances still apply to media work.

## Persistence and permissions

`/api/sales-ai` is restricted to owner/manager roles; the service profile and allowance are owner-only. Workers recheck active membership, role, profile revision, opt-out and conversation revision before spending and before exposing a result. A queued job from a previous month cannot begin model work in the new month. Revoked access or changed context prevents stale drafts from appearing.

SQLite tables `sales_ai_settings`, `sales_ai_prospects`, `sales_ai_jobs`, `sales_ai_drafts` and `sales_ai_events` are created additively. Qualified prospects link to `leads` rather than creating a second sales pipeline. Queries return the latest 50 matching prospects and the last 10 jobs/drafts per detail screen; search finds older prospects. Explicit request keys make queue requests idempotent. One active job per prospect and a worker lease prevent duplicate claims. Stale model leases become Unknown rather than being replayed. Sent draft text is immutable and manual actions have an event history.

Backups include the private sales records. Restoring a snapshot holds unfinished model requests as Unknown and pre-model work as Failed with released reservations; it does not resume research or model work from the snapshot.

## Website retrieval boundaries

Automatic reading supports bounded public HTTPS HTML/plain text over IPv4. It rejects credentials, query strings, custom ports, IP-literal URLs, local names and non-public DNS answers, including Azure metadata/platform addresses. Every redirect is revalidated; at most three requests are attempted. The connection pins a validated IPv4 address while preserving the original Host and certificate validation, preventing DNS rebinding to private destinations. It sends no browser cookies, app credentials or authorization headers.

Responses are limited to 512 KB, text to 10,000 characters, DNS waits to three seconds and each HTTPS request to twelve seconds. Scripts, forms and other non-content sections are removed from HTML; no JavaScript executes. This is an HTML extract, not a rendered-site or speed audit. Redirect loops, inaccessible sites, large pages and JavaScript-only sites can require a pasted public excerpt, which is labelled as user supplied.

When an outbound HTTP proxy is configured, automatic reading fails closed because proxy DNS resolution cannot be pinned with this transport. It does not bypass a managed environment's proxy. Use pasted evidence there. Production website reading must be separately verified on the Azure VM before declaring that route operational.

Untrusted page content and replies are model input, not instructions to act. The model receives no database tool, sending capability, credentials or unrelated client records. Source quotation validation and human review remain necessary; neither guarantees every generated interpretation is correct.

## Verification

Backend tests cover URL/DNS/redirect protections, source extraction, sales-only access, owner allowance control, shared media/sales budgets, idempotency, draft revisions, manual-send provenance, opt-outs, interruption/recovery, permissions/conversation changes during work, model rejection and pipeline conversion. Azure adapter tests verify the text prompt boundary and request limits using fake transport.

Browser tests use real isolated accounts for prospect/settings/conversion/reply flows with production providers disabled. A separately labelled deterministic browser fixture exercises the generated draft presentation/edit/approval UI. These tests do not claim an end-to-end live customer outreach cycle or send any messages.
