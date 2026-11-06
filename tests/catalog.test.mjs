import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';process.env.DB_PATH=':memory:';process.env.DEMO_MODE='1';
const {server}=await import('../server.mjs');let base;const cookies={};
before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;for(const role of ['owner','manager','brand','creator','finance']){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:'u_'+role})});cookies[role]=r.headers.get('set-cookie').split(';')[0];}});
after(()=>new Promise(r=>server.close(r)));
async function req(path,data,role='owner'){const r=await fetch(base+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{Cookie:cookies[role]||'',...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json()};}
const profile={name:'New creator',handle:'new_creator',niche:'Design',location:'Mumbai',language:'English, Hindi',bio:'Independent design stories.',fee:1250000,available:true,followers:null,engagement:null,metric_source:'Not supplied',observed_on:null,sample_size:null,sample_kind:'Mixed / unknown',portfolio:['https://www.instagram.com/new_creator/'],collaborations:'',visibility:'Draft',evidence_url:''};

test('creator approval controls public visibility and never reveals planning fees',async()=>{
 const created=await req('catalog/creators',profile);assert.equal(created.status,201);const id=created.data.id;assert.ok(!(await req('public')).data.creators.some(c=>c.id===id));
 assert.equal((await req('catalog/creators',{...profile,id,visibility:'Approved'})).status,201);const c=(await req('public')).data.creators.find(c=>c.id===id);assert.equal(c.followers,null);assert.equal(c.verified,false);assert.equal('fee' in c,false);assert.deepEqual(c.portfolio,profile.portfolio);
 await req('catalog/creators',{...profile,id,visibility:'Hidden'});assert.ok(!(await req('public')).data.creators.some(c=>c.id===id));assert.equal((await req('catalog')).data.creators.find(c=>c.id===id).fee,1250000);
});
test('statistics require provenance and manual entry cannot claim connected verification',async()=>{
 for(const extra of [{followers:100},{engagement:4,metric_source:'Self-reported',observed_on:'2026-01-01'},{metric_source:'Connected'},{portfolio:['javascript:alert(1)']},{fee:-1},{observed_on:'2099-01-01'}])assert.equal((await req('catalog/creators',{...profile,...extra})).status,400);
 const r=await req('catalog/creators',{...profile,followers:10000,engagement:4,metric_source:'Uploaded evidence',observed_on:'2026-01-01',sample_size:10,sample_kind:'Organic',evidence_url:'https://example.com/evidence'});assert.equal(r.status,201);const c=(await req('catalog')).data.creators.find(c=>c.id===r.data.id);assert.equal(c.sample_size,10);assert.equal(c.sample_kind,'Organic');assert.equal(c.verified,false);
});
test('website content publishing needs evidence and catalogue writes are staff-scoped',async()=>{
 for(const role of ['brand','creator','finance']){assert.equal((await req('catalog',undefined,role)).status,403);assert.equal((await req('catalog/brands',{name:'X',industry:'Y'},role)).status,403);}
 const b=await req('catalog/brands',{name:'A real brand',industry:'Home'},'manager');assert.equal(b.status,201);
 const content={kind:'Case study',title:'Recorded campaign',summary:'An evidence-based example.',details:'Sample limitation: one campaign.',state:'Published'};assert.equal((await req('catalog/content',content)).status,400);
 const r=await req('catalog/content',{...content,evidence_url:'https://example.com/report'});assert.equal(r.status,201);assert.ok((await req('public')).data.content.some(c=>c.id===r.data.id));await req('catalog/content',{...content,id:r.data.id,state:'Hidden',evidence_url:'https://example.com/report'});assert.ok(!(await req('public')).data.content.some(c=>c.id===r.data.id));
 assert.ok((await req('catalog')).data.audit.length>=3);
});
