import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync, sign, randomUUID} from 'node:crypto';
import {createIdentity, identityConfig} from '../identity.mjs';
import {clerkConfig, verifyClerkSessionToken} from '../clerk-identity.mjs';

const origin = 'https://agency.example';
const issuer = 'https://testing.clerk.accounts.dev';
const key = generateKeyPairSync('rsa', {modulusLength: 2048});
const settings = {requested: true, configured: true, baseURL: origin, issuer, secretKey: 'sk_test_example', jwtKey: key.publicKey.export({format: 'pem', type: 'spki'})};
const password = 'Voqro test account passphrase!';
function token(extra = {}, privateKey = key.privateKey) {
  const time = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const data = encode({alg: 'RS256', typ: 'JWT', kid: 'test'}) + '.' + encode({iss: issuer, azp: origin, sub: 'user_owner', sid: 'sess_owner', iat: time, nbf: time - 1, exp: time + 60, ...extra});
  return data + '.' + sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url');
}

async function fixture(t, extra = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,brand_id TEXT,creator_id TEXT);
    CREATE TABLE brands(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE creators(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER);
    INSERT INTO brands VALUES('brand-a','A'),('brand-b','B');`);
  const row = (sql, ...args) => db.prepare(sql).get(...args), rows = (sql, ...args) => db.prepare(sql).all(...args), run = (sql, ...args) => db.prepare(sql).run(...args);
  const requireThat = (value, status, message) => { if (!value) throw Object.assign(Error(message), {status}); };
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const cfg = identityConfig({AUTH_PROVIDER: 'password', APP_BASE_URL: origin, IDENTITY_BOOTSTRAP_EMAIL: 'owner@example.com', IDENTITY_BOOTSTRAP_SECRET: 'a'.repeat(40)});
  const users = new Map(), sessions = new Map(), memberships = new Map();
  let providerReads = 0, afterRead;
  function addUser(subject, email, sid = subject.replace('user_', 'sess_')) {
    users.set(subject, {id: subject, firstName: 'Test', primaryEmailAddressId: 'email1', emailAddresses: [{id: 'email1', emailAddress: email, verification: {status: 'verified'}}]});
    sessions.set(sid, {id: sid, userId: subject, status: 'active', createdAt: Date.now() - 10000, expireAt: Date.now() + 3600000});
  }
  addUser('user_owner', 'owner@example.com');
  const provider = {
    organizations:{updateOrganizationMembership:async()=>({}),getOrganizationMembershipList:async({organizationId,userId})=>({data:memberships.get(organizationId)?.has(userId[0])?[{organization:{id:organizationId},publicUserData:{userId:userId[0]},role:'org:member'}]:[]}),createOrganizationMembership:async({organizationId,userId})=>{if(!memberships.has(organizationId))memberships.set(organizationId,new Set());memberships.get(organizationId).add(userId);return {}; }},
    users: {getUserList:async({emailAddress})=>{const data=[...users.values()].filter(u=>u.emailAddresses.some(e=>emailAddress.includes(e.emailAddress)));return {data,totalCount:data.length};},createUser:async({emailAddress})=>{const subject='user_new';addUser(subject,emailAddress[0]);users.get(subject).emailAddresses[0].verification.status='unverified';return users.get(subject);},getUser: async subject => { providerReads++; if (afterRead) { const fn = afterRead; afterRead = null; fn(); } if (!users.has(subject)) throw Error('missing'); return users.get(subject); }},
    sessions: {getSession: async sid => { providerReads++; if (!sessions.has(sid)) throw Error('missing'); return sessions.get(sid); }},
  };
  const send = (res, status, data, headers = {}) => { res.writeHead(status, {'Content-Type': 'application/json', ...headers}); res.end(JSON.stringify(data)); };
  const identity = createIdentity({db, row, rows, run, id: prefix => prefix + randomUUID(), now: () => new Date().toISOString(), transaction, requireThat,
    textField: (v, name, max = 1000) => { requireThat(typeof v === 'string' && v.trim() && v.length <= max, 400, name); return v.trim(); },
    send, body: async req => { let data = ''; for await (const chunk of req) data += chunk; return JSON.parse(data || '{}'); }, config: cfg,
    clerkOptions: {configuration: {...settings, ...extra}, provider},
  });
  const server = http.createServer(async (req, res) => {
    try {
      const path = req.url;
      if (await identity.handlePublic(req, res, path)) return;
      await identity.prepare(req);
      const user = identity.session(req); requireThat(user, 401, 'No session.');
      if (path === '/api/whoami') return send(res, 200, user);
      if (path === '/api/logout') return identity.logout(req, res);
      if (await identity.handleAuthed(req, res, path, user)) return;
      send(res, 404, {});
    } catch (e) { send(res, e.status || 500, {error: e.message}); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, data, cookie = '', jwt, requestOrigin = origin, organizationId) {
    const res = await fetch(base + path, {method: data === undefined ? 'GET' : 'POST', headers: {...(organizationId?{'X-Voqro-Organization':organizationId}:{}),Cookie: cookie, Origin: requestOrigin, 'Content-Type': 'application/json', ...(jwt ? {Authorization: 'Bearer ' + jwt} : {})}, body: data === undefined ? undefined : JSON.stringify(data)});
    return {status: res.status, data: await res.json(), cookie: res.headers.getSetCookie().find(v => v.startsWith('__Host-voqro_auth='))?.split(';')[0] || ''};
  }
  const bootstrap = () => request('/api/identity/password/bootstrap', {email: 'owner@example.com', name: 'Owner', password, bootstrap_secret: 'a'.repeat(40)});
  const link = (cookie, jwt = token(), currentPassword = password) => request('/api/identity/clerk/link', {current_password: currentPassword}, cookie, jwt);
  const exchange = (jwt = token(), cookie = '', organizationId) => request('/api/identity/clerk/exchange', organizationId?{organization_id:organizationId}:{}, cookie, jwt);
  return {db, row, run, cfg, identity, users, sessions, memberships, request, bootstrap, link, exchange, addUser, afterRead: fn => { afterRead = fn; }, reads: () => providerReads};
}

test('Clerk config is opt-in and fails closed for demo, missing keys and untrusted origins', () => {
  const env = {AUTH_PROVIDER: 'clerk', CLERK_ISSUER: issuer, CLERK_SECRET_KEY: 'sk_test_example', APP_BASE_URL: origin};
  assert.equal(identityConfig(env).configured, true);
  assert.equal(identityConfig({...env, CLERK_ISSUER: origin + '/__clerk'}).configured, true);
  assert.equal(identityConfig({...env, CLERK_ISSUER: 'https://other.example/__clerk'}).configured, false);
  for (const patch of [{CLERK_SECRET_KEY: ''}, {APP_BASE_URL: 'https://agency.example/extra'}, {APP_BASE_URL: 'http://agency.example'}, {CLERK_ISSUER: issuer + '/extra'}, {DEMO_MODE: '1'}]) assert.equal(identityConfig({...env, ...patch}).configured, false);
  assert.equal(clerkConfig({...env, AUTH_PROVIDER: 'password'}).configured, false);
  assert.equal(clerkConfig({...env, AUTH_PROVIDER: 'password', CLERK_MIGRATION_ENABLED: '1'}).configured, true);
});

test('official Clerk SDK rejects forged, expired, wrong-instance and wrong-frontend JWTs', async () => {
  assert.equal((await verifyClerkSessionToken(token(), settings)).sub, 'user_owner');
  const proxyIssuer = origin + '/__clerk';
  assert.equal((await verifyClerkSessionToken(token({iss: proxyIssuer}), {...settings, issuer: proxyIssuer})).sub, 'user_owner');
  await assert.rejects(verifyClerkSessionToken(token({iss: proxyIssuer + '/other'}), {...settings, issuer: proxyIssuer}), {status: 401});
  const time = Math.floor(Date.now() / 1000);
  for (const change of [{iss: 'https://other.clerk.accounts.dev'}, {azp: 'https://evil.example'}, {azp: undefined}, {exp: time - 1}, {nbf: time + 100}, {iat: time + 100}, {sid: undefined}, {sub: 'machine_123'}, {sts: 'pending'}, {act: {sub: 'actor'}}]) await assert.rejects(verifyClerkSessionToken(token(change), settings), {status: 401});
  await assert.rejects(verifyClerkSessionToken(token({}, generateKeyPairSync('rsa', {modulusLength: 2048}).privateKey), settings), {status: 401});
});

test('linking requires current local session, password, verified matching email and exact Origin', async t => {
  const f = await fixture(t), owner = await f.bootstrap();
  assert.equal(owner.status, 201);
  assert.equal((await f.link('')).status, 401);
  assert.equal((await f.link(owner.cookie, token(), 'wrong password')).status, 401);
  assert.equal((await f.request('/api/identity/clerk/link', {current_password: password}, owner.cookie, token(), 'https://evil.example')).status, 403);
  f.users.get('user_owner').emailAddresses[0].verification.status = 'unverified';
  assert.equal((await f.link(owner.cookie)).status, 403);
  f.users.get('user_owner').emailAddresses[0].verification.status = 'verified';
  f.users.get('user_owner').emailAddresses[0].emailAddress = 'other@example.com';
  assert.equal((await f.link(owner.cookie)).status, 403);
  f.users.get('user_owner').emailAddresses[0].emailAddress = 'owner@example.com';
  assert.equal((await f.link(owner.cookie)).status, 200);
  assert.equal(f.row('SELECT user_id FROM clerk_bindings').user_id, owner.data.user.id);
  assert.equal(f.row('SELECT COUNT(*) n FROM users').n, 1);
  assert.equal(f.row('SELECT COUNT(*) n FROM password_credentials').n, 1);
  assert.equal((await f.exchange()).status, 409);
  f.cfg.provider = 'clerk';
  assert.equal((await f.request('/api/whoami', undefined, owner.cookie)).status, 401);
  const connected = await f.exchange();
  assert.equal(connected.status, 200);
  const who = await f.request('/api/whoami', undefined, connected.cookie);
  assert.equal(who.data.id, owner.data.user.id); assert.equal(who.data.role, 'owner');
  assert.equal((await f.request('/api/identity/password/login', {email: 'owner@example.com', password})).status, 503);
  // Rolling back to password auth restores access to unchanged credentials.
  f.cfg.provider = 'password';
  assert.equal((await f.request('/api/whoami', undefined, connected.cookie)).status, 401);
  assert.equal((await f.request('/api/identity/password/login', {email: 'owner@example.com', password})).status, 200);
});

test('linking rechecks local session after asynchronous provider work', async t => {
  const f = await fixture(t), owner = await f.bootstrap();
  f.afterRead(() => f.run('DELETE FROM identity_sessions'));
  assert.equal((await f.link(owner.cookie)).status, 401);
  assert.equal(f.row('SELECT COUNT(*) n FROM clerk_bindings').n, 0);
});

test('existing emails never auto-merge and a different Clerk identity cannot replace a binding', async t => {
  const f = await fixture(t), owner = await f.bootstrap();
  f.cfg.provider = 'clerk';
  assert.equal((await f.exchange()).status, 403);
  f.cfg.provider = 'password';
  assert.equal((await f.link(owner.cookie)).status, 200);
  f.addUser('user_second', 'owner@example.com');
  assert.equal((await f.link(owner.cookie, token({sub: 'user_second', sid: 'sess_second'}))).status, 409);
});

test('Clerk sign-in never bootstraps an owner; invitation enforces brand scope and cannot be reused', async t => {
  const f = await fixture(t), owner = await f.bootstrap();
  await f.link(owner.cookie); f.cfg.provider = 'clerk';
  const signedIn = await f.exchange();
  f.addUser('user_brand', 'brand@example.com');
  const jwt = token({sub: 'user_brand', sid: 'sess_brand', org_role: 'org:admin', role: 'owner'});
  assert.equal((await f.exchange(jwt)).status, 403);
  const invite = await f.request('/api/identity/invitations', {email: 'brand@example.com', role: 'brand', brand_id: 'brand-a'}, signedIn.cookie);
  assert.equal(invite.status, 201);
  assert.equal(invite.data.sign_in_url, origin + '/login');
  const brand = await f.exchange(jwt); assert.equal(brand.status, 200);
  const who = await f.request('/api/whoami', undefined, brand.cookie);
  assert.equal(who.data.role, 'brand'); assert.equal(who.data.brand_id, 'brand-a');
  assert.equal((await f.request('/api/identity/members', undefined, brand.cookie)).status, 403);
  f.addUser('user_imposter', 'brand@example.com');
  assert.equal((await f.exchange(token({sub: 'user_imposter', sid: 'sess_imposter'}))).status, 403);
  assert.equal(f.row('SELECT status FROM identity_invitations').status, 'Accepted');
});

test('revocation, logout, disabled membership and provider session termination deny access and token refresh', async t => {
  const f = await fixture(t), owner = await f.bootstrap(); await f.link(owner.cookie); f.cfg.provider = 'clerk';
  let signedIn = await f.exchange();
  assert.equal((await f.request('/api/identity/members/revoke-sessions', {id: owner.data.user.id, reason: 'Security test'}, signedIn.cookie)).status, 200);
  assert.equal((await f.request('/api/whoami', undefined, signedIn.cookie)).status, 401);
  assert.equal((await f.exchange(token())).status, 401);
  f.sessions.get('sess_owner').createdAt = Date.now() + 1;
  signedIn = await f.exchange(); assert.equal(signedIn.status, 200);
  f.sessions.get('sess_owner').status = 'revoked';
  assert.equal((await f.request('/api/whoami', undefined, signedIn.cookie)).status, 401);
  f.sessions.get('sess_owner').status = 'active';
  f.run("UPDATE identity_accounts SET status='Disabled'");
  assert.equal((await f.request('/api/whoami', undefined, signedIn.cookie)).status, 401);
  assert.equal((await f.exchange()).status, 403);
  f.run("UPDATE identity_accounts SET status='Active'");
  assert.equal((await f.request('/api/logout', {}, signedIn.cookie)).status, 200);
  assert.equal((await f.exchange()).status, 401);
});

test('provider outages fail closed and never expose SDK errors or keys', async t => {
  const f = await fixture(t), owner = await f.bootstrap(); await f.link(owner.cookie); f.cfg.provider = 'clerk';
  const signedIn = await f.exchange(); f.users.delete('user_owner');
  const result = await f.request('/api/whoami', undefined, signedIn.cookie);
  assert.equal(result.status, 503);
  assert.equal(result.data.error, 'The identity provider is unavailable. Please retry.');
});

test('unconfigured Clerk makes no provider requests and does not interfere with password login', async t => {
  const f = await fixture(t, {configured: false}), owner = await f.bootstrap();
  assert.equal((await f.link(owner.cookie)).status, 503);
  assert.equal((await f.request('/api/whoami', undefined, owner.cookie)).status, 200);
  assert.equal(f.reads(), 0);
});

async function organizationFixture(t){
  const f=await fixture(t),owner=await f.bootstrap();await f.link(owner.cookie);f.cfg.provider='clerk';
  f.run("INSERT INTO workspace_organizations VALUES(?,?,?,?,?,?,?)",'org_agency',issuer,'agency','voqro',null,'Voqro',new Date().toISOString());
  for(const [org,brand] of [['org_brandA','brand-a'],['org_brandB','brand-b']])f.run('INSERT INTO workspace_organizations VALUES(?,?,?,?,?,?,?)',org,issuer,'brand',brand,'org_agency',brand,new Date().toISOString());
  for(const org of ['org_agency','org_brandA']){f.run('INSERT INTO workspace_org_members VALUES(?,?,?)',org,owner.data.user.id,new Date().toISOString());f.memberships.set(org,new Set(['user_owner']));}
  f.run('INSERT INTO workspace_org_config VALUES(1,1)');
  return {...f,owner};
}

test('organization exchange selects a scoped default; brand selection cannot retain owner privileges',async t=>{
 const f=await organizationFixture(t);
 const agency=await f.exchange();assert.equal(agency.status,200);assert.equal(agency.data.organization_id,'org_agency');
 assert.equal((await f.request('/api/whoami',undefined,agency.cookie)).data.role,'owner');
 const brand=await f.exchange(token({o:{id:'org_brandA',rol:'admin'},org_role:'org:admin'}),'','org_brandA');assert.equal(brand.status,200);
 const user=(await f.request('/api/whoami',undefined,brand.cookie)).data;
 assert.equal(user.role,'brand');assert.equal(user.brand_id,'brand-a');assert.equal(user.organization.id,'org_brandA');
 assert.equal((await f.request('/api/identity/members',undefined,brand.cookie)).status,403);
});
test('unknown organizations and membership in another Clerk organization grant no app access',async t=>{
 const f=await organizationFixture(t);
 for(const id of ['org_unknown','org_brandB']){f.memberships.set(id,new Set(['user_owner']));assert.equal((await f.exchange(token({org_id:id}),'',id)).status,403);}
});
test('Clerk organization membership has no effect; local grant removal denies existing workspace cookies',async t=>{
 const f=await organizationFixture(t),login=await f.exchange(token({org_id:'org_brandA'}),'','org_brandA');
 f.memberships.get('org_brandA').delete('user_owner');assert.equal((await f.request('/api/whoami',undefined,login.cookie)).status,200);
 f.memberships.get('org_brandA').add('user_owner');f.run('DELETE FROM workspace_org_members WHERE organization_id=?','org_brandA');
 assert.equal((await f.request('/api/whoami',undefined,login.cookie)).status,403);
});
test('cross-tab organization mismatch blocks both reads and mutations; missing mutation scope is denied',async t=>{
 const f=await organizationFixture(t),login=await f.exchange();
 assert.equal((await f.request('/api/whoami',undefined,login.cookie,undefined,origin,'org_brandA')).status,409);
 assert.equal((await f.request('/api/identity/invitations',{email:'new@example.com',role:'manager'},login.cookie)).status,409);
 const invited=await f.request('/api/identity/invitations',{email:'new@example.com',role:'manager'},login.cookie,undefined,origin,'org_agency');assert.equal(invited.status,201);
});
test('owner invitations enroll a new verified identity once without making a second login necessary',async t=>{
 const f=await organizationFixture(t),login=await f.exchange();
 await f.request('/api/identity/invitations',{email:'new@example.com',role:'brand',brand_id:'brand-a'},login.cookie,undefined,origin,'org_agency');
 assert.equal(f.memberships.get('org_brandA').has('user_new'),false);
 f.addUser('user_new','new@example.com');f.users.get('user_new').emailAddresses[0].verification.status='unverified';
 assert.equal((await f.exchange(token({sub:'user_new',sid:'sess_new'}))).status,403,'Reserved email must be verified before app access');
 f.addUser('user_new','new@example.com');
 const joined=await f.exchange(token({sub:'user_new',sid:'sess_new'}));assert.equal(joined.status,200);assert.equal(joined.data.organization_id,'org_brandA');
 const user=(await f.request('/api/whoami',undefined,joined.cookie)).data;assert.equal(user.role,'brand');
 f.run('DELETE FROM workspace_org_members WHERE user_id=?',user.id);
 assert.equal((await f.exchange(token({sub:'user_new',sid:'sess_new'}))).status,403,'Revoked access must not be regranted on sign-in');
});

test('Clerk organization claims are ignored and backend switching preserves the selected workspace across exchange',async t=>{
 const f=await organizationFixture(t),login=await f.exchange(token({org_id:'org_unrelated',o:{id:'org_unrelated',rol:'admin'}}));
 assert.equal(login.status,200);assert.equal(login.data.organization_id,'org_agency');
 const switched=await f.request('/api/organizations/switch',{organization_id:'org_brandA'},login.cookie,undefined,origin,'org_agency');assert.equal(switched.status,200);
 assert.equal((await f.request('/api/whoami',undefined,login.cookie)).data.role,'brand');
 const refreshed=await f.exchange(token(),login.cookie);assert.equal(refreshed.data.organization_id,'org_brandA');
 assert.equal((await f.request('/api/organizations/switch',{organization_id:'org_brandB'},refreshed.cookie,undefined,origin,'org_brandA')).status,403);
});
