import {DatabaseSync} from 'node:sqlite';
import {createReadStream,readFileSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,writeFile,lstat,readdir,rename,rm,rmdir,statfs} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createBackup,verifyBackup,restoreBackup} from './scripts/backup.mjs';

export const MAX_BACKUP_BYTES=128*1024*1024;
export const MAX_BACKUP_FILES=100;
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const validPath=p=>/^(?:voqro\.sqlite|manifest\.json|uploads\/[a-zA-Z0-9_-]{1,100})$/.test(p);
async function fileHash(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');}
export function validateCompletion(record,prefix){
 assert(/^daily\/[a-zA-Z0-9_-]{1,100}$/.test(prefix),'Invalid backup prefix.');
 assert(record?.format===1&&record.prefix===prefix&&Array.isArray(record.files)&&record.files.length>=2&&record.files.length<=MAX_BACKUP_FILES,'Invalid backup completion record.');
 let total=0;const names=new Set();for(const file of record.files){assert(validPath(file.path)&&!names.has(file.path)&&Number.isSafeInteger(file.size)&&file.size>=0&&/^[a-f0-9]{64}$/.test(file.sha256),'Invalid backup file entry.');names.add(file.path);total+=file.size;}
 assert(names.has('voqro.sqlite')&&names.has('manifest.json')&&total<=MAX_BACKUP_BYTES,'Backup exceeds the recovery limit or is incomplete.');return record;
}
async function downloadSnapshot(store,record,destination){
 await mkdir(destination,{mode:0o700});await mkdir(join(destination,'uploads'),{mode:0o700});
 for(const file of record.files)await store.download(record.prefix+'/'+file.path,join(destination,file.path),file.size,file.sha256);
 return verifyBackup(destination);
}
export async function recoverOffsiteBackup({store,prefix,destination}){
 assert(/^daily\/[a-zA-Z0-9_-]{1,100}$/.test(prefix),'Invalid backup prefix.');
 const record=validateCompletion(await store.json(prefix+'/complete.json'),prefix);
 // mkdir is exclusive: a live database, prior restore or symlink is never overwritten.
 return downloadSnapshot(store,record,resolve(destination));
}
async function writeStatus(path,value){const temp=path+'.'+randomUUID();await writeFile(temp,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx'});await rename(temp,path);}
export async function runOffsiteBackup({store,database,uploads,stateDirectory,force=false,clock=()=>Date.now()}){
 const state=resolve(stateDirectory),statusPath=join(state,'status.json'),lock=join(state,'lock');
 await mkdir(state,{recursive:true,mode:0o700});let previous={};try{previous=JSON.parse(await readFile(statusPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Backup status cannot be read.');}
 if(!force&&previous.last_attempt&&clock()-Date.parse(previous.last_attempt)<20*3600000)return {skipped:true,reason:'A backup was already attempted within 20 hours.'};
 // A crashed job can leave its lock. Network work has a 15 minute deadline;
 // automatic stale-lock recovery waits two hours and moves it aside atomically.
 try{await mkdir(lock,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;const old=await lstat(lock);assert(old.isDirectory()&&clock()-old.mtimeMs>2*3600000,'Another backup is running.');await rename(lock,lock+'.stale.'+randomUUID());await mkdir(lock,{mode:0o700});}
 let staging;const attempt=new Date(clock()).toISOString();
 try{
  try{previous=JSON.parse(await readFile(statusPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Backup status cannot be read.');}
  if(!force&&previous.last_attempt&&clock()-Date.parse(previous.last_attempt)<20*3600000)return {skipped:true,reason:'A backup was already attempted within 20 hours.'};
  await writeStatus(statusPath,{...previous,state:'Running',last_attempt:attempt,error:null});
  const source=await lstat(database);assert(source.isFile(),'Backup source must be a regular database file.');
  const db=new DatabaseSync(database,{readOnly:true});let media,logicalBytes;try{logicalBytes=db.prepare('PRAGMA page_count').get().page_count*db.prepare('PRAGMA page_size').get().page_size;media=db.prepare("SELECT COUNT(*) count,COALESCE(SUM(size),0) bytes FROM uploads WHERE status='Complete'").get();}finally{db.close();}
  assert(Math.max(source.size,logicalBytes)+media.bytes<=MAX_BACKUP_BYTES&&media.count+2<=MAX_BACKUP_FILES,'Backup exceeds the 128 MiB or 100 file safety limit; increase capacity deliberately before retrying.');
  const disk=await statfs(state);assert(disk.bavail*disk.bsize>4*(Math.max(source.size,logicalBytes)+media.bytes)+64*1024*1024,'Not enough free space to verify a backup safely.');
  staging=await mkdtemp(join(state,'run-'));
  const snapshot=join(staging,'snapshot');await createBackup({database,uploads,destination:snapshot});
  const paths=['voqro.sqlite','manifest.json',...(await readdir(join(snapshot,'uploads'))).map(p=>'uploads/'+p)];
  const prefix='daily/'+attempt.replace(/[^0-9TZ]/g,'')+'_'+randomUUID().replaceAll('-','');const files=[];
  for(const path of paths){const stat=await lstat(join(snapshot,path));assert(stat.isFile(),'Unexpected backup file type.');files.push({path,size:stat.size,sha256:await fileHash(join(snapshot,path))});}
  const record=validateCompletion({format:1,prefix,created:attempt,files},prefix);
  for(const file of files)await store.put(prefix+'/'+file.path,join(snapshot,file.path),file.size,file.sha256);
  // Read back every object and restore a second copy before publishing completion.
  await downloadSnapshot(store,record,join(staging,'readback'));
  await restoreBackup(join(staging,'readback'),join(staging,'restored'));
  const complete=join(staging,'complete.json');await writeFile(complete,JSON.stringify(record),{mode:0o600,flag:'wx'});
  await store.put(prefix+'/complete.json',complete,(await lstat(complete)).size,await fileHash(complete));
  const echoed=validateCompletion(await store.json(prefix+'/complete.json'),prefix);
  assert(JSON.stringify(echoed)===JSON.stringify(record),'Backup completion readback mismatch.');
  const status={state:'Verified',last_attempt:attempt,last_success:new Date(clock()).toISOString(),restore_verified_at:new Date(clock()).toISOString(),remote_prefix:prefix,bytes:files.reduce((sum,f)=>sum+f.size,0),files:files.length,error:null};
  await writeStatus(statusPath,status);return status;
 }catch(e){await writeStatus(statusPath,{...previous,state:'Failed',last_attempt:attempt,error:e.code?'Backup filesystem operation failed ('+e.code+').':e.message});throw e;}
 finally{if(staging)await rm(staging,{recursive:true,force:true});await rmdir(lock);}
}
export function backupStatus(env=process.env,now=Date.now()){
 if(!env.AZURE_BACKUP_ACCOUNT||!env.AZURE_BACKUP_CONTAINER)return {configured:false,state:'Not configured'};
 let saved;try{const value=readFileSync(join(env.BACKUP_STATE_PATH||'/var/lib/voqro/offsite-backup-state','status.json'),'utf8');if(value.length>16000)throw Error();saved=JSON.parse(value);}catch{return {configured:true,state:'Awaiting verification',healthy:false};}
 const healthy=saved.state==='Verified'&&Number.isFinite(Date.parse(saved.last_success))&&now-Date.parse(saved.last_success)>=-300000&&now-Date.parse(saved.last_success)<36*3600000;
 return {configured:true,state:healthy?'Verified':saved.state==='Running'&&now-Date.parse(saved.last_attempt)<30*60000?'Running':'Needs attention',healthy,last_success:saved.last_success||null,last_attempt:saved.last_attempt||null,restore_verified_at:saved.restore_verified_at||null,bytes:saved.bytes||0,retention_days:7,max_backup_bytes:MAX_BACKUP_BYTES};
}
