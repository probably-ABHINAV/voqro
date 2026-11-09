import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {createDelivery} from '../delivery.mjs';
import {createCloud,prepareEvidence,validateAIFindings} from '../cloud.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const video=readFileSync(new URL('./fixtures/draft.mp4',import.meta.url)),cover=readFileSync(new URL('./fixtures/cover.png',import.meta.url));
const finding={layer:'Human review flags',field:'video',timestamp:0,observation:'Only a sampled frame was reviewed.',requirement:'Show the product clearly.',correction:'Review the full video.',severity:'warning',confidence:.5,blocking:false};

async function fixture(options={}){
 const directory=mkdtempSync(resolve(tmpdir(),'voqro-cloud-')),db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,brand_id TEXT,creator_id TEXT);
 CREATE TABLE brands(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE creators(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE campaigns(id TEXT PRIMARY KEY,brand_id TEXT,name TEXT,status TEXT,description TEXT);
 CREATE TABLE assignments(id TEXT PRIMARY KEY,campaign_id TEXT,creator_id TEXT);
 CREATE TABLE deliverables(id TEXT PRIMARY KEY,assignment_id TEXT,title TEXT,due_date TEXT,status TEXT,owner TEXT,publishing_account TEXT);
 CREATE TABLE content_versions(id TEXT PRIMARY KEY,deliverable_id TEXT,version INTEGER,package_json TEXT,created TEXT);
 CREATE TABLE approvals(id TEXT PRIMARY KEY,content_version_id TEXT,reviewer_id TEXT,stage TEXT,created TEXT);
 INSERT INTO users VALUES('owner','Owner','owner',NULL,NULL),('manager','Manager','manager',NULL,NULL),('creator','Creator','creator',NULL,'c1'),('brand','Brand','brand','b1',NULL),('other','Other','brand','b2',NULL),('finance','Finance','finance',NULL,NULL);
 INSERT INTO brands VALUES('b1','First'),('b2','Other');INSERT INTO creators VALUES('c1','Creator'),('c2','Other Creator');
 INSERT INTO campaigns VALUES('cam1','b1','First','Active',''),('cam2','b2','Other','Active','');
 INSERT INTO assignments VALUES('a1','cam1','c1'),('a2','cam2','c2');
 INSERT INTO deliverables VALUES('d1','a1','First video',NULL,'Draft due','Creator','@brand'),('d2','a2','Other video',NULL,'Draft due','Other Creator','@other');`);
 const row=(s,...args)=>db.prepare(s).get(...args),rows=(s,...args)=>db.prepare(s).all(...args),run=(s,...args)=>db.prepare(s).run(...args),now=()=>new Date().toISOString(),id=p=>p+'_'+randomUUID().replaceAll('-','');
 const requireThat=(v,status,message)=>{if(!v)throw Object.assign(new Error(message),{status});};
 const textField=(v,label,max=5000)=>{requireThat(typeof v==='string'&&v.trim()&&v.length<=max,400,label+' required');return v.trim();};
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 const body=async req=>{let text='';for await(const c of req)text+=c;return JSON.parse(text||'{}');};
 const shared={db,row,rows,run,id,now,requireThat,textField,transaction,send,body,activity:()=>{},dbPath:resolve(directory,'db.sqlite')};
 const delivery=createDelivery(shared),store=delivery.context.store;writeFileSync(resolve(store,'video1'),video);writeFileSync(resolve(store,'cover1'),cover);
 run('INSERT INTO uploads VALUES(?,?,?,?,?,?,?,?,?,?)','video1','d1','creator','draft.mp4','video/mp4',video.length,'video','Complete',hash(video),now());run('INSERT INTO uploads VALUES(?,?,?,?,?,?,?,?,?,?)','cover1','d1','creator','cover.png','image/png',cover.length,'cover','Complete',hash(cover),now());
 run('INSERT INTO brief_versions VALUES(?,?,?,?,?,?)','brief1','cam1',1,JSON.stringify({requirements:'Show product',disclosure:'#ad'}),'Owner',now());
 function version(id='v1',number=1){run('INSERT INTO content_versions VALUES(?,?,?,?,?)',id,'d1',number,JSON.stringify({video_id:'video1',video_sha256:hash(video),cover_id:'cover1',cover_sha256:hash(cover),caption:'Our product #ad',brief_version_id:'brief1'}),now());return id;}
 version();
 const objects=new Map(),uploads=new Map();let modelCalls=0,completeCalls=0,listCalls=0;
 const provider={
  async createMultipart(key,mime,metadata){uploads.set(key,{mime,metadata,id:'provider-'+key,bytes:video});return 'provider-'+key;},
  async findMultipart(key){return uploads.get(key)?.id;},
  async signPart(key,upload,number,size,checksum){return `https://private-bucket.s3.ap-south-1.amazonaws.com/${key}?part=${number}&size=${size}&checksum=${checksum}`;},
  async listParts(key){listCalls++;if(options.listPartsGate)await options.listPartsGate;const a=uploads.get(key);return [{number:1,size:a.bytes.length,etag:'part-etag',checksum:Buffer.from(hash(a.bytes),'hex').toString('base64')}];},
  async complete(key){completeCalls++;const a=uploads.get(key);objects.set(key,{bytes:a.bytes,Metadata:a.metadata,VersionId:'object-version-1',ContentLength:a.bytes.length});if(options.completeTimeout)throw new Error('Timed out after provider commit');return {VersionId:'object-version-1'};},
  async head(key){return objects.get(key)||null;},
  async stream(key){return Readable.from([objects.get(key).bytes]);},
  async put(key,bytes,mime,metadata){objects.set(key,{bytes,Metadata:metadata,VersionId:'object-version-1',ContentLength:bytes.length});return {VersionId:'object-version-1'};},
  async signGet(key,version,seconds){return `https://private-bucket.s3.ap-south-1.amazonaws.com/${key}?versionId=${version}&expires=${seconds}`;},
  async analyse(){modelCalls++;if(options.modelTimeout)throw new Error('Provider timeout');return {payload:options.modelInvalid?{findings:[{...finding,confidence:5}]}:{findings:[finding]},usage:{inputTokens:40,outputTokens:20},request_id:'bedrock-request'};}
 };
 const cloud=createCloud({...shared,delivery,provider,azureProvider:options.azure?provider:undefined,config:{region:'ap-south-1',bucket:'private-bucket',enabled:true,aiEnabled:true,model:'test-model',pricingVerified:true,reservationCents:50,monthlyLimitCents:100,...options.config}});
 delivery.analysisFor=cloud.analysisFor;
 const server=http.createServer(async(req,res)=>{try{const u=row('SELECT * FROM users WHERE id=?',req.headers['x-user']||'owner');requireThat(u,401,'Sign in');if(!await cloud.handler(req,res,new URL(req.url,'http://local').pathname,u)&&!await delivery(req,res,new URL(req.url,'http://local').pathname,u))send(res,404,{error:'Missing'});}catch(e){send(res,e.status||500,{error:e.message});}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 async function request(path='',data,user='owner'){const r=await fetch(base+(path.startsWith('/api/')?path:'/api/cloud'+path),{method:data===undefined?'GET':'POST',headers:{'x-user':user,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:(r.headers.get('content-type')||'').includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer()),headers:r.headers};}
 return {db,row,run,cloud,request,objects,uploads,version,store,modelCalls:()=>modelCalls,completeCalls:()=>completeCalls,listCalls:()=>listCalls,close:async()=>{cloud.stop();await new Promise(r=>server.close(r));db.close();rmSync(directory,{recursive:true,force:true});}};
}

test('S3 multipart upload enforces owner, exact byte integrity, immutable version and private release scope',async()=>{
 const f=await fixture();try{
  const input={deliverable_id:'d1',name:'draft.mp4',mime:'video/mp4',size:video.length,kind:'video',sha256:hash(video),request_key:'upload-request'};
  assert.equal((await f.request('/uploads',{...input,deliverable_id:'d2'},'creator')).status,403);
  const created=await f.request('/uploads',input,'creator');assert.equal(created.status,202);const uid=created.data.id;
  assert.equal((await f.request('/uploads',input,'creator')).data.id,uid);assert.equal((await f.request('/uploads',{...input,sha256:'a'.repeat(64)},'creator')).status,409);
  assert.equal((await f.request('/uploads/'+uid+'/parts',{part_number:1,sha256:hash(video)},'owner')).status,403);
  const signed=await f.request('/uploads/'+uid+'/parts',{part_number:1,sha256:hash(video)},'creator');assert.equal(signed.status,200);assert.equal(signed.data.size,video.length);assert.equal(signed.data.expires_in,300);
  assert.equal((await f.request('/uploads/'+uid+'/complete',{},'creator')).status,202);assert.equal(f.row('SELECT id FROM uploads WHERE id=?',uid),undefined);
  await f.cloud.tick();assert.equal(f.row('SELECT state FROM cloud_uploads WHERE id=?',uid).state,'Verified');assert.equal(f.row('SELECT sha256 FROM uploads WHERE id=?',uid).sha256,hash(video));assert.deepEqual(readFileSync(resolve(f.store,uid)),video);
  assert.equal((await f.request('/media/'+uid,undefined,'brand')).status,403);assert.equal((await f.request('/media/'+uid,undefined,'other')).status,403);
  assert.equal((await f.request('/uploads/'+uid+'/complete',{},'creator')).data.state,'Verified');assert.equal(f.completeCalls(),1);
  const url=await f.cloud.publishingMedia('v1','video',{expiresIn:900});assert.match(url.url,/versionId=object-version-1/);assert.equal(url.sha256,hash(video));
 }finally{await f.close();}
});

test('uncertain S3 completion reconciles the existing object without duplicate writes',async()=>{
 const f=await fixture({completeTimeout:true});try{
  const c=await f.request('/uploads',{deliverable_id:'d1',name:'draft.mp4',mime:'video/mp4',size:video.length,kind:'video',sha256:hash(video),request_key:'uncertain'},'creator'),uid=c.data.id;
  assert.equal((await f.request('/uploads/'+uid+'/complete',{},'creator')).data.state,'Needs reconciliation');assert.equal((await f.request('/uploads/'+uid+'/complete',{},'creator')).status,409);
  assert.equal((await f.request('/uploads/'+uid+'/reconcile',{},'creator')).data.state,'Verifying');await f.cloud.tick();assert.equal(f.row('SELECT state FROM cloud_uploads WHERE id=?',uid).state,'Verified');assert.equal(f.completeCalls(),1);
 }finally{await f.close();}
});

test('analysis reserves USD allowances once, prepares real frames, isolates scope and retains immutable findings',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('/analyse',{version_id:'v1',mode:'aws'})).status,409);
  assert.equal((await f.request('/budget',{campaign_id:'cam1',limit_cents:50},'manager')).status,403);assert.equal((await f.request('/budget',{campaign_id:'cam1',limit_cents:50})).status,200);
  assert.equal((await f.request('/analyse',{version_id:'v1',mode:'aws'},'creator')).status,403);
  const first=await f.request('/analyse',{version_id:'v1',mode:'aws'});assert.equal(first.status,202);assert.equal((await f.request('/analyse',{version_id:'v1',mode:'aws'})).data.id,first.data.id);
  await f.cloud.tick();assert.equal(f.row('SELECT state FROM cloud_ai_jobs WHERE id=?',first.data.id).state,'Prepared');await f.cloud.tick();const completed=f.row('SELECT * FROM cloud_ai_jobs WHERE id=?',first.data.id);assert.equal(completed.state,'Completed');assert.equal(JSON.parse(completed.result).findings[0].observation,finding.observation);assert.equal(f.modelCalls(),1);assert.equal(f.row('SELECT COUNT(*) AS n FROM approvals').n,0);
  f.version('v2',2);assert.equal((await f.request('/analyse',{version_id:'v2',mode:'aws'})).status,409);assert.equal((await f.request('',undefined,'other')).data.jobs.length,0);assert.equal((await f.request('',undefined,'brand')).data.jobs.length,0);
  const creator=(await f.request('',undefined,'creator')).data.jobs[0];assert.equal('reserved_cents' in creator,false);assert.equal((await f.request('',undefined,'finance')).status,403);
  const local=await f.request('/analyse',{version_id:'v2',mode:'local'},'creator');await f.cloud.tick();assert.equal(f.row('SELECT state FROM cloud_ai_jobs WHERE id=?',local.data.id).state,'Completed');assert.equal(f.modelCalls(),1);
 }finally{await f.close();}
});

test('uncertain model requests retain their reservation and never auto retry',async()=>{
 const f=await fixture({modelTimeout:true});try{
  await f.request('/budget',{campaign_id:'cam1',limit_cents:100});const created=await f.request('/analyse',{version_id:'v1',mode:'aws'});await f.cloud.tick();await f.cloud.tick();await f.cloud.tick();const job=f.row('SELECT * FROM cloud_ai_jobs WHERE id=?',created.data.id);assert.equal(job.state,'Needs reconciliation');assert.equal(job.reserved_cents,50);assert.equal(job.external_started,1);assert.equal(f.modelCalls(),1);assert.equal((await f.request('/analyse',{version_id:'v1',mode:'aws'})).data.state,'Needs reconciliation');
 }finally{await f.close();}
});

test('invalid findings and altered source media fail before approval or paid analysis',async()=>{
 assert.throws(()=>validateAIFindings({findings:[{...finding,confidence:2}]},1),/values/);assert.throws(()=>validateAIFindings({findings:[{...finding,timestamp:20}]},1),/values/);
 const f=await fixture();try{await f.request('/budget',{campaign_id:'cam1',limit_cents:50});const job=await f.request('/analyse',{version_id:'v1',mode:'aws'});writeFileSync(resolve(f.store,'video1'),'corrupt');await f.cloud.tick();const failed=f.row('SELECT * FROM cloud_ai_jobs WHERE id=?',job.data.id);assert.equal(failed.state,'Failed');assert.equal(failed.reserved_cents,0);assert.equal(f.modelCalls(),0);}finally{await f.close();}
});

test('leases recover local work once and quarantine interrupted model calls without another invocation',async()=>{
 const f=await fixture();try{
  const local=await f.request('/analyse',{version_id:'v1',mode:'local'},'creator');f.run('UPDATE cloud_ai_jobs SET lease_token=?,lease_until=? WHERE id=?','old-worker',Date.now()-1,local.data.id);
  const processed=await Promise.all([f.cloud.tick(),f.cloud.tick()]);assert.equal(processed.filter(Boolean).length,1);assert.equal(f.row('SELECT state FROM cloud_ai_jobs WHERE id=?',local.data.id).state,'Completed');
  await f.request('/budget',{campaign_id:'cam1',limit_cents:100});const aws=await f.request('/analyse',{version_id:'v1',mode:'aws'});await f.cloud.tick();
  f.run("UPDATE cloud_ai_jobs SET state='Analyzing',external_started=1,lease_token=?,lease_until=? WHERE id=?",'interrupted-model',Date.now()-1,aws.data.id);await f.cloud.tick();
  const recovered=f.row('SELECT * FROM cloud_ai_jobs WHERE id=?',aws.data.id);assert.equal(recovered.state,'Needs reconciliation');assert.equal(recovered.reserved_cents,50);assert.equal(f.modelCalls(),0);
 }finally{await f.close();}
});

test('malformed provider findings are quarantined and exact-version studio responses hide private allowances',async()=>{
 const bad=await fixture({modelInvalid:true});try{await bad.request('/budget',{campaign_id:'cam1',limit_cents:50});const job=await bad.request('/analyse',{version_id:'v1',mode:'aws'});await bad.cloud.tick();await bad.cloud.tick();const row=bad.row('SELECT * FROM cloud_ai_jobs WHERE id=?',job.data.id);assert.equal(row.state,'Needs reconciliation');assert.equal(row.result,null);assert.equal(row.reserved_cents,50);}finally{await bad.close();}
 const f=await fixture();try{
  await f.request('/budget',{campaign_id:'cam1',limit_cents:50});const requested=await f.request('/analyse',{version_id:'v1',mode:'aws'});await f.cloud.tick();await f.cloud.tick();
  const sample='/jobs/'+requested.data.id+'/frames/0';const ownFrame=await f.request(sample,undefined,'creator');assert.equal(ownFrame.status,200);assert.ok(ownFrame.data.length>0);assert.equal(ownFrame.headers.get('cache-control'),'private, no-store');assert.equal((await f.request(sample,undefined,'brand')).status,403);assert.equal((await f.request(sample,undefined,'other')).status,403);
  const hidden=await f.request('/api/delivery/deliverable/d1',undefined,'brand');assert.equal(hidden.status,200);assert.equal(hidden.data.versions.length,0);
  f.run('INSERT INTO approvals VALUES(?,?,?,?,?)','agency1','v1','owner','agency',new Date().toISOString());
  const released=await f.request('/api/delivery/deliverable/d1',undefined,'brand');assert.equal(released.status,200);assert.equal((await f.request(sample,undefined,'brand')).status,200);const evidence=released.data.versions[0].analysis[0];assert.equal(evidence.version_id,'v1');assert.equal('reserved_cents' in evidence,false);assert.equal('reserved_cents' in evidence.result,false);assert.equal('knowledge' in evidence.prepared,false);
  assert.equal((await f.request('/api/delivery/deliverable/d1',undefined,'other')).status,403);assert.equal(f.row('SELECT COUNT(*) AS n FROM approvals').n,1);
 }finally{await f.close();}
});

test('concurrent multipart completion claims the provider action exactly once',async()=>{
 let release;const gate=new Promise(r=>release=r),f=await fixture({listPartsGate:gate});try{
  const created=await f.request('/uploads',{deliverable_id:'d1',name:'draft.mp4',mime:'video/mp4',size:video.length,kind:'video',sha256:hash(video),request_key:'concurrent'},'creator');const endpoint='/uploads/'+created.data.id+'/complete';
  const responses=Promise.all([f.request(endpoint,{},'creator'),f.request(endpoint,{},'creator')]);for(let i=0;i<100&&f.listCalls()<2;i++)await new Promise(r=>setTimeout(r,5));assert.equal(f.listCalls(),2);release();
  assert.deepEqual((await responses).map(r=>r.status).sort(),[202,409]);assert.equal(f.completeCalls(),1);await f.cloud.tick();assert.equal(f.row('SELECT state FROM cloud_uploads WHERE id=?',created.data.id).state,'Verified');
 }finally{release();await f.close();}
});

test('a stale worker cannot invoke a paid model after another worker takes its lease',async()=>{
 const f=await fixture();try{
  await f.request('/budget',{campaign_id:'cam1',limit_cents:50});const job=await f.request('/analyse',{version_id:'v1',mode:'aws'});await f.cloud.tick();
  const stale=f.cloud.tick();f.run('UPDATE cloud_ai_jobs SET lease_token=?,lease_until=? WHERE id=?','replacement-worker',Date.now()+180000,job.data.id);await stale;
  const saved=f.row('SELECT * FROM cloud_ai_jobs WHERE id=?',job.data.id);assert.equal(saved.lease_token,'replacement-worker');assert.equal(saved.external_started,0);assert.equal(saved.state,'Prepared');assert.equal(f.modelCalls(),0);
 }finally{await f.close();}
});

test('an existing provider object must match actual approved bytes, not only its checksum metadata',async()=>{
 const f=await fixture();try{
  f.objects.set('originals/video1',{bytes:Buffer.alloc(video.length),ContentLength:video.length,VersionId:'forged-version',Metadata:{sha256:hash(video)}});
  await assert.rejects(f.cloud.publishingMedia('v1','video'),/bytes differ/);assert.equal(f.row('SELECT * FROM cloud_assets WHERE upload_id=?','video1'),undefined);
 }finally{await f.close();}
});

const azureConfig={enabled:false,aiEnabled:false,bucket:'',azureEnabled:true,azureEndpoint:'https://test.openai.azure.com/',azureDeployment:'review',azurePricingVerified:true,azureRegion:'uaenorth'};
test('Azure review uses local immutable media without AWS, enforces allowance and retains human approval',async()=>{
 const f=await fixture({azure:true,config:azureConfig});try{
  const status=(await f.request()).data.status;assert.deepEqual(status.analysis_modes,['local','azure']);
  assert.equal((await f.request('/analyse',{version_id:'v1',mode:'azure'},'creator')).status,403);
  assert.equal((await f.request('/analyse',{version_id:'v1',mode:'azure'})).status,409);
  await f.request('/budget',{campaign_id:'cam1',limit_cents:50});
  const requested=await f.request('/analyse',{version_id:'v1',mode:'azure'});assert.equal(requested.status,202);
  assert.equal((await f.request('/analyse',{version_id:'v1',mode:'azure'})).data.id,requested.data.id);
  await f.cloud.tick();await f.cloud.tick();await f.cloud.tick();
  const job=f.row('SELECT * FROM cloud_ai_jobs WHERE id=?',requested.data.id),result=JSON.parse(job.result);
  assert.equal(job.state,'Completed');assert.equal(job.reserved_cents,50);assert.equal(result.engine,'Azure OpenAI');assert.equal(result.ai,true);assert.match(result.coverage,/Audio.*not analysed/);assert.equal(f.modelCalls(),1);assert.equal(f.objects.size,0);assert.equal(f.row('SELECT COUNT(*) n FROM approvals').n,0);
  assert.equal((await f.request('',undefined,'other')).data.jobs.length,0);
 }finally{await f.close();}
});
test('Azure uncertain response keeps reservation and never repeats a model call',async()=>{
 const f=await fixture({azure:true,config:azureConfig,modelTimeout:true});try{
  await f.request('/budget',{campaign_id:'cam1',limit_cents:50});const requested=await f.request('/analyse',{version_id:'v1',mode:'azure'});
  await f.cloud.tick();await f.cloud.tick();await f.cloud.tick();
  const job=f.row('SELECT * FROM cloud_ai_jobs WHERE id=?',requested.data.id);assert.equal(job.state,'Needs reconciliation');assert.equal(job.reserved_cents,50);assert.equal(f.modelCalls(),1);
 }finally{await f.close();}
});
test('Azure review stays unavailable without explicit enablement',async()=>{
 const f=await fixture({azure:true,config:{...azureConfig,azureEnabled:false}});try{
  await f.request('/budget',{campaign_id:'cam1',limit_cents:50});assert.equal((await f.request('/analyse',{version_id:'v1',mode:'azure'})).status,503);assert.equal(f.modelCalls(),0);
 }finally{await f.close();}
});

test('queued Azure analysis cannot spend after its operator loses access',async()=>{
 const f=await fixture({azure:true,config:azureConfig});try{
  await f.request('/budget',{campaign_id:'cam1',limit_cents:50});const requested=await f.request('/analyse',{version_id:'v1',mode:'azure'});await f.cloud.tick();
  f.run("UPDATE users SET role='reviewer' WHERE id='owner'");await f.cloud.tick();
  const job=f.row('SELECT * FROM cloud_ai_jobs WHERE id=?',requested.data.id);assert.equal(job.state,'Failed');assert.equal(job.external_started,0);assert.equal(job.reserved_cents,0);assert.equal(f.modelCalls(),0);
 }finally{await f.close();}
});

test('media jobs count sales reservations against the same monthly AI ceiling',async()=>{
 const f=await fixture();try{
  f.db.exec('CREATE TABLE sales_ai_jobs(id TEXT PRIMARY KEY,reserved_cents INTEGER,created TEXT)');
  f.run('INSERT INTO sales_ai_jobs VALUES(?,?,?)','sales',60,new Date().toISOString());
  await f.request('/budget',{campaign_id:'cam1',limit_cents:100});
  const result=await f.request('/analyse',{version_id:'v1',mode:'aws',language:'en-IN'});
  assert.equal(result.status,409);assert.equal(f.row('SELECT COUNT(*) n FROM cloud_ai_jobs').n,0);
 }finally{await f.close();}
});
