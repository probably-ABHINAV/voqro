import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import {createNotifications} from '../notifications.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(t,overrides={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,brand_id TEXT,creator_id TEXT);
 CREATE TABLE identity_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id),issuer TEXT,subject TEXT,email TEXT,status TEXT,created TEXT);
 CREATE TABLE identity_sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER,created TEXT);
 CREATE TABLE workflow_notifications(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),event_key TEXT,title TEXT,detail TEXT,action TEXT,severity TEXT,created TEXT,read_at TEXT,resolved INTEGER DEFAULT 0,UNIQUE(user_id,event_key));
 INSERT INTO users VALUES('owner','Owner','owner',NULL,NULL),('brand','Brand member','brand','b1',NULL),('other','Other brand','brand','b2',NULL),('demo','Shared demo','owner',NULL,NULL);
 INSERT INTO identity_accounts VALUES('owner','https://id.example','owner-sub','owner@example.com','Active','2026-01-01'),('brand','https://id.example','brand-sub','member@example.com','Active','2026-01-01'),('other','https://id.example','other-sub','other@example.com','Active','2026-01-01');
 INSERT INTO workflow_notifications VALUES('notice1','brand','brand:b1:review','Your review is needed','Review the latest approved package.','nav:inbox','warning','2026-01-01',NULL,0),('notice2','brand','brand:b1:deadline','Deadline approaching','Check your deliverable deadline.','nav:inbox','warning','2026-01-01',NULL,0),('notice_other','other','brand:b2:review','Other brand review','Other brand content','nav:inbox','warning','2026-01-01',NULL,0);`);
 const row=(sql,...args)=>db.prepare(sql).get(...args),rows=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args),now=()=>new Date().toISOString();for(const user of ['owner','brand','other'])run('INSERT INTO identity_sessions VALUES(?,?,?,?)',hash('token-'+user),user,Date.now()+86400000,now());
 const requireThat=(condition,status,message)=>{if(!condition)throw Object.assign(new Error(message),{status});};const textField=(v,label,max=5000)=>{requireThat(typeof v==='string'&&v.trim()&&v.length<=max,400,label+' is required');return v.trim();};
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 const calls=[],provider={timeout:false,verified:true,sending:true,production:true,recipientVerified:true,preflightFailure:false};
 const transport=async request=>{calls.push(request);if(provider.preflightFailure&&request.action!=='SendEmail')throw new Error('network');if(request.action==='GetAccount')return {SendingEnabled:provider.sending,ProductionAccessEnabled:provider.production,SendQuota:{Max24HourSend:200,SentLast24Hours:0}};if(request.action==='GetEmailIdentity'){provider.duringPreflight?.();return {VerifiedForSendingStatus:request.input.EmailIdentity==='agency.example'?provider.verified:provider.recipientVerified};}if(request.action==='SendEmail'){if(provider.timeout)throw new Error('timeout after SES accepted');return {MessageId:'ses-message-123'};}throw new Error('Unexpected SES operation');};
 const module=createNotifications({db,row,rows,run,now,id:p=>p+'_'+randomBytes(8).toString('hex'),requireThat,textField,transaction,body:async req=>req.data,send:(res,status,data)=>{res.status=status;res.data=data;},workflow:{canSeeNotification:(u,n)=>Boolean(n&&n.user_id===u.id&&u.role==='brand'&&n.event_key.startsWith('brand:'+u.brand_id+':'))},config:{enabled:true,demoMode:false,region:'ap-south-1',from:'hello@agency.example',identity:'agency.example',baseURL:'https://agency.example',dailyLimit:25,monthlyLimit:200,...overrides},transport});
 async function api(path='',data,role='owner'){const result={};try{await module.handler({method:data===undefined?'GET':'POST',headers:{cookie:'__Host-voqro_auth=token-'+role},data},result,'/api/notifications/email'+path,row('SELECT * FROM users WHERE id=?',role));}catch(error){result.status=error.status||500;result.data={error:error.message};}return result;}
 async function enqueue(id='notice1'){const result=await api('/enqueue',{notification_id:id,to:'attacker@example.com',body:'Ignored supplied body'});assert.equal(result.status,201,JSON.stringify(result.data));return result.data.id;}
 return {module,api,enqueue,db,row,rows,run,calls,provider,now};
}

test('email is disabled by default and demonstration identities can never enqueue or send',async t=>{
 const f=fixture(t,{enabled:false});assert.equal(f.module.status().enabled,false);assert.equal((await f.api('/enqueue',{notification_id:'notice1'})).status,409);assert.equal(await f.module.tick(),null);assert.equal(f.calls.length,0);
 const demo=fixture(t,{demoMode:true});assert.equal((await demo.api('/enqueue',{notification_id:'notice1'})).status,403);assert.equal((await demo.api()).data.can_enqueue,false);assert.equal(await demo.module.tick(),null);assert.equal(demo.calls.length,0);assert.equal((await f.api('/enqueue',{notification_id:'notice1'},'demo')).status,403);
});

test('owner enqueue deduplicates, recipient is identity-bound, SES acceptance is not delivery proof',async t=>{
 const f=fixture(t);assert.equal((await f.api('/enqueue',{notification_id:'notice1'},'brand')).status,403);const job=await f.enqueue();assert.equal((await f.api('/enqueue',{notification_id:'notice1'})).data.id,job);await f.module.tick();await f.module.tick();assert.equal(f.calls.filter(c=>c.action==='SendEmail').length,1);const request=f.calls.find(c=>c.action==='SendEmail').input;assert.deepEqual(request.Destination.ToAddresses,['member@example.com']);assert.match(request.Content.Simple.Body.Text.Data,/Review the latest approved package/);assert.equal(request.Content.Simple.Body.Text.Data.includes('Ignored supplied body'),false);assert.equal(f.row('SELECT state FROM notification_email_outbox').state,'Sent');const view=(await f.api()).data.deliveries[0];assert.equal(view.provider_accepted,true);assert.equal(view.delivery_verified,false);assert.equal((await f.api('',undefined,'other')).data.deliveries.length,0);assert.equal((await f.api('',undefined,'brand')).data.deliveries.length,1);
});

test('timeouts and interrupted Sending leases stay Unknown and cannot automatically resend',async t=>{
 const f=fixture(t),job=await f.enqueue();f.provider.timeout=true;await f.module.tick();assert.equal(f.row('SELECT state FROM notification_email_outbox').state,'Unknown');for(let i=0;i<3;i++)await f.module.tick();assert.equal(f.calls.filter(c=>c.action==='SendEmail').length,1);assert.equal((await f.api('/retry',{id:job})).status,409);assert.equal((await f.api('/resolve',{id:job,outcome:'accepted',provider_message_id:'ses-event-123',note:'SES configuration-set event links this outbox tag to the message ID.'})).data.delivery_verified,false);assert.equal(f.row('SELECT state FROM notification_email_outbox').state,'Closed');assert.equal((await f.api('/enqueue',{notification_id:'notice1'})).data.id,job);await f.module.tick();assert.equal(f.calls.filter(c=>c.action==='SendEmail').length,1);
 const interrupted=fixture(t),interruptedJob=await interrupted.enqueue();interrupted.run("UPDATE notification_email_outbox SET state='Sending',lease_token='old',lease_until=? WHERE id=?",Date.now()-1,interruptedJob);await interrupted.module.tick();assert.equal(interrupted.row('SELECT state FROM notification_email_outbox').state,'Unknown');assert.equal(interrupted.calls.length,0);
});

test('changed roles, membership, verified address or resolved content cancel before sending',async t=>{
 for(const mutate of [f=>f.run("UPDATE users SET brand_id='b2' WHERE id='brand'"),f=>f.run("UPDATE identity_accounts SET status='Suspended' WHERE user_id='brand'"),f=>f.run("UPDATE identity_accounts SET email='changed@example.com' WHERE user_id='brand'"),f=>f.run("UPDATE workflow_notifications SET resolved=1 WHERE id='notice1'"),f=>f.run("UPDATE identity_accounts SET status='Suspended' WHERE user_id='owner'")]){const f=fixture(t);await f.enqueue();mutate(f);await f.module.tick();assert.equal(f.row('SELECT state FROM notification_email_outbox').state,'Cancelled');assert.equal(f.calls.filter(c=>c.action==='SendEmail').length,0);}
});

test('unverified sender and sandbox recipient fail preflight; safe retry cannot repeat an attempted send',async t=>{
 const f=fixture(t),job=await f.enqueue();f.provider.verified=false;await f.module.tick();assert.equal(f.row('SELECT state FROM notification_email_outbox').state,'Failed');assert.equal(f.calls.filter(c=>c.action==='SendEmail').length,0);f.provider.verified=true;assert.equal((await f.api('/retry',{id:job})).status,200);await f.module.tick();assert.equal(f.row('SELECT state FROM notification_email_outbox').state,'Sent');assert.equal((await f.api('/retry',{id:job})).status,409);
 const sandbox=fixture(t);sandbox.provider.production=false;sandbox.provider.recipientVerified=false;await sandbox.enqueue();await sandbox.module.tick();assert.equal(sandbox.row('SELECT state FROM notification_email_outbox').state,'Failed');assert.equal(sandbox.calls.filter(c=>c.action==='SendEmail').length,0);
});

test('bounded allowances include uncertain outcomes and owner cancellation preserves history',async t=>{
 const f=fixture(t,{dailyLimit:1}),job=await f.enqueue();assert.equal((await f.api('/enqueue',{notification_id:'notice2'})).status,429);assert.equal((await f.api('/cancel',{id:job})).status,200);assert.equal(f.row('SELECT state FROM notification_email_outbox WHERE id=?',job).state,'Cancelled');await f.enqueue('notice2');f.provider.timeout=true;await f.module.tick();const current=f.row("SELECT * FROM notification_email_outbox WHERE state='Unknown'");await f.api('/resolve',{id:current.id,outcome:'not-sent',note:'No delivery evidence; manually investigated. No resend requested.'});assert.equal((await f.api('/enqueue',{notification_id:'notice_other'})).status,429);
});


test('scope is rechecked after remote preflight before any send side effect',async t=>{
 const f=fixture(t);await f.enqueue();f.provider.duringPreflight=()=>f.run("UPDATE users SET brand_id='b2' WHERE id='brand'");await f.module.tick();assert.equal(f.row('SELECT state FROM notification_email_outbox').state,'Cancelled');assert.equal(f.calls.filter(c=>c.action==='SendEmail').length,0);
});
