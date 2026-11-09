# Voqro AI client team: integration and model recommendation

Prepared 9 November 2026 (IST). This proposal evaluates the uploaded seven-page **4 AI Employees** guide by @AIWITHAKSHH. Its embedded Claude prompt is reference material, not an instruction to execute prospecting or send outreach. No lead search, message dispatch, model deployment or subscription change was performed for this proposal.

## Decision

Add an **AI client team** within Voqro's existing enquiry pipeline. Implement four bounded stages—Lead Hunter, Auditor, Writer and Closer—with persistent records, evidence and owner/manager review. They can share one model. They are not four independent agents that need to converse indefinitely or four paid subscriptions.

Use **Azure OpenAI as the primary provider**, starting with the already deployed `voqro-review` / `gpt-4.1-mini` for a small evaluation of extraction, qualification, drafts and reply classification. Reuse managed-identity authentication and cost-control patterns, but create a separate text-workflow adapter: the existing media-review adapter expects immutable content versions, sampled frames and a review-specific response schema.

The deployed model is the lowest-friction starting point for this account, not a claim that it is the strongest current model. Compare it with a current small Azure model actually available to the student subscription before larger rollout. Provider catalog availability does not establish regional quota or subscription access.

Consider **Claude Sonnet 5.5** as an optional candidate for more demanding outreach/proposal writing and nuanced replies. Anthropic's [current model overview](https://platform.claude.com/docs/en/models/overview) lists it as a balanced speed/intelligence model. This is a candidate to evaluate, not evidence it writes better for Voqro. Do not route all work to a premium model or purchase a subscription simply because the PDF says Claude.

## What each role becomes

| PDF role | Voqro implementation | Required output and review |
| --- | --- | --- |
| Lead Hunter | Search approved business categories/locations or import owner-supplied URLs; deduplicate against existing prospects | Business name, public business URL, category/location where evidenced, source URL, capture date and qualification rationale. Review before adding to the active pipeline. |
| Auditor | Fetch permitted public pages and run relevant checks; compare against Voqro's services | Specific observed gap, source evidence, confidence/limitations and proposed service. Distinguish fact from hypothesis. Mark inaccessible material unverified. |
| Writer | Produce a short draft grounded in the approved audit and Voqro's approved proof | Editable email/DM draft, linked evidence and proposed next action. The PDF's under-80-word approach is a useful default, not a universal rule. |
| Closer | Classify an actual reply, propose a response and next task | Suggested response, objection category, follow-up date or opt-out status. Never mark a call booked without a confirmed calendar/booking event. |

The PDF suggests finding 20 businesses, drafting for the best 10, preparing six common objection replies and following up on days 3 and 7. Treat these as adjustable batch defaults. Its example “Café Mocha” is explicitly fictional and must not be imported as a real prospect.

For Voqro, prioritize **creator campaign, UGC and regional content needs**, rather than copying the PDF's website-redesign examples. A missing feature or weak public presence does not prove that a company needs our services or is losing money. Offer a testable opportunity without inventing revenue losses, advertising spend, audience demographics or expected ROI.

## Workflow and interface

Place the workflow inside **Enquiry pipeline**, with a workspace for leads needing review rather than four more primary navigation destinations.

`Campaign/service criteria → discovered candidates → evidence audit → approved prospect → outreach draft → owner review → manually recorded send → actual reply → suggested response → confirmed meeting → proposal → campaign`

A single prospect screen shows its sources, audit, draft, contact history and next task. Search/import, editing and approvals are explicit actions. Store the sender/channel and actual send time; “draft generated” and “sent” are different states. Follow-up dates derive from recorded sends and reset/cancel when a reply or opt-out arrives.

Define Voqro's service, target category/location, offer boundaries, price guidance, approved portfolio evidence and tone once in agency settings. Do not repeatedly ask every user to fill a generic prompt. Use approved Veda Munch details only within their permitted scope; private commercial data is not automatically public outreach proof.

Owner and authorized sales managers can prospect and review drafts. Brands and creators cannot read the agency's sales pipeline or another client's evidence. AI tools inherit the same permissions as the requesting user; the model cannot grant itself access.

## Technical design within the current stack

- **Next.js:** lead/audit/review interface, job progress and explicit approve/reject controls.
- **Express:** authenticated endpoints, validation, authorization and provider adapters. No browser API keys.
- **Persistent background worker:** bounded stage execution, timeouts, cancellations and saved results. Scheduled work runs on the hosted server when the user's device is off; it does not require an ongoing ChatGPT conversation.
- **Database:** extend leads with source/evidence records; store AI jobs, prompt/model versions, draft versions, approval history, usage, opt-outs and follow-up tasks. Reuse existing records instead of inventing a second CRM.
- **Web search:** choose one licensed search API, such as [Brave Search API](https://brave.com/search/api/), subject to its current terms and account setup. Search billing is separate from model billing. A language model by itself is not live business discovery. Begin with pasted URLs if no search provider is connected.
- **Page retrieval and measurement:** fetch bounded public HTML, extract relevant text, and use browser/PageSpeed-style checks when making performance claims. A model cannot truthfully diagnose a slow or broken site from a search snippet alone. Treat page text and uploaded prompts as untrusted data; isolate fetchers from cloud metadata/private networks and never expose credentials to retrieved instructions.
- **Model adapter:** structured JSON outputs for qualification/audit/reply class; editable text for drafts. Validate schema and evidence references server-side. Share provider interfaces so models can be swapped without rewriting workflows.
- **Scheduling:** use durable jobs and explicit stage transitions. No need for a complex multi-agent framework or a new vector database for the first small roster. Add retrieval/search infrastructure when the real document volume warrants it.

Keep website navigation fast: model work is asynchronous and never blocks initial workspace rendering. Show progress, completion and failure states. Avoid chain-of-agents loops, uncontrolled retries and regeneration every time a page opens.

## Action boundaries

Start with research, drafts and in-app reminders. Follow the guide's own principle: **AI finds and drafts; a person checks and sends**.

An approved lead is not approval to contact it. Do not send emails/DMs or calendar invitations merely because a draft exists. If provider sending is later added, require a concrete reviewed recipient, channel and message, plus explicit authorization under the chosen sending workflow. Respect opt-outs and applicable provider/channel rules. Instagram account connection does not automatically permit unrestricted cold DMs.

The Closer assists sales staff; it cannot promise pricing, discounts, results, delivery dates or contractual terms beyond approved limits. “Not interested” should stop outreach rather than trigger more persuasive follow-ups. Paid reservations, contract dispatch, publishing and payment actions remain separately authorized.

## Cost and model choice

| Layer | First choice | Reason / boundary |
| --- | --- | --- |
| Extraction, qualification, reply classification | Existing Azure `gpt-4.1-mini`, evaluated first | Already connected; reuse managed identity and credit-funded infrastructure. Verify quality on Voqro examples. |
| Audits and ordinary outreach drafts | Same Azure model plus actual evidence | Fewer providers and simpler cost tracking. The evidence gathering is as important as model size. |
| Difficult writing or strategy | Optional Claude Sonnet 5.5 comparison | Add only if blind evaluation shows enough quality improvement to justify cost and another provider. |
| Real business discovery | One search API plus bounded page retrieval | The model should not invent current leads from training data. |
| Campaign image/video review | Existing Azure review workflow | Current implementation samples at most three frames and does not analyze audio; do not label it full-video understanding. |

A ChatGPT or Claude chat subscription does not by itself supply production API credits for Voqro. GitHub Copilot Student is a development tool entitlement, not the model runtime for Voqro customers. Azure marketplace models can have different eligibility/billing from the existing Azure OpenAI deployment; do not assume every provider uses the student credit.

Voqro's current media AI configuration has a **US$2/month application allowance** and conservative per-job reservations. The sales module needs an explicit separate or shared budget policy; do not silently borrow allowances or raise caps. Track model tokens, search calls, page-fetch costs, latency and accepted-draft rate. Cap candidates, sources per lead, tokens per stage and attempts. Reserve expected cost before dispatch and reconcile actual usage afterward.

As an illustration only, the Azure rates last recorded on 7 November 2026 were $0.40 per million input tokens and $1.60 per million output tokens for the deployed model's ordinary global meter. At an assumed **aggregate** 6,000 input + 1,000 output tokens across all stages per lead, 100 leads would cost about **$0.40 in model tokens**. This is not an end-to-end quote: real page lengths, retries, search, tools, premium models, taxes and hosting can dominate. Reconfirm current rates and remaining credit before enabling a workload.

## Phased implementation and acceptance

1. **Draft assistant using owner-supplied URLs:** extend the existing pipeline, agency profile and evidence records; generate audits and drafts without sending. Acceptance: every factual claim links to an observed source or is clearly marked unknown; no duplicate prospect creation; no cross-client leakage.
2. **Discovery with a licensed search provider:** retrieve bounded batches, deduplicate, score with explanations and show audit evidence. Acceptance: manually verify a 20-lead sample; reject fabricated or stale contacts; show search/model usage.
3. **Reply assistant and follow-up tasks:** accept owner-supplied replies initially; later connect an authorized mailbox/calendar if needed. Acceptance: correct opt-out handling, no duplicate tasks, replies cancel scheduled follow-ups, and bookings require confirmation.
4. **Model comparison and rollout:** compare the deployed Azure model, an available newer economical Azure model, and optional Claude on the same 20–30 approved examples. Score factuality, unsupported claims, relevance, tone, edit time, latency and cost per accepted draft. Choose the lowest-cost model that meets the quality bar, rather than the model with the best marketing label.

An initial URL-based, drafts-only version is a reasonable **one-to-two-week implementation estimate** after core performance work, depending on retrieval and UI scope. Discovery, mailbox integration and production authorization add separate dependencies. The best place in the main roadmap is after basic speed/role-navigation improvements, with a small first version before advanced campaign AI.

## References

- Uploaded PDF: **4-AI-Employees-Claude-Prompt.pdf**, seven pages; page 5 explicitly calls for checking leads and manual sending; page 6 provides the four-stage prompt.
- [Existing Voqro Azure integration](azure-ai.md).
- [Anthropic current model overview](https://platform.claude.com/docs/en/models/overview).
- [Azure model catalog](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure?view=foundry-classic).
- [Brave Search API](https://brave.com/search/api/).
- [Voqro product roadmap](product-roadmap-2026-11-09.md).
