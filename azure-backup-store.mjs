import {createReadStream,createWriteStream} from 'node:fs';
import {stat,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export function createAzureBackupStore({account,container},{request=fetch,credential,deadline=Date.now()+15*60*1000}={}){
 if(!/^[a-z0-9]{3,24}$/.test(account||'')||!/^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/.test(container||'')||container.includes('--'))throw Error('Invalid private backup storage configuration.');
 const origin=`https://${account}.blob.core.windows.net/${container}`;let cached;
 const timeout=()=>{const remaining=deadline-Date.now();if(remaining<=0)throw Error('Backup time limit reached.');return AbortSignal.timeout(Math.min(remaining,120000));};
 async function bytes(response,max){if(!response.ok)throw Error(`Backup storage returned HTTP ${response.status}.`);let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>max)throw Error('Backup response exceeds its limit.');chunks.push(chunk);}return Buffer.concat(chunks);}
 async function token(){
  if(credential)return credential();if(cached?.expires>Date.now()+60000)return cached.value;
  const response=await request('http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fstorage.azure.com%2F',{headers:{Metadata:'true'},signal:AbortSignal.timeout(5000),redirect:'error'});
  const body=JSON.parse((await bytes(response,20000)).toString());if(typeof body.access_token!=='string'||!body.access_token||!Number.isFinite(Number(body.expires_on)))throw Error('Backup managed identity is unavailable.');
  cached={value:body.access_token,expires:Number(body.expires_on)*1000};return cached.value;
 }
 async function send(name,options={}){
  if(!/^daily\/[a-zA-Z0-9_-]+\/(?:voqro\.sqlite|manifest\.json|complete\.json|uploads\/[a-zA-Z0-9_-]{1,100})$/.test(name))throw Error('Invalid backup object name.');
  try{return await request(origin+'/'+name,{...options,redirect:'error',signal:timeout(),headers:{'x-ms-version':'2023-11-03','x-ms-date':new Date().toUTCString(),Authorization:'Bearer '+await token(),...options.headers}});}catch{throw Error('Backup storage request did not complete. No write was automatically retried.');}
 }
 return {
  async put(name,file,size,sha256){
   if((await stat(file)).size!==size)throw Error('Backup file changed before upload.');
   const stream=createReadStream(file);try{const response=await send(name,{method:'PUT',body:stream,duplex:'half',headers:{'Content-Type':'application/octet-stream','Content-Length':String(size),'x-ms-blob-type':'BlockBlob','x-ms-meta-sha256':sha256,'If-None-Match':'*'}});if(response.status!==201)throw Error(`Backup upload returned HTTP ${response.status}; existing objects are never overwritten.`);await response.body?.cancel();}finally{stream.destroy();}
  },
  async json(name,max=1024*1024){return JSON.parse((await bytes(await send(name),max)).toString());},
  async download(name,file,size,sha256){
   const response=await send(name);if(!response.ok)throw Error(`Backup download returned HTTP ${response.status}.`);
   if(response.headers.has('content-length')&&Number(response.headers.get('content-length'))!==size){await response.body?.cancel();throw Error('Backup download size mismatch.');}
   let count=0,created=false;const hash=createHash('sha256');const output=createWriteStream(file,{flags:'wx',mode:0o600});output.on('open',()=>{created=true;});
   try{await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,_encoding,callback){count+=chunk.length;if(count>size)return callback(Error('Backup download exceeds its expected size.'));hash.update(chunk);callback(null,chunk);}}),output);if(count!==size||hash.digest('hex')!==sha256)throw Error('Backup download checksum mismatch.');}
   catch(error){if(created)await unlink(file).catch(()=>{});throw error;}
  }
 };
}
