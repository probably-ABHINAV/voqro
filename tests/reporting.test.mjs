import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {createCommerce} from '../commerce.mjs';
import {createReporting} from '../reporting.mjs';

const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,brand_id TEXT,creator_id TEXT);
 CREATE TABLE brands(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE creators(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE campaigns(id TEXT PRIMARY KEY,brand_id TEXT,name TEXT,status TEXT,budget INTEGER,description TEXT);
 CREATE TABLE assignments(id TEXT PRIMARY KEY,campaign_id TEXT,creator_id TEXT);
 CREATE TABLE deliverables(id TEXT PRIMARY KEY,assignment_id TEXT,title TEXT,due_date TEXT,status TEXT);
 CREATE TABLE content_versions(id TEXT PRIMARY KEY,deliverable_id TEXT,version INTEGER,package_json TEXT,created TEXT);
 CREATE TABLE brief_versions(id TEXT PRIMARY KEY,campaign_id TEXT,version INTEGER,payload TEXT,created TEXT);
 CREATE TABLE review_events(version_id TEXT,kind TEXT);
 CREATE TABLE approvals(stage TEXT,created TEXT,content_version_id TEXT);
 CREATE TABLE live_posts(id TEXT PRIMARY KEY,deliverable_id TEXT,version_id TEXT,permalink TEXT,published_at TEXT,source TEXT);
 CREATE TABLE metric_snapshots(id TEXT PRIMARY KEY,post_id TEXT,captured_at TEXT,payload TEXT,source TEXT,created TEXT);
`);
const run=(sql,...args)=>db.prepare(sql).run(...args),row=(sql,...args)=>db.prepare(sql).get(...args),rows=(sql,...args)=>db.prepare(sql).all(...args);
const now=()=>new Date().toISOString(),id=p=>p+'_'+randomUUID().replaceAll('-','');
const requireThat=(condition,status,message)=>{if(!condition)throw Object.assign(new Error(message),{status});};
const textField=(v,name,max=5000)=>{requireThat(typeof v==='string'&&v.trim().length>0&&v.length<=max,400,name+' is required.');return v.trim();};
const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const x=fn();db.exec('COMMIT');return x;}catch(e){db.exec('ROLLBACK');throw e;}};
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
const body=async req=>{let s='';for await(const x of req)s+=x;return JSON.parse(s||'{}');};
const helpers={db,row,rows,run,id,now,transaction,requireThat,textField,send,body};
const commerce=createCommerce(helpers),reporting=createReporting(helpers);
const roles={owner:['Owner','owner',null,null],finance:['Finance','finance',null,null],manager:['Manager','manager',null,null],reviewer:['Reviewer','reviewer',null,null],brand:['Brand One','brand','b1',null],other:['Brand Two','brand','b2',null],creator:['Creator One','creator',null,'cr1']};
for(const [key,u] of Object.entries(roles))run('INSERT INTO users VALUES(?,?,?,?,?)',key,...u);
for(const [id,name] of [['b1','Olive'],['b2','North']])run('INSERT INTO brands VALUES(?,?)',id,name);
for(const [id,name] of [['cr1','Asha'],['cr2','Tara']])run('INSERT INTO creators VALUES(?,?)',id,name);
for(const [id,brand] of [['cam1','b1'],['cam2','b2']])run('INSERT INTO campaigns VALUES(?,?,?,?,?,?)',id,brand,id,'Active',500000,'Campaign description');
run('INSERT INTO assignments VALUES(?,?,?)','a1','cam1','cr1');run('INSERT INTO assignments VALUES(?,?,?)','a2','cam1','cr2');
for(const [did,aid] of [['d1','a1'],['d2','a2']]){run('INSERT INTO deliverables VALUES(?,?,?,?,?)',did,aid,did==='d1'?'=HYPERLINK("evil")':'Second post','2099-01-01','Brand approved');run('INSERT INTO content_versions VALUES(?,?,?,?,?)','v'+did,did,1,JSON.stringify({brief_version_id:'brief1'}),now());run('INSERT INTO approvals VALUES(?,?,?)','agency',now(),'v'+did);run('INSERT INTO approvals VALUES(?,?,?)','brand',now(),'v'+did);run('INSERT INTO live_posts VALUES(?,?,?,?,?,?)','p'+did,did,'v'+did,'https://www.instagram.com/reel/'+did+'/',now(),did==='d1'?'Team-reported; not verified by Instagram':'Meta Graph API · verified live');run('INSERT INTO metric_snapshots VALUES(?,?,?,?,?,?)','m'+did,'p'+did,'2026-01-01T00:00:00.000Z',JSON.stringify({views:100,reach:80,likes:10,comments:null,saves:2,shares:null}),did==='d1'?'Manual screenshot':'Meta Graph API · connected insights',now());}
run('INSERT INTO brief_versions VALUES(?,?,?,?,?)','brief1','cam1',1,JSON.stringify({goals:'Explain the product'}),now());
const server=http.createServer(async(req,res)=>{try{const u=row('SELECT * FROM users WHERE id=?',req.headers['x-role']||'owner');requireThat(u,401,'Sign in.');const path=new URL(req.url,'http://localhost').pathname;if(await reporting.handler(req,res,path,u))return;if(await commerce(req,res,path,u))return;send(res,404,{error:'Not found'});}catch(e){send(res,e.status||500,{error:e.message});}});let base;
before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(r=>server.close(r));db.close();});
async function call(path,data,role='owner'){const response=await fetch(base+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{'x-role':role,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const json=response.headers.get('Content-Type')?.includes('application/json');return {status:response.status,data:json?await response.json():await response.text(),headers:response.headers};}
const draft=(key,extra={})=>({campaign_id:'cam1',title:'Report '+key,lessons:'Shared learning',next_steps:'Try clearer packaging',request_key:key,...extra});
const feeInvoice={campaign_id:'cam1',title:'Creation fee',due_on:'2099-12-31',request_key:'i1',items:[{label:'Creative service',quantity:1,unit_price:100000,tax_bps:1800}]};
let invoiceId,costId,reportId;

test('immutable snapshots reconcile recorded costs and retain sources without summing unique reach',async()=>{
 invoiceId=(await call('commerce/invoices',feeInvoice)).data.id;await call('commerce/issue',{id:invoiceId});await call('commerce/settle',{parent_type:'invoice',parent_id:invoiceId,amount:50000,reference:'BANK-1',effective_on:now().slice(0,10),note:'Private banking evidence'});
 const cost=await call('commerce/costs',{campaign_id:'cam1',creator_id:'cr1',category:'Creator fee',description:'Private agreed fee',amount:30000,due_on:'2099-12-31',evidence:'Secret negotiated document',request_key:'c1'});assert.equal(cost.status,201);costId=cost.data.id;
 const result=await call('reporting/reports',draft('snapshot'));assert.equal(result.status,201);reportId=result.data.id;const p=result.data.payload;
 assert.equal(p.billing.totals.contribution_before_overhead,70000);assert.equal(p.billing.totals.receivables,68000);assert.equal(p.billing.totals.recorded_costs,30000);assert.equal(p.posts.length,2);assert.equal(p.posts[0].snapshot.metrics.reach,80);assert.equal(p.posts[1].snapshot.metrics.reach,80);assert.equal('total_reach' in p,false);assert.equal(p.posts[0].snapshot.metrics.comments,null);assert.match(p.posts[1].source,/verified live/);assert.equal(p.posts[1].verification,'Team-reported; not independently verified');assert.match(p.posts[0].source,/not verified/);
 assert.equal((await call('reporting/reports',draft('snapshot'))).data.id,reportId);assert.equal((await call('reporting/reports',draft('snapshot',{title:'Different'}))).status,409);
 run('INSERT INTO metric_snapshots VALUES(?,?,?,?,?,?)','newmetrics','pd1','2099-01-01T00:00:00.000Z',JSON.stringify({views:5000,reach:4000,likes:300}), 'Later observation',now());
 const old=(await call('reporting/reports/'+reportId)).data.payload;assert.equal(old.posts[0].snapshot.metrics.views,100);const fresh=(await call('reporting/reports',draft('new-snapshot'))).data;assert.equal(fresh.version,2);assert.equal(fresh.payload.posts[0].snapshot.metrics.views,5000);
});

test('draft reports stay internal; shared reports hide finance and other creators’ data by role',async()=>{
 assert.equal((await call('reporting/reports/'+reportId,undefined,'brand')).status,403);assert.equal((await call('reporting',undefined,'brand')).data.reports.length,0);
 assert.equal((await call('reporting/share',{id:reportId},'manager')).status,200);
 const brand=(await call('reporting/reports/'+reportId,undefined,'brand')).data.payload;assert.equal(brand.billing.invoices.length,1);assert.equal('costs' in brand.billing,false);assert.equal('totals' in brand.billing,false);assert.ok(!JSON.stringify(brand).includes('Private agreed fee'));
 const creator=(await call('reporting/reports/'+reportId,undefined,'creator')).data.payload;assert.equal(creator.deliverables.length,1);assert.equal(creator.posts.length,1);assert.equal(creator.posts[0].creator_id,'cr1');assert.equal('billing' in creator,false);assert.equal('budget' in creator.campaign,false);
 assert.equal((await call('reporting/reports/'+reportId,undefined,'other')).status,403);assert.equal('billing' in (await call('reporting/reports/'+reportId,undefined,'manager')).data.payload,false);
 assert.equal((await call('reporting/reports',draft('forged'),'brand')).status,403);
});

test('download exports escape markup and spreadsheet formulas and enforce the same scope',async()=>{
 const r=(await call('reporting/reports',draft('escaping',{title:'<img src=x onerror=alert(1)>',lessons:'<script>alert(1)</script>'}))).data;await call('reporting/share',{id:r.id});
 const doc=await call(`reporting/reports/${r.id}/download/html`,undefined,'brand');assert.equal(doc.status,200);assert.ok(doc.data.includes('&lt;script&gt;'));assert.ok(!doc.data.includes('<script>'));assert.ok(!doc.data.includes('Private agreed fee'));assert.match(doc.headers.get('content-disposition'),/attachment/);
 const csv=await call(`reporting/reports/${r.id}/download/csv`,undefined,'creator');assert.equal(csv.status,200);assert.ok(csv.data.includes("'=HYPERLINK"));assert.ok(!csv.data.includes('Second post'));assert.ok(!csv.data.includes('contribution_before_overhead'));
 assert.equal((await call(`reporting/reports/${r.id}/download/html`,undefined,'other')).status,403);
 const invoice=await call(`reporting/invoices/${invoiceId}/print`,undefined,'brand');assert.equal(invoice.status,200);assert.match(invoice.data,/₹1,180.00/);assert.match(invoice.data,/not a certified statutory tax invoice/);assert.equal((await call(`reporting/invoices/${invoiceId}/print`,undefined,'manager')).status,403);assert.equal((await call(`reporting/invoices/${invoiceId}/print`,undefined,'creator')).status,403);
});

test('versioned agreements preserve acknowledgements and reject stale versions and other parties',async()=>{
 const input={request_key:'agreement-original',campaign_id:'cam1',kind:'Brand',title:'Brand delivery agreement',terms:'Two reels; documented usage rights.',document_reference:'SIGNED-REFERENCE-001',document_sha256:'a'.repeat(64),expires_on:'2099-12-31'};
 const created=await call('reporting/agreements',input);assert.equal(created.status,201);const a=created.data,v=a.versions[0];assert.equal((await call('reporting/agreements',input)).data.id,a.id);
 assert.equal((await call('reporting/agreements/accept',{version_id:v.id,statement:'Reviewed'},'other')).status,403);assert.equal((await call('reporting/agreements/accept',{version_id:v.id,statement:'Reviewed'},'creator')).status,403);
 const ack=await call('reporting/agreements/accept',{version_id:v.id,statement:'I reviewed this version'},'brand');assert.equal(ack.status,201);assert.equal((await call('reporting/agreements/accept',{version_id:v.id,statement:'Retry'},'brand')).data.id,ack.data.id);await call('reporting/agreements/accept',{version_id:v.id,statement:'Agency acknowledges'},'owner');
 const revised=await call('reporting/agreements',{...input,request_key:'agreement-revision',agreement_id:a.id,base_version_id:v.id,terms:'Three reels and updated scope.'});assert.equal(revised.status,201);assert.equal(revised.data.versions[0].version,2);assert.equal(revised.data.versions[0].acceptances.length,0);assert.equal(revised.data.versions[1].acceptances.length,2);
 assert.equal((await call('reporting/agreements/accept',{version_id:v.id,statement:'Old version'},'brand')).status,409);assert.equal((await call('reporting/agreements',{...input,agreement_id:a.id,base_version_id:v.id})).status,409);
 assert.equal((await call('reporting/agreements',{...input,request_key:'creator-agreement',title:'Creator fee agreement',kind:'Creator',creator_id:'cr1',terms:'Private creator terms'})).status,201);
 const brand=(await call('reporting',undefined,'brand')).data;assert.ok(brand.agreements.every(a=>a.kind==='Brand'));const creator=(await call('reporting',undefined,'creator')).data;assert.ok(creator.agreements.every(a=>a.kind==='Creator'&&a.creator_id==='cr1'));assert.equal(creator.agreements.length,1);
});

test('milestone plans remain separate from actuals and link once to an exact scoped obligation',async()=>{
 const plan={campaign_id:'cam1',direction:'Receivable',title:'Deposit milestone',amount:118000,due_on:'2099-12-31',request_key:'milestone-1'};
 const m=await call('reporting/milestones',plan);assert.equal(m.status,201);assert.equal((await call('reporting/milestones',plan)).data.id,m.data.id);
 const before=(await call('reporting',undefined,'brand')).data.milestones.find(x=>x.id===m.data.id);assert.equal(before.state,'Planned');assert.equal(before.paid,0);
 assert.equal((await call('reporting/milestones/link',{id:m.data.id,record_id:costId})).status,400);assert.equal((await call('reporting/milestones/link',{id:m.data.id,record_id:invoiceId})).status,200);
 const linked=(await call('reporting',undefined,'brand')).data.milestones.find(x=>x.id===m.data.id);assert.equal(linked.state,'Part settled');assert.equal(linked.paid,50000);assert.equal(linked.outstanding,68000);
 const duplicate=(await call('reporting/milestones',{...plan,request_key:'milestone-2'})).data;assert.equal((await call('reporting/milestones/link',{id:duplicate.id,record_id:invoiceId})).status,409);
 const payable=(await call('reporting/milestones',{...plan,direction:'Payable',creator_id:'cr1',amount:30000,title:'Creator fee due',request_key:'creator-fee-plan'})).data;assert.equal((await call('reporting/milestones/link',{id:payable.id,record_id:costId})).status,200);assert.equal((await call('reporting',undefined,'creator')).data.milestones.length,1);assert.ok((await call('reporting',undefined,'brand')).data.milestones.every(m=>m.direction==='Receivable'));
 assert.equal((await call('reporting/milestones',plan,'manager')).status,403);assert.equal((await call('reporting/milestones',{...plan,amount:-1,request_key:'negative'})).status,400);
});

test('tracking references enforce campaign membership and deduplicate without inventing attribution',async()=>{
 const input={campaign_id:'cam1',deliverable_id:'d1',label:'Creator code',url:'https://brand.example/landing?utm_source=asha',code:'ASHA_01'};
 const t=await call('reporting/tracking',input);assert.equal(t.status,201);assert.equal((await call('reporting/tracking',input)).data.id,t.data.id);assert.equal((await call('reporting/tracking',{...input,url:'https://different.example'})).status,409);
 assert.equal((await call('reporting/tracking',{...input,url:'javascript:alert(1)',code:'BAD'})).status,400);assert.equal((await call('reporting/tracking',{...input,campaign_id:'cam2',code:'WRONG'})).status,400);assert.equal((await call('reporting/tracking',input,'creator')).status,403);
 await call('reporting/tracking',{...input,deliverable_id:'d2',code:'TARA_01'});const creator=(await call('reporting',undefined,'creator')).data.tracking;assert.equal(creator.length,1);assert.equal(creator[0].code,'ASHA_01');assert.equal('conversions' in creator[0],false);
});

test('report approval summary invalidates changed briefs and subsequent revision requests',async()=>{
 run('INSERT INTO brief_versions VALUES(?,?,?,?,?)','brief2','cam1',2,JSON.stringify({goals:'Updated brief'}),now());const changed=(await call('reporting/reports',draft('brief-change'))).data.payload;assert.ok(changed.deliverables.every(d=>!d.agency_approved&&!d.brand_approved&&d.status==='Brief changed'));
 run('UPDATE content_versions SET package_json=? WHERE id=?',JSON.stringify({brief_version_id:'brief2'}),'vd1');run('INSERT INTO review_events VALUES(?,?)','vd1','revision');const revision=(await call('reporting/reports',draft('revision-request'))).data.payload;const d=revision.deliverables.find(d=>d.id==='d1');assert.equal(d.agency_approved,false);assert.equal(d.brand_approved,false);assert.equal(d.status,'Changes requested');
});

test('connected verification requires exact provider job and metric-sync proof, not a source label',async()=>{
 db.exec('CREATE TABLE instagram_jobs(id TEXT PRIMARY KEY,deliverable_id TEXT,version_id TEXT,permalink TEXT,state TEXT); CREATE TABLE instagram_metric_syncs(id TEXT PRIMARY KEY,job_id TEXT,snapshot_id TEXT);');
 run('INSERT INTO instagram_jobs VALUES(?,?,?,?,?)','ig-proof','d2','vd2','https://www.instagram.com/reel/d2/','Verified');
 run('INSERT INTO instagram_metric_syncs VALUES(?,?,?)','sync-proof','ig-proof','md2');
 let p=(await call('reporting/reports',draft('provider-proof'))).data.payload.posts.find(p=>p.id==='pd2');assert.equal(p.verification,'Provider-verified live');assert.equal(p.snapshot.verification,'Connected provider insights');
 run('UPDATE instagram_metric_syncs SET snapshot_id=? WHERE id=?','md1','sync-proof');p=(await call('reporting/reports',draft('wrong-metric-proof'))).data.payload.posts.find(p=>p.id==='pd2');assert.equal(p.verification,'Provider-verified live');assert.equal(p.snapshot.verification,'Manually recorded or unverified evidence');
 run('UPDATE instagram_jobs SET permalink=? WHERE id=?','https://www.instagram.com/reel/different/','ig-proof');p=(await call('reporting/reports',draft('wrong-post-proof'))).data.payload.posts.find(p=>p.id==='pd2');assert.equal(p.verification,'Team-reported; not independently verified');
});
