import {organizationHeaders} from '@/lib/api';
import {api, ApiError} from '../../lib/api';

export interface UploadSession {id:string;chunkSize:number;nextChunk:number;complete:boolean}
export type UploadSessions = WeakMap<File, UploadSession>;
const allowed = {video:['video/mp4','video/webm'],cover:['image/png','image/jpeg','image/webp']};

/** Keeps the upload ID and next acknowledged chunk while the form remains open.
 * Retrying after a dropped response sends the same chunk; the API checks its hash.
 * Private filenames, file bytes and session IDs are never placed in browser storage.
 */
export async function uploadPrivateFile(file:File, kind:'video'|'cover', deliverableId:string, sessions:UploadSessions, progress:(message:string)=>void):Promise<string> {
  const limit=(kind==='video'?200:10)*1024*1024;
  if(!allowed[kind].includes(file.type))throw new Error(kind==='video'?'Choose an MP4 or WebM video.':'Choose a PNG, JPEG or WebP cover.');
  if(!file.size||file.size>limit)throw new Error(`${kind==='video'?'Video':'Cover'} must be between 1 byte and ${kind==='video'?200:10} MB.`);
  let session=sessions.get(file);
  if(!session){
    const start=await api<{id:string;chunk_size:number}>('uploads',{deliverable_id:deliverableId,name:file.name,mime:file.type,size:file.size,kind});
    session={id:start.id,chunkSize:start.chunk_size,nextChunk:0,complete:false};
    sessions.set(file,session);
  }
  if(session.complete)return session.id;
  const count=Math.ceil(file.size/session.chunkSize);
  for(let index=session.nextChunk;index<count;index++){
    const bytes=file.slice(index*session.chunkSize,Math.min(file.size,(index+1)*session.chunkSize));
    for(let attempt=0;attempt<3;attempt++){
      try{
        const response=await fetch(`/api/uploads/${encodeURIComponent(session.id)}/chunks/${index}`,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream',...organizationHeaders()},body:bytes,signal:AbortSignal.timeout(30000)});
        if(!response.ok){
          const result=await response.json().catch(()=>({error:'The upload service did not respond correctly.'}));
          throw new ApiError(result.error||'Chunk upload failed.',response.status);
        }
        break;
      }catch(error){
        const retryable=!(error instanceof ApiError)||error.status>=500||error.status===429||(error.status===409&&/already being processed/.test(error.message));
        if(!retryable||attempt===2)throw error;
        progress(`Connection interrupted. Retrying ${kind} chunk ${index+1}…`);
        await new Promise(resolve=>setTimeout(resolve,400*(attempt+1)));
      }
    }
    session.nextChunk=index+1;
    progress(`Uploading ${kind}: ${Math.round(Math.min(file.size,session.nextChunk*session.chunkSize)/file.size*100)}%`);
  }
  progress(`Checking ${kind} integrity…`);
  const completed=await api<{id:string}>(`uploads/${encodeURIComponent(session.id)}/complete`,{});
  session.complete=true;
  return completed.id;
}
