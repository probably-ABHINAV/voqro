import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {createOptimization} from '../optimization.mjs';
const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT);CREATE TABLE campaigns(id TEXT PRIMARY KEY,name TEXT);
CREATE TABLE creators(id TEXT PRIMARY KEY,name TEXT,niche TEXT,location TEXT,language TEXT,fee INTEGER,available INTEGER);
CREATE TABLE assignments(id TEXT PRIMARY KEY,campaign_id TEXT REFERENCES campaigns(id),creator_id TEXT REFERENCES creators(id));
CREATE TABLE deliverables(id TEXT PRIMARY KEY,assignment_id TEXT REFERENCES assignments(id),title TEXT,due_date TEXT);
CREATE TABLE content_versions(id TEXT PRIMARY KEY,deliverable_id TEXT REFERENCES deliverables(id),version INTEGER,created TEXT);
CREATE TABLE review_events(id TEXT PRIMARY KEY,version_id TEXT REFERENCES content_versions(id),kind TEXT,created TEXT);
CREATE TABLE live_posts(id TEXT PRIMARY KEY,deliverable_id TEXT REFERENCES deliverables(id),source TEXT,published_at TEXT);
CREATE TABLE metric_snapshots(id TEXT PRIMARY KEY,post_id TEXT REFERENCES live_posts(id),captured_at TEXT,payload TEXT,source TEXT);
INSERT INTO users VALUES('owner','owner'),('manager','manager'),('brand','brand'),('creator','creator'),('finance','finance'),('reviewer','reviewer');
INSERT INTO campaigns VALUES('campaign','A new collection'),('other','Other campaign');
INSERT INTO creators VALUES('asha','Asha','Lifestyle','Mumbai','English, Hindi',2500000,1),('tara','Tara','Lifestyle','Mumbai','English, Gujarati',4500000,1),('rohan','Rohan','Travel','Bengaluru','English, Hindi',1000000,0);
INSERT INTO assignments VALUES('assignment','campaign','asha'),('other_assignment','other','tara');
INSERT INTO deliverables VALUES('d1','assignment','First story','2026-01-10'),('d2','assignment','Second story','2026-01-10'),('d3','assignment','Unsubmitted story','2026-01-10');
INSERT INTO content_versions VALUES('v1','d1',1,'2026-01-09T10:00:00.000Z'),('v2','d1',2,'2026-01-10T12:00:00.000Z'),('v3','d2',1,'2026-01-12T00:00:00.000Z');
INSERT INTO review_events VALUES('revision','v1','revision','2026-01-09T12:00:00.000Z'),('approved','v2','brand_approved','2026-01-11T00:00:00.000Z');
`);
const row=(s,...a)=>db.prepare(s).get(...a),rows=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a);let clock='2026-02-01T00:00:00.000Z';
const requireThat=(c,status,message)=>{if(!c)throw Object.assign(new Error(message),{status});};
const textField=(s,l,m=5000)=>{requireThat(typeof s==='string'&&s.trim().length>0&&s.length<=m,400,l+' required');return s.trim();};
const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
const body=async req=>{let s='';for await(const chunk of req)s+=chunk;return JSON.parse(s);};
const optimization=createOptimization({db,row,rows,run,id:p=>p+'_'+randomUUID(),now:()=>clock,transaction,requireThat,textField,send,body});
const server=http.createServer(async(req,res)=>{try{if(!await optimization.handler(req,res,new URL(req.url,'http://local').pathname,row('SELECT * FROM users WHERE id=?',req.headers['x-user']||'owner')))send(res,404,{});}catch(e){send(res,e.status||500,{error:e.message});}});let base;
before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/api/optimization`;});
after(async()=>{await new Promise(r=>server.close(r));db.close();});
async function req(path='',data,role='owner'){const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'x-user':role,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json()};}
const fit=(creator_id,dimension,score)=>({campaign_id:'campaign',creator_id,dimension,score,source_url:'https://example.com/review',observed_on:'2026-01-31',observation:'Reviewed campaign-relevant portfolio',limitations:'Human judgement; limited sample'});

test('hard filters are enforced and private matching cannot be accessed by external or finance roles',async()=>{
 for(const role of ['brand','creator','finance','reviewer'])assert.equal((await req('',undefined,role)).status,403);
 const result=await req('/match',{campaign_id:'campaign',region:'Mumbai',language:'Hindi',niche:'Lifestyle',max_fee:3000000});assert.equal(result.status,201);assert.deepEqual(result.data.results.filter(c=>c.eligible).map(c=>c.creator_id),['asha']);const asha=result.data.results[0];assert.ok(asha.missing.includes('audience'));assert.equal(asha.reliability.deadline_samples,3);assert.equal(asha.reliability.on_time,1);assert.equal(asha.reliability.median_revision_response_hours,24);assert.equal(asha.reliability.ever_brand_approved,1);
 assert.equal((await req('/override',{run_id:result.data.id,creator_id:'tara',decision:'Selected',reason:'I like this creator'})).status,409);
 assert.equal((await req('/override',{run_id:result.data.id,creator_id:'asha',decision:'Selected',reason:'Language and budget are confirmed'})).status,201);
 const history=(await req()).data.runs.find(r=>r.id===result.data.id);assert.equal(history.overrides.length,1);assert.equal(history.overrides[0].reason,'Language and budget are confirmed');
 assert.equal((await req('/match',{campaign_id:'campaign',weights:{audience:-1}})).status,400);
 assert.equal((await req('/match',{campaign_id:'campaign',max_fee:10.5})).status,400);
});

test('dated fit evidence and configurable weights change rankings without inventing missing dimensions',async()=>{
 assert.equal((await req('/evidence',fit('asha','audience',90),'manager')).status,201);assert.equal((await req('/evidence',fit('tara','style',95))).status,201);
 const a=(await req('/match',{campaign_id:'campaign',weights:{audience:100,style:0,budget:0,reliability:0,results:0}})).data;assert.equal(a.results[0].creator_id,'asha');assert.equal(a.results[0].score,90);assert.equal(a.results[0].coverage,100);assert.equal(a.results.find(r=>r.creator_id==='tara').score,null);
 const b=(await req('/match',{campaign_id:'campaign',weights:{audience:0,style:100,budget:0,reliability:0,results:0}})).data;assert.equal(b.results[0].creator_id,'tara');assert.equal(b.results[0].score,95);
 assert.equal((await req('/evidence',{...fit('asha','audience',50),observed_on:'2099-01-01'})).status,400);
 assert.equal((await req('/evidence',{...fit('asha','audience',50),source_url:'javascript:alert(1)'})).status,400);
});

test('reliability exclusions and reinstatements preserve source facts and a correction audit',async()=>{
 assert.equal((await req('/reliability',{deliverable_id:'d3',excluded:true,reason:'Brand delivery delay; creator could not film'})).status,201);let r=(await req()).data.reliability.find(c=>c.creator_id==='asha');assert.equal(r.deadline_samples,2);assert.equal(r.on_time_rate,50);assert.equal(r.details.find(d=>d.id==='d3').excluded,true);assert.equal(row('SELECT due_date FROM deliverables WHERE id=?','d3').due_date,'2026-01-10');
 await req('/reliability',{deliverable_id:'d3',excluded:false,reason:'Corrected after reviewing the dispatch log'});r=(await req()).data.reliability.find(c=>c.creator_id==='asha');assert.equal(r.deadline_samples,3);assert.equal(rows('SELECT * FROM optimization_reliability_corrections WHERE deliverable_id=?','d3').length,2);
});

let experiment;
test('experiments register an immutable design and assignment before publication, with no initial performance claim',async()=>{
 const e=await req('/experiments',{campaign_id:'campaign',title:'Benefit-first openings',hypothesis:'A benefit-first opening increases saves',baseline:'Existing opening style',treatment:'Show benefit in the first two seconds',metric:'saves',content_kind:'Sponsored',window_hours:24,min_per_arm:5,target_lift:10});assert.equal(e.status,201);experiment=e.data.id;assert.equal(e.data.comparison.conclusion,'Insufficient data');assert.equal(e.data.comparison.relative_lift_pct,null);
 for(let i=0;i<10;i++){const did='exp-d'+i;run('INSERT INTO deliverables VALUES(?,?,?,?)',did,'assignment','Experiment story '+i,'2026-02-05');assert.equal((await req('/assign',{experiment_id:experiment,deliverable_id:did,arm:i<5?'Baseline':'Treatment'})).status,201);}
 assert.equal((await req('/assign',{experiment_id:experiment,deliverable_id:'exp-d0',arm:'Treatment'})).status,409);
 assert.equal((await req('/assign',{experiment_id:experiment,deliverable_id:'exp-d0',arm:'Baseline'})).data.already_registered,true);
 assert.equal((await req('/experiments',{campaign_id:'campaign',title:'Bad sample',hypothesis:'H',baseline:'B',treatment:'T',metric:'saves',content_kind:'Sponsored',window_hours:24,min_per_arm:1,target_lift:10})).status,400);
});

test('observations require a real snapshot, matching content and age, and one observation per registered post',async()=>{
 clock='2026-02-03T00:00:00.000Z';
 for(let i=0;i<10;i++){run('INSERT INTO live_posts VALUES(?,?,?,?)','post'+i,'exp-d'+i,'Team-reported; not verified by Instagram','2026-02-01T01:00:00.000Z');run('INSERT INTO metric_snapshots VALUES(?,?,?,?,?)','snapshot'+i,'post'+i,'2026-02-02T01:00:00.000Z',JSON.stringify({views:100+i*10,saves:i<5?10:20}),'Creator-supplied insights');}
 assert.equal((await req('/observe',{experiment_id:experiment,snapshot_id:'snapshot0'})).status,409);
 for(let i=0;i<10;i++){await req('/metric-context',{snapshot_id:'snapshot'+i,content_kind:'Sponsored',reason:'Paid campaign agreement'});assert.equal((await req('/observe',{experiment_id:experiment,snapshot_id:'snapshot'+i})).status,201);}
 assert.equal((await req('/observe',{experiment_id:experiment,snapshot_id:'snapshot0'})).data.already_recorded,true);
 run('INSERT INTO metric_snapshots VALUES(?,?,?,?,?)','snapshot-extra','post0','2026-02-02T01:01:00.000Z',JSON.stringify({views:101,saves:11}),'Later capture');await req('/metric-context',{snapshot_id:'snapshot-extra',content_kind:'Sponsored',reason:'Same paid post'});assert.equal((await req('/observe',{experiment_id:experiment,snapshot_id:'snapshot-extra'})).status,409);
 assert.equal((await req('/metric-context',{snapshot_id:'snapshot0',content_kind:'Organic',reason:'Attempted reclassification'})).status,409);
 const e=(await req()).data.experiments.find(e=>e.id===experiment);assert.deepEqual(e.comparison.sample_sizes,{baseline:5,treatment:5});assert.equal(e.comparison.conclusion,'Observed target met');assert.equal(e.comparison.relative_lift_pct,100);assert.ok(e.comparison.limitations.includes('not randomised'));assert.equal(e.comparison.observations.length,10);
 run('INSERT INTO deliverables VALUES(?,?,?,?)','late','assignment','Published before arm registration','2026-02-05');run('INSERT INTO live_posts VALUES(?,?,?,?)','late-post','late','Manual','2026-02-01T01:00:00.000Z');assert.equal((await req('/assign',{experiment_id:experiment,deliverable_id:'late',arm:'Baseline'})).status,409);
});

test('historical references keep source and age, deduplicate posts, separate organic and leave insufficient data unknown',async()=>{
 const f=(await req('/forecast',{creator_id:'asha',metric:'views',content_kind:'Sponsored',window_hours:24})).data;assert.equal(f.sample_size,10);assert.equal(f.median,145);assert.deepEqual(f.observed_range,[100,190]);assert.equal(f.observations.filter(s=>s.post_id==='post0').length,1);assert.equal(f.observations.find(s=>s.post_id==='post0').snapshot_id,'snapshot0');assert.ok(f.observations.every(s=>s.source==='Creator-supplied insights'));
 const organic=(await req('/forecast',{creator_id:'asha',metric:'views',content_kind:'Organic',window_hours:24})).data;assert.equal(organic.sample_size,0);assert.equal(organic.median,null);assert.equal(organic.status,'Insufficient comparable history');
 assert.equal((await req('/forecast',{creator_id:'asha',metric:'reach',content_kind:'Sponsored',window_hours:24})).data.median,null);
 assert.equal((await req('/forecast',{creator_id:'asha',metric:'views',content_kind:'Sponsored',window_hours:168})).data.sample_size,0);
});

test('wrong-age observations are rejected and a zero baseline never claims a percentage target was met',async()=>{
 clock='2026-02-04T00:00:00.000Z';
 const e=(await req('/experiments',{campaign_id:'campaign',title:'Zero baseline example',hypothesis:'Observe likes',baseline:'Existing style',treatment:'New style',metric:'likes',content_kind:'Sponsored',window_hours:24,min_per_arm:5,target_lift:10})).data;
 for(let i=0;i<10;i++){const did='zero-d'+i;run('INSERT INTO deliverables VALUES(?,?,?,?)',did,'assignment','Zero story '+i,'2026-02-07');assert.equal((await req('/assign',{experiment_id:e.id,deliverable_id:did,arm:i<5?'Baseline':'Treatment'})).status,201);}
 clock='2026-02-06T00:00:00.000Z';
 for(let i=0;i<10;i++){run('INSERT INTO live_posts VALUES(?,?,?,?)','zero-post'+i,'zero-d'+i,'Team-reported','2026-02-04T01:00:00.000Z');run('INSERT INTO metric_snapshots VALUES(?,?,?,?,?)','zero-snapshot'+i,'zero-post'+i,'2026-02-05T01:00:00.000Z',JSON.stringify({likes:i<5?0:1}),'Observed fixture');await req('/metric-context',{snapshot_id:'zero-snapshot'+i,content_kind:'Sponsored',reason:'Paid campaign'});}
 run('INSERT INTO metric_snapshots VALUES(?,?,?,?,?)','wrong-age','zero-post0','2026-02-04T02:00:00.000Z',JSON.stringify({likes:0}),'Too early');await req('/metric-context',{snapshot_id:'wrong-age',content_kind:'Sponsored',reason:'Paid campaign'});assert.equal((await req('/observe',{experiment_id:e.id,snapshot_id:'wrong-age'})).status,409);
 for(let i=0;i<10;i++)assert.equal((await req('/observe',{experiment_id:e.id,snapshot_id:'zero-snapshot'+i})).status,201);
 const result=(await req()).data.experiments.find(x=>x.id===e.id).comparison;assert.equal(result.conclusion,'Cannot assess relative target');assert.equal(result.relative_lift_pct,null);assert.equal(result.difference,1);
});
