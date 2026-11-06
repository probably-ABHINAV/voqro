import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
process.env.NODE_ENV='test';process.env.DB_PATH=':memory:';process.env.DEMO_MODE='1';
const mediaDir=mkdtempSync(resolve(tmpdir(),'voqro-delivery-test-'));process.env.UPLOAD_PATH=mediaDir;
const {server}=await import('../server.mjs');let base,owner,creator,brand,other,reviewer,finance;
async function call(path,data,cookie='',options={}){const r=await fetch(base+'/api/'+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),Cookie:cookie,...options.headers},body:data?JSON.stringify(data):undefined,...Object.fromEntries(Object.entries(options).filter(([k])=>k!=='headers'))});const json=(r.headers.get('content-type')||'').includes('application/json');return {status:r.status,data:json?await r.json():Buffer.from(await r.arrayBuffer()),cookie:r.headers.get('set-cookie')?.split(';')[0],headers:r.headers};}
async function login(user_id){return (await call('login',{user_id})).cookie;}
before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;[owner,creator,brand,other,reviewer,finance]=await Promise.all(['u_owner','u_creator','u_brand','u_other','u_reviewer','u_finance'].map(login));});
after(async()=>{await new Promise(r=>server.close(r));rmSync(mediaDir,{recursive:true,force:true});});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const video=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(1024*1024+30)]);
async function upload(bytes,kind='video',cookie=creator,did='d1'){
 const init=await call('uploads',{deliverable_id:did,name:kind==='video'?'draft.mp4':'cover.png',mime:kind==='video'?'video/mp4':'image/png',size:bytes.length,kind},cookie);assert.equal(init.status,201,JSON.stringify(init.data));for(let offset=0,index=0;offset<bytes.length;offset+=init.data.chunk_size,index++){const r=await call(`uploads/${init.data.id}/chunks/${index}`,null,cookie,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes.subarray(offset,offset+init.data.chunk_size)});assert.equal(r.status,200,JSON.stringify(r.data));}const completed=await call(`uploads/${init.data.id}/complete`,{},cookie);assert.equal(completed.status,200,JSON.stringify(completed.data));return completed.data.id;
}
const brief={campaign_id:'cam_1',goals:'An everyday skincare ritual',requirements:'Show product use and packaging. 15 second reel.',tone:'Warm and human.',claims:'Hydrating moisturiser.',prohibited:'No medical claims.',disclosure:'#ad'};
let videoId,coverId,v1,v2,v3;
const packageBody=()=>({deliverable_id:'d1',video_id:videoId,cover_id:coverId,caption:'A thoughtful morning ritual.',hashtags:'#skincare',mentions:'@oliveandearth',disclosure:'#ad',account:'@oliveandearth',window_start:new Date(Date.now()+86400000).toISOString(),window_end:new Date(Date.now()+172800000).toISOString()});
test('versioned campaign brief, assignment scope, deadline and dispatch permissions',async()=>{
 assert.equal((await call('delivery/campaign',brief,creator)).status,403);assert.equal((await call('delivery/campaign',brief,owner)).status,201);assert.equal((await call('delivery/campaign',brief,owner)).status,409);assert.equal((await call('delivery/campaign/cam_1',null,other)).status,403);assert.equal((await call('delivery/campaign/cam_1',null,finance)).status,403);assert.equal((await call('delivery/deliverable/d2',null,creator)).status,403);
 assert.equal((await call('delivery/assignment',{deliverable_id:'d1',due_date:'2026-02-31'},owner)).status,400);assert.equal((await call('delivery/assignment',{deliverable_id:'d1',due_date:'2026-11-15'},owner)).status,200);
 assert.equal((await call('delivery/shipment',{assignment_id:'a1',product:'Daily care kit',quantity:1,carrier:'Example courier',tracking:'TRACK-01',status:'Dispatched'},owner)).status,200);assert.equal((await call('delivery/shipment',{assignment_id:'a2',status:'Received'},creator)).status,403);assert.equal((await call('delivery/shipment',{assignment_id:'a1',status:'Received'},creator)).status,200);const data=(await call('delivery/campaign/cam_1',null,creator)).data;assert.equal(data.shipments.length,1);assert.equal(data.shipments[0].status,'Received');
});
test('private chunk uploads, exact retries, missing chunks, checksums and range requests',async()=>{
 const init=await call('uploads',{deliverable_id:'d1',name:'draft.mp4',mime:'video/mp4',size:video.length,kind:'video'},creator);const uid=init.data.id;
 assert.equal((await call(`uploads/${uid}/complete`,{},creator)).status,409);assert.equal((await call(`uploads/${uid}/chunks/0`,null,other,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:video.subarray(0,1024*1024)})).status,403);
 const chunk=video.subarray(0,1024*1024);for(let i=0;i<2;i++)assert.equal((await call(`uploads/${uid}/chunks/0`,null,creator,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:chunk})).status,200);
 assert.equal((await call(`uploads/${uid}/chunks/0`,null,creator,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:Buffer.alloc(chunk.length)})).status,409);
 assert.equal((await call(`uploads/${uid}/chunks/1`,null,creator,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:video.subarray(1024*1024)})).status,200);const done=await call(`uploads/${uid}/complete`,{},creator);assert.equal(done.status,200);assert.equal(done.data.sha256.length,64);assert.deepEqual((await call(`uploads/${uid}/complete`,{},creator)).data,done.data);videoId=uid;coverId=await upload(png,'cover');
 assert.equal((await call('media/'+uid)).status,401);assert.equal((await call('media/'+uid,null,brand)).status,403);assert.equal((await call('media/'+uid,null,other)).status,403);assert.equal((await call('media/'+uid,null,finance)).status,403);const partial=await call('media/'+uid,null,creator,{headers:{Range:'bytes=4-7'}});assert.equal(partial.status,206);assert.equal(partial.data.toString(),'ftyp');assert.equal(partial.headers.get('cache-control'),'private, no-store');assert.equal((await call('media/'+uid,null,creator,{headers:{Range:'bytes=999999999-'}})).status,416);
});
test('creator → agency revision → new draft → agency approval → brand approval; notes remain private',async()=>{
 let result=await call('delivery/versions',packageBody(),creator);assert.equal(result.status,201,JSON.stringify(result.data));v1=result.data.id;
 assert.equal((await call('delivery/review',{version_id:v1,action:'approve'},brand)).status,403);
 assert.equal((await call('delivery/review',{version_id:v1,action:'comment',message:'Agency private assessment',visibility:'internal'},reviewer)).status,200);
 assert.equal((await call('delivery/review',{version_id:v1,action:'comment',message:'Cannot add an internal note',visibility:'internal'},creator)).status,403);
 assert.equal((await call('delivery/review',{version_id:v1,action:'revision',message:'Show the label clearly.',seconds:2},reviewer)).status,200);
 result=await call('delivery/versions',{...packageBody(),base_version_id:v1,caption:'A closer look at the daily care label.'},creator);assert.equal(result.status,201);v2=result.data.id;
 assert.equal((await call('delivery/review',{version_id:v1,action:'approve'},owner)).status,409);
 assert.equal((await call('delivery/review',{version_id:v2,action:'approve'},reviewer)).status,200);
 assert.equal((await call('delivery/review',{version_id:v2,action:'comment',message:'Agency private note on v2',visibility:'internal'},reviewer)).status,200);
 let b=(await call('delivery/deliverable/d1',null,brand)).data;assert.equal(b.versions.length,1);assert.equal(b.versions[0].id,v2);assert.ok(!JSON.stringify(b).includes('Agency private'));assert.equal((await call('media/'+videoId,null,brand)).status,200);
 assert.equal((await call('delivery/review',{version_id:v2,action:'approve'},creator)).status,403);
 assert.equal((await call('delivery/review',{version_id:v2,action:'approve'},brand)).status,200);
 assert.equal((await call('delivery/review',{version_id:v2,action:'approve'},brand)).data.already_recorded,true);
 b=(await call('delivery/deliverable/d1',null,creator)).data;assert.equal(b.deliverable.status,'Brand approved');assert.equal(b.handoff.ready,false);
 assert.equal((await call('delivery/rights',{campaign_id:'cam_1',channels:'Instagram organic',territory:'India',start:new Date().toISOString().slice(0,10),end:'2099-12-31',agreement:'Agreement 01',paid_usage:false},owner)).status,200);assert.equal((await call('delivery/deliverable/d1',null,creator)).data.handoff.ready,true);
});
test('caption/account/cover/brief changes cannot reuse approval; old versions stay immutable',async()=>{
 let result=await call('delivery/versions',{...packageBody(),base_version_id:v2,caption:'Changed approved caption',account:'@newaccount'},creator);assert.equal(result.status,201);v3=result.data.id;let data=(await call('delivery/deliverable/d1',null,creator)).data;assert.equal(data.deliverable.status,'Agency review');assert.equal(data.versions[0].approvals.length,0);assert.equal(data.handoff.ready,false);assert.equal(data.versions.find(v=>v.id===v2).approvals.length,2);assert.equal(data.versions.find(v=>v.id===v2).package.caption,'A closer look at the daily care label.');assert.equal((await call('delivery/review',{version_id:v3,action:'approve'},brand)).status,403);
 const campaign=(await call('delivery/campaign/cam_1',null,owner)).data;assert.equal((await call('delivery/campaign',{...brief,base_brief_id:campaign.brief.id,requirements:'A newly required product demonstration.'},owner)).status,201);assert.equal((await call('delivery/review',{version_id:v3,action:'approve'},reviewer)).status,409);assert.equal((await call('delivery/deliverable/d1',null,creator)).data.deliverable.status,'Brief changed');assert.equal((await call('delivery/versions',{...packageBody(),base_version_id:v2},creator)).status,409);
});
test('reject invalid media signatures, cross-assignment assets and impossible posting windows',async()=>{
 const init=await call('uploads',{deliverable_id:'d1',name:'bad.mp4',mime:'video/mp4',size:16,kind:'video'},creator);await call(`uploads/${init.data.id}/chunks/0`,null,creator,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:Buffer.alloc(16)});assert.equal((await call(`uploads/${init.data.id}/complete`,{},creator)).status,400);
 assert.equal((await call('delivery/versions',{...packageBody(),base_version_id:v3,window_end:'2020-01-01'},creator)).status,400);assert.equal((await call('delivery/versions',{...packageBody(),deliverable_id:'d2'},owner)).status,400);
});
test('new cover creates a distinct immutable package and rights scope is enforced at handoff',async()=>{
 const alternative=Buffer.concat([png,Buffer.from('alternative demo cover')]);const newCover=await upload(alternative,'cover');const result=await call('delivery/versions',{...packageBody(),base_version_id:v3,cover_id:newCover},creator);assert.equal(result.status,201);const next=result.data.id;
 let data=(await call('delivery/deliverable/d1',null,creator)).data;assert.equal(data.versions[0].package.cover_id,newCover);assert.notEqual(data.versions[0].package.cover_sha256,data.versions.find(v=>v.id===v2).package.cover_sha256);assert.equal(data.versions[0].approvals.length,0);
 assert.equal((await call('delivery/review',{version_id:next,action:'approve'},reviewer)).status,200);assert.equal((await call('delivery/review',{version_id:next,action:'approve'},reviewer)).data.already_recorded,true);assert.equal((await call('delivery/review',{version_id:next,action:'approve'},brand)).status,200);
 await call('delivery/rights',{campaign_id:'cam_1',channels:'YouTube only',territory:'India',start:'2026-01-01',end:'2099-12-31',agreement:'Amended rights'},owner);data=(await call('delivery/deliverable/d1',null,brand)).data;assert.equal(data.handoff.ready,false);assert.ok(data.handoff.reasons.includes('Recorded rights do not include Instagram.'));
});
