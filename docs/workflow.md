# Workflow, knowledge and in-app reminders

`workflow.mjs` supplies real local workflow records, role-scoped exceptions and repeat-safe in-app reminders. `public/workflow.js` supplies four screens: Tasks, Brand knowledge, Inbox and Exceptions. It does not send external email, publish a post or change an approved brief automatically.

## Working flow

1. Open **Tasks & knowledge → Brand knowledge** as the owner, account manager or matching brand. Record tone/visual direction, product facts, approved claims, prohibited wording, disclosure requirements, notes and HTTPS reference links. Save a version; subsequent edits require the current base version ID and preserve all prior versions. History can be read individually. Reference links are not fetched automatically.
2. As owner or account manager, open **Tasks & knowledge → Tasks** and create a **Task** against a campaign. Set an assignee, due date, visibility and optional dependencies. Eligible assignees include the campaign's own brand users, assigned creators and agency staff. Only the owner can plan finance-only tasks.
3. The assignee or account team can move a task from Open to In progress to Done. All dependencies must be Done first. Cycles, cross-campaign dependencies and dependencies the assignee cannot read are rejected. Reopening work with completed dependents is rejected until the dependent work is reopened. Revision numbers prevent stale edits from overwriting newer changes.
4. Discuss the task in its detail view. Agency users may add internal comments; brands and creators receive only shared comments. Visibility is fixed when a task is created, so changing an audience cannot expose a private discussion's history. Create a new task to change its audience.
5. Open **Exceptions** for current, record-based blockers and **Inbox** for personal reminders. Mark notifications read or open their action. Resolved reminders remain in history and are labelled resolved.
6. The owner can change review delay, product receipt delay, rights warning and escalation thresholds under **Reminder rules**, or disable new reminders while keeping exception reporting available.

## Access rules

- Owner/account manager plan tasks; reviewers can read agency tasks and update tasks assigned to them. Brands see shared tasks in their own campaigns. Creators see only shared tasks assigned to their own user account.
- Finance-only tasks are visible only to the owner and finance roles. Finance users do not receive brand knowledge, creative tasks or agency review notes.
- Agency users can read brand knowledge; a brand can read its own library; a creator can read libraries for brands with which they have an assignment. The owner/account manager and corresponding brand may create knowledge versions. Creators and reviewers cannot edit the library.
- Invoice exceptions and their notifications are visible only to owner/finance and the invoice's own brand. Creator costs, agency margins and bank evidence are not included in workflow responses.
- Notifications belong to one user. Current role/tenant access is rechecked when reading historical notifications, so a changed membership cannot expose old internal notification text.

## Exceptions and reminder behaviour

The module derives exceptions from task deadlines, missing/revised drafts, latest review-stage age, failed processing jobs, recorded shipments awaiting receipt, recorded rights expiry, unverified publishing connections for scheduled packages and overdue issued invoices with positive recorded balances. Dates use UTC, matching the existing application. It does not infer delivery, payment, legal rights or live publishing from a missing response.

An assignment notification is created for an unfinished task's assignee. An overdue issue has a stable event key tied to its record/version/deadline and one notification per recipient. The owner's later escalation uses a separate event key. Repeated ticks do not add duplicates or reset read state. Resolved issues are marked resolved. Changing a due date/version can legitimately create a new issue. A muted rule leaves the existing inbox history untouched. The initial pilot implementation polls every minute and also refreshes reminders when workflow data is requested.

The default `connectionVerified` callback returns false. Production integration should inject a function that verifies the particular version's account connection, not simply whether a token variable exists. A disconnected-provider exception points to Connections and retains the existing manual-handoff path.

The reminder rule defaults are 48 hours for reviews, seven days for a pending product receipt, 14 days for rights expiry warning and 48 hours before owner escalation. These are editable operational thresholds, not contractual service levels. Status and discussions are stored durably in SQLite. No provider delivery guarantee is claimed.

## Integration contract

Instantiate after the existing delivery, operations and commerce modules, because exceptions read their tables:

```js
const workflow = createWorkflow({
  db, row, rows, run, id, now, transaction,
  requireThat, textField, send, body, delivery,
  // Optional: connectionVerified(versionId) -> boolean
});
// After authenticated user resolution:
if (await workflow.handler(req, res, path, user)) return;
// Start with the existing app lifecycle, except in isolated tests:
workflow.start();
// Stop on server close:
workflow.stop();
```

`workflow.canSeeNotification(user, notification)` checks recipient ownership and current role/tenant access for an optional delivery outbox. A sender must additionally skip resolved records and independently verify the recipient’s active production identity and email. This helper does not grant permission to send external messages.

The public module exports `workflowUI(ctx)` with `render(view)`, `action(value)`, `submit(form)` and `invalidate()`. It uses the existing UI helpers, `ctx.state()`, `ctx.view()` and `ctx.render()`. Wire views `workflow`, `knowledge`, `inbox`, `exceptions`, action prefix `wf-`, form prefix `wf-`, and static `/workflow.js`. Invalidate caches after navigation or account change. It uses existing CSS classes.

`tests/workflow.test.mjs` verifies knowledge version isolation/stale edits, task cycles and completion rules, role/comment/finance boundaries, reminder deduplication and resolution, read permissions, owner-only rules and scoped invoice exceptions. Provider callbacks and external message delivery remain separate integrations.
