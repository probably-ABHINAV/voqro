'use client';

import {useRef,useState} from 'react';
import {api} from '../../lib/api';
import type {Brief,ContentVersion,Studio} from './types';
import {Area,Field,SaveForm,localTime} from './shared';
import {uploadPrivateFile,type UploadSessions} from './upload';

export function PackageForm({deliverable,previous,brief,onSaved,onCancel}:{deliverable:Studio['deliverable'];previous?:ContentVersion;brief:Brief;onSaved:()=>Promise<void>;onCancel:()=>void}){
 const [video,setVideo]=useState<File>(),[cover,setCover]=useState<File>(),[progress,setProgress]=useState('');
 const sessions=useRef<UploadSessions>(new WeakMap());
 const p=previous?.package;
 const start=p?.window_start||new Date(Date.now()+86400000).toISOString(),end=p?.window_end||new Date(Date.now()+172800000).toISOString();
 async function submit(values:Record<string,FormDataEntryValue>){
  const videoId=video?await uploadPrivateFile(video,'video',deliverable.id,sessions.current,setProgress):p?.video_id;
  const coverId=cover?await uploadPrivateFile(cover,'cover',deliverable.id,sessions.current,setProgress):p?.cover_id;
  if(!videoId||!coverId)throw new Error('A completed video and cover are both required.');
  setProgress('Saving the exact post package…');
  await api('delivery/versions',{deliverable_id:deliverable.id,base_version_id:previous?.id||null,video_id:videoId,cover_id:coverId,caption:String(values.caption),hashtags:String(values.hashtags),mentions:String(values.mentions),disclosure:String(values.disclosure),account:String(values.account),window_start:new Date(String(values.window_start)).toISOString(),window_end:new Date(String(values.window_end)).toISOString()});
  await onSaved();
 }
 return <SaveForm title={previous?'Submit a new content version':'Upload the first draft'} label="Submit for agency review" onCancel={onCancel} onSave={submit}><p className="text-sm muted">Video, cover, caption, disclosure, publishing account and posting window are approved together. Every submission starts a fresh agency review.</p><div className="form-grid"><label className="field"><span>Video · MP4 or WebM</span><input className="input" name="video" type="file" accept="video/mp4,video/webm" required={!p} onChange={e=>setVideo(e.target.files?.[0])}/><small className="muted">Up to 200 MB. {p?'Leave empty to reuse the previous video.':'Uploaded privately in 1 MB chunks.'}</small></label><label className="field"><span>Cover · PNG, JPEG or WebP</span><input className="input" name="cover" type="file" accept="image/png,image/jpeg,image/webp" required={!p} onChange={e=>setCover(e.target.files?.[0])}/><small className="muted">Up to 10 MB. {p?'Leave empty to reuse the previous cover.':'A specific cover belongs to each approval.'}</small></label></div><Area label="Caption" name="caption" value={p?.caption} maxLength={2200}/><div className="form-grid"><Field label="Hashtags" name="hashtags" value={p?.hashtags} maxLength={1000} required={false}/><Field label="Mentions" name="mentions" value={p?.mentions} maxLength={1000} required={false}/><Field label="Disclosure" name="disclosure" value={p?.disclosure||brief.payload.disclosure} maxLength={500}/><Field label="Publishing account" name="account" value={p?.account||(deliverable.publishing_account.startsWith('@')?deliverable.publishing_account:'')} maxLength={31}/><Field label="Posting window starts (your local time)" name="window_start" type="datetime-local" value={localTime(start)}/><Field label="Posting window ends (your local time)" name="window_end" type="datetime-local" value={localTime(end)}/></div>{progress&&<p role="status" aria-live="polite" className="rounded-xl bg-[#eaf0e3] p-4 text-sm">{progress}</p>}<p className="text-xs muted">If the connection drops, keep this form open and retry to resume acknowledged chunks. Closing the form requires selecting and uploading the files again. File signatures and checksums are verified before submission.</p></SaveForm>;
}
