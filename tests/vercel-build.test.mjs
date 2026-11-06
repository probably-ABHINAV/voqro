import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backendOrigin, buildVercel, outputConfiguration} from '../scripts/build-vercel.mjs';

const backend = 'https://api.voqro.example.com';
const env = {VOQRO_BACKEND_ORIGIN: backend};

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'voqro-vercel-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'public', 'art'), {recursive: true});
  await writeFile(join(root, 'public', 'index.html'), '<html><head><title>Fixture</title></head><body><script type="module" src="/app.js"></script></body></html>');
  await writeFile(join(root, 'public', 'app.js'), "fetch('/api/public');");
  await writeFile(join(root, 'public', 'art', 'profile.svg'), '<svg/>');
  return root;
}

async function addPreviewFixture(root) {
  await mkdir(join(root, 'preview'));
  await writeFile(join(root, 'preview', 'entry.mjs'), "await import('/app.js');");
  await writeFile(join(root, 'preview', 'api.mjs'), 'export function createPreviewAPI() {}');
  await writeFile(join(root, 'preview', 'styles.css'), '.preview-banner { display: block; }');
  await writeFile(join(root, 'preview', 'fixtures.json'), JSON.stringify({schema_version: 1, generated_at: '2026-11-06T12:00:00Z', public: {demo: true}, users: [{id: 'u_owner'}], workspaces: {u_owner: {demo: true}}, responses: {}}));
}

test('Vercel build rejects missing, non-HTTPS, credential-bearing and private origins', () => {
  for (const value of [undefined, '', 'not-a-url', 'http://api.example.com', 'https://name:secret@api.example.com', 'https://api.example.com/path', 'https://api.example.com?token=x', 'https://api.example.com#part', 'https://api.example.com:8443', 'https://localhost', 'https://localhost.', 'https://api.localhost', 'https://api.local', 'https://localhost.localdomain', 'https://api.home.arpa', 'https://api.internal', 'https://metadata.google.internal', 'https://api', 'https://127.0.0.1', 'https://10.0.0.1', 'https://169.254.169.254', 'https://192.168.1.1', 'https://2130706433', 'https://0x7f000001', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://8.8.8.8', 'https://api.example.com.']) {
    assert.throws(() => backendOrigin(value), /VOQRO_BACKEND_ORIGIN/);
  }
  assert.equal(backendOrigin(' https://API.VOQRO.EXAMPLE.COM:443/ '), backend);
});

test('Vercel API routes retain same-origin paths and disable private response caching', () => {
  const config = outputConfiguration(env);
  assert.equal(config.version, 3);
  const route = config.routes.find(r => r.dest?.startsWith(backend));
  assert.ok(route);
  for (const path of ['/api/public', '/api/identity/start', '/api/identity/callback', '/api/instagram/oauth/callback', '/api/uploads/upload-1/chunks/2', '/api/media/private-file', '/api/reporting/export.csv']) {
    const match = path.match(new RegExp(route.src));
    assert.ok(match, path);
    assert.equal(route.dest.replace('$1', match[1] || ''), backend + path);
  }
  assert.equal(new RegExp(route.src).test('/apiary'), false);
  assert.equal(new RegExp(route.src).test('/app.js'), false);
  assert.equal(route.headers['Cache-Control'], 'no-store');
  assert.equal(route.headers['Vercel-CDN-Cache-Control'], 'no-store');
  assert.equal(route.headers['x-vercel-enable-rewrite-caching'], '0');
  assert.equal(route.methods, undefined, 'All existing API methods must pass through.');
  assert.equal(route.headers['Set-Cookie'], undefined, 'Backend session cookies must not be replaced.');
  assert.equal(route.headers.Location, undefined, 'Backend OAuth redirects must not be replaced.');
  assert.equal(route.headers['Content-Range'], undefined, 'Backend range responses must not be replaced.');
  assert.ok(config.routes.some(r => r.handle === 'filesystem'));
  assert.equal(config.routes.at(-1).status, 404);
});

test('Vercel CSP preserves self-hosted assets and permits only the configured exact S3 bucket', () => {
  const plain = outputConfiguration(env).routes[0].headers;
  assert.match(plain['Content-Security-Policy'], /connect-src 'self';/);
  assert.equal(plain['X-Content-Type-Options'], 'nosniff');
  assert.equal(plain['X-Frame-Options'], 'DENY');
  const s3 = 'https://voqro-private-media.s3.ap-south-1.amazonaws.com';
  const configured = outputConfiguration({...env, VOQRO_S3_UPLOAD_ORIGIN: s3}).routes[0].headers['Content-Security-Policy'];
  assert.ok(configured.includes(`connect-src 'self' ${s3};`));
  assert.equal(configured.includes('*'), false);
  for (const origin of ['https://evil.example.com', 'https://*.s3.ap-south-1.amazonaws.com', 'https://bucket.s3.us-east-1.amazonaws.com', s3 + '/object', 'http://localhost']) {
    assert.throws(() => outputConfiguration({...env, VOQRO_S3_UPLOAD_ORIGIN: origin}));
  }
});

test('Vercel artifact contains only public assets and routing, preserving project linkage on rebuild', async t => {
  const root = await fixture(t);
  await mkdir(join(root, '.data'), {recursive: true});
  await mkdir(join(root, '.vercel'), {recursive: true});
  await writeFile(join(root, '.env'), 'PRIVATE_TOKEN=fixture-secret');
  await writeFile(join(root, '.data', 'database.sqlite'), 'private-fixture');
  await writeFile(join(root, 'server.mjs'), 'private backend implementation');
  const project = '{"projectId":"fixture-project"}';
  await writeFile(join(root, '.vercel', 'project.json'), project);
  const result = await buildVercel({rootDirectory: root, env: {...env, PRIVATE_TOKEN: 'fixture-secret'}});
  assert.deepEqual((await readdir(result.output)).sort(), ['config.json', 'static']);
  assert.deepEqual((await readdir(join(result.output, 'static'))).sort(), ['app.js', 'art', 'index.html']);
  assert.equal(await readFile(join(result.output, 'static', 'art', 'profile.svg'), 'utf8'), '<svg/>');
  assert.equal((await readFile(join(result.output, 'config.json'), 'utf8')).includes('fixture-secret'), false);
  await writeFile(join(result.output, 'static', 'obsolete.js'), 'stale');
  await buildVercel({rootDirectory: root, env});
  assert.equal((await readdir(join(result.output, 'static'))).includes('obsolete.js'), false);
  assert.equal(await readFile(join(root, '.vercel', 'project.json'), 'utf8'), project);
  assert.equal(await readFile(join(root, '.env'), 'utf8'), 'PRIVATE_TOKEN=fixture-secret');
  assert.deepEqual((await readdir(join(root, '.vercel'))).sort(), ['output', 'project.json']);
});

test('Vercel build fails before replacing an existing artifact when backend configuration is missing', async t => {
  const root = await fixture(t);
  const {output} = await buildVercel({rootDirectory: root, env});
  const original = await readFile(join(output, 'config.json'), 'utf8');
  await assert.rejects(buildVercel({rootDirectory: root, env: {}}), /VOQRO_BACKEND_ORIGIN/);
  assert.equal(await readFile(join(output, 'config.json'), 'utf8'), original);
});

test('Vercel build refuses asset symlinks and hidden files instead of publishing private content', async t => {
  for (const kind of ['symlink', 'hidden']) {
    const root = await fixture(t);
    await writeFile(join(root, '.env'), 'PRIVATE_TOKEN=fixture-secret');
    if (kind === 'symlink') await symlink(join(root, '.env'), join(root, 'public', 'leak.txt'));
    else await writeFile(join(root, 'public', '.env'), 'PRIVATE_TOKEN=fixture-secret');
    await assert.rejects(buildVercel({rootDirectory: root, env}), /Hidden files and symbolic links/);
    assert.deepEqual(await readdir(join(root, '.vercel')), []);
  }
});

test('Vercel build refuses redirected output paths without touching their targets', async t => {
  for (const redirected of ['parent', 'output']) {
    const root = await fixture(t);
    const target = join(root, 'keep');
    await mkdir(target);
    await writeFile(join(target, 'important.txt'), 'preserve');
    if (redirected === 'output') await mkdir(join(root, '.vercel'));
    await symlink(target, redirected === 'output' ? join(root, '.vercel', 'output') : join(root, '.vercel'));
    await assert.rejects(buildVercel({rootDirectory: root, env}), /real directories/);
    assert.equal(await readFile(join(target, 'important.txt'), 'utf8'), 'preserve');
  }
});

test('explicit preview mode builds isolated static assets without a backend or external API route', async t => {
  const root = await fixture(t);
  await addPreviewFixture(root);
  await writeFile(join(root, '.env'), 'PRIVATE_TOKEN=must-not-publish');
  await mkdir(join(root, '.data'));
  await writeFile(join(root, '.data', 'database.sqlite'), 'private-existing-data');
  await writeFile(join(root, 'preview', '.debug-secret'), 'private-debug-data');
  const result = await buildVercel({rootDirectory: root, env: {VOQRO_PREVIEW: '1', VOQRO_S3_UPLOAD_ORIGIN: 'https://private.s3.ap-south-1.amazonaws.com'}});
  assert.equal(result.mode, 'preview');
  assert.equal(result.backendOrigin, null);
  const config = JSON.parse(await readFile(join(result.output, 'config.json'), 'utf8'));
  const apiRoute = config.routes.find(route => route.src.includes('api'));
  assert.equal(apiRoute.dest, '/preview/api-unavailable.json');
  assert.equal(apiRoute.status, 503);
  assert.equal(apiRoute.headers['Cache-Control'], 'no-store');
  assert.equal(apiRoute.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(config.routes.some(route => /^https?:/.test(route.dest || '')), false);
  assert.match(config.routes[0].headers['Content-Security-Policy'], /connect-src 'self';/);
  const html = await readFile(join(result.output, 'static', 'index.html'), 'utf8');
  assert.ok(html.includes('src="/preview/entry.mjs"'));
  assert.ok(html.includes('href="/preview/styles.css"'));
  assert.equal(html.includes('src="/app.js"'), false);
  assert.ok((await readFile(join(root, 'public', 'index.html'), 'utf8')).includes('src="/app.js"'));
  assert.deepEqual((await readdir(join(result.output, 'static', 'preview'))).sort(), ['api-unavailable.json', 'api.mjs', 'entry.mjs', 'fixtures.json', 'styles.css']);
  assert.equal(JSON.parse(await readFile(join(result.output, 'static', 'preview', 'api-unavailable.json'), 'utf8')).preview, true);
  assert.equal((await readdir(join(result.output, 'static'))).includes('.data'), false);
  assert.equal((await readdir(join(result.output, 'static'))).includes('.env'), false);
});

test('connected builds never copy the preview dataset or replace the production entrypoint', async t => {
  const root = await fixture(t);
  await addPreviewFixture(root);
  const result = await buildVercel({rootDirectory: root, env});
  assert.equal(result.mode, 'connected');
  assert.equal((await readdir(join(result.output, 'static'))).includes('preview'), false);
  const html = await readFile(join(result.output, 'static', 'index.html'), 'utf8');
  assert.ok(html.includes('src="/app.js"'));
  assert.equal(html.includes('/preview/'), false);
  await assert.rejects(buildVercel({rootDirectory: root, env: {VOQRO_PREVIEW: '0'}}), /VOQRO_BACKEND_ORIGIN/);
  assert.throws(() => outputConfiguration({VOQRO_PREVIEW: 'true'}), /VOQRO_PREVIEW/);
});

test('preview build rejects unmarked workspaces and symlinked preview assets', async t => {
  for (const invalid of ['real-workspace', 'symlink']) {
    const root = await fixture(t);
    await addPreviewFixture(root);
    if (invalid === 'real-workspace') {
      await writeFile(join(root, 'preview', 'fixtures.json'), JSON.stringify({schema_version: 1, public: {demo: false}, users: [{id: 'real-owner'}], workspaces: {'real-owner': {demo: false}}}));
    } else {
      await rm(join(root, 'preview', 'api.mjs'));
      await writeFile(join(root, '.env'), 'PRIVATE_TOKEN=must-not-publish');
      await symlink(join(root, '.env'), join(root, 'preview', 'api.mjs'));
    }
    await assert.rejects(buildVercel({rootDirectory: root, env: {VOQRO_PREVIEW: '1'}}), invalid === 'real-workspace' ? /demonstration workspaces/ : /regular files/);
    assert.deepEqual(await readdir(join(root, '.vercel')), []);
  }
});

test('committed preview fixtures contain only the fresh seven-role demonstration with providers disconnected', async () => {
  const fixtures = JSON.parse(await readFile(new URL('../preview/fixtures.json', import.meta.url), 'utf8'));
  assert.equal(fixtures.public.demo, true);
  assert.equal(fixtures.base_date, fixtures.generated_at.slice(0, 10));
  assert.deepEqual(fixtures.users.map(user => user.id).sort(), ['u_brand', 'u_creator', 'u_finance', 'u_manager', 'u_other', 'u_owner', 'u_reviewer']);
  for (const user of fixtures.users) {
    const workspace = fixtures.workspaces[user.id];
    assert.equal(workspace.demo, true);
    assert.equal(workspace.connections.identity.available, false);
    assert.equal(workspace.connections.instagram.connected_accounts, 0);
    assert.equal(workspace.connections.notifications.email, 'Not configured');
  }
});
