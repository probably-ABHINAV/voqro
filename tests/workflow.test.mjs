import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createWorkflow} from '../workflow.mjs';
import {createDelivery} from '../delivery.mjs';
const temp=mkdtempSync(resolve(tmpdir(),'voqro-workflow-'));
process.env.NODE_ENV='test';process.env.DEMO_MODE='1';process.env.DB_PATH=resolve(temp,'test.sqlite');process.env.UPLOAD_PATH=resolve(temp,'uploads');
await import('../server.mjs');
const db=new DatabaseSync(process.env.DB_PATH);db.exec('PRAGMA foreign_keys=ON');
const row=(q,...v)=>db.prepare(q).get(...v),rows=(q,...v)=>db.prepare(q).all(...v),run=(q,...v)=>db.prepare(q).run(...v);
const now=()=>new Date().toISOString(),id=p=>p+'_'+randomUUID().replaceAll('-','');
const requireThat=(c,status,message)=>{if(!c)throw Object.assign(new Error(message),{status});};
const textField=(v,n,max=5000)=>{requireThat(typeof v==='string'&&v.trim()&&v.length<=max,400,n+' is required.');return v.trim();};
const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}};
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
const body=async req=>{let text='';for await(const chunk of req)text+=chunk;return JSON.parse(text||'{}');};
const common={db,row,rows,run,id,now,transaction,requireThat,textField,send,body,activity:()=>{},dbPath:process.env.DB_PATH};
const delivery=createDelivery(common),workflow=createWorkflow({...common,delivery});
let base;
const server=http.createServer(async(req,res)=>{try{const u=row('SELECT * FROM users WHERE id=?',req.headers['x-user']||'u_owner');requireThat(u,401,'Sign in.');if(!await workflow.handler(req,res,new URL(req.url,'http://localhost').pathname,u))send(res,404,{error:'Missing'});}catch(e){send(res,e.status||500,{error:e.message});}});
before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/api/workflow`;});
after(async()=>{workflow.stop();await new Promise(r=>server.close(r));db.close();rmSync(temp,{recursive:true,force:true});});
async function request(path='',data,user='u_owner'){const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'x-user':user,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json()};}
const taskInput=(title,extra={})=>({campaign_id:'cam_1',owner_id:'u_creator',title,description:'A clear next action.',due_on:'2020-01-01',visibility:'shared',dependencies:[],...extra});

test('brand knowledge is versioned, scoped and rejects stale or unsafe references',async()=>{
 const first=await request('/knowledge',{brand_id:'b_olive',tone:'Warm',facts:'Product fact',claims:'Approved claim',references:[{label:'Visual direction',url:'https://example.com/reference'}]});assert.equal(first.status,201,JSON.stringify(first.data));
 const second=await request('/knowledge',{brand_id:'b_olive',base_version_id:first.data.id,tone:'Clear and warm',references:[]},'u_brand');assert.equal(second.data.version,2);
 const read=await request('/knowledge/b_olive',undefined,'u_creator');assert.equal(read.status,200);assert.equal(read.data.latest.payload.tone,'Clear and warm');assert.equal(read.data.history.length,2);const history=await request('/knowledge-version/'+first.data.id,undefined,'u_creator');assert.equal(history.data.payload.tone,'Warm');assert.equal((await request('/knowledge-version/'+first.data.id,undefined,'u_other')).status,403);
 assert.equal((await request('/knowledge/b_olive',undefined,'u_other')).status,403);assert.equal((await request('/knowledge/b_olive',undefined,'u_finance')).status,403);
 assert.equal((await request('/knowledge',{brand_id:'b_olive',base_version_id:first.data.id,tone:'Stale'})).status,409);
 assert.equal((await request('/knowledge',{brand_id:'b_olive',base_version_id:second.data.id,references:[{label:'Bad',url:'javascript:alert(1)'}]})).status,400);
 assert.equal((await request('/knowledge',{brand_id:'b_olive',tone:'Unauthorized'},'u_creator')).status,403);
});

test('task dependencies reject cycles, cross-campaign links and premature completion',async()=>{
 const a=(await request('/tasks',taskInput('Film the draft'))).data;
 const b=(await request('/tasks',taskInput('Prepare submission',{dependencies:[a.id]}))).data;
 assert.equal((await request('/tasks',{...taskInput('Film the draft'),id:a.id,revision:a.revision,dependencies:[b.id]})).status,409);
 assert.equal((await request('/tasks/status',{id:b.id,revision:b.revision,status:'Done'},'u_creator')).status,409);
 const completed=(await request('/tasks/status',{id:a.id,revision:a.revision,status:'Done'},'u_creator')).data;assert.equal(completed.status,'Done');
 assert.equal((await request('/tasks/status',{id:a.id,revision:a.revision,status:'Open'},'u_creator')).status,409);
 const done=(await request('/tasks/status',{id:b.id,revision:b.revision,status:'Done'},'u_creator')).data;assert.equal(done.status,'Done');
 assert.equal((await request('/tasks/status',{id:a.id,revision:completed.revision,status:'Open'},'u_creator')).status,409);
 const foreign=(await request('/tasks',taskInput('Northstar task',{campaign_id:'cam_2',owner_id:'u_manager'}))).data;
 assert.equal((await request('/tasks',taskInput('Invalid dependency',{dependencies:[foreign.id]}))).status,400);
 assert.equal((await request('/tasks',taskInput('Unassigned creator',{campaign_id:'cam_2'}))).status,400);
});

test('task visibility, comments and finance remain scoped across roles',async()=>{
 const shared=(await request('/tasks',taskInput('Shared task'))).data;
 const privateTask=(await request('/tasks',taskInput('Agency confidential',{owner_id:'u_manager',visibility:'agency'}))).data;
 const finance=(await request('/tasks',taskInput('Finance confidential',{owner_id:'u_finance',visibility:'finance'}))).data;
 await request('/tasks/comment',{id:shared.id,message:'Internal discussion',visibility:'agency'});await request('/tasks/comment',{id:shared.id,message:'Shared feedback',visibility:'shared'},'u_creator');
 assert.equal((await request('/tasks/status',{id:shared.id,revision:shared.revision,status:'Done'},'u_brand')).status,403);
 const creator=(await request('/tasks/'+shared.id,undefined,'u_creator')).data;assert.deepEqual(creator.comments.map(x=>x.message),['Shared feedback']);
 for(const user of ['u_creator','u_brand','u_other','u_finance'])assert.equal((await request('/tasks/'+privateTask.id,undefined,user)).status,403);
 for(const user of ['u_manager','u_reviewer','u_creator','u_brand'])assert.equal((await request('/tasks/'+finance.id,undefined,user)).status,403);
 assert.equal((await request('/tasks/'+finance.id,undefined,'u_finance')).status,200);
 assert.equal((await request('/tasks/'+shared.id,undefined,'u_other')).status,403);
 assert.equal((await request('/tasks/comment',{id:shared.id,message:'Forged internal',visibility:'agency'},'u_brand')).status,403);
 assert.equal((await request('/tasks',{...taskInput('Release private'),id:privateTask.id,revision:privateTask.revision,owner_id:'u_manager',visibility:'shared'})).status,409);
});

test('reminders deduplicate, read state persists, resolution is tracked and rules require owner',async()=>{
 const t=(await request('/tasks',taskInput('Reminder test'))).data;
 workflow.tick();const first=(await request('',undefined,'u_creator')).data;
 assert.ok(first.notifications,JSON.stringify(first));const notice=first.notifications.find(n=>n.event_key.startsWith('task:'+t.id+':'));assert.ok(notice);assert.equal(notice.read_at,null);assert.equal(notice.resolved,0);
 const count=first.notifications.length;workflow.tick();assert.equal((await request('',undefined,'u_creator')).data.notifications.length,count);
 assert.equal((await request('/notifications/read',{id:notice.id},'u_other')).status,404);await request('/notifications/read',{id:notice.id},'u_creator');assert.ok((await request('',undefined,'u_creator')).data.notifications.find(n=>n.id===notice.id).read_at);
 await request('/tasks/status',{id:t.id,revision:t.revision,status:'Done'},'u_creator');workflow.tick();assert.equal((await request('',undefined,'u_creator')).data.notifications.find(n=>n.id===notice.id).resolved,1);
 const settings={enabled:false,review_hours:24,shipment_days:3,rights_days:7,escalation_hours:48};assert.equal((await request('/rules',settings,'u_manager')).status,403);assert.equal((await request('/rules',{...settings,review_hours:0})).status,400);assert.equal((await request('/rules',settings)).status,200);assert.equal(workflow.tick().created,0);
 assert.equal((await request('/rules',{...settings,enabled:true})).status,200);
});

test('invoice exceptions never disclose agency receivables to creators or other brands',async()=>{
 const stamp=now();run('INSERT INTO invoices(id,campaign_id,title,items,subtotal,tax,total,currency,state,issued_on,due_on,created_by,created,request_key,payload_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)','invoice_workflow','cam_1','Private brand invoice','[]',10000,0,10000,'INR','Issued','2020-01-01','2020-01-02','u_owner',stamp,'workflow-invoice','fixture');
 assert.ok(workflow.exceptions(row('SELECT * FROM users WHERE id=?','u_finance')).some(x=>x.kind==='invoice'));
 assert.ok(workflow.exceptions(row('SELECT * FROM users WHERE id=?','u_brand')).some(x=>x.kind==='invoice'));
 for(const user of ['u_creator','u_other','u_manager','u_reviewer'])assert.equal(workflow.exceptions(row('SELECT * FROM users WHERE id=?',user)).some(x=>x.kind==='invoice'),false);
});

test('membership changes cannot reveal earlier private notification text',async()=>{
 const task=(await request('/tasks',taskInput('Role-sensitive finance evidence',{owner_id:'u_finance',visibility:'finance'}))).data;
 workflow.tick();const before=(await request('',undefined,'u_finance')).data.notifications.find(n=>n.event_key.startsWith('task:'+task.id+':'));assert.ok(before);
 run("UPDATE users SET role='brand',brand_id='b_north' WHERE id='u_finance'");
 try{const after=(await request('',undefined,'u_finance')).data;assert.ok(!JSON.stringify(after.notifications).includes('Role-sensitive finance evidence'));assert.equal((await request('/notifications/read',{id:before.id},'u_finance')).status,404);}finally{run("UPDATE users SET role='finance',brand_id=NULL WHERE id='u_finance'");}
});

test('review, processing, dispatch, rights and publishing exceptions derive from their records',()=>{
 const past='2020-01-01T00:00:00.000Z';
 run('INSERT INTO brief_versions VALUES(?,?,?,?,?,?)','wf_brief','cam_1',1,'{}','Owner',past);
 run('INSERT INTO content_versions VALUES(?,?,?,?,?)','wf_version','d1',1,JSON.stringify({brief_version_id:'wf_brief'}),past);
 run('INSERT INTO approvals VALUES(?,?,?,?,?)','wf_approval','wf_version','u_owner','agency',past);
 run('INSERT INTO review_events VALUES(?,?,?,?,?,?,?,?,?,?)','wf_review','wf_version','u_owner','Owner','owner','agency_approved','shared',null,'',past);
 run('INSERT INTO processing_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)','wf_job','wf_version','Failed',3,0,null,null,null,'Media failed validation',past,past);
 run('INSERT INTO shipments VALUES(?,?,?,?,?,?,?,?)','wf_shipment','a1','Product sample',1,'Carrier','REF-1','Dispatched',past);
 run('INSERT INTO rights_records VALUES(?,?,?)','cam_1',JSON.stringify({start:'2019-01-01',end:'2020-01-01',channels:'Instagram organic'}),past);
 run('INSERT INTO handoff_schedule VALUES(?,?,?,?,?,?,?,?,?)','wf_schedule','d1','wf_version',past,'Blocked','Reconnect account','u_owner',past,past);
 const owner=workflow.exceptions(row('SELECT * FROM users WHERE id=?','u_owner'));
 for(const kind of ['review','processing','dispatch','rights','connection'])assert.ok(owner.some(x=>x.kind===kind),kind);
 const brand=workflow.exceptions(row('SELECT * FROM users WHERE id=?','u_brand'));assert.ok(brand.some(x=>x.kind==='review'));assert.ok(!brand.some(x=>x.kind==='processing'||x.kind==='connection'));
 const other=workflow.exceptions(row('SELECT * FROM users WHERE id=?','u_other'));assert.ok(!other.some(x=>['review','processing','dispatch','rights','connection'].includes(x.kind)));
});
