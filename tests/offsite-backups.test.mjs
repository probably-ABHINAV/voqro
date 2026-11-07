import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {runOffsiteBackup,recoverOffsiteBackup,validateCompletion,backupStatus,MAX_BACKUP_BYTES} from '../offsite-backups.mjs';
import {createAzureBackupStore} from '../azure-backup-store.mjs';
const directory=await mkdtemp(join(tmpdir(),'voqro-offsite-'));const database=join(directory,'live.sqlite'),uploads=join(directory,'uploads');
process.env.NODE_ENV='test';process.env.DEMO_MODE='1';process.env.DB_PATH=database;process.env.UPLOAD_PATH=uploads;
const {server}=await import('../server.mjs');await new Promise(r=>server.listen(0,'127.0.0.1',r));
after(async()=>{await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});});
function memoryStore(){const objects=new Map();return {objects,async put(key,file){assert.equal(objects.has(key),false);objects.set(key,await readFile(file));},async json(key){if(!objects.has(key))throw Error('Incomplete backup.');return JSON.parse(objects.get(key));},async download(key,file){if(!objects.has(key))throw Error('Missing object.');await writeFile(file,objects.get(key),{flag:'wx',mode:0o600});}};}
async function fixture(){return {store:memoryStore(),database,uploads,stateDirectory:await mkdtemp(join(directory,'state-'))};}
test('daily backup verifies remote bytes, restores a separate copy, preserves source and enforces frequency',async()=>{
 const f=await fixture(),before=new DatabaseSync(database,{readOnly:true});const count=before.prepare('SELECT COUNT(*) n FROM users').get().n;before.close();
 const result=await runOffsiteBackup(f);assert.equal(result.state,'Verified');assert.ok(result.restore_verified_at);assert.ok(f.store.objects.has(result.remote_prefix+'/complete.json'));
 const recovered=await recoverOffsiteBackup({store:f.store,prefix:result.remote_prefix,destination:join(f.stateDirectory,'manual-restore')});const db=new DatabaseSync(recovered.database,{readOnly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,count);assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);db.close();
 await assert.rejects(recoverOffsiteBackup({store:f.store,prefix:result.remote_prefix,destination:join(f.stateDirectory,'manual-restore')}),/EEXIST/);
 const total=f.store.objects.size;assert.equal((await runOffsiteBackup(f)).skipped,true);assert.equal(f.store.objects.size,total);
 assert.equal((await readdir(f.stateDirectory)).some(name=>name==='lock'||name.startsWith('run-')),false);
 const env={AZURE_BACKUP_ACCOUNT:'example',AZURE_BACKUP_CONTAINER:'backups',BACKUP_STATE_PATH:f.stateDirectory};assert.equal(backupStatus(env).healthy,true);assert.equal(backupStatus(env,Date.now()+40*3600000).state,'Needs attention');
});
test('failed uploads never publish completion and retain last successful recovery metadata',async()=>{
 const f=await fixture();const good=await runOffsiteBackup(f);const original=f.store.put;
 f.store.put=async()=>{throw Error('Storage unavailable.');};await assert.rejects(runOffsiteBackup({...f,force:true}),/Storage unavailable/);
 const status=JSON.parse(await readFile(join(f.stateDirectory,'status.json')));assert.equal(status.state,'Failed');assert.equal(status.last_success,good.last_success);assert.equal(status.remote_prefix,good.remote_prefix);
 assert.equal([...f.store.objects.keys()].filter(k=>k.endsWith('complete.json')).length,1);f.store.put=original;
});
test('corrupt readback prevents success and incomplete remote snapshots cannot be restored',async()=>{
 const f=await fixture();f.store.download=async(key,file)=>writeFile(file,key.endsWith('voqro.sqlite')?'corrupt':f.store.objects.get(key),{flag:'wx'});
 await assert.rejects(runOffsiteBackup(f),/checksum/);assert.equal([...f.store.objects.keys()].some(k=>k.endsWith('complete.json')),false);
 await assert.rejects(recoverOffsiteBackup({store:f.store,prefix:'daily/missing',destination:join(f.stateDirectory,'missing')}),/Incomplete/);
});
test('manifest validation rejects path traversal, duplicate files and unbounded restores',()=>{
 const file={path:'voqro.sqlite',size:1,sha256:'a'.repeat(64)},record={format:1,prefix:'daily/run',files:[file,{...file,path:'manifest.json'}]};validateCompletion(record,'daily/run');
 for(const files of [[file,{...file,path:'../escape'}],[file,file],[{...file,size:MAX_BACKUP_BYTES},record.files[1]]])assert.throws(()=>validateCompletion({...record,files},'daily/run'));
 assert.throws(()=>validateCompletion(record,'../run'));assert.equal(backupStatus({}).configured,false);
});
test('Azure backup transport uses managed credentials, conditional writes and checks downloaded bytes',async()=>{
 const folder=await mkdtemp(join(directory,'transport-')),file=join(folder,'input');await writeFile(file,'abc');const calls=[];
 const {createHash}=await import('node:crypto');const hash=createHash('sha256').update('abc').digest('hex');
 const request=async(url,opts)=>{calls.push({url,opts});if(opts.method==='PUT'){for await(const _ of opts.body){}return new Response(null,{status:201});}return new Response('abc',{status:200,headers:{'content-length':'3'}});};
 const store=createAzureBackupStore({account:'testaccount',container:'backups'},{request,credential:async()=>'test-only-credential'});
 await store.put('daily/run/voqro.sqlite',file,3,hash);assert.equal(calls[0].opts.headers['If-None-Match'],'*');assert.equal(calls[0].opts.redirect,'error');assert.equal(calls[0].opts.headers.Authorization,'Bearer test-only-credential');
 const target=join(folder,'download');await store.download('daily/run/voqro.sqlite',target,3,hash);assert.equal(await readFile(target,'utf8'),'abc');
 await assert.rejects(store.download('daily/run/voqro.sqlite',target,3,hash),/EEXIST/);assert.equal(await readFile(target,'utf8'),'abc');
 await assert.rejects(store.download('daily/run/voqro.sqlite',join(folder,'corrupt'),3,'b'.repeat(64)),/checksum/);
 await assert.rejects(store.json('../outside'),/Invalid backup object/);
 let writes=0;const failing=createAzureBackupStore({account:'testaccount',container:'backups'},{credential:async()=>'test-only',request:async()=>{writes++;return new Response(null,{status:412});}});await assert.rejects(failing.put('daily/run/voqro.sqlite',file,3,hash),/never overwritten/);assert.equal(writes,1);
 assert.throws(()=>createAzureBackupStore({account:'evil.example/path',container:'backups'}),/Invalid/);
});


test('oversized source is refused before any remote write',async()=>{
 const f=await fixture(),small=join(f.stateDirectory,'oversized.sqlite'),db=new DatabaseSync(small);db.exec("CREATE TABLE uploads(status TEXT,size INTEGER); INSERT INTO uploads VALUES('Complete',134217729)");db.close();
 await assert.rejects(runOffsiteBackup({...f,database:small}),/128 MiB/);assert.equal(f.store.objects.size,0);
 assert.equal(JSON.parse(await readFile(join(f.stateDirectory,'status.json'))).state,'Failed');
});
test('an active lock blocks overlapping backup work',async()=>{
 const f=await fixture();await mkdir(join(f.stateDirectory,'lock'));
 await assert.rejects(runOffsiteBackup(f),/Another backup/);assert.equal(f.store.objects.size,0);
});
