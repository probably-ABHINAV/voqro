# Reports, agreements and milestones

`reporting.mjs` adds durable commercial reporting to the existing campaign, delivery and operational ledger. `public/reporting.js` supplies the **Reports & agreements** workspace. No email, payment transfer, certified signature or third-party analytics request occurs through this module.

## Campaign report workflow

1. An owner, account manager or finance user selects **Create report**, chooses a campaign and records shared lessons and next steps.
2. The server snapshots the campaign goals, deliverable status and current approvals, latest recorded post observations, tracking references, issued invoices, recorded costs, settlements and milestone state in one database transaction. A stable request key prevents duplicate creation on retry. A new report always receives a new campaign version; existing payloads cannot be edited.
3. Review the draft internally, then choose **Share snapshot**. The brand and assigned creators can access only shared reports. Sharing is repeat-safe and does not send email.
4. Later metrics, payment receipts, revisions or new briefs do not rewrite an old report. Create a new report version when evidence changes.

Each post retains its recorded live-post and metric source. The report uses the latest dated metric snapshot available at creation. Missing metrics remain `null` / **Unknown**. Reach remains a per-post observation; it is never summed into unique people. Tracking links and codes do not imply measured visits, conversions, attribution or causal lift.

A provider-verified label requires a matching `instagram_jobs` record in `Verified` state with the exact deliverable, content version and permalink. Connected insights additionally require `instagram_metric_syncs` linking that verified job to the exact metric snapshot. A user-entered source description cannot grant verification. The original source string remains available as evidence. If the provider tables are absent or the proof does not match, the observation is labelled unverified.

Approval summaries check the snapshot's current brief and latest revision decision. Historical approval rows do not make a changed brief or a package under revision appear approved.

## Permissions and financial interpretation

| Role | Report contents |
| --- | --- |
| Owner / finance | Campaign evidence, issued invoices, recorded costs and reconciliation |
| Account manager / reviewer | Campaign evidence; no internal financial block |
| Matching brand | Shared campaign evidence and its issued invoice records; no creator fees, costs, margins or internal notes |
| Assigned creator | Shared report filtered to their own deliverables, post observations and linked tracking references; no campaign budget or financial block |

The report stores a private financial snapshot but filters it on every API read and download. Invoice receipts and cost payouts include reversal entries. Voided invoices do not contribute to invoiced totals. Contribution equals issued invoice subtotal excluding tax minus recorded accrued costs, including unpaid costs. Cash movement equals recorded receipts minus recorded payouts. Neither is statutory profit. The campaign budget remains a plan; catalogue fees and unrecorded expenses are not substituted for actuals. Settlements are manual records rather than bank verification.

Shared lessons and next steps are intentionally visible to the campaign's brand and creators. The editor labels these fields accordingly. Do not enter private negotiations or other creators' confidential terms into shared narrative fields.

## Downloads

- **Download report** creates a standalone HTML document with its source coverage, delivery, per-post observations, role-appropriate reconciliation, tracking references and narrative.
- **Export CSV** flattens the same role-scoped snapshot. Text beginning with spreadsheet formula prefixes is neutralised, and all cells are quoted. Numeric money stays integer paise with the currency/unit metadata included.
- **Download invoice** produces an operational invoice HTML document for owner/finance or the invoice's brand once issued. It includes immutable line items, rounded line taxes and current recorded receipts. Draft invoices remain private to finance. No internal settlement notes appear in the export.

Downloads require the same authenticated role checks as their JSON counterparts, are served as attachments with private/no-store headers, and escape all user text. HTML exports carry a restrictive document CSP. Invoice exports explicitly require accountant review for GST/TDS, registration, place of supply and other statutory requirements; they are not certified tax documents.

## Agreement register

Owners, managers and finance users create an agreement for the campaign's brand or a specific assigned creator. An agreement version records its terms, document reference, optional user-supplied SHA-256, acknowledgement expiry and author. The document is not fetched or verified; recording a checksum does not certify the referenced contents.

Revisions keep the campaign, title and parties, require the latest base version and create an immutable version. Stable request keys prevent duplicate versions on retry. The agency owner and named brand or creator can acknowledge the latest unexpired version. Each party has one acknowledgement per version; retry returns the existing record. Old acknowledgements remain historical and do not approve a new version. Acknowledgement through demonstration identities is not a certified electronic signature or independent proof of legal identity.

Brands cannot see creator agreement records. Creators can see only agreements naming them. Managers can administer agreements but do not gain access to the private financial report or ledger APIs.

## Payment milestone plans

Owner/finance can record a receivable or payable plan with an amount in integer paise and a due date. Creator payables must reference an assigned creator. Plans are labelled **Planned** and do not count as revenue, expense, receipts or payouts.

Finance links a plan to one matching invoice or cost after recording that obligation. Campaign, amount and creator must match. A record can be linked to only one milestone, and a linked milestone cannot be reassigned. Outstanding balances and settlement state come from the underlying ledger; the plan does not execute payments. A milestone's planned due date remains separate from the linked invoice/cost's legal due date. Brand views include receivable plans, while creator views include only their own payable plans. Unissued invoice IDs remain private in external milestone views.

## Integration contract

```js
const reporting = createReporting({
  db, row, rows, run, id, now, transaction, requireThat, textField, send, body
});
// After normal authentication and existing delivery/commerce schema creation:
if (await reporting.handler(req, res, path, user)) return;
```

The UI factory exposes `render`, `action`, `submit` and `invalidate`. Use view `reporting`, actions and form IDs prefixed `report-`, and serve `/reporting.js`. Give the UI the existing common helpers plus `state`, `view` and `render` getters/callbacks. Invalidate its role-scoped cache when navigating or switching identity.

Key routes:

- `GET /api/reporting`: scoped index of report versions, agreements, milestones, tracking and downloadable invoice records.
- `POST /api/reporting/reports`, `/share`: create and explicitly share immutable snapshots.
- `GET /api/reporting/reports/:id`, `/download/html`, `/download/csv`: scoped read/export.
- `GET /api/reporting/invoices/:id/print`: protected operational invoice export.
- `POST /api/reporting/tracking`: validated HTTPS reference and campaign-unique code.
- `POST /api/reporting/agreements`, `/agreements/accept`: versioned terms and party acknowledgement.
- `POST /api/reporting/milestones`, `/milestones/link`: payment plan and exact ledger linkage.

`tests/reporting.test.mjs` exercises real HTTP handlers against an isolated SQLite schema: snapshot immutability, paise reconciliation, role filtering, draft sharing, HTML/CSV safety, protected invoice exports, agreement retries/stale versions/parties, milestone linkage and overcount prevention, tracking scope and current-brief approval invalidation.

Provider-backed signing, bank reconciliation, certified statutory invoices, TDS, refund execution and credit-note accounting remain separate integrations. The module deliberately keeps current operational balances and observed results intact rather than inventing completion of those external workflows.
