import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createBackup, restoreBackup, verifyBackup} from '../scripts/backup.mjs';

const origin = 'https://recovery.example';
const password = 'Isolated recovery test passphrase 42!';

async function startApp(t, directory, bootstrapSecret = '') {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e',
    "import {server} from './server.mjs'; server.listen(0,'127.0.0.1',()=>console.log('PORT:'+server.address().port));"], {
    cwd: resolve(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, NODE_ENV: 'test', DEMO_MODE: '0', AUTH_PROVIDER: 'password', CLERK_MIGRATION_ENABLED: '0',
      APP_BASE_URL: origin, AUTH_ALLOW_INSECURE_LOCAL: '0', COOKIE_SECURE: '1',
      IDENTITY_BOOTSTRAP_EMAIL: 'owner@recovery.example', IDENTITY_BOOTSTRAP_SECRET: bootstrapSecret,
      DB_PATH: join(directory, 'voqro.sqlite'), UPLOAD_PATH: join(directory, 'uploads'),
      AWS_MEDIA_ENABLED: '0', AWS_AI_ENABLED: '0', AZURE_AI_ENABLED: '0', INSTAGRAM_PUBLISH_ENABLED: '0', NOTIFICATION_EMAIL_ENABLED: '0'},
  });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await stopped; } finally { clearTimeout(timer); }
  });
  const base = await new Promise((resolvePort, reject) => {
    let output = '', errors = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('Recovery app startup timed out.')); }, 15000);
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(Error('Recovery app exited ' + code + ': ' + errors)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      const port = output.match(/PORT:(\d+)/);
      if (port) { clearTimeout(timer); resolvePort('http://127.0.0.1:' + port[1]); }
    });
  });
  const request = async (path, body, cookie = '', extraHeaders = {}) => {
    const response = await fetch(base + path, {method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: {Origin: origin, ...(body === undefined ? {} : {'Content-Type': 'application/json'}), ...(cookie ? {Cookie: cookie} : {}), ...extraHeaders},
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000)});
    const bytes = Buffer.from(await response.arrayBuffer());
    return {status: response.status, data: response.headers.get('content-type')?.includes('json') ? JSON.parse(bytes) : bytes,
      headers: response.headers, cookie: response.headers.getSetCookie().find(value => value.startsWith('__Host-voqro_auth='))?.split(';')[0] || ''};
  };
  return {request, login: email => request('/api/identity/password/login', {email, password})};
}

test('a restored production-mode app preserves records and media while requiring fresh login and enforcing brand scope', {timeout: 60000}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'voqro-recovery-app-'));
  // Remove fixture files after child teardown, including on failure.
  try {
    await t.test('live WAL backup boots as a separate application', async inner => {
      const liveDirectory = join(directory, 'live'), secret = randomBytes(32).toString('base64url');
      const live = await startApp(inner, liveDirectory, secret);
      const owner = await live.request('/api/identity/password/bootstrap', {name: 'Recovery Owner', email: 'owner@recovery.example', password, bootstrap_secret: secret});
      assert.equal(owner.status, 201);
      const brand = await live.request('/api/catalog/brands', {name: 'Recovery Brand', industry: 'Food'}, owner.cookie);
      const other = await live.request('/api/catalog/brands', {name: 'Separate Brand', industry: 'Design'}, owner.cookie);
      assert.equal(brand.status, 201); assert.equal(other.status, 201);
      const invitation = await live.request('/api/identity/invitations', {email: 'other@recovery.example', role: 'brand', brand_id: other.data.id}, owner.cookie);
      assert.equal(invitation.status, 201);
      const outsider = await live.request('/api/identity/password/register', {name: 'Other Brand', email: 'other@recovery.example', password, token: invitation.data.invitation_token});
      assert.equal(outsider.status, 201);

      // Deterministic synthetic campaign/media fixture, using the actual application schema.
      const bytes = await readFile(new URL('./fixtures/draft.mp4', import.meta.url));
      const db = new DatabaseSync(join(liveDirectory, 'voqro.sqlite'));
      try {
        db.exec('PRAGMA foreign_keys=ON');
        db.prepare('INSERT INTO campaigns(id,brand_id,name,budget,status) VALUES(?,?,?,?,?)').run('recovery_campaign', brand.data.id, 'Recovered campaign', 50001, 'Active');
        db.prepare('INSERT INTO creators(id,name) VALUES(?,?)').run('recovery_creator', 'Recovery Creator');
        db.prepare('INSERT INTO assignments VALUES(?,?,?)').run('recovery_assignment', 'recovery_campaign', 'recovery_creator');
        db.prepare('INSERT INTO deliverables(id,assignment_id,title,status) VALUES(?,?,?,?)').run('recovery_deliverable', 'recovery_assignment', 'Private recovered video', 'Draft');
        db.prepare('INSERT INTO uploads VALUES(?,?,?,?,?,?,?,?,?,?)').run('recovery_video', 'recovery_deliverable', owner.data.user.id, 'draft.mp4', 'video/mp4', bytes.length, 'video', 'Complete', createHash('sha256').update(bytes).digest('hex'), new Date().toISOString());
      } finally { db.close(); }
      await writeFile(join(liveDirectory, 'uploads/recovery_video'), bytes, {mode: 0o600});
      const invoice = await live.request('/api/commerce/invoices', {campaign_id: 'recovery_campaign', title: 'Recovery invoice', request_key: 'recovery-invoice', due_on: '2099-12-31', items: [{label: 'Fee', quantity: 1, unit_price: 50001, tax_bps: 1800}]}, owner.cookie);
      assert.equal(invoice.status, 201);

      const snapshot = join(directory, 'snapshot'), recoveredDirectory = join(directory, 'recovered');
      await createBackup({database: join(liveDirectory, 'voqro.sqlite'), uploads: join(liveDirectory, 'uploads'), destination: snapshot});
      await restoreBackup(snapshot, recoveredDirectory);
      const recovered = await startApp(inner, recoveredDirectory);
      assert.equal((await recovered.request('/api/health')).data.demo, false);
      assert.equal((await recovered.request('/api/identity/config')).data.bootstrap_required, false);
      for (const cookie of [owner.cookie, outsider.cookie, '']) {
        assert.equal((await recovered.request('/api/workspace', undefined, cookie)).status, 401);
        assert.equal((await recovered.request('/api/media/recovery_video', undefined, cookie)).status, 401);
      }
      const ownerLogin = await recovered.login('owner@recovery.example');
      const otherLogin = await recovered.login('other@recovery.example');
      assert.equal(ownerLogin.status, 200); assert.equal(otherLogin.status, 200);
      const workspace = await recovered.request('/api/workspace', undefined, ownerLogin.cookie);
      assert.equal(workspace.status, 200); assert.equal(workspace.data.user.id, owner.data.user.id);
      assert.ok(workspace.data.campaigns.some(campaign => campaign.id === 'recovery_campaign'));
      const savedInvoice = await recovered.request('/api/commerce/invoices/' + invoice.data.id, undefined, ownerLogin.cookie);
      assert.equal(savedInvoice.status, 200); assert.equal(savedInvoice.data.total, 59001);
      const media = await recovered.request('/api/media/recovery_video', undefined, ownerLogin.cookie);
      assert.equal(media.status, 200); assert.deepEqual(media.data, bytes);
      assert.match(media.headers.get('cache-control'), /no-store/);
      const partial = await recovered.request('/api/media/recovery_video', undefined, ownerLogin.cookie, {Range: 'bytes=0-31'});
      assert.equal(partial.status, 206); assert.deepEqual(partial.data, bytes.subarray(0, 32));
      const scoped = await recovered.request('/api/workspace', undefined, otherLogin.cookie);
      assert.deepEqual(scoped.data.brands.map(record => record.id), [other.data.id]);
      assert.equal((await recovered.request('/api/commerce/invoices/' + invoice.data.id, undefined, otherLogin.cookie)).status, 403);
      assert.equal((await recovered.request('/api/media/recovery_video', undefined, otherLogin.cookie)).status, 403);

      // Recovery remains separate: new writes and sessions do not change the source or backup.
      const newBrand = await recovered.request('/api/catalog/brands', {name: 'Recovery-only write', industry: 'Test'}, ownerLogin.cookie);
      assert.equal(newBrand.status, 201);
      const unchanged = await live.request('/api/workspace', undefined, owner.cookie);
      assert.equal(unchanged.status, 200); assert.equal(unchanged.data.brands.length, 2);
      assert.equal(unchanged.data.brands.some(record => record.id === newBrand.data.id), false);
      await verifyBackup(snapshot);
    });
  } finally { await rm(directory, {recursive: true, force: true}); }
});
