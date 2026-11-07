import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, createHash} from 'node:crypto';
import {identityConfig} from '../identity.mjs';

const appOrigin='https://agency.example';
const password='Test account password 123!';
const path='/api/identity/password/';
async function fixture(t, extra={}) {
  const directory=await mkdtemp(join(tmpdir(),'voqro-password-')), database=join(directory,'accounts.sqlite'), secret=randomBytes(32).toString('base64url');
  let child,base,db;
  const environment={...process.env,NODE_ENV:'test',DEMO_MODE:'0',AUTH_PROVIDER:'password',APP_BASE_URL:appOrigin,IDENTITY_BOOTSTRAP_EMAIL:'owner@example.com',IDENTITY_BOOTSTRAP_SECRET:secret,AUTH_ALLOW_INSECURE_LOCAL:'0',DB_PATH:database,UPLOAD_PATH:join(directory,'uploads'),AWS_MEDIA_ENABLED:'0',AWS_AI_ENABLED:'0',INSTAGRAM_PUBLISH_ENABLED:'0',NOTIFICATION_EMAIL_ENABLED:'0',...extra};
  async function start(overrides={}) {
    child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','--input-type=module','-e',"import {app,server} from './server.mjs'; if(typeof app.use!=='function'||app.get('trust proxy')!==false)throw Error('Express middleware missing'); server.listen(0,'127.0.0.1',()=>console.log('PORT:'+server.address().port));"],{cwd:resolve(import.meta.dirname,'..'),env:{...environment,...overrides},stdio:['ignore','pipe','pipe']});
    base=await new Promise((resolvePort,reject)=>{let output='',error='';const timeout=setTimeout(()=>{child.kill();reject(new Error('Backend startup timed out.'));},10000);child.stderr.on('data',chunk=>{error+=chunk;});child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/PORT:(\d+)/);if(match){clearTimeout(timeout);resolvePort('http://127.0.0.1:'+match[1]);}});child.once('exit',code=>{clearTimeout(timeout);if(!output.includes('PORT:'))reject(new Error('Backend exited '+code+': '+error));});});
    db=new DatabaseSync(database);
  }
  async function stop(){db?.close();db=null;if(child&&child.exitCode===null){const exited=new Promise(resolveExit=>child.once('exit',resolveExit));child.kill('SIGTERM');await exited;}}
  await start();t.after(async()=>{await stop();await rm(directory,{recursive:true,force:true});});
  async function request(endpoint,data,cookie='',headers={}) {
    const response=await fetch(base+endpoint,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json',Origin:appOrigin}),...(cookie?{Cookie:cookie}:{}),...headers},body:data===undefined?undefined:JSON.stringify(data),redirect:'manual'});
    const text=await response.text();return {status:response.status,data:text?JSON.parse(text):null,headers:response.headers,cookie:response.headers.getSetCookie().find(value=>/^(?:__Host-voqro_auth|voqro_auth_local)=/.test(value))?.split(';')[0]||'',cookies:response.headers.getSetCookie()};
  }
  const bootstrap=(fields={})=>request(path+'bootstrap',{email:'owner@example.com',name:'Owner',password,bootstrap_secret:secret,...fields});
  const login=(email='owner@example.com',pass=password)=>request(path+'login',{email,password:pass});
  const query=(sql,...args)=>db.prepare(sql).get(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  async function brand(cookie,name='Olive & Earth'){const result=await request('/api/catalog/brands',{name,industry:'Lifestyle'},cookie);assert.equal(result.status,201);return result.data.id;}
  async function invite(cookie,email='brand@example.com',fields={}){return request('/api/identity/invitations',{email,role:'brand',brand_id:await brand(cookie),...fields},cookie);}
  return {request,bootstrap,login,query,run,brand,invite,secret,restart:async overrides=>{await stop();await start(overrides);}};
}

test('password configuration is explicit, HTTPS is required and local development is separately opted in',()=>{
  assert.equal(identityConfig({AUTH_PROVIDER:'password'}).configured,false);
  assert.equal(identityConfig({AUTH_PROVIDER:'password',APP_BASE_URL:appOrigin}).configured,true);
  for(const url of ['http://agency.example','https://name:pass@agency.example','https://agency.example/path'])assert.equal(identityConfig({AUTH_PROVIDER:'password',APP_BASE_URL:url}).configured,false);
  assert.equal(identityConfig({AUTH_PROVIDER:'password',APP_BASE_URL:'http://localhost:3100'}).configured,false);
  const local=identityConfig({AUTH_PROVIDER:'password',APP_BASE_URL:'http://localhost:3100',AUTH_ALLOW_INSECURE_LOCAL:'1'});assert.equal(local.configured,true);assert.equal(local.insecureLocal,true);
  assert.equal(identityConfig({AUTH_PROVIDER:'password',APP_BASE_URL:appOrigin,IDENTITY_BOOTSTRAP_SECRET:'short'}).configured,false);
  assert.equal(identityConfig({AUTH_PROVIDER:'unrecognised'}).configured,false);
});

test('fresh Express backend bootstraps only explicit owner credentials and stores salted hashes plus secure sessions',async t=>{
  const f=await fixture(t);const publicData=await f.request('/api/public');
  assert.equal(publicData.data.demo,false);assert.equal(publicData.data.identity.provider,'Password');assert.equal(publicData.data.identity.bootstrap_required,true);assert.equal(JSON.stringify(publicData.data).includes(f.secret),false);
  assert.equal(f.query('SELECT COUNT(*) n FROM users').n,0);
  assert.equal((await f.bootstrap({email:'other@example.com'})).status,403);
  assert.equal((await f.bootstrap({bootstrap_secret:'incorrect'.repeat(5)})).status,403);
  assert.equal((await f.bootstrap({password:'short'})).status,400);
  const blocked=await f.request(path+'bootstrap',{email:'owner@example.com',name:'Owner',password,bootstrap_secret:f.secret},'',{Origin:'https://attacker.example'});assert.equal(blocked.status,403);
  const missingOrigin=await f.request(path+'login',{email:'owner@example.com',password},'',{Origin:''});assert.equal(missingOrigin.status,403);
  const owner=await f.bootstrap({role:'brand',brand_id:'made-up'});assert.equal(owner.status,201);assert.equal(owner.data.user.role,'owner');assert.equal(owner.data.user.brand_id,null);
  assert.match(owner.cookies[0],/^__Host-voqro_auth=.*HttpOnly; Secure; SameSite=Strict/);assert.equal(owner.headers.has('x-powered-by'),false);
  const stored=f.query('SELECT * FROM password_credentials');assert.notEqual(stored.password_hash,password);assert.equal(Buffer.from(stored.salt,'base64url').length,32);assert.equal(Buffer.from(stored.password_hash,'base64url').length,64);
  const raw=owner.cookie.split('=')[1];assert.equal(f.query('SELECT token FROM identity_sessions').token,createHash('sha256').update(raw).digest('hex'));
  assert.equal((await f.request('/api/workspace',undefined,owner.cookie)).data.user.id,owner.data.user.id);
  assert.equal((await f.request('/api/public')).data.identity.bootstrap_required,false);
  assert.equal((await f.bootstrap()).status,409);
  assert.equal((await f.request(path+'login')).status,405);
  assert.equal((await f.request('/api/identity/start')).status,503);
});

test('password invitations are single-use, email bound, scoped, revocable and secret-free in member lists',async t=>{
  const f=await fixture(t),owner=await f.bootstrap(),invitation=await f.invite(owner.cookie);
  assert.equal(invitation.status,201);assert.match(invitation.data.invitation_token,/^[A-Za-z0-9_-]{43}$/);
  const url=new URL(invitation.data.registration_url);assert.equal(url.pathname,'/register');assert.equal(url.search,'');assert.equal(new URLSearchParams(url.hash.slice(1)).get('email'),'brand@example.com');
  assert.notEqual(f.query('SELECT token_hash FROM password_invitation_tokens').token_hash,invitation.data.invitation_token);
  const members=await f.request('/api/identity/members',undefined,owner.cookie);assert.equal(members.data.members[0].email_verified,false);for(const value of [password,f.secret,invitation.data.invitation_token,'password_hash','token_hash'])assert.equal(JSON.stringify(members.data).includes(value),false);
  assert.equal((await f.request('/api/identity/invitations',{email:'brand@example.com',role:'brand',brand_id:invitation.data.brand_id},owner.cookie)).status,409);
  assert.equal((await f.request(path+'register',{email:'other@example.com',name:'Wrong person',password,token:invitation.data.invitation_token})).status,403);
  const member=await f.request(path+'register',{email:'BRAND@example.com',name:'Brand',password,token:invitation.data.invitation_token,role:'owner',brand_id:'other-brand'});assert.equal(member.status,201);assert.equal(member.data.user.role,'brand');assert.equal(member.data.user.brand_id,invitation.data.brand_id);
  assert.notEqual(f.query('SELECT salt FROM password_credentials WHERE user_id=?',member.data.user.id).salt,f.query('SELECT salt FROM password_credentials WHERE user_id=?',owner.data.user.id).salt);
  assert.equal((await f.request(path+'register',{email:'brand@example.com',name:'Replay',password,token:invitation.data.invitation_token})).status,403);
  assert.equal(f.query('SELECT COUNT(*) n FROM password_invitation_tokens').n,0);
  const workspace=await f.request('/api/workspace',undefined,member.cookie);assert.equal(workspace.data.brands.length,1);assert.equal(workspace.data.brands[0].id,invitation.data.brand_id);assert.deepEqual(workspace.data.leads,[]);
  assert.equal((await f.request('/api/identity/members',undefined,member.cookie)).status,403);assert.equal((await f.request('/api/identity/invitations',{email:'takeover@example.com',role:'owner'},member.cookie)).status,403);
  const expired=await f.invite(owner.cookie,'expired@example.com');f.run('UPDATE identity_invitations SET expires=0 WHERE id=?',expired.data.id);assert.equal((await f.request(path+'register',{email:'expired@example.com',name:'Expired',password,token:expired.data.invitation_token})).status,403);
  const revoked=await f.invite(owner.cookie,'revoked@example.com');assert.equal((await f.request('/api/identity/invitations/revoke',{id:revoked.data.id,reason:'Wrong recipient'},owner.cookie)).status,200);assert.equal((await f.request(path+'register',{email:'revoked@example.com',name:'Revoked',password,token:revoked.data.invitation_token})).status,403);
});

test('password login fails generically and durable attempt limits bound repeated guessing',async t=>{
  const f=await fixture(t);await f.bootstrap();
  const known=await f.login('owner@example.com','An incorrect password'),unknown=await f.login('nobody@example.com','An incorrect password');assert.equal(known.status,401);assert.equal(unknown.status,401);assert.equal(known.data.error,unknown.data.error);
  assert.equal((await f.login('owner@example.com','x'.repeat(129))).status,400);
  for(let attempt=0;attempt<8;attempt++)assert.equal((await f.login('owner@example.com','An incorrect password')).status,401);
  await f.restart();const limited=await f.login();assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
  assert.equal(f.query('SELECT COUNT(*) n FROM identity_accounts').n,1);
});

test('password changes revoke every old session and membership changes enforce last-owner protection',async t=>{
  const f=await fixture(t),owner=await f.bootstrap(),secondSession=await f.login();assert.equal(secondSession.status,200);
  const originalSalt=f.query('SELECT salt FROM password_credentials').salt;
  assert.equal((await f.request(path+'change-password',{current_password:'Incorrect password',new_password:'New account password 456!'},owner.cookie)).status,401);
  const changed=await f.request(path+'change-password',{current_password:password,new_password:'New account password 456!'},owner.cookie);assert.equal(changed.status,200);assert.equal(changed.data.sessions_revoked,true);assert.notEqual(f.query('SELECT salt FROM password_credentials').salt,originalSalt);
  for(const cookie of [owner.cookie,secondSession.cookie])assert.equal((await f.request('/api/workspace',undefined,cookie)).status,401);
  assert.equal((await f.login()).status,401);assert.equal((await f.login('owner@example.com','New account password 456!')).status,200);
  const sole=await f.request('/api/identity/members/update',{id:owner.data.user.id,role:'finance',status:'Active',reason:'Accidental change'},changed.cookie);assert.equal(sole.status,409);
  const invitation=await f.request('/api/identity/invitations',{email:'manager@example.com',role:'manager'},changed.cookie);const manager=await f.request(path+'register',{email:'manager@example.com',name:'Manager',password,token:invitation.data.invitation_token});assert.equal(manager.status,201);
  assert.equal((await f.request('/api/identity/members/update',{id:manager.data.user.id,role:'manager',status:'Disabled',reason:'Access ended'},changed.cookie)).status,200);
  assert.equal((await f.request('/api/workspace',undefined,manager.cookie)).status,401);assert.equal((await f.login('manager@example.com')).status,401);
});

test('password accounts and sessions survive backend restart without retaining the bootstrap secret',async t=>{
  const f=await fixture(t),owner=await f.bootstrap();const brand=await f.brand(owner.cookie);
  await f.restart({IDENTITY_BOOTSTRAP_SECRET:'',IDENTITY_BOOTSTRAP_EMAIL:''});
  assert.equal((await f.request('/api/workspace',undefined,owner.cookie)).data.brands[0].id,brand);
  assert.equal((await f.login()).status,200);assert.equal((await f.request('/api/identity/config')).data.bootstrap_required,false);
  assert.equal((await f.request('/api/logout',{},owner.cookie)).status,200);assert.equal((await f.request('/api/workspace',undefined,owner.cookie)).status,401);
  assert.equal(f.query('SELECT COUNT(*) n FROM password_credentials').n,1);
});

test('local password development uses its own non-Secure cookie only with explicit loopback opt-in',async t=>{
  const f=await fixture(t,{APP_BASE_URL:'http://localhost:3100',AUTH_ALLOW_INSECURE_LOCAL:'1'});
  const result=await f.request(path+'bootstrap',{email:'owner@example.com',name:'Owner',password,bootstrap_secret:f.secret},'',{Origin:'http://localhost:3100'});assert.equal(result.status,201);assert.match(result.cookies[0],/^voqro_auth_local=/);assert.equal(result.cookies[0].includes('Secure'),false);assert.match(result.cookies[0],/HttpOnly; SameSite=Strict/);
  assert.equal((await f.request('/api/workspace',undefined,result.cookie)).status,200);
});

test('concurrent bootstrap and invitation claims create exactly one membership per authorization',async t=>{
  const f=await fixture(t),bootstrap=await Promise.all([f.bootstrap(),f.bootstrap()]);assert.deepEqual(bootstrap.map(result=>result.status).sort(),[201,409]);assert.equal(f.query('SELECT COUNT(*) n FROM identity_bootstrap').n,1);
  const owner=bootstrap.find(result=>result.status===201),invitation=await f.invite(owner.cookie);
  const data={email:'brand@example.com',name:'Brand',password,token:invitation.data.invitation_token};
  const claimed=await Promise.all([f.request(path+'register',data),f.request(path+'register',data)]);assert.deepEqual(claimed.map(result=>result.status).sort(),[201,409]);assert.equal(f.query('SELECT COUNT(*) n FROM identity_accounts').n,2);assert.equal(f.query('SELECT COUNT(*) n FROM password_invitation_tokens').n,0);
});
