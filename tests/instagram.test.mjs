import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createInstagram} from '../instagram.mjs';
import {createDelivery} from '../delivery.mjs';
import {createOperations} from '../operations.mjs';

function fixture(t,{publishEnabled=true,configuration=true,...options}={}){
 const directory=mkdtempSync(resolve(tmpdir(),'voqro-instagram-'));const db=new DatabaseSync(':memory:');
 t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,brand_id TEXT,creator_id TEXT);
 CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER);
 CREATE TABLE brands(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE creators(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE campaigns(id TEXT PRIMARY KEY,brand_id TEXT REFERENCES brands(id),name TEXT,description TEXT,status TEXT);
 CREATE TABLE assignments(id TEXT PRIMARY KEY,campaign_id TEXT REFERENCES campaigns(id),creator_id TEXT REFERENCES creators(id));
 CREATE TABLE deliverables(id TEXT PRIMARY KEY,assignment_id TEXT REFERENCES assignments(id),title TEXT,due_date TEXT,status TEXT,owner TEXT,publishing_account TEXT);
 CREATE TABLE content_versions(id TEXT PRIMARY KEY,deliverable_id TEXT REFERENCES deliverables(id),version INTEGER,package_json TEXT,created TEXT);
 CREATE TABLE approvals(id TEXT PRIMARY KEY,content_version_id TEXT REFERENCES content_versions(id),reviewer_id TEXT REFERENCES users(id),stage TEXT,created TEXT);
 INSERT INTO users VALUES('owner','Owner','owner',NULL,NULL),('manager','Manager','manager',NULL,NULL),('brand','Brand','brand','b1',NULL),('other','Other brand','brand','b2',NULL),('creator','Creator','creator',NULL,'c1'),('finance','Finance','finance',NULL,NULL);
 INSERT INTO brands VALUES('b1','Brand one'),('b2','Brand two');
 INSERT INTO creators VALUES('c1','Creator');
 INSERT INTO campaigns VALUES('cam1','b1','Campaign one','','Active');
 INSERT INTO assignments VALUES('a1','cam1','c1');
 INSERT INTO deliverables VALUES('d1','a1','Approved Reel',NULL,'Brand approved','Creator','@oliveandearth');`);
 for(const user of ['owner','manager','brand','other','creator','finance'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('session-'+user).digest('hex'),user,Date.now()+86400000);
 const row=(sql,...args)=>db.prepare(sql).get(...args),rows=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args),now=()=>new Date().toISOString();
 const requireThat=(condition,status,message)=>{if(!condition)throw Object.assign(new Error(message),{status});};
 const textField=(value,label,max=5000)=>{requireThat(typeof value==='string'&&value.trim().length>0&&value.length<=max,400,label+' is required');return value.trim();};
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
 const helpers={db,row,rows,run,now,requireThat,textField,transaction,id:prefix=>prefix+'_'+randomBytes(8).toString('hex'),send:(res,status,data,headers={})=>{res.status=status;res.data=data;res.headers=headers;},body:async req=>req.data,activity:()=>{},dbPath:resolve(directory,'live.sqlite')};
 const delivery=createDelivery(helpers),operations=createOperations({...helpers,delivery});
 const pkg={video_id:'video1',cover_id:'cover1',video_sha256:'a'.repeat(64),cover_sha256:'b'.repeat(64),caption:'Product story #ad',hashtags:'#care',mentions:'',disclosure:'#ad',account:'@oliveandearth',brief_version_id:'brief1',window_start:new Date(Date.now()-3600000).toISOString(),window_end:new Date(Date.now()+3600000).toISOString()};
 run('INSERT INTO brief_versions VALUES(?,?,?,?,?,?)','brief1','cam1',1,JSON.stringify({disclosure:'#ad'}),'Owner',now());
 run('INSERT INTO content_versions VALUES(?,?,?,?,?)','v1','d1',1,JSON.stringify(pkg),now());
 run('INSERT INTO review_events VALUES(?,?,?,?,?,?,?,?,?,?)','review1','v1','brand','Brand','brand','brand_approved','shared',null,'',now());
 run('INSERT INTO approvals VALUES(?,?,?,?,?)','ap1','v1','owner','agency',now());run('INSERT INTO approvals VALUES(?,?,?,?,?)','ap2','v1','brand','brand',now());
 run('INSERT INTO rights_records VALUES(?,?,?)','cam1',JSON.stringify({channels:'Instagram organic',start:'2020-01-01',end:'2099-12-31'}),now());
 operations.enqueue('v1');run("UPDATE processing_jobs SET state='Completed',result=? WHERE version_id='v1'",JSON.stringify({findings:[]}));
 const calls=[],provider={published:false,publishTimeout:false,createTimeout:false,containerStatus:'FINISHED',mediaUsername:'oliveandearth',mediaCaption:'Product story #ad\n\n#care',revoke:false};
 async function transport(request){calls.push(request);const {method,path,params}=request;
  if(path==='oauth/access_token')return {access_token:params.code?'private-short-token':'private-long-token',expires_in:86400};
  if(path==='debug_token')return {data:{is_valid:true,app_id:'123',expires_at:Math.floor(Date.now()/1000)+86400,scopes:['instagram_basic','instagram_content_publish','instagram_manage_insights','pages_show_list','pages_read_engagement']}};
  if(path==='me/accounts')return {data:[{id:'page1',name:'Page one',access_token:'private-page-token',instagram_business_account:{id:'ig1',username:'oliveandearth'}}]};
  if(provider.revoke)throw Object.assign(new Error('Revoked token'),{revoked:true});
  if(path==='ig1')return {id:'ig1',username:'oliveandearth'};
  if(path==='ig1/media'&&method==='POST'){if(provider.createTimeout)throw new Error('timeout');return {id:'container1'};}
  if(path==='container1')return {id:'container1',status_code:provider.published?'PUBLISHED':provider.containerStatus};
  if(path==='ig1/media_publish'&&method==='POST'){provider.published=true;if(provider.publishTimeout)throw new Error('timeout');return {id:'media1'};}
  if(path==='media1')return {id:'media1',username:provider.mediaUsername,caption:provider.mediaCaption,permalink:'https://www.instagram.com/reel/VERIFIED/',timestamp:now(),media_type:'VIDEO',media_product_type:'REELS'};
  if(path==='media1/insights'){if(params.metric==='reach')throw new Error('Unsupported metric');return {data:[{name:params.metric,values:[{value:params.metric==='views'?1234:12}]}]};}
  throw new Error('Unexpected fake provider request '+path);
 }
 const config=configuration?{appId:'123',appSecret:'private-app-secret',graphVersion:'v99.0',redirectURI:'https://agency.example/api/instagram/oauth/callback',tokenKey:'c'.repeat(64),pollMs:0,publishEnabled}:{};
 const mediaURL=async(v,kind)=>({url:'https://private-media.example/'+JSON.parse(v.package_json)[kind+'_id'],sha256:JSON.parse(v.package_json)[kind+'_sha256'],expires_at:new Date(Date.now()+900000).toISOString()});
 const module=createInstagram({...helpers,delivery,operations,config,transport,mediaURL,...options});
 async function api(path='',data,role='owner',extra={}){const req={method:data===undefined?'GET':'POST',headers:{cookie:'voqro_session=session-'+role},url:'/api/instagram'+path,data,...extra},res={writeHead(status,headers){this.status=status;this.headers=headers;},end(){}};try{await module.handler(req,res,'/api/instagram'+path,row('SELECT * FROM users WHERE id=?',role));}catch(error){res.status=error.status||500;res.data={error:error.message};}return res;}
 async function callback(url,browserCookie){const req={method:'GET',headers:{cookie:browserCookie},url},res={writeHead(status,headers){this.status=status;this.headers=headers;},end(){}};try{await module.handlePublic(req,res,'/api/instagram/oauth/callback');}catch(error){res.status=error.status||500;res.data={error:error.message};}return res;}
 async function connect(){const init=await api('/connect',{brand_id:'b1'});assert.equal(init.status,200,JSON.stringify(init.data));const url=new URL(init.data.authorization_url),state=url.searchParams.get('state'),cookie=init.headers['Set-Cookie'].split(';')[0],path='/api/instagram/oauth/callback?code=test-code&state='+state;assert.equal((await callback(path,cookie)).status,302);const pending=(await api()).data.pending[0];const bound=await api('/bind',{pending_id:pending.id,account_id:'ig1'});assert.equal(bound.status,200,JSON.stringify(bound.data));return bound.data.id;}
 async function schedule(connection){const payload={version_id:'v1',connection_id:connection,scheduled_for:now()},result=await api('/schedule',payload);assert.equal(result.status,201,JSON.stringify(result.data));return {id:result.data.id,payload};}
 return {db,row,rows,run,module,operations,api,callback,connect,schedule,calls,provider,pkg,now};
}

test('disabled integration fails closed and account management is restricted',async t=>{
 const f=fixture(t,{configuration:false});assert.equal(f.module.status().oauth_configured,false);assert.equal((await f.api('/connect',{brand_id:'b1'})).status,503);assert.equal((await f.api('/schedule',{version_id:'v1'})).status,409);assert.equal((await f.api('/connect',{brand_id:'b1'},'brand')).status,403);assert.equal((await f.api('',undefined,'finance')).status,403);assert.equal(await f.module.tick(),null);assert.equal(f.calls.length,0);
});

test('OAuth is browser-bound, one-use and selected accounts store encrypted credentials only',async t=>{
 const f=fixture(t);const init=await f.api('/connect',{brand_id:'b1'}),url=new URL(init.data.authorization_url),state=url.searchParams.get('state'),path='/api/instagram/oauth/callback?code=code&state='+state,cookie=init.headers['Set-Cookie'].split(';')[0];assert.equal((await f.callback(path,'')).status,400);assert.equal((await f.callback(path,cookie)).status,302);assert.equal((await f.callback(path,cookie)).status,400);const owner=(await f.api()).data;assert.equal(owner.pending.length,1);assert.equal(JSON.stringify(owner).includes('private-'),false);const p=owner.pending[0];assert.equal((await f.api('/bind',{pending_id:p.id,account_id:'ig1'},'manager')).status,409);assert.equal((await f.api('/bind',{pending_id:p.id,account_id:'ig1'})).status,200);const stored=f.row('SELECT * FROM instagram_connections');assert.ok(stored.token_cipher);assert.equal(stored.token_cipher.includes('private-page-token'),false);assert.equal(JSON.stringify((await f.api()).data).includes('token_cipher'),false);assert.equal(f.row('SELECT selection_cipher FROM instagram_oauth_states').selection_cipher,null);
});

test('approved Reel publishes once, verifies provider evidence, and insight snapshots deduplicate',async t=>{
 const f=fixture(t),connection=await f.connect(),job=await f.schedule(connection);assert.equal((await f.api('/schedule',job.payload)).data.id,job.id);await f.module.tick();assert.equal(f.row('SELECT state FROM instagram_jobs').state,'Awaiting container');await f.module.tick();assert.equal(f.row('SELECT state FROM instagram_jobs').state,'Verifying');await f.module.tick();assert.equal(f.row('SELECT state FROM instagram_jobs').state,'Verified');assert.equal(f.row('SELECT source FROM live_posts').source,'Meta Graph API · verified live');await f.module.tick();assert.equal(f.calls.filter(c=>c.path==='ig1/media_publish').length,1);assert.equal(f.calls.find(c=>c.path==='ig1/media').params.cover_url,'https://private-media.example/cover1');assert.equal(f.calls.find(c=>c.path==='ig1/media').params.caption,'Product story #ad\n\n#care');
 assert.equal((await f.api('',undefined,'brand')).data.jobs.length,1);assert.equal((await f.api('',undefined,'other')).data.jobs.length,0);assert.equal((await f.api('/insights',{id:job.id,request_key:'sync-1'},'brand')).status,403);
 const metrics=await f.api('/insights',{id:job.id,request_key:'sync-1'});assert.equal(metrics.status,201,JSON.stringify(metrics.data));assert.equal(metrics.data.metrics.views,1234);assert.equal(metrics.data.metrics.reach,null);assert.equal((await f.api('/insights',{id:job.id,request_key:'sync-1'})).data.id,metrics.data.id);assert.equal(f.row('SELECT COUNT(*) AS n FROM metric_snapshots').n,1);assert.match(f.row('SELECT source FROM metric_snapshots').source,/connected insights/);
});

test('changed approved content blocks before media_publish',async t=>{
 const f=fixture(t),connection=await f.connect();await f.schedule(connection);await f.module.tick();f.run('INSERT INTO content_versions VALUES(?,?,?,?,?)','v2','d1',2,JSON.stringify({...f.pkg,caption:'Edited after approval'}),f.now());await f.module.tick();assert.equal(f.row('SELECT state FROM instagram_jobs').state,'Blocked');assert.equal(f.calls.filter(c=>c.path==='ig1/media_publish').length,0);assert.match(f.row('SELECT last_error FROM instagram_jobs').last_error,/latest|approval/i);
});

test('publish timeout never retries; explicit association requires Meta published container and matching evidence',async t=>{
 const f=fixture(t),connection=await f.connect(),job=await f.schedule(connection);f.provider.publishTimeout=true;await f.module.tick();await f.module.tick();assert.equal(f.row('SELECT state FROM instagram_jobs').state,'Publish unknown');for(let n=0;n<3;n++)await f.module.tick();assert.equal(f.calls.filter(c=>c.path==='ig1/media_publish').length,1);assert.equal((await f.api('/cancel',{id:job.id})).status,409);assert.equal((await f.api('/reconcile',{id:job.id,media_id:'media1',confirm_association:false})).status,400);f.provider.mediaUsername='wrong-account';assert.equal((await f.api('/reconcile',{id:job.id,media_id:'media1',confirm_association:true})).status,409);f.provider.mediaUsername='oliveandearth';assert.equal((await f.api('/reconcile',{id:job.id,media_id:'media1',confirm_association:true})).status,200);assert.match(f.row('SELECT source FROM live_posts').source,/operator-associated/);assert.equal(f.calls.filter(c=>c.path==='ig1/media_publish').length,1);
});

test('interrupted publish side effects stay held without duplicate actions',async t=>{
 const f=fixture(t),connection=await f.connect();const job=await f.schedule(connection);f.run("UPDATE instagram_jobs SET state='Publishing',container_id='container1',lease_token='expired',lease_until=? WHERE id=?",Date.now()-1,job.id);await f.module.tick();assert.equal(f.row('SELECT state FROM instagram_jobs').state,'Publish unknown');assert.equal(f.calls.filter(c=>c.path==='ig1/media_publish').length,0);
});

test('disconnect removes credentials and stops queued work',async t=>{
 const f=fixture(t),connection=await f.connect();await f.schedule(connection);assert.equal((await f.api('/disconnect',{id:connection})).status,200);assert.equal(f.row('SELECT token_cipher FROM instagram_connections').token_cipher,null);assert.equal(f.row('SELECT state FROM instagram_jobs').state,'Blocked');await f.module.tick();assert.equal(f.calls.filter(c=>c.path==='ig1/media').length,0);
});


test('OAuth callback rejects a logged-out initiating session before contacting Meta',async t=>{
 const f=fixture(t),init=await f.api('/connect',{brand_id:'b1'}),state=new URL(init.data.authorization_url).searchParams.get('state');f.run('DELETE FROM sessions WHERE user_id=?','owner');const result=await f.callback('/api/instagram/oauth/callback?code=code&state='+state,init.headers['Set-Cookie'].split(';')[0]);assert.equal(result.status,401);assert.equal(f.calls.length,0);
});

test('creation timeout holds the job without repeating the provider action',async t=>{
 const f=fixture(t),connection=await f.connect();await f.schedule(connection);f.provider.createTimeout=true;await f.module.tick();assert.equal(f.row('SELECT state FROM instagram_jobs').state,'Container unknown');await f.module.tick();assert.equal(f.calls.filter(c=>c.path==='ig1/media').length,1);assert.equal(f.calls.filter(c=>c.path==='ig1/media_publish').length,0);
});

test('revoked provider token removes stored credentials and blocks publishing',async t=>{
 const f=fixture(t),connection=await f.connect();await f.schedule(connection);f.provider.revoke=true;await f.module.tick();assert.equal(f.row('SELECT status FROM instagram_connections').status,'Revoked');assert.equal(f.row('SELECT token_cipher FROM instagram_connections').token_cipher,null);assert.equal(f.row('SELECT state FROM instagram_jobs').state,'Blocked');assert.equal(f.calls.filter(c=>c.path==='ig1/media_publish').length,0);
});

test('publishing remains disabled despite a valid OAuth account when operator switch is off',async t=>{
 const f=fixture(t,{publishEnabled:false}),connection=await f.connect();assert.equal((await f.api('/schedule',{version_id:'v1',connection_id:connection,scheduled_for:f.now()})).status,409);assert.equal(await f.module.tick(),null);assert.equal(f.calls.filter(c=>c.path==='ig1/media').length,0);
});


test('results label provider verification only through immutable job and snapshot linkage',async t=>{
 const f=fixture(t),connection=await f.connect(),job=await f.schedule(connection);await f.module.tick();await f.module.tick();await f.module.tick();await f.api('/insights',{id:job.id,request_key:'proof-sync'});
 const post=f.row('SELECT * FROM live_posts');f.run('INSERT INTO metric_snapshots VALUES(?,?,?,?,?,?,?)','spoofed-metric',post.id,f.now(),JSON.stringify({views:999}), 'Meta Graph API · connected insights','owner',f.now());
 const result={};await f.operations.handler({method:'GET'},result,'/api/operations',f.row("SELECT * FROM users WHERE id='brand'"));assert.equal(result.data.posts[0].verification.verified,true);assert.equal(result.data.posts[0].metrics.find(m=>m.id==='spoofed-metric').source_kind,'manual');assert.equal(result.data.posts[0].metrics.find(m=>m.id!=='spoofed-metric').source_kind,'connected');
 f.run("UPDATE instagram_jobs SET state='Blocked' WHERE id=?",job.id);const held={};await f.operations.handler({method:'GET'},held,'/api/operations',f.row("SELECT * FROM users WHERE id='brand'"));assert.equal(held.data.posts[0].verification.verified,false);assert.ok(held.data.posts[0].metrics.every(m=>m.source_kind==='manual'));
});

test('rights expiration and removed operator access are rechecked immediately before publication',async t=>{
 const f=fixture(t),connection=await f.connect();await f.schedule(connection);await f.module.tick();f.run('UPDATE rights_records SET payload=? WHERE campaign_id=?',JSON.stringify({channels:'YouTube only',start:'2020-01-01',end:'2099-12-31'}),'cam1');f.run("UPDATE users SET role='reviewer' WHERE id='owner'");await f.module.tick();assert.equal(f.row('SELECT state FROM instagram_jobs').state,'Blocked');assert.match(f.row('SELECT last_error FROM instagram_jobs').last_error,/publishing permission/);assert.match(f.row('SELECT last_error FROM instagram_jobs').last_error,/Instagram/);assert.equal(f.calls.filter(c=>c.path==='ig1/media_publish').length,0);
});


test('suspending the scheduling production identity blocks queued provider actions',async t=>{
 const f=fixture(t),connection=await f.connect();await f.schedule(connection);f.db.exec("CREATE TABLE identity_accounts(user_id TEXT PRIMARY KEY,status TEXT); INSERT INTO identity_accounts VALUES('owner','Suspended')");await f.module.tick();assert.equal(f.row('SELECT state FROM instagram_jobs').state,'Blocked');assert.match(f.row('SELECT last_error FROM instagram_jobs').last_error,/suspended/);assert.equal(f.calls.filter(c=>c.path==='ig1/media_publish'||c.path==='ig1/media').length,0);
});
