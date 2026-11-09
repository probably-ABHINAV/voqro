import {createHash} from 'node:crypto';
import {researchWebsite,publicWebsite} from './sales-research.mjs';
import {createAzureAIProvider,validateAzureAIConfig} from './azure-ai.mjs';
import {monthlyAIReserved} from './ai-budget.mjs';

const activeStates=['Queued','Researching','Generating'];
const safeError=message=>Object.assign(new Error(message),{status:400});
export function validateSalesResult(payload,evidence) {
  const text=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max;
  if(!payload||!text(payload.summary,800)||!text(payload.message,1600)||payload.message.trim().split(/\s+/).length>80||!Array.isArray(payload.findings)||payload.findings.length>3)throw safeError('The model returned an invalid sales draft.');
  const findings=payload.findings.map(f=>{
    if(!text(f?.observation,500)||!text(f?.opportunity,500)||!text(f?.evidence_quote,400)||!evidence.text.includes(f.evidence_quote))throw safeError('A finding was not grounded in the supplied source text.');
    return {observation:f.observation.trim(),opportunity:f.opportunity.trim(),evidence_quote:f.evidence_quote};
  });
  return {summary:payload.summary.trim(),message:payload.message.trim(),findings};
}
export function createSalesAssistant({db,row,rows,run,id,now,transaction,requireThat:need,textField,send,body,config:provided={},provider,research=researchWebsite}) {
  const config={enabled:process.env.AZURE_AI_ENABLED==='1'&&process.env.AZURE_AI_PRICING_VERIFIED==='1',azureEndpoint:process.env.AZURE_AI_ENDPOINT||'',azureDeployment:process.env.AZURE_AI_DEPLOYMENT||'',monthlyLimitCents:Number(process.env.AI_MONTHLY_LIMIT_CENTS||process.env.AWS_AI_MONTHLY_LIMIT_CENTS||500),reservationCents:Number(process.env.AI_JOB_RESERVATION_CENTS||process.env.AWS_AI_JOB_RESERVATION_CENTS||50),demo:process.env.DEMO_MODE==='1',...provided};
  need(Number.isInteger(config.monthlyLimitCents)&&config.monthlyLimitCents>=0&&config.monthlyLimitCents<=500&&Number.isInteger(config.reservationCents)&&config.reservationCents>0&&config.reservationCents<=500,500,'Invalid shared AI allowance configuration.');
  if(config.enabled)validateAzureAIConfig(config);
  db.exec(`CREATE TABLE IF NOT EXISTS sales_ai_settings(id INTEGER PRIMARY KEY CHECK(id=1),profile TEXT NOT NULL,limit_cents INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,updated_by TEXT,updated TEXT);
    CREATE TABLE IF NOT EXISTS sales_ai_prospects(id TEXT PRIMARY KEY,name TEXT NOT NULL,url TEXT NOT NULL UNIQUE,excerpt TEXT NOT NULL DEFAULT '',contact_state TEXT NOT NULL DEFAULT 'Not contacted',last_reply TEXT NOT NULL DEFAULT '',reply_revision INTEGER NOT NULL DEFAULT 0,lead_id TEXT REFERENCES leads(id),created_by TEXT NOT NULL,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sales_ai_jobs(id TEXT PRIMARY KEY,prospect_id TEXT REFERENCES sales_ai_prospects(id),kind TEXT NOT NULL,state TEXT NOT NULL,input_json TEXT NOT NULL,evidence TEXT,result TEXT,error TEXT,reserved_cents INTEGER NOT NULL,external_started INTEGER NOT NULL DEFAULT 0,request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,created_by TEXT NOT NULL,lease TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS sales_ai_jobs_queue ON sales_ai_jobs(state,created);
    CREATE INDEX IF NOT EXISTS sales_ai_jobs_prospect ON sales_ai_jobs(prospect_id,created);
    CREATE TABLE IF NOT EXISTS sales_ai_drafts(id TEXT PRIMARY KEY,job_id TEXT NOT NULL UNIQUE REFERENCES sales_ai_jobs(id),prospect_id TEXT NOT NULL REFERENCES sales_ai_prospects(id),kind TEXT NOT NULL,message TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,approved_revision INTEGER,approved_by TEXT,sent_at TEXT,channel TEXT,recipient TEXT,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sales_ai_events(id TEXT PRIMARY KEY,prospect_id TEXT,actor_id TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,created TEXT NOT NULL);`);
  run("INSERT OR IGNORE INTO sales_ai_settings(id,profile,limit_cents,updated) VALUES(1,?,0,?)",JSON.stringify({service:'Creator partnerships, regional campaigns and UGC production.',target:'',offer:'',proof:'',tone:'Clear, specific and respectful.'}),now());
  let ai=provider,working=false,timer=null;
  const month=()=>now().slice(0,7)+'-01T00:00:00.000Z';
  const settings=()=>{const s=row('SELECT * FROM sales_ai_settings WHERE id=1');return {...s,profile:JSON.parse(s.profile)};};
  const event=(p,u,action,detail)=>run('INSERT INTO sales_ai_events VALUES(?,?,?,?,?,?)',id('sales_event'),p,u,action,detail,now());
  const prospect=pid=>{const p=row('SELECT * FROM sales_ai_prospects WHERE id=?',pid);need(p,404,'Prospect not found.');return p;};
  const actorAllowed=uid=>!!row("SELECT u.id FROM users u JOIN identity_accounts a ON a.user_id=u.id WHERE u.id=? AND u.role IN ('owner','manager') AND a.status='Active'",uid);
  const optional=(v,label,max)=>v===undefined||v===''?'':textField(v,label,max);
  function totals(){return {shared_reserved_cents:monthlyAIReserved(db,month()),sales_reserved_cents:row('SELECT COALESCE(SUM(reserved_cents),0) n FROM sales_ai_jobs WHERE created>=?',month()).n,monthly_limit_cents:config.monthlyLimitCents,reservation_cents:config.reservationCents};}
  function status(){return {configured:config.enabled&&!config.demo,provider:'Azure OpenAI',deployment:config.azureDeployment,...totals()};}
  function detail(pid){
    const p=prospect(pid);
    const jobs=rows('SELECT id,kind,state,evidence,result,error,reserved_cents,external_started,created,updated FROM sales_ai_jobs WHERE prospect_id=? ORDER BY created DESC,rowid DESC LIMIT 10',pid).map(j=>({...j,evidence:j.evidence?JSON.parse(j.evidence):null,result:j.result?JSON.parse(j.result):null}));
    const drafts=rows('SELECT * FROM sales_ai_drafts WHERE prospect_id=? ORDER BY created DESC,rowid DESC LIMIT 10',pid);
    return {prospect:p,jobs,drafts,events:rows('SELECT action,detail,created FROM sales_ai_events WHERE prospect_id=? ORDER BY rowid DESC LIMIT 20',pid)};
  }
  async function handler(req,res,path,u){
    if(!path.startsWith('/api/sales-ai'))return false;
    need(['owner','manager'].includes(u.role),403,'Only the agency owner and sales managers can use the client team.');
    if(req.method==='GET'&&path==='/api/sales-ai'){
      const limit=50,search=new URL(req.url,'https://local.invalid').searchParams.get('q')?.trim().slice(0,100)||'';
      const list=rows(`SELECT p.id,p.name,p.url,p.contact_state,p.lead_id,p.created,
        (SELECT state FROM sales_ai_jobs j WHERE j.prospect_id=p.id ORDER BY rowid DESC LIMIT 1) job_state,
        (SELECT MAX(sent_at) FROM sales_ai_drafts d WHERE d.prospect_id=p.id AND d.kind='outreach') sent_at
        FROM sales_ai_prospects p WHERE p.name LIKE ? OR p.url LIKE ? ORDER BY p.rowid DESC LIMIT ?`,'%'+search+'%','%'+search+'%',limit);
      for(const p of list)p.follow_up_dates=p.contact_state==='Contacted'&&p.sent_at?[3,7].map(days=>new Date(Date.parse(p.sent_at)+days*86400000).toISOString()):[];
      send(res,200,{settings:settings(),status:status(),prospects:list,limit});return true;
    }
    const match=path.match(/^\/api\/sales-ai\/prospects\/([\w-]+)$/);
    if(match&&req.method==='GET'){send(res,200,detail(match[1]));return true;}
    need(req.method==='POST',405,'Use POST for this action.');const b=await body(req);
    if(path==='/api/sales-ai/settings'){
      need(u.role==='owner',403,'Only the owner can approve the service profile and sales allowance.');
      const profile={service:textField(b.service,'Services',1500),target:optional(b.target,'Target customers',1000),offer:optional(b.offer,'Offer boundaries',1000),proof:optional(b.proof,'Approved proof',1500),tone:optional(b.tone,'Tone',500)};
      need(Number.isInteger(b.limit_cents)&&b.limit_cents>=0&&b.limit_cents<=config.monthlyLimitCents,400,'Sales allowance must fit the existing overall AI ceiling in US cents.');
      transaction(()=>{need(settings().revision===b.revision,409,'The service profile changed. Reload before saving.');need(b.limit_cents>=totals().sales_reserved_cents,409,'The allowance cannot be less than this month’s reservations.');run('UPDATE sales_ai_settings SET profile=?,limit_cents=?,revision=revision+1,updated_by=?,updated=? WHERE id=1',JSON.stringify(profile),b.limit_cents,u.id,now());event(null,u.id,'settings','Service profile and sales allowance updated.');});
      send(res,200,{ok:true});return true;
    }
    if(path==='/api/sales-ai/prospects'){
      const name=textField(b.name,'Business name',160),url=publicWebsite(textField(b.url,'Website',1000)),excerpt=optional(b.excerpt,'Public excerpt',10000);
      const existing=row('SELECT id FROM sales_ai_prospects WHERE url=?',url);if(existing){send(res,200,{id:existing.id,existing:true});return true;}
      const pid=id('prospect');transaction(()=>{run('INSERT INTO sales_ai_prospects(id,name,url,excerpt,created_by,created) VALUES(?,?,?,?,?,?)',pid,name,url,excerpt,u.id,now());event(pid,u.id,'created','Prospect added for research; no message sent.');});send(res,201,{id:pid});return true;
    }
    if(path==='/api/sales-ai/evidence'){
      const p=prospect(b.prospect_id);need(!row("SELECT id FROM sales_ai_jobs WHERE prospect_id=? AND state IN ('Queued','Researching','Generating')",p.id),409,'Wait for or cancel the active job before changing the excerpt.');
      run('UPDATE sales_ai_prospects SET excerpt=? WHERE id=?',optional(b.excerpt,'Public excerpt',10000),p.id);event(p.id,u.id,'evidence','Owner/manager supplied excerpt updated; requires human verification.');send(res,200,{ok:true});return true;
    }
    if(path==='/api/sales-ai/jobs'){
      need(config.enabled&&!config.demo,503,'Azure AI is not enabled for production sales drafts.');
      const p=prospect(b.prospect_id),kind=b.kind||'outreach';need(['outreach','reply'].includes(kind),400,'Choose outreach or reply.');need(p.contact_state!=='Do not contact',409,'This prospect has opted out.');need(kind!=='reply'||p.last_reply,400,'Record the actual reply first.');
      const key=textField(b.request_key,'Request key',100),fingerprint=createHash('sha256').update(JSON.stringify({prospect_id:p.id,kind,actor:u.id})).digest('hex');
      const j=transaction(()=>{
        const prior=row('SELECT * FROM sales_ai_jobs WHERE request_key=?',key);if(prior){need(prior.request_hash===fingerprint,409,'Request key belongs to another operation.');return prior;}
        need(!row("SELECT id FROM sales_ai_jobs WHERE prospect_id=? AND state IN ('Queued','Researching','Generating')",p.id),409,'This prospect already has an active job.');
        need(actorAllowed(u.id),403,'An active production sales membership is required.');
        const limits=totals(),s=settings(),c=config.reservationCents;
        need(c<=s.limit_cents-limits.sales_reserved_cents&&c<=config.monthlyLimitCents-limits.shared_reserved_cents,409,'The sales or shared AI allowance is exhausted. The owner can allocate sales usage within the existing ceiling.');
        need(row('SELECT COUNT(*) n FROM sales_ai_jobs WHERE created_by=? AND created>=?',u.id,new Date(Date.now()-86400000).toISOString()).n<20,429,'Daily client-team job limit reached.');
        const jid=id('sales_job');const input={name:p.name,url:p.url,excerpt:p.excerpt,kind,reply:kind==='reply'?p.last_reply:'',reply_revision:p.reply_revision,profile:s.profile,profile_revision:s.revision,prompt_version:1};
        run('INSERT INTO sales_ai_jobs(id,prospect_id,kind,state,input_json,reserved_cents,request_key,request_hash,created_by,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)',jid,p.id,kind,'Queued',JSON.stringify(input),c,key,fingerprint,u.id,now(),now());event(p.id,u.id,'queued','A draft job was queued; no outreach is sent.');return row('SELECT * FROM sales_ai_jobs WHERE id=?',jid);
      });send(res,202,{id:j.id,state:j.state});return true;
    }
    if(path==='/api/sales-ai/cancel'){
      const j=row('SELECT * FROM sales_ai_jobs WHERE id=?',b.job_id);need(j,404,'Job not found.');need(['Queued','Researching'].includes(j.state)&&!j.external_started,409,'Only work that has not reached the model can be cancelled.');
      run("UPDATE sales_ai_jobs SET state='Cancelled',lease=NULL,reserved_cents=0,updated=? WHERE id=?",now(),j.id);event(j.prospect_id,u.id,'cancelled','Queued research cancelled.');send(res,200,{ok:true});return true;
    }
    if(path==='/api/sales-ai/draft'){
      const d=row('SELECT * FROM sales_ai_drafts WHERE id=?',b.draft_id);need(d,404,'Draft not found.');const p=prospect(d.prospect_id);need(!d.sent_at,409,'A recorded sent message is immutable. Generate a new draft.');need(p.contact_state!=='Do not contact',409,'This prospect has opted out.');need(b.revision===d.revision,409,'This draft changed. Reload it before acting.');
      const j=row('SELECT input_json FROM sales_ai_jobs WHERE id=?',d.job_id),input=JSON.parse(j.input_json);
      need(input.reply_revision===p.reply_revision,409,'A new reply or contact decision arrived. Generate a fresh draft.');
      if(b.action==='save') {const message=textField(b.message,'Draft message',3000);run('UPDATE sales_ai_drafts SET message=?,revision=revision+1,approved_revision=NULL,approved_by=NULL WHERE id=?',message,d.id);event(p.id,u.id,'draft_edited','Draft edited; approval cleared.');}
      else if(b.action==='approve'){run('UPDATE sales_ai_drafts SET approved_revision=revision,approved_by=? WHERE id=?',u.id,d.id);event(p.id,u.id,'draft_approved','Draft '+d.id+' revision '+d.revision+' reviewed for manual sending.');}
      else if(b.action==='sent'){
        need(d.approved_revision===d.revision,409,'Review and approve this exact draft first.');need(['Email','Instagram DM','Other'].includes(b.channel),400,'Choose the channel used.');const recipient=textField(b.recipient,'Actual recipient',200);
        transaction(()=>{run('UPDATE sales_ai_drafts SET sent_at=?,channel=?,recipient=? WHERE id=?',now(),b.channel,recipient,d.id);run('UPDATE sales_ai_prospects SET contact_state=? WHERE id=?',d.kind==='reply'?'Replied':'Contacted',p.id);event(p.id,u.id,'manual_send','User reports sending draft '+d.id+' via '+b.channel+'. Delivery is not provider verified.');});
      }else need(false,400,'Choose save, approve or sent.');send(res,200,{ok:true});return true;
    }
    if(path==='/api/sales-ai/reply'){
      const p=prospect(b.prospect_id);need(p.contact_state!=='Do not contact',409,'This prospect is suppressed.');const reply=textField(b.reply,'Actual reply',3000);need(typeof b.opt_out==='boolean',400,'Specify whether the recipient opted out.');
      transaction(()=>{run('UPDATE sales_ai_prospects SET last_reply=?,reply_revision=reply_revision+1,contact_state=? WHERE id=?',reply,b.opt_out?'Do not contact':'Replied',p.id);event(p.id,u.id,b.opt_out?'opt_out':'reply','Actual reply recorded; introductory follow-up reminders stopped.');});send(res,200,{ok:true});return true;
    }
    if(path==='/api/sales-ai/promote'){
      const p=prospect(b.prospect_id);need(p.contact_state!=='Do not contact',409,'This prospect has opted out.');if(p.lead_id){send(res,200,{id:p.lead_id});return true;}
      const name=textField(b.name,'Contact name',120),email=textField(b.email,'Contact email',200),brief=textField(b.brief,'Qualified opportunity',5000);need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),400,'Enter the contact email you verified.');need(Number.isSafeInteger(b.budget)&&b.budget>0&&b.budget<=10000000000,400,'Enter a positive planning budget in paise.');
      const lid=id('lead');transaction(()=>{run('INSERT INTO leads VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',lid,null,name,email,p.name,brief,b.budget,'Qualified',u.name,null,'Reviewed AI prospect',now());run('UPDATE sales_ai_prospects SET lead_id=? WHERE id=?',lid,p.id);event(p.id,u.id,'promoted','Prospect added to the enquiry pipeline with user-supplied contact and planning budget.');});send(res,201,{id:lid});return true;
    }
    need(false,404,'Client-team action not found.');
  }
  async function tick(){
    if(working)return;working=true;
    try{
      run("UPDATE sales_ai_jobs SET state=CASE WHEN external_started=1 THEN 'Unknown' ELSE 'Failed' END,reserved_cents=CASE WHEN external_started=1 THEN reserved_cents ELSE 0 END,lease=NULL,error='Interrupted work; inspect before creating another job. No automatic model retry.',updated=? WHERE state IN ('Researching','Generating') AND updated<?",now(),new Date(Date.now()-300000).toISOString());
      const j=transaction(()=>{const next=row("SELECT * FROM sales_ai_jobs WHERE state='Queued' ORDER BY rowid LIMIT 1");if(!next)return null;const lease=id('lease');run("UPDATE sales_ai_jobs SET state='Researching',lease=?,updated=? WHERE id=? AND state='Queued'",lease,now(),next.id);return {...next,lease};});
      if(!j)return;
      const current=()=>row('SELECT * FROM sales_ai_jobs WHERE id=? AND lease=?',j.id,j.lease);
      const permitted=()=>{const p=prospect(j.prospect_id),input=JSON.parse(j.input_json);return actorAllowed(j.created_by)&&p.contact_state!=='Do not contact'&&p.reply_revision===input.reply_revision&&settings().revision===input.profile_revision;};
      try{
        need(config.enabled&&!config.demo&&j.created.slice(0,7)===now().slice(0,7)&&permitted(),409,'Job cancelled because configuration, permissions, profile or conversation changed.');
        const input=JSON.parse(j.input_json);
        const evidence=input.excerpt?{url:input.url,text:input.excerpt,source:'User-supplied public excerpt; not independently fetched',captured_at:now()}:await research(input.url);
        need(typeof evidence?.text==='string'&&evidence.text.length>=80&&evidence.text.length<=10000,400,'Provide at least 80 characters of readable public evidence.');
        publicWebsite(evidence.url);
        if(!current())return;
        need(permitted(),409,'Job cancelled because permissions, profile or conversation changed.');
        run("UPDATE sales_ai_jobs SET state='Generating',evidence=?,external_started=1,updated=? WHERE id=? AND lease=?",JSON.stringify(evidence),now(),j.id,j.lease);
        ai??=createAzureAIProvider(config);
        const answer=await ai.draftSales({name:input.name,kind:input.kind,reply:input.reply,profile:input.profile,evidence});
        const result=validateSalesResult(answer.payload,evidence);
        // Never persist arbitrary provider fields or raw diagnostics.
        const usage={};for(const key of ['prompt_tokens','completion_tokens','total_tokens'])if(Number.isSafeInteger(answer.usage?.[key])&&answer.usage[key]>=0)usage[key]=answer.usage[key];
        transaction(()=>{
          if(!current())return;
          need(permitted(),409,'Draft withheld because permissions, profile or conversation changed.');
          run("UPDATE sales_ai_jobs SET state='Completed',result=?,lease=NULL,updated=? WHERE id=? AND lease=?",JSON.stringify({...result,usage,model:config.azureDeployment,prompt_version:1,limitations:'Suggestions based only on supplied page text. No performance, revenue, audience or contact verification. Human review required.'}),now(),j.id,j.lease);
          run('INSERT INTO sales_ai_drafts(id,job_id,prospect_id,kind,message,created) VALUES(?,?,?,?,?,?)',id('sales_draft'),j.id,j.prospect_id,j.kind,result.message,now());
        });
      }catch(error){const c=current();if(c)run('UPDATE sales_ai_jobs SET state=?,reserved_cents=?,error=?,lease=NULL,updated=? WHERE id=? AND lease=?',c.external_started?'Unknown':'Failed',c.external_started?c.reserved_cents:0,c.external_started?'Model outcome is uncertain or the result was rejected. Reservation retained; no automatic retry.':error.status?error.message:'Website research failed. Use a readable public URL or paste a public excerpt.',now(),j.id,j.lease);}
    }finally{working=false;}
  }
  return {handler,tick,status,start(){if(!timer){timer=setInterval(()=>{void tick().catch(()=>console.error('Client-team worker failed.'));},2000);timer.unref();}},stop(){clearInterval(timer);timer=null;}};
}
