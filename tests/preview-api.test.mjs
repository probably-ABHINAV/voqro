import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPreviewAPI} from '../preview/api.mjs';

const time = () => Date.parse('2026-11-06T12:00:00.000Z');
function storage() {
  const records = new Map();
  return {records, getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key)};
}
function fixture() {
  const users = [
    {id: 'u_owner', name: 'Abhinav', role: 'owner', brand_id: null, creator_id: null},
    {id: 'u_manager', name: 'Naina', role: 'manager', brand_id: null, creator_id: null},
    {id: 'u_reviewer', name: 'Dev', role: 'reviewer', brand_id: null, creator_id: null},
    {id: 'u_finance', name: 'Sam', role: 'finance', brand_id: null, creator_id: null},
    {id: 'u_brand', name: 'Priya', role: 'brand', brand_id: 'b_olive', creator_id: null},
    {id: 'u_other', name: 'Alex', role: 'brand', brand_id: 'b_north', creator_id: null},
    {id: 'u_creator', name: 'Asha', role: 'creator', brand_id: null, creator_id: 'c_asha'}
  ];
  const creators = [{id: 'c_asha', name: 'Asha', initials: 'AM', fee: 2500000, available: 1}, {id: 'c_rohan', name: 'Rohan', initials: 'RK', fee: 4000000, available: 1}];
  const payload = {items: [{label: 'Reel', quantity: 2, unit_price: 2500000, creator_id: 'c_asha'}, {label: 'Management', quantity: 1, unit_price: 1500000, creator_id: null}], terms: '50% deposit', rights: 'Organic Instagram', expires: '2026-11-30'};
  const root = {user: users[0], demo: true, connections: {identity: {available: false}}, brands: [{id: 'b_olive', name: 'Olive & Earth'}, {id: 'b_north', name: 'Northstar'}], creators, campaigns: [{id: 'cam_1', brand_id: 'b_olive', name: 'Ritual', budget: 65000000, proposal_id: null, accepted_version_id: null, start_date: '2026-11-02', end_date: '2026-11-24', status: 'Active'}, {id: 'cam_2', brand_id: 'b_north', name: 'Outside', budget: 42000000, status: 'Active'}], assignments: [{id: 'a1', campaign_id: 'cam_1', creator_id: 'c_asha'}, {id: 'a2', campaign_id: 'cam_2', creator_id: 'c_rohan'}], deliverables: [{id: 'd1', assignment_id: 'a1', title: 'Morning reel', due_date: '2026-11-09', status: 'Draft due', owner: 'Asha'}, {id: 'd2', assignment_id: 'a2', title: 'Trail reel', status: 'Brief sent', owner: 'Rohan'}], proposals: [{id: 'p_1', brand_id: 'b_olive', lead_id: 'l_1', title: 'Everyday rituals', status: 'Sent', created: '2026-11-06T12:00:00.000Z', versions: [{id: 'pv_1', proposal_id: 'p_1', version: 1, payload, total: 6500000, created: '2026-11-06T12:00:00.000Z'}]}], activities: [], leads: [{id: 'l_1', brand_id: 'b_olive', name: 'Priya', email: 'priya@example.com', company: 'Olive & Earth', brief: 'Skin care', budget: 6500000, stage: 'Proposal', created: '2026-11-06T12:00:00.000Z'}], shortlists: [{brand_id: 'b_olive', creator_id: 'c_asha'}], finance: {campaign_budgets: 107000000, committed_creator_fees: 6500000}};
  const workspaces = Object.fromEntries(users.map(user => [user.id, {...structuredClone(root), user}]));
  const responses = Object.fromEntries(users.map(user => [user.id, {operations: {jobs: [], for_user: user.id}, workflow: {tasks: [], knowledge: [], notifications: [], exceptions: [], rules: null, capabilities: {}}, ...(user.role !== 'finance' ? {'delivery/campaign/cam_1': {brief: {id: 'brief_1', payload: {goals: 'Sample goals'}}, brief_history: [], rights: null, shipments: []}} : {})}]));
  return {schema_version: 1, generated_at: '2026-11-06T12:00:00.000Z', public: {creators, content: [], demo: true, identity: {available: false}}, users, workspaces, responses, errors: {u_creator: {catalog: {status: 403, error: 'Catalogue access required.'}}}};
}
const create = (options = {}) => createPreviewAPI({fixtures: fixture(), storage: storage(), now: time, ...options});
const login = (api, user_id = 'u_owner') => api.request('login', {user_id});
const rejects = (promise, status, message) => assert.rejects(promise, error => error.status === status && (!message || message.test(error.message)));
const proposal = (overrides = {}) => ({brand_id: 'b_olive', title: 'New sample proposal', expires: '2026-12-01', terms: 'Sample terms', rights: 'Sample rights', items: [{label: 'Reel', creator_id: 'c_asha', quantity: 1, unit_price: 2500000}], ...overrides});

test('preview exposes public sample personas only, validates login and clones all responses', async () => {
  const api = create();
  const publicData = await api.request('public');
  assert.equal(publicData.preview, true);
  assert.equal(publicData.identity.available, false);
  publicData.creators[0].name = 'mutated';
  assert.equal((await api.request('public')).creators[0].name, 'Asha');
  await rejects(api.request('workspace'), 401);
  await rejects(login(api, 'real_owner'), 400);
  assert.equal((await login(api)).user.role, 'owner');
  const result = await api.request('workspace');
  result.campaigns[0].name = 'mutated';
  assert.equal((await api.request('/api/workspace')).campaigns[0].name, 'Ritual');
  assert.equal(api.status().persistence, 'browser');
});

test('browser persistence survives reload and logout; reset clears only preview state; visitors are isolated', async () => {
  const store = storage();
  store.setItem('another-app', 'keep');
  let api = create({storage: store});
  await login(api);
  await api.request('shortlist', {brand_id: 'b_olive', creator_id: 'c_rohan'});
  api = create({storage: store});
  assert.equal((await api.request('workspace')).user.id, 'u_owner');
  assert.equal((await api.request('workspace')).shortlists.length, 2);
  const otherVisitor = create();
  await rejects(otherVisitor.request('workspace'), 401);
  await login(otherVisitor);
  assert.equal((await otherVisitor.request('workspace')).shortlists.length, 1);
  await api.request('logout', {});
  await rejects(api.request('workspace'), 401);
  await login(api, 'u_brand');
  assert.equal((await api.request('workspace')).shortlists.length, 2);
  api.reset();
  assert.equal(store.getItem('another-app'), 'keep');
  assert.equal(store.getItem(api.status().storage_key), null);
  await rejects(api.request('workspace'), 401);
  await login(api);
  assert.equal((await api.request('workspace')).shortlists.length, 1);
});

test('sample dates move with initialization but remain stable on reload until reset', async () => {
  const store = storage();
  let api = create({storage: store, now: () => Date.parse('2027-01-06T12:00:00Z')});
  await login(api, 'u_brand');
  const workspace = await api.request('workspace');
  assert.equal(workspace.proposals[0].versions[0].payload.expires, '2027-01-30');
  assert.equal(workspace.deliverables[0].due_date, '2027-01-09');
  api = create({storage: store, now: () => Date.parse('2027-01-10T12:00:00Z')});
  assert.equal((await api.request('workspace')).deliverables[0].due_date, '2027-01-09');
  api.reset();
  await login(api, 'u_brand');
  assert.equal((await api.request('workspace')).deliverables[0].due_date, '2027-01-13');
});

test('public enquiries validate input, persist only locally and obey sales workspace boundaries', async () => {
  const api = create();
  await rejects(api.request('enquiries', {name: 'Test', email: 'invalid', company: 'Preview', brief: 'A brief', budget: 100}), 400);
  const created = await api.request('enquiries', {name: 'Test', email: 'test@example.com', company: 'Preview', brief: 'A brief', budget: 10000});
  await login(api);
  let lead = (await api.request('workspace')).leads.find(item => item.id === created.id);
  assert.equal(lead.company, 'Preview');
  await api.request('leads/update', {id: lead.id, stage: 'Qualified'});
  await rejects(api.request('leads/update', {id: lead.id, stage: 'Won'}), 400);
  lead = (await api.request('workspace')).leads.find(item => item.id === created.id);
  assert.equal(lead.stage, 'Qualified');
  await login(api, 'u_brand');
  assert.deepEqual((await api.request('workspace')).leads, []);
  await rejects(api.request('leads/update', {id: lead.id, stage: 'Lost'}), 403);
  await rejects(api.request('shortlist', {brand_id: 'b_north', creator_id: 'c_asha'}), 403);
  await login(api, 'u_reviewer');
  await rejects(api.request('shortlist', {brand_id: 'b_olive', creator_id: 'c_rohan'}), 403);
});

test('proposal revisions are immutable and latest-version acceptance creates a scoped campaign exactly once', async () => {
  const api = create();
  await login(api);
  const original = (await api.request('workspace')).proposals[0].versions[0];
  await api.request('proposals', proposal({proposal_id: 'p_1', lead_id: 'l_1', items: [{label: 'Reel', quantity: 2, unit_price: 2500000, creator_id: 'c_asha'}]}));
  const revised = (await api.request('workspace')).proposals[0];
  assert.equal(revised.versions.length, 2);
  assert.deepEqual(revised.versions[1], original);
  await rejects(api.request('proposals/accept', {id: 'p_1', version_id: revised.versions[0].id}), 403);
  await login(api, 'u_other');
  assert.equal((await api.request('workspace')).proposals.length, 0);
  await rejects(api.request('proposals/accept', {id: 'p_1', version_id: revised.versions[0].id}), 403);
  await login(api, 'u_brand');
  await rejects(api.request('proposals/accept', {id: 'p_1', version_id: 'pv_1'}), 409);
  const accepted = await api.request('proposals/accept', {id: 'p_1', version_id: revised.versions[0].id});
  assert.deepEqual(await api.request('proposals/accept', {id: 'p_1', version_id: revised.versions[0].id}), {...accepted, already_accepted: true});
  const campaign = (await api.request('workspace')).campaigns.find(item => item.id === accepted.campaign_id);
  assert.equal(campaign.budget, 5000000);
  const delivery = await api.request('delivery/campaign/' + campaign.id);
  assert.equal(delivery.assignments.length, 1);
  assert.equal(delivery.deliverables.length, 2);
  assert.equal(delivery.brief, null);
  assert.equal((await api.request('delivery/deliverable/' + delivery.deliverables[0].id)).handoff.ready, false);
  await login(api, 'u_creator');
  const creatorWorkspace = await api.request('workspace');
  assert.equal(creatorWorkspace.campaigns.find(item => item.id === campaign.id).budget, undefined);
  assert.deepEqual(creatorWorkspace.proposals, []);
  assert.equal(creatorWorkspace.finance, null);
  assert.equal(creatorWorkspace.creators[0].fee, undefined);
  await rejects(api.request('delivery/campaign/cam_2'), 403);
  await rejects(api.request('delivery/deliverable/d2'), 403);
  await login(api);
  assert.equal((await api.request('workspace')).leads.find(item => item.id === 'l_1').stage, 'Won');
  await rejects(api.request('proposals', proposal({proposal_id: 'p_1'})), 409);
});

test('new enquiry proposals explain persona limitation and failed mutations leave no partial records', async () => {
  const api = create();
  const enquiry = await api.request('enquiries', {name: 'New', email: 'new@example.com', company: 'New brand', brief: 'A new idea', budget: 10000});
  await login(api);
  const before = await api.request('workspace');
  await rejects(api.request('proposals', proposal({lead_id: enquiry.id, brand_id: '', proposal_id: 'missing'})), 404);
  assert.deepEqual(await api.request('workspace'), before);
  const result = await api.request('proposals', proposal({lead_id: enquiry.id, brand_id: ''}));
  assert.match(result.preview_notice, /no selectable persona/);
  assert.equal((await api.request('workspace')).brands.length, 3);
  await rejects(api.request('proposals', proposal({expires: '2026-02-30'})), 400);
  await rejects(api.request('proposals', proposal({items: [{label: 'Wrong', quantity: -1, unit_price: 5}]})), 400);
});

test('seed proposal accepts without a revision and expiry prevents stale acceptance', async () => {
  const api = create();
  await login(api, 'u_brand');
  const accepted = await api.request('proposals/accept', {id: 'p_1', version_id: 'pv_1'});
  assert.equal((await api.request('workspace')).campaigns.find(item => item.id === accepted.campaign_id).budget, 6500000);
  const store = storage();
  let later = create({storage: store});
  await login(later, 'u_brand');
  later = create({storage: store, now: () => Date.parse('2027-01-01T12:00:00Z')});
  await rejects(later.request('proposals/accept', {id: 'p_1', version_id: 'pv_1'}), 409, /expired/);
});

test('task dependencies, revisions and discussion privacy work across sample personas', async () => {
  const api = create();
  await login(api);
  const input = {campaign_id: 'cam_1', owner_id: 'u_creator', title: 'Prepare draft', description: 'Record a sample', due_on: '2026-11-08', visibility: 'shared', dependencies: []};
  const first = await api.request('workflow/tasks', input);
  const second = await api.request('workflow/tasks', {...input, title: 'Deliver draft', dependencies: [first.id]});
  const internal = await api.request('workflow/tasks', {...input, owner_id: 'u_manager', title: 'Agency-only task', visibility: 'agency'});
  await rejects(api.request('workflow/tasks', {...input, id: first.id, revision: first.revision, dependencies: [second.id]}), 409, /cycle/);
  await api.request('workflow/tasks/comment', {id: first.id, message: 'Agency note', visibility: 'agency'});
  await api.request('workflow/tasks/comment', {id: first.id, message: 'Shared note', visibility: 'shared'});
  await login(api, 'u_creator');
  const visible = await api.request('workflow');
  assert.equal(visible.tasks.length, 2);
  assert.equal(visible.tasks[0].comments.length, 1);
  await rejects(api.request('workflow/tasks/' + internal.id), 403);
  await rejects(api.request('workflow/tasks/comment', {id: first.id, message: 'Hidden', visibility: 'agency'}), 403);
  await rejects(api.request('workflow/tasks/status', {id: second.id, revision: 1, status: 'Done'}), 409);
  await api.request('workflow/tasks/status', {id: first.id, revision: 1, status: 'Done'});
  await rejects(api.request('workflow/tasks/status', {id: first.id, revision: 1, status: 'Open'}), 409);
  await api.request('workflow/tasks/status', {id: second.id, revision: 1, status: 'Done'});
  await rejects(api.request('workflow/tasks/status', {id: first.id, revision: 2, status: 'Open'}), 409);
  await login(api, 'u_other');
  assert.equal((await api.request('workflow')).tasks.length, 0);
  await login(api, 'u_brand');
  await rejects(api.request('workflow/tasks/status', {id: first.id, revision: 2, status: 'Open'}), 403);
  await login(api);
  assert.equal((await api.request('workflow/tasks/' + first.id)).comments.length, 2);
});

test('unsupported mutations never succeed and read-only module fixtures stay role-specific', async () => {
  const api = create();
  await login(api, 'u_creator');
  assert.equal((await api.request('operations')).for_user, 'u_creator');
  await rejects(api.request('catalog'), 403);
  for (const endpoint of ['instagram/connect', 'instagram/schedule', 'cloud/analyse', 'notifications/email/enqueue', 'identity/invitations', 'uploads', 'commerce/invoices']) await rejects(api.request(endpoint, {}), 501, /No live service/);
  await rejects(api.request('missing'), 501);
  await rejects(api.request('https://example.com'), 400);
  await rejects(api.request('workspace?user=u_owner'), 400);
  await login(api, 'u_finance');
  await rejects(api.request('delivery/campaign/cam_1'), 403);
});

test('corrupt, oversized and prototype-bearing saved data recover; unavailable storage uses memory', async () => {
  for (const value of ['{broken', 'x'.repeat(2_000_001), '{"__proto__":{"polluted":true}}']) {
    const store = storage();
    store.setItem('voqro.preview.v1', value);
    const api = create({storage: store});
    assert.match(api.status().notice, /fresh sample/);
    await login(api);
    assert.equal((await api.request('workspace')).campaigns.length, 2);
  }
  const malformed = storage();
  const original = create({storage: malformed});
  await login(original);
  const saved = JSON.parse(malformed.getItem('voqro.preview.v1'));
  saved.proposals[0].versions[0].payload.items = [null];
  malformed.setItem('voqro.preview.v1', JSON.stringify(saved));
  const recovered = create({storage: malformed});
  assert.match(recovered.status().notice, /fresh sample/);
  await login(recovered, 'u_brand');
  assert.equal((await recovered.request('workspace')).proposals[0].versions[0].payload.items.length, 2);
  const throwing = {getItem() { throw new Error('disabled'); }, setItem() { throw new Error('disabled'); }, removeItem() { throw new Error('disabled'); }};
  const api = create({storage: throwing});
  assert.equal(api.status().persistence, 'memory');
  await login(api);
  await api.request('shortlist', {brand_id: 'b_olive', creator_id: 'c_rohan'});
  assert.equal((await api.request('workspace')).shortlists.length, 2);
  await rejects(api.request('proposals', JSON.parse('{"__proto__":{"polluted":true}}')), 400);
  assert.equal({}.polluted, undefined);
  await rejects(api.request('enquiries', {brief: 'x'.repeat(100001)}), 413);
  const full = storage();
  full.setItem = () => { throw new Error('QuotaExceededError'); };
  const fallback = create({storage: full});
  await login(fallback);
  assert.equal(fallback.status().persistence, 'memory');
  assert.match(fallback.status().notice, /while this page/);
});

test('generated fresh demo fixtures support every role, module read and seed acceptance', async () => {
  const fixtures = JSON.parse(await readFile(new URL('../preview/fixtures.json', import.meta.url), 'utf8'));
  const api = createPreviewAPI({fixtures, storage: storage(), now: () => Date.parse(fixtures.generated_at)});
  for (const user of fixtures.users) {
    await login(api, user.id);
    assert.equal((await api.request('workspace')).user.id, user.id);
    assert.equal((await api.request('workflow')).tasks.some(task => task.visibility === 'finance'), ['owner', 'finance'].includes(user.role));
    for (const path of Object.keys(fixtures.responses[user.id])) assert.ok(await api.request(path), `${user.id}: ${path}`);
  }
  await login(api, 'u_brand');
  const accepted = await api.request('proposals/accept', {id: 'p_1', version_id: 'pv_1'});
  assert.equal((await api.request('delivery/campaign/' + accepted.campaign_id)).deliverables.length, 2);
});
