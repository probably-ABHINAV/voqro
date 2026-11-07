import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,sign,createHash,randomUUID} from 'node:crypto';
import {createIdentity,identityConfig,verifyCognitoToken} from '../identity.mjs';

const key=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...key.publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
const issuer='https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_Example';
const clientId='exampleclient123';
const cfg={issuer,clientId,domain:'https://example.auth.ap-south-1.amazoncognito.com',baseURL:'https://agency.example',bootstrapEmail:'owner@example.com',demoMode:false,configured:true,missing:[],problem:null};
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function signed(claims,header={alg:'RS256',kid:jwk.kid}){const data=encode(header)+'.'+encode(claims);return data+'.'+sign('RSA-SHA256',Buffer.from(data),key.privateKey).toString('base64url');}
function claims(extra={}){const time=Math.floor(Date.now()/1000);return {iss:issuer,aud:clientId,sub:'provider-owner',email:'owner@example.com',email_verified:true,nonce:'expected-nonce',iat:time,exp:time+3600,token_use:'id',name:'Verified Owner',...extra};}

async function fixture(t,configuration=cfg,options={}){
 const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,brand_id TEXT,creator_id TEXT);
 CREATE TABLE brands(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE creators(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER);
 INSERT INTO users VALUES('u_owner','Demo owner','owner',NULL,NULL);
 INSERT INTO brands VALUES('brand-a','Brand A'),('brand-b','Brand B');INSERT INTO creators VALUES('creator-a','Creator A');`);
 const row=(sql,...args)=>db.prepare(sql).get(...args),rows=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 const requireThat=(value,status,message)=>{if(!value)throw Object.assign(new Error(message),{status});};
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
 const textField=(v,name,max)=>{requireThat(typeof v==='string'&&v.trim()&&v.length<=max,400,name+' is required.');return v.trim();};
 const send=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(JSON.stringify(data));};
 const body=async req=>{let data='';for await(const chunk of req)data+=chunk;if(options.beforeBodyReturn)await options.beforeBodyReturn(req);return JSON.parse(data||'{}');};
 const tokens=new Map(),exchanges=[];let keyReads=0;
 const transport=async(url,options)=>{if(url.endsWith('/.well-known/jwks.json')){keyReads++;return {keys:[jwk]};}assert.equal(url,cfg.domain+'/oauth2/token');const form=new URLSearchParams(options.body);exchanges.push(form);const token=tokens.get(form.get('code'));if(!token)throw new Error('invalid grant');return {id_token:token};};
 const identity=createIdentity({db,row,rows,run,id:prefix=>prefix+'_'+randomUUID().replaceAll('-',''),now:()=>new Date().toISOString(),transaction,requireThat,textField,send,body,config:configuration,transport});
 const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://test').pathname;if(await identity.handlePublic(req,res,path))return;const user=req.headers['x-test-demo']==='true'?row("SELECT * FROM users WHERE id='u_owner'"):identity.session(req);requireThat(user,401,'No session.');if(path==='/api/whoami')return send(res,200,user);if(path==='/api/logout')return identity.logout(req,res);if(await identity.handleAuthed(req,res,path,user))return;send(res,404,{});}catch(e){send(res,e.status||500,{error:e.message});}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
 async function request(path,data,cookie='',extra={}){const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Cookie:cookie,...(data===undefined?{}:{'Content-Type':'application/json'}),...extra},body:data===undefined?undefined:JSON.stringify(data),redirect:'manual'});const text=await response.text();return {status:response.status,headers:response.headers,data:text?JSON.parse(text):null,cookies:response.headers.getSetCookie()};}
 async function start(){const result=await request('/api/identity/start');if(result.status!==303)return result;const url=new URL(result.headers.get('location'));return {...result,state:url.searchParams.get('state'),nonce:url.searchParams.get('nonce'),challenge:url.searchParams.get('code_challenge'),cookie:result.cookies[0].split(';')[0],url};}
 async function login(extra={}){const flow=await start();if(flow.status!==303)return flow;const code=randomUUID();tokens.set(code,signed(claims({nonce:flow.nonce,...extra})));const response=await request('/api/identity/callback?'+new URLSearchParams({state:flow.state,code}),undefined,flow.cookie);return {...response,flow,code,cookie:response.cookies.find(v=>v.startsWith('__Host-voqro_auth='))?.split(';')[0]||''};}
 return {db,row,rows,run,identity,request,start,login,tokens,exchanges,getKeyReads:()=>keyReads};
}

test('Cognito ID tokens verify signature, issuer, audience, nonce, time, purpose and verified email',async()=>{
 const options={issuer,clientId,nonce:'expected-nonce',jwks:{keys:[jwk]}};
 assert.equal((await verifyCognitoToken(signed(claims()),options)).email,'owner@example.com');
 for(const change of [{iss:'https://wrong.example'},{aud:'other-client'},{nonce:'wrong'},{exp:Math.floor(Date.now()/1000)-1},{iat:Math.floor(Date.now()/1000)+120},{token_use:'access'},{email_verified:false},{email_verified:'true'},{sub:''},{azp:'another-client'}])await assert.rejects(verifyCognitoToken(signed(claims(change)),options),/verification failed/);
 await assert.rejects(verifyCognitoToken(signed(claims(),{alg:'HS256',kid:jwk.kid}),options),/verification failed/);
 await assert.rejects(verifyCognitoToken(signed(claims(),{alg:'none',kid:jwk.kid}),options),/verification failed/);
 const token=signed(claims());await assert.rejects(verifyCognitoToken(token.slice(0,-8)+'AAAAAAAA',options),/verification failed/);
 await assert.rejects(verifyCognitoToken(token,{...options,jwks:{keys:[jwk,jwk]}}),/verification failed/);
});

test('configuration fails closed, production sign-in is disabled in demo mode and demo IDs are isolated',async t=>{
 const missing=identityConfig({});assert.equal(missing.configured,false);assert.deepEqual(missing.missing,['COGNITO_ISSUER','COGNITO_CLIENT_ID','COGNITO_DOMAIN','APP_BASE_URL']);
 assert.equal(identityConfig({COGNITO_ISSUER:issuer,COGNITO_CLIENT_ID:clientId,COGNITO_DOMAIN:cfg.domain,APP_BASE_URL:'http://insecure.example'}).configured,false);
 const f=await fixture(t,{...cfg,demoMode:true});assert.equal((await f.start()).status,503);assert.equal(f.exchanges.length,0);assert.equal(f.identity.isDemoUser('u_owner'),true);assert.equal(f.identity.isDemoUser('member_fake'),false);
 assert.equal((await f.request('/api/identity/invitations',{email:'attacker@example.com',role:'owner'},'',{'x-test-demo':'true'})).status,403);
});

test('state and PKCE bind sign-in to one browser, callback is single-use and bootstrap is explicit',async t=>{
 const f=await fixture(t);const begin=await f.start();assert.equal(begin.status,303);assert.equal(begin.url.searchParams.get('code_challenge_method'),'S256');assert.equal(begin.url.searchParams.get('redirect_uri'),cfg.baseURL+'/api/identity/callback');assert.match(begin.cookies[0],/HttpOnly; Secure; SameSite=Lax/);
 const code='proof-code';f.tokens.set(code,signed(claims({nonce:begin.nonce})));const path='/api/identity/callback?'+new URLSearchParams({state:begin.state,code});
 assert.equal((await f.request(path)).status,401);assert.equal(f.exchanges.length,0);assert.equal((await f.request(path,undefined,'__Host-voqro_oidc='+ 'a'.repeat(43))).status,401);
 const signedIn=await f.request(path,undefined,begin.cookie);assert.equal(signedIn.status,303);assert.equal(signedIn.headers.get('location'),cfg.baseURL+'/#workspace');const auth=signedIn.cookies.find(v=>v.startsWith('__Host-voqro_auth='));assert.match(auth,/HttpOnly; Secure; SameSite=Strict/);
 assert.equal(createHash('sha256').update(f.exchanges[0].get('code_verifier')).digest('base64url'),begin.challenge);assert.equal(f.exchanges[0].get('grant_type'),'authorization_code');assert.equal((await f.request(path,undefined,begin.cookie)).status,401);
 const user=(await f.request('/api/whoami',undefined,auth.split(';')[0])).data;assert.equal(user.role,'owner');assert.notEqual(user.id,'u_owner');assert.equal(f.row('SELECT COUNT(*) AS n FROM identity_bootstrap').n,1);assert.equal(f.identity.isDemoUser('u_owner'),false);assert.equal((await f.request('/api/identity/members',undefined,'',{'x-test-demo':'true'})).status,403);
 const ownerAgain=await f.login();assert.equal(ownerAgain.status,303);assert.equal(f.row('SELECT COUNT(*) AS n FROM identity_accounts').n,1);
});

test('uninvited identities cannot join and verified invites enforce role and tenant instead of token attributes',async t=>{
 const f=await fixture(t);assert.equal((await f.login({email:'stranger@example.com',sub:'stranger'})).status,403);assert.equal(f.row('SELECT COUNT(*) AS n FROM identity_accounts').n,0);
 const owner=await f.login();assert.equal(owner.status,303);const payload={email:'Brand@Example.com',role:'brand',brand_id:'brand-a',days:2};const invite=await f.request('/api/identity/invitations',payload,owner.cookie);assert.equal(invite.status,201);assert.equal(invite.data.email_sent,false);assert.equal(invite.data.provider_user_created,false);assert.equal((await f.request('/api/identity/invitations',payload,owner.cookie)).data.id,invite.data.id);
 assert.equal((await f.request('/api/identity/invitations',{...payload,brand_id:'brand-b'},owner.cookie)).status,409);
 assert.equal((await f.request('/api/identity/invitations',{email:'bad@example.com',role:'brand',brand_id:'missing'},owner.cookie)).status,400);
 const brand=await f.login({email:'brand@example.com',sub:'provider-brand',name:'Brand Member','custom:role':'owner','custom:brand_id':'brand-b'});assert.equal(brand.status,303);const user=(await f.request('/api/whoami',undefined,brand.cookie)).data;assert.equal(user.role,'brand');assert.equal(user.brand_id,'brand-a');assert.equal(user.creator_id,null);assert.equal((await f.request('/api/identity/members',undefined,brand.cookie)).status,403);assert.equal((await f.request('/api/identity/invitations',{email:'forged@example.com',role:'owner'},brand.cookie)).status,403);
 assert.equal((await f.login({email:'brand@example.com',sub:'different-subject'})).status,403);assert.equal((await f.login({email:'changed@example.com',sub:'provider-brand'})).status,403);
});

test('revocation, expiry, member disable and last-owner protection immediately enforce access',async t=>{
 const f=await fixture(t),owner=await f.login();const ownerUser=(await f.request('/api/whoami',undefined,owner.cookie)).data;
 assert.equal((await f.request('/api/identity/members/update',{id:ownerUser.id,role:'finance',status:'Active',reason:'Accidental demotion'},owner.cookie)).status,409);
 const invite=await f.request('/api/identity/invitations',{email:'creator@example.com',role:'creator',creator_id:'creator-a'},owner.cookie);
 assert.equal((await f.request('/api/identity/invitations/revoke',{id:invite.data.id,reason:'Wrong recipient'},owner.cookie)).status,200);assert.equal((await f.login({email:'creator@example.com',sub:'provider-creator'})).status,403);
 const renewed=await f.request('/api/identity/invitations',{email:'creator@example.com',role:'creator',creator_id:'creator-a'},owner.cookie);f.run('UPDATE identity_invitations SET expires=? WHERE id=?',Date.now()-1000,renewed.data.id);assert.equal((await f.login({email:'creator@example.com',sub:'provider-creator'})).status,403);
 await f.request('/api/identity/invitations',{email:'creator@example.com',role:'creator',creator_id:'creator-a'},owner.cookie);const creator=await f.login({email:'creator@example.com',sub:'provider-creator'});assert.equal(creator.status,303);const creatorUser=(await f.request('/api/whoami',undefined,creator.cookie)).data;
 assert.equal((await f.request('/api/identity/members/revoke-sessions',{id:creatorUser.id,reason:'Lost browser'},owner.cookie)).status,200);assert.equal((await f.request('/api/whoami',undefined,creator.cookie)).status,401);
 const again=await f.login({email:'creator@example.com',sub:'provider-creator'});assert.equal(again.status,303);assert.equal((await f.request('/api/identity/members/update',{id:creatorUser.id,role:'creator',creator_id:'creator-a',status:'Disabled',reason:'Partnership ended'},owner.cookie)).status,200);assert.equal((await f.request('/api/whoami',undefined,again.cookie)).status,401);assert.equal((await f.login({email:'creator@example.com',sub:'provider-creator'})).status,403);
 assert.equal((await f.request('/api/logout',{},owner.cookie)).status,200);assert.equal((await f.request('/api/whoami',undefined,owner.cookie)).status,401);assert.ok(f.row('SELECT COUNT(*) AS n FROM identity_audit').n>=6);
});

test('expired flows, unverified email and token failures never create a session',async t=>{
 const f=await fixture(t);const flow=await f.start();f.run('UPDATE identity_flows SET expires=?',Date.now()-1);assert.equal((await f.request('/api/identity/callback?'+new URLSearchParams({state:flow.state,code:'expired'}),undefined,flow.cookie)).status,401);
 assert.equal((await f.login({email_verified:false})).status,401);assert.equal((await f.login({nonce:'forged'})).status,401);assert.equal(f.row('SELECT COUNT(*) AS n FROM identity_sessions').n,0);assert.equal(f.row('SELECT COUNT(*) AS n FROM identity_accounts').n,0);
 const unavailable=await f.start();const failedPath='/api/identity/callback?'+new URLSearchParams({state:unavailable.state,code:'missing-provider-code'});const failure=await f.request(failedPath,undefined,unavailable.cookie);assert.equal(failure.status,502);assert.match(failure.data.error,/no session was created/);assert.equal((await f.request(failedPath,undefined,unavailable.cookie)).status,401);assert.equal(f.row('SELECT COUNT(*) AS n FROM identity_sessions').n,0);
 const disabled=await fixture(t,{...cfg,bootstrapEmail:''});assert.equal((await disabled.login()).status,403);assert.equal(disabled.row('SELECT COUNT(*) AS n FROM identity_bootstrap').n,0);
});

test('owner writes recheck the live role and session after delayed request bodies',async t=>{
 let gate;const f=await fixture(t,cfg,{beforeBodyReturn:async req=>{if(req.headers['x-test-pause']){gate.entered();await gate.wait;}}});
 const first=await f.login(),firstUser=(await f.request('/api/whoami',undefined,first.cookie)).data;
 await f.request('/api/identity/invitations',{email:'second@example.com',role:'owner'},first.cookie);
 const second=await f.login({email:'second@example.com',sub:'second-owner'});assert.equal(second.status,303);
 function pause(){let entered,release;const started=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);gate={entered,wait};return {started,release};}
 const one=pause();const pendingInvite=f.request('/api/identity/invitations',{email:'forged@example.com',role:'owner'},first.cookie,{'x-test-pause':'1'});await one.started;
 assert.equal((await f.request('/api/identity/members/revoke-sessions',{id:firstUser.id,reason:'Session revoked while request body is pending'},second.cookie)).status,200);
 one.release();assert.equal((await pendingInvite).status,401);assert.equal(f.row("SELECT id FROM identity_invitations WHERE email='forged@example.com'"),undefined);
 const signedAgain=await f.login();const two=pause();const pendingPromotion=f.request('/api/identity/members/update',{id:firstUser.id,role:'owner',status:'Active',reason:'Attempt to retain old privileges'},signedAgain.cookie,{'x-test-pause':'1'});await two.started;
 assert.equal((await f.request('/api/identity/members/update',{id:firstUser.id,role:'manager',status:'Active',reason:'Demotion while request body is pending'},second.cookie)).status,200);
 two.release();assert.equal((await pendingPromotion).status,403);assert.equal(f.row('SELECT role FROM users WHERE id=?',firstUser.id).role,'manager');
});
