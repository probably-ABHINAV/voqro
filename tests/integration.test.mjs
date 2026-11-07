import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {once} from 'node:events';
process.env.NODE_ENV='test';process.env.DB_PATH=':memory:';process.env.DEMO_MODE='1';
const {server}=await import('../server.mjs');let base;const cookies={};
before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;for(const role of ['owner','manager','reviewer','finance','brand','other','creator']){const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:'u_'+role})});cookies[role]=response.headers.get('set-cookie').split(';')[0];}});
after(()=>new Promise(r=>server.close(r)));
async function request(path,role){const response=await fetch(base+path,{headers:{Cookie:cookies[role]||''}});return {status:response.status,data:await response.json()};}

test('integrated modules retain role boundaries and static modules are reachable',async()=>{
 const access={owner:{optimization:200,workflow:200,reporting:200,cloud:200,instagram:200,catalog:200,'identity/members':200},manager:{optimization:200,workflow:200,reporting:200,cloud:200,instagram:200,catalog:200,'identity/members':403},brand:{optimization:403,workflow:200,reporting:200,cloud:200,instagram:200,catalog:403,'identity/members':403},creator:{optimization:403,workflow:200,reporting:200,cloud:200,instagram:200,catalog:403,'identity/members':403},finance:{optimization:403,workflow:200,reporting:200,cloud:403,instagram:403,catalog:403,'identity/members':403}};
 for(const [role,endpoints] of Object.entries(access))for(const [endpoint,status] of Object.entries(endpoints))assert.equal((await request('/api/'+endpoint,role)).status,status,`${role} ${endpoint}`);
 for(const module of ['identity','optimization','workflow','reporting','cloud','instagram','catalog','notifications']){const response=await fetch(base+'/'+module+'.js');assert.equal(response.status,200,module);assert.match(response.headers.get('content-type'),/javascript/);}
 assert.equal((await request('/api/notifications/email')).status,401);const email=(await request('/api/notifications/email','owner')).data;assert.equal(email.can_enqueue,false);assert.equal(email.status.enabled,false);assert.deepEqual(email.deliveries,[]);assert.equal((await request('/api/workflow')).status,401);assert.equal((await request('/api/connections')).status,401);
});

test('connections distinguish configuration from verification without leaking private cloud allowances',async()=>{
 const owner=(await request('/api/connections','owner')).data;assert.equal(owner.identity.available,false);assert.equal(owner.instagram.connected_accounts,0);assert.equal(owner.cloud.monthly_limit_cents,500);assert.equal(owner.backups.configured,false);
 for(const role of ['brand','other','creator','reviewer','finance'])for(const path of ['/api/connections','/api/workspace']){const result=(await request(path,role)).data,c=path.endsWith('workspace')?result.connections:result;assert.equal('monthly_limit_cents' in c.cloud,false,role+' '+path);assert.equal('reservation_cents' in c.cloud,false);assert.equal(c.instagram.connected_accounts,0);assert.equal('backups' in c,false);}
 const identity=(await request('/api/identity/members','owner')).data;assert.equal(identity.can_manage,false);assert.deepEqual(identity.members,[]);assert.equal((await request('/api/identity/start')).status,503);
});

async function productionServer(directory,dbName='production.sqlite',overrides={}){
 const database=resolve(directory,dbName),code="const {server}=await import('./server.mjs');server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));";
 const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','--input-type=module','-e',code],{cwd:resolve(import.meta.dirname,'..'),env:{...process.env,NODE_ENV:'test',DEMO_MODE:'0',DB_PATH:database,UPLOAD_PATH:resolve(directory,'uploads'),APP_BASE_URL:'https://production.example',COGNITO_ISSUER:'',COGNITO_CLIENT_ID:'',COGNITO_DOMAIN:'',IDENTITY_BOOTSTRAP_EMAIL:'',AWS_REGION:'ap-south-1',AWS_MEDIA_ENABLED:'0',AWS_AI_ENABLED:'0',INSTAGRAM_PUBLISH_ENABLED:'0',...overrides},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;});
 const outcome=await Promise.race([new Promise(resolve=>child.stdout.on('data',()=>{try{const data=JSON.parse(stdout.trim());if(data.port)resolve({base:`http://127.0.0.1:${data.port}`});}catch{}})),once(child,'exit').then(([code])=>({exit:code})),new Promise(resolve=>{const timer=setTimeout(()=>resolve({timeout:true}),10000);timer.unref();})]);
 return {...outcome,child,database,stderr:()=>stderr};
}

test('clean production starts without demo records and HTTPS origin checks work behind the configured ingress',async t=>{
 const directory=mkdtempSync(resolve(tmpdir(),'voqro-production-test-')),app=await productionServer(directory);t.after(async()=>{if(app.child.exitCode===null){app.child.kill();await once(app.child,'exit');}rmSync(directory,{recursive:true,force:true});});assert.ok(app.base,app.stderr());
 const pub=await fetch(app.base+'/api/public').then(r=>r.json());assert.equal(pub.demo,false);assert.deepEqual(pub.creators,[]);assert.equal(pub.identity.available,false);
 const db=new DatabaseSync(app.database,{readOnly:true});try{for(const table of ['users','brands','creators','campaigns','identity_accounts'])assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,table);}finally{db.close();}
 assert.equal((await fetch(app.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:'u_owner'})})).status,403);
 const enquiry={name:'External enquiry',email:'person@example.com',company:'New real brand',budget:10000,brief:'A scoped campaign enquiry.'};
 const post=origin=>fetch(app.base+'/api/enquiries',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'X-Forwarded-Host':'attacker.example'},body:JSON.stringify(enquiry)});
 assert.equal((await post('https://attacker.example')).status,403);assert.equal((await post('https://production.example')).status,201);
 assert.equal((await fetch(app.base+'/api/workspace')).status,401);
});

test('production refuses a database containing shared demo identities and preserves its source records',async t=>{
 const directory=mkdtempSync(resolve(tmpdir(),'voqro-mixed-db-test-')),database=resolve(directory,'mixed.sqlite'),db=new DatabaseSync(database);db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,brand_id TEXT,creator_id TEXT);INSERT INTO users VALUES('u_owner','Demo owner','owner',NULL,NULL)");db.close();
 const app=await productionServer(directory,'mixed.sqlite');t.after(async()=>{if(app.child.exitCode===null){app.child.kill();await once(app.child,'exit');}rmSync(directory,{recursive:true,force:true});});assert.equal(app.exit,1);assert.match(app.stderr(),/Production startup refused/);const original=new DatabaseSync(database,{readOnly:true});try{assert.equal(original.prepare("SELECT name FROM users WHERE id='u_owner'").get().name,'Demo owner');}finally{original.close();}
});


test('demo mode refuses a bootstrapped production database before adding sample brands or users',async t=>{
 const directory=mkdtempSync(resolve(tmpdir(),'voqro-production-demo-')),database=resolve(directory,'owner-only.sqlite'),db=new DatabaseSync(database);db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,brand_id TEXT,creator_id TEXT);INSERT INTO users VALUES('member_owner','Real owner','owner',NULL,NULL);CREATE TABLE identity_accounts(user_id TEXT PRIMARY KEY);INSERT INTO identity_accounts VALUES('member_owner')");db.close();
 const app=await productionServer(directory,'owner-only.sqlite',{DEMO_MODE:'1'});t.after(async()=>{if(app.child.exitCode===null){app.child.kill();await once(app.child,'exit');}rmSync(directory,{recursive:true,force:true});});assert.equal(app.exit,1);assert.match(app.stderr(),/Demonstration startup refused/);const original=new DatabaseSync(database,{readOnly:true});try{assert.equal(original.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);assert.equal(original.prepare('SELECT COUNT(*) AS n FROM brands').get().n,0);}finally{original.close();}
});
