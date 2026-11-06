import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createReadStream} from 'node:fs';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const execute=promisify(execFile);
const probe=async file=>{
 const {stdout}=await execute('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',file],{timeout:15000,maxBuffer:1024*1024});
 return JSON.parse(stdout);
};
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}

export function createOperations({db,row,rows,run,id,now,transaction,requireThat,textField,send,body,activity,delivery}){
 const c=delivery.context;
 const tableExists=name=>Boolean(row("SELECT name FROM sqlite_master WHERE type='table' AND name=?",name));
 db.exec(`
 CREATE TABLE IF NOT EXISTS processing_jobs(id TEXT PRIMARY KEY,version_id TEXT UNIQUE REFERENCES content_versions(id),state TEXT,attempts INTEGER,next_at INTEGER,lease_until INTEGER,lease_token TEXT,result TEXT,error TEXT,created TEXT,updated TEXT);
 CREATE TABLE IF NOT EXISTS handoff_schedule(id TEXT PRIMARY KEY,deliverable_id TEXT UNIQUE REFERENCES deliverables(id),version_id TEXT REFERENCES content_versions(id),due_at TEXT,state TEXT,reason TEXT,owner_id TEXT REFERENCES users(id),created TEXT,updated TEXT);
 CREATE TABLE IF NOT EXISTS live_posts(id TEXT PRIMARY KEY,deliverable_id TEXT UNIQUE REFERENCES deliverables(id),version_id TEXT REFERENCES content_versions(id),permalink TEXT UNIQUE,reported_by TEXT REFERENCES users(id),reported_at TEXT,published_at TEXT,source TEXT);
 CREATE TABLE IF NOT EXISTS metric_snapshots(id TEXT PRIMARY KEY,post_id TEXT REFERENCES live_posts(id),captured_at TEXT,payload TEXT,source TEXT,entered_by TEXT REFERENCES users(id),created TEXT);
 CREATE TABLE IF NOT EXISTS trend_evidence(id TEXT PRIMARY KEY,campaign_id TEXT REFERENCES campaigns(id),source_url TEXT,observed_on TEXT,region TEXT,language TEXT,niche TEXT,format TEXT,observation TEXT,rationale TEXT,limitations TEXT,author TEXT,created TEXT);
 CREATE INDEX IF NOT EXISTS job_queue ON processing_jobs(state,next_at);
 `);
 function enqueue(versionId){requireThat(row('SELECT id FROM content_versions WHERE id=?',versionId),404,'Content version not found.');run('INSERT OR IGNORE INTO processing_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)',id('job'),versionId,'Queued',0,Date.now(),null,null,null,null,now(),now());return row('SELECT * FROM processing_jobs WHERE version_id=?',versionId);}
 delivery.onVersion=enqueue;
 for(const v of rows('SELECT id FROM content_versions'))enqueue(v.id);
 function version(u,vid){const v=row('SELECT * FROM content_versions WHERE id=?',vid);c.visibleVersion(u,v);return v;}
 function canSee(u,vid){try{version(u,vid);return true;}catch{return false;}}
 function inspectReady(d,vid,at){const reasons=[...c.handoff(d).reasons];if(c.latestVersion(d.id)?.id!==vid)reasons.push('The scheduled version is no longer the latest package.');const v=row('SELECT * FROM content_versions WHERE id=?',vid);if(v){const p=JSON.parse(v.package_json);if(at<p.window_start||at>p.window_end)reasons.push('The selected time is outside the approved posting window.');}
  const job=row('SELECT * FROM processing_jobs WHERE version_id=?',vid);if(job?.state!=='Completed')reasons.push('Technical checks have not completed successfully.');else if(JSON.parse(job.result).findings.some(f=>f.blocking))reasons.push('Technical checks contain a blocking finding.');return [...new Set(reasons)];}
 function scheduleTick(){for(const s of rows("SELECT * FROM handoff_schedule WHERE state IN ('Scheduled','Ready for manual handoff')")){
   const d=row('SELECT d.*,a.campaign_id FROM deliverables d JOIN assignments a ON a.id=d.assignment_id WHERE d.id=?',s.deliverable_id);
   const reasons=inspectReady(d,s.version_id,new Date(Math.max(Date.now(),Date.parse(s.due_at))).toISOString());
   const state=reasons.length?'Blocked':Date.parse(s.due_at)<=Date.now()?'Ready for manual handoff':'Scheduled';
   if(state!==s.state||reasons.join(' ')!==s.reason)run('UPDATE handoff_schedule SET state=?,reason=?,updated=? WHERE id=?',state,reasons.join(' '),now(),s.id);
  }}
 async function analyse(job){const v=row('SELECT * FROM content_versions WHERE id=?',job.version_id),p=JSON.parse(v.package_json);const brief=row('SELECT * FROM brief_versions WHERE id=?',p.brief_version_id);const required=brief?JSON.parse(brief.payload):{};const findings=[];
  const add=(layer,field,observation,correction,severity,blocking=false)=>findings.push({layer,field,timestamp:null,observation,correction,severity,confidence:'Deterministic check',blocking});
  for(const kind of ['video','cover']){const asset=row('SELECT * FROM uploads WHERE id=?',p[kind+'_id']);if(!asset||await digest(resolve(c.store,asset.id))!==p[kind+'_sha256'])throw new Error('INTEGRITY');}
  let media,cover;try{media=await probe(resolve(c.store,p.video_id));cover=await probe(resolve(c.store,p.cover_id));}catch(e){const err=new Error(e.code==='ENOENT'?'TOOL_MISSING':'MEDIA_UNREADABLE');throw err;}
  const stream=media.streams.find(s=>s.codec_type==='video'),image=cover.streams.find(s=>s.codec_type==='video'),duration=Number(media.format.duration||stream?.duration);
  if(!stream||!image||!Number.isFinite(duration)||duration<=0)add('Required checks','video','Video duration or visual stream could not be validated.','Upload a playable video and cover.','error',true);
  if(stream&&(stream.width>4096||stream.height>4096))add('Human review flags','resolution','Video exceeds the local review guideline of 4096 pixels.','Check current platform specifications and processing costs.','warning');
  if(stream&&stream.width>=stream.height)add('Creative recommendations','aspect ratio',`Video is ${stream.width} × ${stream.height}.`,'Consider a vertical composition for a Reel; check the intended placement.','info');
  if(!media.streams.some(s=>s.codec_type==='audio'))add('Human review flags','audio','No audio stream was detected.','Confirm whether silent content is intentional.','warning');
  if(required.disclosure&&!p.disclosure.toLowerCase().includes(required.disclosure.toLowerCase()))add('Required checks','disclosure','The package disclosure does not contain the brief’s required wording.','Use the required disclosure or agree a revised brief.','error',true);
  if(p.disclosure&&!p.caption.toLowerCase().includes(p.disclosure.toLowerCase()))add('Human review flags','caption','The disclosure is recorded separately from the caption.','Confirm the required disclosure placement in the final post.','warning');
  add('Human review flags','content','Product demonstrations, claims, speech, music rights and visual disclosures have not been analysed.','Watch the complete video and compare it with the brief before approving.','warning');
  return {engine:'Local technical checks v1',ai:false,coverage:'File hashes, container metadata, stream presence and explicit text comparison only. No transcription, frame sampling, semantic analysis or platform eligibility verification.',outcome:findings.some(f=>f.blocking)?'Changes required':'Human review required',media:{duration_seconds:duration||null,width:stream?.width||null,height:stream?.height||null,video_codec:stream?.codec_name||null,audio:media.streams.some(s=>s.codec_type==='audio')},findings,completed_at:now()};
 }
 async function tick(){
  const job=transaction(()=>{
   run("UPDATE processing_jobs SET state=CASE WHEN attempts>=3 THEN 'Failed' ELSE 'Queued' END,lease_token=NULL,lease_until=NULL,error='Worker interrupted; lease expired.',updated=? WHERE state='Running' AND lease_until<=?",now(),Date.now());
   const candidate=row("SELECT * FROM processing_jobs WHERE state='Queued' AND attempts<3 AND next_at<=? ORDER BY created,id LIMIT 1",Date.now());if(!candidate)return null;const token=randomUUID();run("UPDATE processing_jobs SET state='Running',attempts=attempts+1,lease_until=?,lease_token=?,updated=? WHERE id=?",Date.now()+90000,token,now(),candidate.id);return {...candidate,lease_token:token,attempts:candidate.attempts+1};
  });
  if(job){try{const result=await analyse(job);run("UPDATE processing_jobs SET state='Completed',result=?,error=NULL,lease_token=NULL,lease_until=NULL,updated=? WHERE id=? AND lease_token=?",JSON.stringify(result),now(),job.id,job.lease_token);}catch(e){const messages={INTEGRITY:'A media checksum did not match. Re-upload the affected file in a new version.',TOOL_MISSING:'ffprobe is not installed. Install the trusted FFmpeg package and retry.',MEDIA_UNREADABLE:'Media metadata could not be read within the processing limit. Check that the file is playable.'};const permanent=['INTEGRITY','MEDIA_UNREADABLE'].includes(e.message);run('UPDATE processing_jobs SET state=?,error=?,next_at=?,lease_until=NULL,lease_token=NULL,updated=? WHERE id=? AND lease_token=?',permanent||job.attempts>=3?'Failed':'Queued',messages[e.message]||'The processing worker could not read this media. Check storage availability and retry.',Date.now()+job.attempts*10000,now(),job.id,job.lease_token);}}
  scheduleTick();return job?.id||null;
 }
 let timer=null,working=false;
 function start(){if(timer)return;timer=setInterval(async()=>{if(working)return;working=true;try{await tick();}catch(e){console.error('Processing tick failed:',e.code||e.name);}finally{working=false;}},1000);timer.unref();}
 function stop(){clearInterval(timer);timer=null;}
 const iso=(s,label)=>{requireThat(typeof s==='string'&&!Number.isNaN(Date.parse(s)),400,`${label} must be a valid timestamp.`);return new Date(s).toISOString();};
 const url=(s,instagram=false)=>{let u;try{u=new URL(s);}catch{}requireThat(u?.protocol==='https:'&&!u.username&&!u.password&&(!instagram||(['instagram.com','www.instagram.com'].includes(u.hostname)&&/^\/(p|reel)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname))),400,instagram?'Enter a canonical HTTPS Instagram post or Reel URL.':'Enter an HTTPS source URL.');u.hash='';if(instagram){u.search='';u.hostname='www.instagram.com';u.pathname=u.pathname.replace(/\/$/,'')+'/';}return u.href;};
 async function handler(req,res,path,u){if(!path.startsWith('/api/operations'))return false;
  if(path==='/api/operations'&&req.method==='GET'){
   scheduleTick();const jobs=rows('SELECT * FROM processing_jobs ORDER BY created DESC').filter(j=>canSee(u,j.version_id)).map(({lease_token,lease_until,...j})=>({...j,version:row('SELECT version FROM content_versions WHERE id=?',j.version_id).version,title:row('SELECT d.title FROM deliverables d JOIN content_versions v ON v.deliverable_id=d.id WHERE v.id=?',j.version_id).title,result:j.result?JSON.parse(j.result):null}));
   const schedules=rows('SELECT * FROM handoff_schedule ORDER BY due_at').filter(s=>canSee(u,s.version_id));const posts=rows('SELECT * FROM live_posts ORDER BY reported_at DESC').filter(p=>canSee(u,p.version_id)).map(p=>{const verified=tableExists('instagram_jobs')?row("SELECT id,media_id,association,updated FROM instagram_jobs WHERE state='Verified' AND deliverable_id=? AND version_id=? AND permalink=? AND media_id IS NOT NULL",p.deliverable_id,p.version_id,p.permalink):null;return {...p,verification:verified?{verified:true,provider:'Meta Graph API',media_id:verified.media_id,association:verified.association,verified_at:verified.updated}:{verified:false,provider:null,association:'Team-reported'},metrics:rows('SELECT * FROM metric_snapshots WHERE post_id=? ORDER BY captured_at DESC',p.id).map(m=>({...m,payload:JSON.parse(m.payload),source_kind:verified&&tableExists('instagram_metric_syncs')&&row('SELECT id FROM instagram_metric_syncs WHERE job_id=? AND snapshot_id=?',verified.id,m.id)?'connected':'manual'}))};});
   const brands=c.reviewers(u)?rows('SELECT id FROM brands').map(b=>b.id):u.role==='brand'?[u.brand_id]:u.role==='creator'?rows('SELECT DISTINCT c.brand_id AS id FROM campaigns c JOIN assignments a ON a.campaign_id=c.id WHERE a.creator_id=?',u.creator_id).map(b=>b.id):[];const connected=tableExists('instagram_connections')?rows("SELECT brand_id FROM instagram_connections WHERE status='Connected' AND (expires_at IS NULL OR expires_at=0 OR expires_at>?)",Date.now()).filter(x=>brands.includes(x.brand_id)).length:0;
   send(res,200,{jobs,schedules,posts,trends:c.reviewers(u)?rows('SELECT * FROM trend_evidence ORDER BY observed_on DESC'):[],connections:{technical_checks:'Local ffprobe',ai:'Not connected',instagram:connected?connected+' authorised account'+(connected===1?'':'s'):'Not connected'},timing_guidance:'Posting guidance requires measured account history. Register posting-window experiments and compare their observations before changing the baseline.'});return true;
  }
  const packageMatch=path.match(/^\/api\/operations\/package\/([\w-]+)$/);
  if(packageMatch&&req.method==='GET'){const v=version(u,packageMatch[1]),d=c.deliverableAccess(u,v.deliverable_id),p=JSON.parse(v.package_json);send(res,200,{id:v.id,version:v.version,deliverable_id:d.id,title:d.title,account:p.account,window_start:p.window_start,window_end:p.window_end,reasons:inspectReady(d,v.id,new Date(Math.max(Date.now(),Date.parse(p.window_start))).toISOString())});return true;}
  if(req.method!=='POST'){requireThat(false,404,'Operation not found.');}
  const b=await body(req);
  if(path==='/api/operations/checks'){
   const v=version(u,b.version_id);requireThat(c.reviewers(u)||u.role==='creator',403,'Only the delivery team can request technical checks.');const job=enqueue(v.id);if(b.retry){requireThat(job.state==='Failed',409,'Only a failed job can be retried.');run("UPDATE processing_jobs SET state='Queued',attempts=0,next_at=?,error=NULL,updated=? WHERE id=?",Date.now(),now(),job.id);}send(res,200,{id:job.id});return true;
  }
  if(path==='/api/operations/schedule'){
   requireThat(c.editors(u),403,'Only the owner or account manager can schedule handoff.');const v=version(u,b.version_id),d=c.deliverableAccess(u,v.deliverable_id),due=iso(b.due_at,'Handoff time');requireThat(Date.parse(due)>=Date.now()-60000,400,'Choose a current or future handoff time.');requireThat(!row('SELECT id FROM live_posts WHERE deliverable_id=?',d.id),409,'A live post is already recorded for this deliverable.');const reasons=inspectReady(d,v.id,due);requireThat(!reasons.length,409,reasons.join(' '));const existing=row('SELECT * FROM handoff_schedule WHERE deliverable_id=?',d.id);run('INSERT INTO handoff_schedule VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(deliverable_id) DO UPDATE SET version_id=excluded.version_id,due_at=excluded.due_at,state=excluded.state,reason=excluded.reason,owner_id=excluded.owner_id,updated=excluded.updated',existing?.id||id('schedule'),d.id,v.id,due,'Scheduled','',u.id,existing?.created||now(),now());activity(d.brand_id,u.name,`Scheduled manual handoff for ${d.title}`);scheduleTick();send(res,200,{ok:true});return true;
  }
  if(path==='/api/operations/cancel'){
   requireThat(c.editors(u),403,'Account manager access required.');const s=row('SELECT * FROM handoff_schedule WHERE id=?',b.id);requireThat(s,404,'Schedule not found.');version(u,s.version_id);requireThat(s.state!=='Reported live',409,'A live report cannot be cancelled as a schedule.');run("UPDATE handoff_schedule SET state='Cancelled',reason='Cancelled by account manager',updated=? WHERE id=?",now(),s.id);send(res,200,{ok:true});return true;
  }
  if(path==='/api/operations/live'){
   requireThat(c.editors(u),403,'Only the owner or account manager can record publication.');const v=version(u,b.version_id),d=c.deliverableAccess(u,v.deliverable_id),permalink=url(b.permalink,true),published=iso(b.published_at,'Publication time');requireThat(Date.parse(published)<=Date.now()+60000,400,'Publication time cannot be in the future.');
   const result=transaction(()=>{const prev=row('SELECT * FROM live_posts WHERE deliverable_id=?',d.id);if(prev){requireThat(prev.version_id===v.id&&prev.permalink===permalink&&prev.published_at===published,409,'A different live report is already recorded.');return {id:prev.id,already_recorded:true};}const reasons=inspectReady(d,v.id,published);requireThat(!reasons.length,409,reasons.join(' '));requireThat(!row('SELECT id FROM live_posts WHERE permalink=?',permalink),409,'This post URL is already recorded.');const pid=id('post');run('INSERT INTO live_posts VALUES(?,?,?,?,?,?,?,?)',pid,d.id,v.id,permalink,u.id,now(),published,'Team-reported; not verified by Instagram');run("UPDATE handoff_schedule SET state='Reported live',reason='',updated=? WHERE deliverable_id=?",now(),d.id);activity(d.brand_id,u.name,`Recorded a team-reported post for ${d.title}`);return {id:pid};});send(res,201,result);return true;
  }
  if(path==='/api/operations/metrics'){
   requireThat(c.editors(u),403,'Account manager access required.');const post=row('SELECT * FROM live_posts WHERE id=?',b.post_id);requireThat(post,404,'Post not found.');version(u,post.version_id);const captured=iso(b.captured_at,'Capture time');requireThat(captured>=post.published_at&&Date.parse(captured)<=Date.now()+60000,400,'Capture time must be after publication and not in the future.');const metrics={};for(const key of ['views','reach','likes','comments','saves','shares']){const value=b[key];requireThat(value===null||(Number.isSafeInteger(value)&&value>=0&&value<=1000000000000),400,'Metrics must be nonnegative whole numbers or left unknown.');metrics[key]=value;}requireThat(Object.values(metrics).some(v=>v!==null),400,'Enter at least one observed metric.');const source=textField(b.source,'Evidence description',1000);run('INSERT INTO metric_snapshots VALUES(?,?,?,?,?,?,?)',id('metrics'),post.id,captured,JSON.stringify(metrics),source,u.id,now());send(res,201,{ok:true});return true;
  }
  if(path==='/api/operations/trends'){
   requireThat(c.reviewers(u),403,'Trend evidence is internal to the agency.');c.campaignAccess(u,row('SELECT * FROM campaigns WHERE id=?',b.campaign_id));requireThat(/^\d{4}-\d{2}-\d{2}$/.test(b.observed_on)&&!isNaN(Date.parse(b.observed_on))&&new Date(b.observed_on).toISOString().slice(0,10)===b.observed_on&&b.observed_on<=now().slice(0,10),400,'Choose a valid observation date no later than today.');run('INSERT INTO trend_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id('trend'),b.campaign_id,url(b.source_url),b.observed_on,textField(b.region,'Region',120),textField(b.language,'Language',120),textField(b.niche,'Niche',120),textField(b.format,'Format',200),textField(b.observation,'Observation',2000),textField(b.rationale,'Relevance',2000),textField(b.limitations,'Limitations',2000),u.name,now());send(res,201,{ok:true});return true;
  }
  requireThat(false,404,'Operation not found.');
 }
 return {handler,tick,start,stop,enqueue,inspectReady};
}
