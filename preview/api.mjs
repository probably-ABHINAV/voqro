// Browser-only sample state. These role checks demonstrate the product; they are
// not authentication, and this module must never handle production data.
const VERSION = 1;
const STORAGE_KEY = 'voqro.preview.v1';
const MAX_BYTES = 2_000_000;
const MAX_RECORDS = 1500;
const TABLES = ['brands', 'creators', 'campaigns', 'assignments', 'deliverables', 'proposals', 'activities', 'leads', 'shortlists', 'tasks'];
const ROLES = ['owner', 'manager', 'reviewer', 'finance', 'brand', 'creator'];
const clone = value => JSON.parse(JSON.stringify(value));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const requireThat = (condition, status, message) => { if (!condition) fail(status, message); };
const staff = user => ['owner', 'manager', 'reviewer', 'finance'].includes(user.role);
const agency = user => ['owner', 'manager', 'reviewer'].includes(user.role);
const sales = user => ['owner', 'manager'].includes(user.role);
const financial = user => ['owner', 'finance'].includes(user.role);
const unavailable = () => fail(501, 'This action needs the connected application. In this preview, you can explore sample records, enquiries, proposals, shortlists and tasks. No live service was contacted.');

function safeTree(value, maximumBytes = MAX_BYTES) {
  const encoded = JSON.stringify(value);
  requireThat(typeof encoded === 'string' && encoded.length <= maximumBytes, 413, 'This preview has reached its storage limit. Reset the preview to start again.');
  let nodes = 0;
  const visit = (entry, depth) => {
    requireThat(++nodes <= 100000 && depth <= 24, 400, 'Invalid preview data.');
    if (typeof entry === 'string') requireThat(entry.length <= 30000, 400, 'Preview text is too long.');
    if (typeof entry === 'number') requireThat(Number.isFinite(entry), 400, 'Invalid preview number.');
    if (entry && typeof entry === 'object') {
      requireThat(Array.isArray(entry) || Object.getPrototypeOf(entry) === Object.prototype || Object.getPrototypeOf(entry) === null, 400, 'Invalid preview record.');
      for (const [key, child] of Object.entries(entry)) {
        requireThat(!['__proto__', 'prototype', 'constructor'].includes(key), 400, 'Invalid preview key.');
        visit(child, depth + 1);
      }
    } else requireThat(entry === null || ['string', 'number', 'boolean'].includes(typeof entry), 400, 'Invalid preview value.');
  };
  visit(value, 0);
  return encoded;
}

function text(value, label, maximum = 5000, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.length <= maximum, 400, `${label} is required (maximum ${maximum} characters).`);
  return value.trim();
}
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

function shiftDates(value, days, key = '') {
  if (Array.isArray(value)) return value.map(item => shiftDates(item, days));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, shiftDates(item, days, name)]));
  if (typeof value === 'string' && /^(?:created|updated|expires|start|end|start_date|end_date|due_date|due_on|follow_up|observed_on|generated_at|captured_at|as_of|published_at|window_start|window_end|completed_at|read_at|since|shared_at)$/.test(key) && /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/.test(value) && Number.isFinite(Date.parse(value))) {
    const shifted = new Date(Date.parse(value) + days * 86400000).toISOString();
    return value.length === 10 ? shifted.slice(0, 10) : shifted;
  }
  return value;
}

export function createPreviewAPI({fixtures, storage, now = () => Date.now()} = {}) {
  requireThat(fixtures && Array.isArray(fixtures.users) && fixtures.users.length > 0 && fixtures.workspaces && fixtures.responses && fixtures.public, 400, 'Preview fixtures are unavailable.');
  safeTree(fixtures, 8_000_000);
  const timestamp = () => {
    const supplied = now();
    const result = supplied instanceof Date ? supplied.getTime() : typeof supplied === 'string' ? Date.parse(supplied) : supplied;
    requireThat(Number.isFinite(result), 500, 'Preview time is unavailable.');
    return result;
  };
  const iso = () => new Date(timestamp()).toISOString();
  const today = () => iso().slice(0, 10);
  const users = clone(fixtures.users);
  requireThat(users.every(user => typeof user.id === 'string' && ROLES.includes(user.role)) && new Set(users.map(user => user.id)).size === users.length, 400, 'Invalid sample personas.');
  const owner = users.find(user => user.role === 'owner');
  requireThat(owner && fixtures.workspaces[owner.id], 400, 'The sample owner workspace is missing.');
  const fixtureDate = String(fixtures.generated_at || '2026-11-06').slice(0, 10);
  const delta = validDate(fixtureDate) ? Math.round((Date.parse(today()) - Date.parse(fixtureDate)) / 86400000) : 0;
  let baseline = shiftDates(clone(fixtures), delta);
  let persistent = !!storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function' && typeof storage.removeItem === 'function';
  let recoveryNotice = '';
  let sequence = 0;
  const uid = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.().replaceAll('-', '') || `${timestamp().toString(36)}${(++sequence).toString(36)}${Math.random().toString(36).slice(2)}`}`;
  const seed = () => {
    const workspace = baseline.workspaces[owner.id];
    const result = {version: VERSION, fixture_version: fixtures.schema_version || 1, user_id: null, initialized_at: iso(), notification_reads: []};
    for (const table of TABLES) result[table] = clone(workspace[table] || []);
    result.tasks = [];
    for (const user of users) for (const task of baseline.responses[user.id]?.workflow?.tasks || []) {
      const existing = result.tasks.find(item => item.id === task.id);
      if (!existing) result.tasks.push({...clone(task), dependencies: (task.dependencies || []).map(item => typeof item === 'string' ? item : item.id), comments: clone(task.comments || []), history: clone(task.history || [])});
      else for (const comment of task.comments || []) if (!existing.comments.some(item => item.id === comment.id)) existing.comments.push(clone(comment));
    }
    return result;
  };
  function validateState(candidate) {
    safeTree(candidate);
    requireThat(candidate.version === VERSION && candidate.fixture_version === (fixtures.schema_version || 1) && (candidate.user_id === null || users.some(user => user.id === candidate.user_id)), 400, 'The saved preview is incompatible.');
    requireThat(validDate(String(candidate.initialized_at || '').slice(0, 10)) && Array.isArray(candidate.notification_reads) && candidate.notification_reads.length <= 5000 && candidate.notification_reads.every(value => typeof value === 'string' && value.length <= 250), 400, 'Invalid saved preview.');
    for (const table of TABLES) {
      requireThat(Array.isArray(candidate[table]) && candidate[table].length <= MAX_RECORDS, 413, 'The preview record limit is reached. Reset the preview to start again.');
      requireThat(candidate[table].every(record => record && typeof record === 'object' && !Array.isArray(record)), 400, 'Invalid saved preview records.');
      if (table !== 'shortlists') requireThat(candidate[table].every(record => typeof record.id === 'string' && /^[\w-]{1,120}$/.test(record.id)) && new Set(candidate[table].map(record => record.id)).size === candidate[table].length, 400, 'Invalid saved preview identifiers.');
    }
    const has = (table, id) => candidate[table].some(record => record.id === id);
    requireThat(candidate.brands.every(item => typeof item.name === 'string') && candidate.creators.every(item => typeof item.name === 'string'), 400, 'Invalid sample names.');
    const amount = value => Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000_000;
    const optionalDate = value => value === null || value === undefined || validDate(value);
    requireThat(candidate.campaigns.every(item => has('brands', item.brand_id) && typeof item.name === 'string' && typeof item.status === 'string' && amount(item.budget) && optionalDate(item.start_date) && optionalDate(item.end_date)) && candidate.assignments.every(item => has('campaigns', item.campaign_id) && has('creators', item.creator_id)) && candidate.deliverables.every(item => has('assignments', item.assignment_id) && typeof item.title === 'string' && typeof item.status === 'string' && typeof item.owner === 'string' && optionalDate(item.due_date)), 400, 'Invalid preview campaign relationships.');
    requireThat(candidate.proposals.every(item => has('brands', item.brand_id) && typeof item.title === 'string' && ['Sent', 'Accepted'].includes(item.status) && Array.isArray(item.versions) && item.versions.length > 0 && item.versions.length <= 100 && item.versions.every(version => version && typeof version.id === 'string' && Number.isInteger(version.version) && version.version > 0 && amount(version.total) && version.payload && Array.isArray(version.payload.items) && version.payload.items.length > 0 && version.payload.items.length <= 30 && version.payload.items.every(line => line && typeof line.label === 'string' && Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 100 && amount(line.unit_price) && (!line.creator_id || has('creators', line.creator_id))) && typeof version.payload.terms === 'string' && typeof version.payload.rights === 'string' && validDate(version.payload.expires))), 400, 'Invalid saved proposal.');
    requireThat(candidate.shortlists.every(item => has('brands', item.brand_id) && has('creators', item.creator_id)), 400, 'Invalid saved shortlist.');
    requireThat(candidate.leads.every(item => ['name', 'email', 'company', 'brief', 'stage', 'created'].every(key => typeof item[key] === 'string') && amount(item.budget) && optionalDate(item.follow_up)), 400, 'Invalid saved enquiry.');
    requireThat(candidate.activities.every(item => typeof item.actor === 'string' && typeof item.message === 'string' && typeof item.created === 'string'), 400, 'Invalid saved activity.');
    requireThat(candidate.tasks.every(item => has('campaigns', item.campaign_id) && users.some(user => user.id === item.owner_id) && typeof item.title === 'string' && Number.isInteger(item.revision) && item.revision > 0 && validDate(item.due_on) && ['Open', 'In progress', 'Done'].includes(item.status) && ['shared', 'agency', 'finance'].includes(item.visibility) && Array.isArray(item.dependencies) && item.dependencies.every(id => has('tasks', id)) && Array.isArray(item.comments) && item.comments.every(comment => comment && typeof comment.message === 'string' && typeof comment.author_name === 'string' && ['agency', 'shared'].includes(comment.visibility)) && Array.isArray(item.history) && item.history.every(event => event && typeof event.action === 'string' && typeof event.actor_name === 'string' && event.payload && typeof event.payload === 'object')), 400, 'Invalid saved task.');
    return candidate;
  }
  let state = seed();
  if (persistent) {
    try {
      const saved = storage.getItem(STORAGE_KEY);
      if (saved) {
        requireThat(saved.length <= MAX_BYTES, 413, 'Saved preview is too large.');
        state = validateState(JSON.parse(saved));
        // Keep static fixtures aligned with the date of this browser's sample state.
        const savedDelta = Math.round((Date.parse(state.initialized_at.slice(0, 10)) - Date.parse(fixtureDate)) / 86400000);
        if (Number.isFinite(savedDelta)) baseline = shiftDates(clone(fixtures), savedDelta);
      }
    } catch (error) {
      state = seed();
      recoveryNotice = 'Saved preview data could not be read. A fresh sample workspace was opened.';
      try { storage.removeItem(STORAGE_KEY); } catch { persistent = false; }
    }
  }
  function persist() {
    if (!persistent) return;
    try { storage.setItem(STORAGE_KEY, safeTree(state)); }
    catch { persistent = false; recoveryNotice = 'Browser storage is unavailable. Changes last only while this page stays open.'; }
  }
  function currentUser() {
    const user = users.find(item => item.id === state.user_id);
    requireThat(user, 401, 'Choose a sample workspace to continue.');
    return user;
  }
  const campaign = id => {
    const record = state.campaigns.find(item => item.id === id);
    requireThat(record, 404, 'Campaign not found.');
    return record;
  };
  const campaignVisible = (user, record) => !!record && (staff(user) || user.role === 'brand' && record.brand_id === user.brand_id || user.role === 'creator' && state.assignments.some(item => item.campaign_id === record.id && item.creator_id === user.creator_id));
  function deliveryCampaign(user, id) {
    const record = campaign(id);
    requireThat(user.role !== 'finance' && campaignVisible(user, record), 403, 'This campaign is outside your delivery workspace.');
    return record;
  }
  function assignmentVisible(user, assignment) { return campaignVisible(user, state.campaigns.find(item => item.id === assignment.campaign_id)) && (user.role !== 'creator' || assignment.creator_id === user.creator_id); }
  function activity(brandId, user, message) { state.activities.unshift({id: uid('act'), brand_id: brandId, actor: user.name, message, created: iso()}); }
  function workspace(user) {
    const result = clone(baseline.workspaces[user.id] || {});
    const campaigns = state.campaigns.filter(item => campaignVisible(user, item));
    const assignments = state.assignments.filter(item => assignmentVisible(user, item));
    const ids = new Set(assignments.map(item => item.id));
    const brandIds = new Set(campaigns.map(item => item.brand_id));
    result.user = clone(user);
    result.demo = true;
    result.preview = true;
    result.brands = clone(state.brands.filter(item => staff(user) || user.role === 'brand' && item.id === user.brand_id || user.role === 'creator' && brandIds.has(item.id)));
    result.creators = clone(state.creators).map(({fee, visibility, ...item}) => item);
    result.campaigns = clone(campaigns).map(item => { if (user.role === 'creator') { delete item.budget; delete item.proposal_id; delete item.accepted_version_id; } return item; });
    result.assignments = clone(assignments);
    result.deliverables = clone(state.deliverables.filter(item => ids.has(item.assignment_id)));
    result.proposals = clone(state.proposals.filter(item => staff(user) || user.role === 'brand' && item.brand_id === user.brand_id));
    result.activities = clone(state.activities.filter(item => staff(user) || user.role === 'brand' && item.brand_id === user.brand_id).slice(0, 20));
    result.leads = sales(user) ? clone(state.leads) : [];
    result.shortlists = clone(state.shortlists.filter(item => staff(user) || user.role === 'brand' && item.brand_id === user.brand_id));
    if (financial(user)) result.finance = {...clone(result.finance || {}), campaign_budgets: campaigns.reduce((sum, item) => sum + (item.budget || 0), 0), currency: 'INR', invoices_connected: false};
    else result.finance = null;
    return result;
  }
  function taskVisible(user, task) {
    return !!task && (task.visibility === 'finance' ? financial(user) : task.visibility === 'agency' ? agency(user) : campaignVisible(user, state.campaigns.find(item => item.id === task.campaign_id)) && (user.role !== 'creator' || task.owner_id === user.id));
  }
  function getTask(user, id) {
    const result = state.tasks.find(item => item.id === id);
    requireThat(result, 404, 'Task not found.');
    requireThat(taskVisible(user, result), 403, 'This task is outside your sample workspace.');
    return result;
  }
  function taskView(user, task) {
    return {...clone(task), owner_name: users.find(item => item.id === task.owner_id)?.name || 'Sample user', dependencies: task.dependencies.map(id => {
      const dependency = state.tasks.find(item => item.id === id);
      return taskVisible(user, dependency) ? {id, title: dependency.title, status: dependency.status} : {id, title: 'Restricted dependency', status: dependency?.status === 'Done' ? 'Done' : 'Incomplete'};
    }), comments: clone(task.comments.filter(item => item.visibility !== 'agency' || agency(user)))};
  }
  function workflow(user) {
    const view = clone(baseline.responses[user.id]?.workflow || {});
    const ws = workspace(user);
    const tasks = state.tasks.filter(item => taskVisible(user, item));
    view.campaigns = ws.campaigns;
    view.brands = ws.brands;
    view.tasks = tasks.map(item => taskView(user, item));
    view.knowledge ||= ws.brands.map(item => ({brand_id: item.id, brand_name: item.name, latest: null}));
    view.assignees = sales(user) ? ws.campaigns.map(item => ({campaign_id: item.id, users: clone(users.filter(person => campaignVisible(person, item)))})) : [];
    view.notifications = (view.notifications || []).map(item => ({...item, read_at: state.notification_reads.includes(`${user.id}:${item.id}`) ? item.read_at || iso() : item.read_at}));
    view.exceptions = (view.exceptions || []).filter(item => item.kind !== 'task');
    for (const task of tasks.filter(item => item.status !== 'Done' && item.due_on < today())) view.exceptions.push({key: `task:${task.id}`, kind: 'task', title: `Overdue task: ${task.title}`, detail: `Assigned to ${users.find(person => person.id === task.owner_id)?.name}. Due ${task.due_on}.`, action: `wf-task:${task.id}`, severity: 'warning', since: task.due_on + 'T00:00:00.000Z'});
    view.capabilities = {manage_tasks: sales(user), edit_knowledge: false, manage_rules: false};
    view.notification_channel = 'Sample in-app notifications. No external email or messages are sent.';
    view.rules ||= null;
    return view;
  }
  function get(path, user) {
    if (path === 'workspace') return workspace(user);
    if (path === 'workflow') return workflow(user);
    const taskMatch = /^workflow\/tasks\/([\w-]+)$/.exec(path);
    if (taskMatch) return taskView(user, getTask(user, taskMatch[1]));
    const campaignMatch = /^delivery\/campaign\/([\w-]+)$/.exec(path);
    if (campaignMatch) {
      const record = deliveryCampaign(user, campaignMatch[1]);
      const assignments = state.assignments.filter(item => item.campaign_id === record.id && assignmentVisible(user, item));
      const assignmentIds = new Set(assignments.map(item => item.id));
      const sample = clone(baseline.responses[user.id]?.[path] || {});
      return {...sample, brief: sample.brief || null, brief_history: sample.brief_history || [], rights: sample.rights || null, shipments: (sample.shipments || []).filter(item => assignmentIds.has(item.assignment_id)), assignments: clone(assignments), deliverables: clone(state.deliverables.filter(item => assignmentIds.has(item.assignment_id)))};
    }
    const deliverableMatch = /^delivery\/deliverable\/([\w-]+)$/.exec(path);
    if (deliverableMatch) {
      const record = state.deliverables.find(item => item.id === deliverableMatch[1]);
      requireThat(record, 404, 'Deliverable not found.');
      const assignment = state.assignments.find(item => item.id === record.assignment_id);
      const camp = deliveryCampaign(user, assignment.campaign_id);
      requireThat(assignmentVisible(user, assignment), 403, 'This is another creator’s assignment.');
      const sample = clone(baseline.responses[user.id]?.[path] || {});
      return {...sample, deliverable: {...clone(record), campaign_id: camp.id, brand_id: camp.brand_id, creator_id: assignment.creator_id}, brief: sample.brief || null, versions: sample.versions || [], handoff: sample.handoff || {ready: false, version_id: null, reasons: ['This sample assignment has no approved content package.'], mode: 'Preview only; publishing is not connected.'}};
    }
    if (own(baseline.responses[user.id], path)) return clone(baseline.responses[user.id][path]);
    const knownError = baseline.errors?.[user.id]?.[path];
    if (knownError) fail(knownError.status || 403, knownError.error || 'This view is outside your sample workspace.');
    unavailable();
  }
  function mutate(path, body, user) {
    if (path === 'shortlist') {
      requireThat(sales(user) || user.role === 'brand', 403, 'Only the brand and sales team can edit shortlists.');
      requireThat(staff(user) || user.brand_id === body.brand_id, 403, 'This brand is outside your sample workspace.');
      requireThat(state.brands.some(item => item.id === body.brand_id) && state.creators.some(item => item.id === body.creator_id), 404, 'Brand or creator not found.');
      const existing = state.shortlists.findIndex(item => item.brand_id === body.brand_id && item.creator_id === body.creator_id);
      if (body.remove && existing >= 0) state.shortlists.splice(existing, 1);
      if (!body.remove && existing < 0) state.shortlists.push({brand_id: body.brand_id, creator_id: body.creator_id});
      return {ok: true};
    }
    if (path === 'leads/update') {
      requireThat(sales(user), 403, 'Sales access required.');
      const lead = state.leads.find(item => item.id === body.id);
      requireThat(lead, 404, 'Enquiry not found.');
      requireThat(['Enquiry', 'Qualified', 'Discovery', 'Negotiation', 'Lost'].includes(body.stage), 400, 'Choose an enquiry stage. Sharing or accepting a proposal sets Proposal and Won.');
      lead.stage = body.stage;
      return {ok: true};
    }
    if (path === 'proposals') {
      requireThat(sales(user), 403, 'Sales access required.');
      const lead = body.lead_id ? state.leads.find(item => item.id === body.lead_id) : null;
      requireThat(!body.lead_id || lead, 404, 'Enquiry not found.');
      const title = text(body.title, 'Proposal title', 180);
      requireThat(Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 30, 400, 'Add between 1 and 30 line items.');
      const items = body.items.map(item => {
        requireThat(item && typeof item === 'object', 400, 'Invalid line item.');
        const label = text(item.label, 'Line item', 200), quantity = Number(item.quantity), unit_price = Number(item.unit_price);
        requireThat(Number.isInteger(quantity) && quantity > 0 && quantity <= 100 && Number.isSafeInteger(unit_price) && unit_price > 0 && unit_price <= 1_000_000_000, 400, 'Line items need positive quantities and prices.');
        requireThat(!item.creator_id || state.creators.some(creator => creator.id === item.creator_id), 400, 'Unknown creator.');
        return {label, quantity, unit_price, creator_id: item.creator_id || null};
      });
      requireThat(validDate(body.expires) && body.expires >= today(), 400, 'Choose a future expiry date.');
      const payload = {title, items, terms: text(body.terms, 'Payment terms', 2000), rights: text(body.rights, 'Usage rights', 2000), expires: body.expires};
      const total = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
      requireThat(Number.isSafeInteger(total) && total <= 10_000_000_000, 400, 'Proposal total is too large.');
      let brandId = body.brand_id || lead?.brand_id;
      if (lead?.brand_id) requireThat(brandId === lead.brand_id, 400, 'Use the brand associated with this enquiry.');
      if (!brandId && lead) {
        brandId = uid('brand');
        state.brands.push({id: brandId, name: lead.company, industry: 'New sample partner', color: '#c5b5a0'});
        lead.brand_id = brandId;
      }
      requireThat(state.brands.some(item => item.id === brandId), 400, 'Choose a brand or enquiry.');
      if (lead && !lead.brand_id) lead.brand_id = brandId;
      let proposal = body.proposal_id ? state.proposals.find(item => item.id === body.proposal_id) : null;
      requireThat(!body.proposal_id || proposal?.brand_id === brandId, 404, 'Proposal not found.');
      requireThat(proposal?.status !== 'Accepted', 409, 'Accepted proposals cannot be changed.');
      if (!proposal) { proposal = {id: uid('proposal'), brand_id: brandId, lead_id: lead?.id || null, title, status: 'Sent', created: iso(), versions: []}; state.proposals.push(proposal); }
      const version = (proposal.versions[0]?.version || 0) + 1;
      proposal.title = title;
      proposal.status = 'Sent';
      proposal.versions.unshift({id: uid('pv'), proposal_id: proposal.id, version, payload, total, created: iso()});
      if (lead) lead.stage = 'Proposal';
      activity(brandId, user, `Shared sample version ${version} of ${title}`);
      return {id: proposal.id, version, preview_notice: users.some(person => person.role === 'brand' && person.brand_id === brandId) ? 'Switch to the matching sample brand to accept.' : 'This new sample brand has no selectable persona. Use Olive & Earth or Northstar to try brand acceptance.'};
    }
    if (path === 'proposals/accept') {
      requireThat(user.role === 'brand', 403, 'The brand must accept its own proposal.');
      const proposal = state.proposals.find(item => item.id === body.id);
      requireThat(proposal, 404, 'Proposal not found.');
      requireThat(proposal.brand_id === user.brand_id, 403, 'This proposal belongs to another brand.');
      const existing = state.campaigns.find(item => item.proposal_id === proposal.id);
      if (existing) return {campaign_id: existing.id, already_accepted: true};
      const version = proposal.versions[0];
      requireThat(version?.id === body.version_id, 409, 'A newer proposal is available. Refresh before accepting.');
      requireThat(version.payload.expires >= today(), 409, 'This sample proposal has expired. Ask the sample account manager for a new version.');
      const id = uid('campaign');
      state.campaigns.push({id, brand_id: proposal.brand_id, proposal_id: proposal.id, accepted_version_id: version.id, name: version.payload.title || proposal.title, budget: version.total, status: 'Planning', start_date: today(), end_date: null, description: 'Sample campaign created from the accepted proposal. No agreement, payment or external message was sent.'});
      for (const item of version.payload.items.filter(item => item.creator_id)) {
        let assignment = state.assignments.find(record => record.campaign_id === id && record.creator_id === item.creator_id);
        if (!assignment) { assignment = {id: uid('assignment'), campaign_id: id, creator_id: item.creator_id}; state.assignments.push(assignment); }
        for (let index = 0; index < item.quantity; index++) state.deliverables.push({id: uid('deliverable'), assignment_id: assignment.id, title: item.label + (item.quantity > 1 ? ` · ${index + 1}` : ''), due_date: null, status: 'Brief needed', owner: state.creators.find(creator => creator.id === item.creator_id).name, publishing_account: 'Not assigned'});
      }
      proposal.status = 'Accepted';
      const lead = state.leads.find(item => item.id === proposal.lead_id);
      if (lead) lead.stage = 'Won';
      activity(proposal.brand_id, user, `Accepted sample ${proposal.title} · version ${version.version}`);
      return {campaign_id: id};
    }
    if (path === 'workflow/tasks') {
      requireThat(sales(user), 403, 'Only the sample owner or account manager can plan tasks.');
      const camp = campaign(body.campaign_id), existing = body.id ? getTask(user, body.id) : null;
      requireThat(!existing || existing.campaign_id === camp.id, 400, 'A task cannot move between campaigns.');
      requireThat(!existing || existing.visibility === body.visibility, 409, 'Task visibility is fixed to preserve discussion privacy.');
      requireThat(!existing || Number.isInteger(body.revision) && body.revision === existing.revision, 409, 'The task changed. Reload before saving.');
      requireThat(['shared', 'agency', 'finance'].includes(body.visibility), 400, 'Choose a valid task visibility.');
      requireThat(body.visibility !== 'finance' || user.role === 'owner', 403, 'Only the owner can manage finance tasks.');
      const assignee = users.find(person => person.id === body.owner_id);
      requireThat(assignee && campaignVisible(assignee, camp), 400, 'Choose an assignee with access to this campaign.');
      requireThat(validDate(body.due_on), 400, 'Choose a valid task due date.');
      const next = {...existing, id: existing?.id || uid('task'), campaign_id: camp.id, owner_id: assignee.id, title: text(body.title, 'Task title', 200), description: text(body.description, 'Task description', 4000, true), due_on: body.due_on, visibility: body.visibility, status: existing?.status || 'Open', revision: (existing?.revision || 0) + 1, completed_at: existing?.completed_at || null, created_by: existing?.created_by || user.id, created: existing?.created || iso(), updated: iso(), comments: existing?.comments || [], history: existing?.history || [], dependencies: body.dependencies || []};
      requireThat(taskVisible(assignee, next), 400, 'The assignee cannot access this task visibility.');
      requireThat(Array.isArray(next.dependencies) && next.dependencies.length <= 30 && new Set(next.dependencies).size === next.dependencies.length && next.dependencies.every(id => typeof id === 'string'), 400, 'Choose up to 30 distinct dependencies.');
      for (const id of next.dependencies) {
        const dependency = state.tasks.find(item => item.id === id);
        requireThat(dependency && dependency.campaign_id === camp.id && taskVisible(assignee, dependency) && (next.visibility !== 'shared' || dependency.visibility === 'shared'), 400, 'Dependencies must be in this campaign and visible to the assignee.');
        const reaches = (target, visited = new Set()) => { if (target === next.id) return true; if (visited.has(target)) return false; visited.add(target); return (state.tasks.find(item => item.id === target)?.dependencies || []).some(item => reaches(item, visited)); };
        requireThat(!reaches(id), 409, 'These dependencies would create a cycle.');
        requireThat(next.status !== 'Done' || dependency.status === 'Done', 409, 'A completed task cannot depend on incomplete work.');
      }
      if (existing) for (const dependent of state.tasks.filter(item => item.dependencies.includes(existing.id))) requireThat(taskVisible(users.find(person => person.id === dependent.owner_id), next), 409, 'Changing this assignee would hide a prerequisite.');
      next.history.push({actor_name: user.name, action: existing ? 'updated' : 'created', payload: {title: next.title}, created: iso()});
      if (existing) state.tasks[state.tasks.indexOf(existing)] = next; else state.tasks.push(next);
      return taskView(user, next);
    }
    if (path === 'workflow/tasks/status') {
      const task = getTask(user, body.id);
      requireThat(sales(user) || task.owner_id === user.id, 403, 'Only the assignee or account team can update task progress.');
      requireThat(body.revision === task.revision, 409, 'The task changed. Reload before updating.');
      requireThat(['Open', 'In progress', 'Done'].includes(body.status), 400, 'Invalid task status.');
      if (body.status === 'Done') requireThat(task.dependencies.every(id => state.tasks.find(item => item.id === id)?.status === 'Done'), 409, 'Complete all dependencies before this task.');
      if (task.status === 'Done' && body.status !== 'Done') requireThat(!state.tasks.some(item => item.dependencies.includes(task.id) && item.status === 'Done'), 409, 'Reopen completed dependent tasks first.');
      if (body.status !== task.status) {
        task.history.push({actor_name: user.name, action: 'status_changed', payload: {from: task.status, to: body.status}, created: iso()});
        task.status = body.status; task.revision++; task.updated = iso(); task.completed_at = body.status === 'Done' ? iso() : null;
      }
      return taskView(user, task);
    }
    if (path === 'workflow/tasks/comment') {
      const task = getTask(user, body.id), visibility = body.visibility || 'shared';
      requireThat(['shared', 'agency'].includes(visibility) && (visibility !== 'agency' || agency(user)), 403, 'Agency notes require agency access.');
      task.comments.push({id: uid('comment'), task_id: task.id, author_id: user.id, author_name: user.name, message: text(body.message, 'Comment', 4000), visibility, created: iso()});
      return {ok: true};
    }
    if (path === 'workflow/notifications/read') {
      const records = baseline.responses[user.id]?.workflow?.notifications || [];
      requireThat(body.all === true || records.some(item => item.id === body.id), 404, 'Notification not found.');
      for (const record of records.filter(item => body.all === true || item.id === body.id)) {
        const key = `${user.id}:${record.id}`;
        if (!state.notification_reads.includes(key)) state.notification_reads.push(key);
      }
      return {ok: true};
    }
    unavailable();
  }
  async function request(path, body) {
    requireThat(typeof path === 'string' && path.length <= 300 && /^[\w/-]+$/.test(path), 400, 'Invalid preview route.');
    path = path.replace(/^\/?api\//, '').replace(/^\//, '');
    const mutation = body !== undefined && body !== null;
    if (mutation) { requireThat(body && typeof body === 'object' && !Array.isArray(body), 400, 'Send a preview record.'); safeTree(body, 100000); body = clone(body); }
    if (path === 'public' && !mutation) return {...clone(baseline.public), demo: true, preview: true, identity: {...clone(baseline.public.identity || {}), available: false, status: 'Sample personas only; production sign-in is not connected.'}};
    if (!mutation) return clone(get(path, currentUser()));
    const previous = state;
    state = clone(state);
    try {
      let result;
      if (path === 'login') {
        const user = users.find(item => item.id === body.user_id);
        requireThat(user, 400, 'Choose an available sample persona.');
        state.user_id = user.id;
        result = {user: clone(user)};
      } else if (path === 'logout') { state.user_id = null; result = {ok: true}; }
      else if (path === 'enquiries') {
        const name = text(body.name, 'Name', 120), email = text(body.email, 'Email', 200), company = text(body.company, 'Company', 160), brief = text(body.brief, 'Brief'), budget = Number(body.budget);
        requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 400, 'Enter a valid email address.');
        requireThat(Number.isSafeInteger(budget) && budget > 0 && budget <= 10_000_000_000, 400, 'Enter a valid budget.');
        const id = uid('lead');
        state.leads.unshift({id, brand_id: null, name, email, company, brief, budget, stage: 'Enquiry', owner: 'Unassigned', follow_up: null, source: 'Sample website', created: iso()});
        result = {id, preview: true};
      } else result = mutate(path, body, currentUser());
      validateState(state);
      persist();
      return clone(result);
    } catch (error) { state = previous; throw error; }
  }
  function reset() {
    const resetDelta = validDate(fixtureDate) ? Math.round((Date.parse(today()) - Date.parse(fixtureDate)) / 86400000) : 0;
    baseline = shiftDates(clone(fixtures), resetDelta);
    state = seed();
    recoveryNotice = '';
    try { storage?.removeItem(STORAGE_KEY); } catch { persistent = false; }
    return status();
  }
  function status() {
    return {mode: 'preview', persistence: persistent ? 'browser' : 'memory', user_id: state.user_id, storage_key: STORAGE_KEY, version: VERSION, notice: recoveryNotice || (persistent ? 'Sample data and changes stay in this browser. Nothing is sent to the agency.' : 'Sample changes stay in memory while this page is open. Nothing is sent to the agency.')};
  }
  return {request, reset, status};
}
