import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Always create a new sample database. Never open a workspace database or .env.
process.env.NODE_ENV = 'test';
process.env.DEMO_MODE = '1';
process.env.DB_PATH = ':memory:';
process.env.AWS_MEDIA_ENABLED = '0';
process.env.AWS_AI_ENABLED = '0';
process.env.INSTAGRAM_PUBLISH_ENABLED = '0';
process.env.NOTIFICATION_EMAIL_ENABLED = '0';
for (const name of ['COGNITO_ISSUER', 'COGNITO_CLIENT_ID', 'COGNITO_DOMAIN', 'IDENTITY_BOOTSTRAP_EMAIL', 'AWS_MEDIA_BUCKET', 'BEDROCK_MODEL_ID', 'AWS_AI_PRICING_VERIFIED', 'META_APP_ID', 'META_APP_SECRET', 'META_GRAPH_VERSION', 'META_REDIRECT_URI', 'INTEGRATION_TOKEN_KEY', 'SES_FROM_EMAIL', 'SES_VERIFIED_IDENTITY', 'SES_CONFIGURATION_SET']) delete process.env[name];
process.env.APP_BASE_URL = 'https://preview.invalid';
const temporaryMedia = await mkdtemp(join(tmpdir(), 'voqro-preview-fixtures-'));
process.env.UPLOAD_PATH = temporaryMedia;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const users = ['u_owner', 'u_manager', 'u_reviewer', 'u_finance', 'u_brand', 'u_other', 'u_creator'];
const modules = ['connections', 'workflow', 'commerce', 'catalog', 'operations', 'cloud', 'instagram', 'identity/config', 'identity/members', 'optimization', 'reporting', 'notifications/email'];
let server;

try {
  ({server} = await import('../server.mjs'));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  async function request(path, {cookie, body} = {}) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {...(cookie ? {Cookie: cookie} : {}), ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      redirect: 'error'
    });
    return {status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0]};
  }
  async function required(path, options) {
    const result = await request(path, options);
    if (result.status < 200 || result.status >= 300) throw new Error(`Fresh sample fixture request ${path} failed (${result.status}).`);
    return result;
  }
  const owner = (await required('login', {body: {user_id: 'u_owner'}})).cookie;
  // These are explicitly illustrative additions to the source application's demo seed.
  for (const [campaign, title] of [['cam_1', 'The everyday ritual'], ['cam_2', 'Out of office'], ['cam_3', 'Objects with a story']]) {
    await required('delivery/campaign', {cookie: owner, body: {
      campaign_id: campaign,
      goals: `Sample brief for ${title}: show a thoughtful creator partnership from concept to review.`,
      requirements: 'One original short-form story, a cover image, a clear caption and two review rounds.',
      tone: 'Warm, considered and conversational.',
      claims: 'Illustrative planning information only; no product efficacy or commercial results are claimed.',
      prohibited: 'Unsupported product claims or unlicensed assets.',
      disclosure: 'Use the appropriate partnership disclosure in any real approved publication.'
    }});
  }
  await required('workflow/knowledge', {cookie: owner, body: {
    brand_id: 'b_olive', tone: 'Warm, honest and unhurried.',
    facts: 'This is an illustrative skincare campaign for exploring the product preview.',
    claims: 'No real product claims have been supplied or verified.',
    prohibited: 'Unsubstantiated efficacy statements.', references: []
  }});
  for (const task of [
    {title: 'Confirm the creator brief', owner_id: 'u_creator', visibility: 'shared', due_on: '2026-11-09'},
    {title: 'Review campaign direction', owner_id: 'u_manager', visibility: 'agency', due_on: '2026-11-08'},
    {title: 'Check the sample campaign budget', owner_id: 'u_finance', visibility: 'finance', due_on: '2026-11-10'}
  ]) await required('workflow/tasks', {cookie: owner, body: {campaign_id: 'cam_1', description: 'An illustrative next step for this browser-only product preview.', dependencies: [], ...task}});

  const generatedAt = new Date().toISOString();
  const fixture = {
    schema_version: 1,
    generated_at: generatedAt,
    base_date: generatedAt.slice(0, 10),
    source: 'Fresh in-memory demonstration records; no workspace database or real provider data.',
    public: (await required('public')).data,
    users: [], workspaces: {}, responses: {}, errors: {}
  };
  for (const userId of users) {
    const login = await required('login', {body: {user_id: userId}}), cookie = login.cookie;
    fixture.users.push(login.data.user);
    const workspace = (await required('workspace', {cookie})).data;
    fixture.workspaces[userId] = workspace;
    const paths = new Set(modules);
    for (const campaign of workspace.campaigns) paths.add(`delivery/campaign/${campaign.id}`);
    for (const deliverable of workspace.deliverables) paths.add(`delivery/deliverable/${deliverable.id}`);
    fixture.responses[userId] = {};
    fixture.errors[userId] = {};
    const record = async path => {
      const result = await request(path, {cookie});
      if (result.status === 200) fixture.responses[userId][path] = result.data;
      else fixture.errors[userId][path] = {status: result.status, error: result.data.error || 'This sample record is outside the selected role.'};
      return result;
    };
    for (const path of paths) await record(path);
    const workflow = fixture.responses[userId].workflow;
    for (const task of workflow?.tasks || []) await record(`workflow/tasks/${task.id}`);
    for (const brand of workflow?.brands || []) await record(`workflow/knowledge/${brand.id}`);
    for (const knowledge of workflow?.knowledge || []) if (knowledge.latest) await record(`workflow/knowledge-version/${knowledge.latest.id}`);
  }
  // Source demo deadlines are anchored to 6 November 2026; creation timestamps
  // already use today's clock. Shift only exact date-only source values here.
  const dateShift = Date.parse(fixture.base_date + 'T00:00:00Z') - Date.parse('2026-11-06T00:00:00Z');
  const normalizeDates = value => {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(Date.parse(value + 'T00:00:00Z') + dateShift).toISOString().slice(0, 10);
    if (Array.isArray(value)) return value.map(normalizeDates);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeDates(item)]));
    return value;
  };
  for (const key of ['public', 'workspaces', 'responses']) fixture[key] = normalizeDates(fixture[key]);
  if (!fixture.public.demo || fixture.users.length !== 7 || Object.values(fixture.workspaces).some(workspace => !workspace.demo)) throw new Error('Fixture safety check failed: every workspace must be a demonstration.');
  await mkdir(join(projectRoot, 'preview'), {recursive: true});
  await writeFile(join(projectRoot, 'preview', 'fixtures.json'), JSON.stringify(fixture, null, 2) + '\n');
  console.log(`Generated fresh preview fixtures for ${fixture.users.length} illustrative roles. No existing database was opened.`);
} finally {
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await rm(temporaryMedia, {recursive: true, force: true});
}
