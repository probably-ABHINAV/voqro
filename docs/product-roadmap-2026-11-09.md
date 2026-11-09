# Voqro: product and performance plan

Prepared 9 November 2026 (IST). Based on the live public website, desktop/mobile browser observations, source code at `bcb1a64`, deployment metadata, existing release documentation, and current official competitor/platform pages. [Audit evidence](research/voqro-audit-2026-11-09.json) includes the measured samples and source URLs.

## Recommendation

Position Voqro as **the agency that gives Indian consumer brands a clear path from creator brief to approved content, recorded payments and credible results**. Begin with a narrow segment such as emerging food, wellness or lifestyle brands running regional micro-creator campaigns. Treat this segment as a hypothesis to validate with Veda Munch and additional clients, not as established market demand.

Voqro remains one agency. Brands and creators receive their own scoped experiences; they do not become separate agencies or Clerk organizations. Verified-email signup stays open, and choosing Brand or Creator remains optional. Access to existing client records still requires the appropriate relationship or permission.

The first competitive advantage should be delivery quality: better briefs, fewer revision loops, clear responsibility, visible rights and payment status, and trustworthy campaign evidence. AI supports that workflow. AI chat, a large menu, or a newer framework alone will not establish an advantage against established competitors.

This is a proposed roadmap. No performance fixes, redesign or provider activation is claimed as deployed by this review.

## 1. What the audit established

### Measured public performance

| Observation | Result | Meaning |
| --- | --- | --- |
| Homepage HTTP time to first byte, five samples | Median 274 ms; range 81–820 ms | Variable response time; too few samples for a p95 or availability claim. |
| Frontend `/api/health`, five samples | Median 462 ms; range 411–874 ms | An inexpensive endpoint already includes meaningful network overhead. |
| Direct Azure health, five samples | Median 290 ms; range 280–821 ms | Proxy and direct paths differ. These samples do not isolate a cause. |
| Public catalogue API, five samples | Median 329 ms; range 301–418 ms | Data is fetched after the public page starts; client rendering adds another stage. |
| Fresh public homepage, desktop | 43 resource entries; approximately 0.54 MB JS transferred and 1.77 MB decoded JS | The public page loads substantial application/auth code for a small amount of content. Timing entries can omit opaque cross-origin sizes. |
| Desktop homepage LCP | 1.32 seconds in one run | This run does not support saying every public page is extremely slow. It does not measure the signed-in experience. |
| Simulated mobile homepage | Five long tasks, about 527 ms combined | Startup has work worth reducing on less powerful devices. |
| Simulated mobile login | CLS 0.113 in one run | Slightly above the good layout-stability target of 0.1; reserve stable space for the sign-in UI and retest. |

Measurements came from a cloud runner, not an Indian customer's device. The mobile run used a 390px viewport, configured network/CPU throttling, and a warm-cache navigation from homepage to login. It is not a Lighthouse score, field percentile, or measured authenticated-workspace result. INP was not measured. A real Indian Android session and authenticated request traces are still required.

### Confirmed implementation concerns

- `clerk-identity.mjs`: authenticated requests call Clerk's `getSession` and `getUser` remotely. They run in parallel with each other, but application work waits for them. This adds latency and provider availability dependence to frequent reads.
- `clerk-workspace-gate.tsx`: entry waits for Clerk readiness, identity configuration, a fresh token and session exchange before loading the workspace. Instrument this waterfall before changing it.
- `workspace-app.tsx`: major sales, delivery, work and extension screens are statically imported into one client entry. Use measured bundle analysis and lazy boundaries.
- `server.mjs`: `/api/workspace` assembles broad collections and makes per-campaign, per-proposal and per-deliverable queries. It has no resource pagination. Small data works, but this shape will age poorly.
- `lib/api.ts`: every request opts out of caching; there is no shared read cache or request deduplication at this layer. Keep private HTTP responses uncacheable by shared infrastructure, while introducing carefully scoped in-memory client caching.
- Deployment inspection places frontend functions in `iad1`; the backend is in Central India. Test a nearby function region such as Mumbai. External rewrite routing must also be measured; changing function region alone does not prove every request path improves.
- The public page renders no approved creator profiles. The visible copy is broad, with illustrations and an empty discovery section rather than concrete work and outcomes. Do not publish private Veda Munch or creator materials without approval.
- The owner navigation exposes roughly 23 destinations. New users who skip profile selection reach a valid but low-value welcome page. These are product clarity problems even when the server is fast.

Existing automated tests establish important workflow and permission behavior. They do not establish usability, fast real-world interactions, product-market fit or successful live provider integrations.

## 2. Competitive baseline and differentiation

These are advertised capabilities on official pages, not independently verified vendor performance or proof that competitors lack our proposed features.

| Reference | Advertised strength | What Voqro should learn |
| --- | --- | --- |
| [Modash](https://www.modash.io/) | Discovery, creator management, tracking, payments, Shopify gifting/affiliate workflows, AI search and MCP | Connect the campaign lifecycle. Do not compete initially on the size of a global creator database. |
| [GRIN](https://grin.co/) | Creator CRM, marketplace, affiliate/gifting/paid programs, payment wallet and Gia AI assistance | A generic AI assistant is already a baseline feature. Assistance must act on useful, permissioned workflow data. |
| [Aspire](https://www.aspire.io/) | Creator relationships, commerce, gifting, automation and partnership advertising | Link content work to business results and long-term creator relationships. |
| [CreatorIQ](https://www.creatoriq.com/) | Enterprise measurement, governance, brand safety and integrations | Every important number needs source, date, scope and permissions. Build evidence quality before enterprise breadth. |
| [Qoruz](https://qoruz.com/) | Discovery filters, outreach, influencer intelligence and campaign tracking | Local creator relevance and useful planning matter. Start with a smaller, trusted network and accurate data. |
| [Frame.io](https://frame.io/) | Precise feedback, version review, transcripts and controlled sharing | Build a review experience people enjoy using, rather than another status form. |

### Three product bets to validate

**A. Regional creator planning with human accountability.** Build a consented creator roster with language, location, content style, availability, agreed rates and dated evidence. Generate a shortlist with clear inclusion/exclusion reasons and estimated commercial impact. Existing matching snapshots are a foundation; richer records and usable explanations are the next step. Reliability indicators must be based on actual work, be contestable, and avoid unsupported accusations of fraud.

**B. An approval studio that protects delivery and margin.** Put the brief, current asset, timestamped comments, version comparison, required changes, included revision count, deadline and usage rights on one screen. Brand reviewers should understand the decision without navigating agency administration. Connect extra revision requests to a change-order proposal rather than silently absorbing costs.

**C. A campaign evidence record.** Connect each approved version to the agreement, publishing evidence, measured results and recorded settlement. Label facts as provider-verified, participant-reported, estimated or unknown. Show the brand what happened; show the owner what the campaign earned after costs. Do not present coupon/link attribution as proof that a campaign caused incremental sales.

These are hypotheses for a defensible advantage through repeat execution and first-party relationship history. A claim that they are unique in the market would require further research and customer validation.

## 3. Product experience to build

| User | Primary destination | Core actions |
| --- | --- | --- |
| Visitor | Concrete services, approved work and creator examples | Submit a brief; apply as a creator; understand how Voqro works. |
| Signed-in user without a profile | Useful personal home | Save a brief draft, explore public opportunities, choose a profile later. No agency data exposed. |
| Brand | Campaign progress and decisions awaiting the brand | Submit a brief, review shortlist/proposal, approve or request changes, see invoices and reports. |
| Creator | My work, feedback and earnings | Maintain profile, view assignments, upload/resume drafts, address comments, understand payout status. |
| Owner/team | Today, campaigns, creators, clients and finance | Resolve blockers, plan capacity, review margins, oversee delivery and relationships. |

Reduce primary navigation to five to seven items by role. Move provider setup and technical diagnostics into settings. Make the campaign the shared unit of work: brief → shortlist → agreement → production → review → publication → settlement → report. Keep optional stages explicit; manual evidence remains available where integrations are not yet connected.

The visual direction should use Voqro's existing identity with clearer hierarchy, consistent controls, denser useful work views and real approved imagery. Add keyboard access, visible focus, proper error messages, empty-state next actions and mobile layouts. Do not equate polish with animation or a total rewrite.

## 4. Delivery roadmap

Indicative **8–12 weeks for an initial differentiated pilot**, assuming one focused product/engineering workstream, timely owner decisions and available provider access. Estimates are planning ranges, not a promise of unattended work or guaranteed dates. Some phases overlap; app reviews, domain decisions and participant availability can extend the schedule.

| Phase | Indicative effort | Deliverables | Acceptance gate |
| --- | --- | --- | --- |
| 0. Baseline and speed | 3–5 working days | Request timings, real-user performance instrumentation, auth waterfall trace, bundle analysis, lazy screens, query/request reductions and stable login layout | Before/after evidence on the same Indian mobile/desktop test journeys; unchanged authorization and revocation tests. |
| 1. Professional journeys | 1–2 weeks | Role-specific navigation, action-oriented home screens, optional onboarding with useful next steps, stronger public proposition and approved portfolio | Five representative users complete their main tasks without developer assistance; keyboard/mobile checks pass. |
| 2. One complete campaign loop | 2–3 weeks | Guided brief, shortlist/proposal, creator assignment, resumable upload, timestamped review, version comparison, change requests, rights and commercial status | A real brand and creator complete a campaign workflow without duplicate entry into spreadsheets; audit history and isolation verified. |
| 3. Connected measurement and commerce | 2–3 weeks, access-dependent | Instagram connection/refresh/webhooks/insights, selected signing and payment integrations, verified event processing, reconciliation and report presentation | Duplicate/out-of-order events tested; one deliberately authorized live flow for each configured provider; missing connections stay honestly labelled. |
| 4. Useful AI and campaign learning | 1–2 weeks after adequate records | Grounded brief assistance, explainable creator recommendations, draft review against brand requirements, evidence-linked report drafts | Evaluate against a labelled set of 20–30 representative cases; show sources/unknowns; budget limits and human approval for external actions. |
| 5. Pilot and hardening | 1–2 weeks, overlapping later phases | Three-brand pilot target, monitoring and recovery exercises, accessibility/performance checks, pricing/cost review and repeat-campaign interviews | Real participants confirm value, data reconciles, recovery works, and launch-critical issues are resolved. |

A provider delay must not block speed, usability, review tooling or reporting improvements. Build and test the integration contract while waiting, then keep live verification explicitly pending.

## 5. First ten working days: executable backlog

| Order | Work item | Concrete result / verification |
| --- | --- | --- |
| 1 | Measure authenticated journeys and API stages | Record sign-in-to-workspace and campaign/review navigation; separate provider, query and network time without logging tokens or business content. |
| 2 | Remove repeated auth round trips safely | Use Clerk SDK validation of short-lived signed sessions where appropriate; preserve issuer/audience/expiry checks, local permission checks and immediate local revocation. Document any remote revocation window; test forged/expired/revoked tokens, email changes and provider failure before rollout. |
| 3 | Split frontend feature bundles | Load finance, reports, optimization and review modules when needed. Compare bundle/network traces; keep loading and failure states usable. |
| 4 | Serve smaller, purpose-specific reads | Replace blanket reloads with summary/list/detail APIs and cursor pagination. Batch related queries; add indexes based on query plans. Keep existing permission scoping. |
| 5 | Add scoped client cache and targeted invalidation | Deduplicate reads; reset cached state on logout and permission changes. Never share private data between users. Use optimistic updates only for reversible actions, with rollback. |
| 6 | Measure and correct geographical routing | Compare India traffic before/after region configuration; retain canonical origin and auth constraints. Avoid broad infrastructure changes without measured benefit. |
| 7 | Improve public rendering and login stability | Render safe public content earlier; assess whether the full Clerk UI is needed on the marketing page; use fixed layout space and appropriate media sizing. Public caching must exclude identity/private fields. |
| 8 | Replace the menu with role-focused workspaces | Owner sees blockers and campaign progress; brand sees decisions; creator sees tasks and feedback. Keep optional Brand/Creator onboarding. |
| 9 | Build one excellent campaign detail view | Brief, people, deadlines, files, approvals, money and activity linked in a clear hierarchy; no fabricated completion statuses. |
| 10 | Publish approved proof and run acceptance sessions | Prepare a Veda Munch case-study draft from verified records, obtain permission for public assets/claims, and test with representative users. Do not fill the empty directory with invented profiles or metrics. |

Change one measurable bottleneck at a time, run relevant regressions and compare before/after. No big-bang rewrite.

## 6. Quality and business targets

Performance targets follow [Core Web Vitals](https://web.dev/articles/vitals): **LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 at the 75th percentile**, segmented by mobile/desktop and public/authenticated routes. Enough real observations are needed before declaring compliance. Lab checks catch regressions while field data accumulates.

Additional initial engineering budgets, to refine after the baseline:

- Cached workspace navigation to useful content: p95 under one second on the agreed Indian mobile test profile.
- Ordinary authenticated reads: p95 under 500ms end-to-end from the agreed India probe, excluding uploads and AI jobs. Track server processing separately.
- Reduce public startup JavaScript transfer by at least 30% from the measured baseline, without breaking Clerk sign-in. Treat this as an optimization target to validate, not guaranteed savings.
- Video upload survives a lost connection and resumes; users can see progress and retry safely.
- No regression in cross-brand access, duplicate payments/webhooks, session revocation or immutable approval history.
- Use WCAG 2.2 AA as the accessibility target, supported by automated and manual keyboard/screen-reader checks; passing a scanner alone is insufficient.

Product hypotheses for the pilot: a brief can be completed in under ten minutes; approval turnaround improves by at least 30% versus each pilot's recorded baseline; at least 90% of agreed deliverables are on time; recorded settlements reconcile exactly; every displayed metric has provenance or is explicitly unknown. These targets require baseline measurement and are not current achievements.

Track activation separately for brands and creators, brief-to-approved-plan time, revision rounds, time awaiting decisions, on-time delivery, agency gross margin, creator payment delay and repeat campaign booking. Pilot goal: three real brands, 10–20 participating creators and at least five campaign cycles, with at least two brands choosing a follow-on campaign. This is a recruitment/validation target, not existing traction or statistical proof.

## 7. Architecture, cost and hosting decisions

Keep **Next.js + React + Tailwind, Express/Node and Clerk**. They are capable of supporting this product. The immediate problem is request design, data loading and workflow quality rather than the absence of a newer stack.

Keep SQLite for the measured small single-instance workload while fixing queries and backup acceptance. Introduce versioned schema migrations now. Move to managed PostgreSQL when concurrent write load, multiple app instances, operational requirements or measured contention justify it; prove the migration with backfill checks, a restore drill, a cutover plan and rollback. Do not describe a database migration as an automatic speed improvement.

Keep long-running video and AI processing outside request handlers. Separate worker resources as media workload grows. Move large originals/derived media to private object storage with scoped delivery and appropriate caching; evaluate the working Azure environment before provisioning a second cloud. Keep connection secrets server-side, verify provider webhooks, and make external operations idempotent.

**Current hosting issue:** the connected Vercel team reports `hobby`. [Vercel's Hobby terms](https://vercel.com/docs/plans/hobby) restrict it to personal, non-commercial use. A commercial agency launch requires an appropriate Vercel plan or a host whose terms permit that use. No billing change has been made.

| Choice | Recommendation |
| --- | --- |
| Stay on Vercel | Obtain current pricing for an eligible commercial plan, confirm included usage and controls, then decide. The Student Pack review found no Vercel Pro entitlement. |
| Remain credit-funded | Evaluate hosting the Next.js server on Azure under the existing student subscription, subject to applicable terms, available credit and capacity. This needs capacity/load testing and a planned URL/auth migration; it is not automatically free or equally resilient. |
| More observability tools | Prefer one error tracker and one suitable infrastructure/uptime system. Redeem relevant Student Pack offers against existing accounts; do not enable overlapping paid add-ons. |
| New paid creator databases | Defer until the small owned roster no longer meets client demand and unit economics justify a license. |

Check actual remaining Azure credit and current compute/storage/AI usage before setting a spending forecast. The original $100 grant is not a current balance. Define billing alerts and a monthly resource budget before adding services; user growth, uploads and AI create variable costs. Student benefits are temporary and may have commercial-use or seat limits. Prioritize Clerk Pro, Sentry, appropriate infrastructure monitoring and mobile QA over collecting every subscription.

## 8. Dependencies and explicit non-goals

Instagram still needs a professional account, an approved app/permission path and secure authorization. [Current Meta documentation](https://developers.facebook.com/documentation/instagram-platform) describes newer login options alongside Facebook Login. Review the appropriate flow against the current adapter and required features before forcing a Facebook Page or implementing a migration. Available metrics and permissions must be verified for the actual app/account.

Signing and payments need selected providers, eligibility, live credentials and an authorized real test. India payment availability matters; no provider selection or fee-free processing is implied by student credits. Financial/tax fields should be checked against the business's actual invoicing obligations before claiming compliance. Production transactional email requires a sending provider; Testmail only supplies test inboxes.

Defer a global creator database, multiple social networks, automated mass outreach, proprietary model training, a separate native mobile app, full ERP/accounting, and multi-agency SaaS tenancy until real customer needs justify them. An effective mobile web experience comes first. Keep human approval for publication, contract dispatch, payment initiation and other consequential external actions.

## 9. Release process and next decision

For each phase: record a baseline → build the smallest complete journey → test permissions and failure handling → test with representative users → deploy with rollback → compare results. Add performance checks and a commercial-provider staging environment to existing CI. GitHub checks currently report results but do not gate Vercel's independent deployment; make that a deliberate release policy before scaling usage.

The next implementation release should be **performance and role-specific navigation**, followed by a usable campaign review studio. Prove the approach on Veda Munch's real work, then recruit further pilot brands. Evaluate packaging and pricing from measured agency delivery cost and customer willingness to pay before launching standalone software subscriptions.

## Addition: AI client acquisition team

The uploaded four-employee guide can become a bounded Lead Hunter → Auditor → Writer → Closer workflow inside the enquiry pipeline. Start with owner-supplied URLs and reviewed drafts using the existing Azure OpenAI deployment; add licensed discovery and reply integrations in later steps. This complements the campaign product and does not replace performance work. See the [AI client team plan](ai-client-team-plan.md) for model selection, data flow, costs and acceptance criteria.

## Sources and review boundaries

Reviewed official pages: [Modash](https://www.modash.io/), [GRIN](https://grin.co/), [Aspire](https://www.aspire.io/), [CreatorIQ](https://www.creatoriq.com/), [Qoruz](https://qoruz.com/), [Frame.io](https://frame.io/), [Core Web Vitals](https://web.dev/articles/vitals), [Next.js lazy loading](https://nextjs.org/docs/app/guides/lazy-loading), [Vercel regions](https://vercel.com/docs/functions/configuring-functions/region), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Clerk session tokens](https://clerk.com/docs/guides/sessions/session-tokens), and [Meta Instagram platform](https://developers.facebook.com/documentation/instagram-platform). The previously researched [Student Pack plan](student-benefits.md) informs tooling choices.

This is a targeted review of relevant available sources, not an exhaustive scan of the internet or hands-on verification of competitors' paid products. The One Impression URL attempted returned 404 and was excluded. No authenticated production account was used in the browser measurements, and no real campaign, subscription or provider account was modified.
