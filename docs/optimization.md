# Matching and measured experiments

The **Matching & experiments** workspace is private to the owner and account managers. Every optimization endpoint enforces that permission; reviewers, finance users, brands and creators cannot retrieve private fees, fit assessments, reliability or experiment records.

## Creator matching

1. Select a campaign and enter hard requirements: recorded location, listed language, niche, availability and maximum reference fee per creator. Location and niche use a case-insensitive text match; language matches an entry in the recorded comma-separated language list. Catalogue fees are reference prices, not negotiated agreements.
2. Choose weights for audience fit, content style, budget, reliability and historical results. Weights are nonnegative, need not total 100, and at least one must be positive.
3. Save the matching run. The system stores an immutable snapshot of requirements, weights, scores and supporting evidence. It retains eligible and excluded candidates with explicit exclusion reasons.
4. Add a selection or exclusion with a reason. This is a recorded team decision; it does not create an assignment. Selection cannot bypass a hard filter, and current availability/fee requirements are rechecked. Changed requirements need a new run.

Audience and style scores come from dated, campaign-specific human assessments with an HTTPS evidence reference, observation and limitations. These references are not fetched automatically. Latest evidence is selected by observation date, then insertion order; the UI shows the source date so stale evidence remains visible.

Budget scores measure unused room under the per-creator fee ceiling, not creative quality. Reliability uses the on-time first-draft rate only when at least three deadlines are assessable. Results use relative ranks of historical median views among eligible creators with comparable classified post history. A results rank requires at least two comparable creators and five distinct posts per creator.

The displayed score is the weighted supported points divided by all requested weights. Missing dimensions contribute no supported points. The separate evidence coverage percentage is essential: a low supported score can mean insufficient evidence, not a poor creator. The system does not invent an audience fit, reliability score, viral prediction, or unique audience estimate.

## Reliability and corrections

The system reads actual deliverables, content versions and review events. It reports first submission, current recorded due date, historical brand approval, revision requests and median revision-response time. A first draft is on time if its UTC date is on or before the recorded due date. A past-due deliverable without a draft counts as late; a future deliverable without a draft is not scored. Historical brand approval is separate from current approval/publishing readiness.

An owner/manager can exclude a deliverable with a reason, then reinstate it with another recorded reason. Original deliverables and content are not edited by this correction. All corrections remain in `optimization_reliability_corrections`; the most recent correction determines inclusion. Deadline edits elsewhere change the recorded input and should be assessed in their campaign context. The system does not pretend to know an original deadline that was never snapshotted.

## Historical references

Classify a recorded metric snapshot as **Sponsored** or **Organic**, with evidence for the classification. These are team classifications; they do not verify the metric values.

Historical references use a selected metric at 24, 48, 72 or 168 hours after publication, allowing ±10% age tolerance (at least one hour). The nearest eligible snapshot per post is used; additional snapshots of the same post cannot inflate the sample. Up to 30 most recent distinct posts are included, with the original evidence source and capture time retained. Sponsored and organic posts never mix.

At least five posts are required before showing a median and observed minimum/maximum. Less history returns **Insufficient comparable history** with unknown values. An observed range is neither a future prediction interval nor a guarantee. Reach remains a per-post measure; it is not summed as unique audience.

## Registered experiments

A design records the campaign, hypothesis, baseline, treatment, metric, content category, observation age, minimum posts per arm (5–100) and target relative lift. The design cannot be edited after registration.

Register each deliverable in **Baseline** or **Treatment** before recording its publication. The arm cannot subsequently change. Observations link to existing `metric_snapshots` and require:

- A registered deliverable from the experiment's campaign.
- Publication after both design and arm registration.
- The registered sponsored/organic category.
- A capture age inside the registered tolerance, no future timestamp, and a known metric value.
- One observation per post and per registered deliverable. Identical retries return the existing observation; another snapshot for the same post is rejected.

Once used in an experiment, a snapshot cannot be reclassified. The observation stores the original value, source and capture timestamp. The database does not accept freely entered experimental result numbers.

Before both arms meet the registered minimum, comparison returns **Insufficient data**. Thereafter it shows observed means, difference, relative lift where the baseline is positive, and a 95% percentile bootstrap interval for the mean difference using 1,000 deterministic resamples. The interval is compared with the registered relative-lift target converted to baseline units. Results are labelled **Observed target met**, **Observed target not met**, or **Inconclusive**. A zero baseline returns **Cannot assess relative target** because percentage lift is undefined.

This is a descriptive pilot comparison. Team-selected arms are not randomisation; campaign differences, selection bias, repeated inspection and manual-data errors can explain apparent uplift. Bootstrap intervals are unstable with small samples and constant values. Meeting a target is not proof of causality, general superiority or future performance. Production Release 5 completion still requires actual comparable campaign outcomes against an agreed baseline; test fixtures do not provide that evidence.

## Integration

Backend:

```js
import {createOptimization} from './optimization.mjs';
const optimization=createOptimization({db,row,rows,run,id,now,transaction,requireThat,textField,send,body});
// After authentication and before the catch-all route:
if(await optimization.handler(req,res,path,u))return;
```

Initialize after the delivery/operations schemas. The module adds only `optimization_*` tables. It reads existing creators, campaigns, deliverables, versions, reviews, posts and metric snapshots, and has no background worker or external network calls.

Frontend:

```js
import {optimizationUI} from './optimization.js';
const opt=optimizationUI({api,esc,icon,tag,btn,heading,openModal,closeModal,toast,
  state:()=>state,view:()=>view,render});
```

Serve `/optimization.js`. Owner/manager navigation uses view `optimization`; render it with `opt.render()`. Delegate `opt-` actions to `opt.action(a)` and `opt-` form IDs to `opt.submit(form)`. Call `opt.invalidate()` on navigation/account changes; request generation and principal checks prevent a late response displaying another account's data.

Tests: `node --disable-warning=ExperimentalWarning --test tests/optimization.test.mjs`. The isolated SQLite/API fixture covers hard filters, access privacy, missing evidence, weights, audited reliability corrections, pre-publication registration, immutable arms, real snapshot linkage, duplicate observations, classification locking, comparable historical samples and insufficient-data handling. Measured uplifts in the tests are explicitly synthetic fixtures.
