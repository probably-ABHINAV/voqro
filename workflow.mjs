export function createWorkflow({db,row,rows,run,id,now,transaction,requireThat,textField,send,body,delivery,connectionVerified=()=>false}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_versions(id TEXT PRIMARY KEY,brand_id TEXT REFERENCES brands(id),version INTEGER,payload TEXT,author_id TEXT REFERENCES users(id),created TEXT,UNIQUE(brand_id,version));
    CREATE TABLE IF NOT EXISTS workflow_tasks(id TEXT PRIMARY KEY,campaign_id TEXT REFERENCES campaigns(id),owner_id TEXT REFERENCES users(id),title TEXT,description TEXT,due_on TEXT,visibility TEXT,status TEXT,revision INTEGER,completed_at TEXT,created_by TEXT REFERENCES users(id),created TEXT,updated TEXT);
    CREATE TABLE IF NOT EXISTS task_dependencies(task_id TEXT REFERENCES workflow_tasks(id),depends_on TEXT REFERENCES workflow_tasks(id),PRIMARY KEY(task_id,depends_on));
    CREATE TABLE IF NOT EXISTS task_comments(id TEXT PRIMARY KEY,task_id TEXT REFERENCES workflow_tasks(id),author_id TEXT REFERENCES users(id),message TEXT,visibility TEXT,created TEXT);
    CREATE TABLE IF NOT EXISTS workflow_audit(id TEXT PRIMARY KEY,record_type TEXT,record_id TEXT,actor_id TEXT REFERENCES users(id),action TEXT,payload TEXT,created TEXT);
    CREATE TABLE IF NOT EXISTS workflow_notifications(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),event_key TEXT,title TEXT,detail TEXT,action TEXT,severity TEXT,created TEXT,read_at TEXT,resolved INTEGER DEFAULT 0,UNIQUE(user_id,event_key));
    CREATE TABLE IF NOT EXISTS workflow_rules(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER,review_hours INTEGER,shipment_days INTEGER,rights_days INTEGER,escalation_hours INTEGER,updated_by TEXT,updated TEXT);
    CREATE INDEX IF NOT EXISTS workflow_tasks_campaign ON workflow_tasks(campaign_id,status);
    CREATE INDEX IF NOT EXISTS workflow_notification_user ON workflow_notifications(user_id,created);
  `);
  run('INSERT OR IGNORE INTO workflow_rules VALUES(1,1,48,7,14,48,NULL,?)',now());
  const agency=u=>['owner','manager','reviewer'].includes(u.role);
  const manage=u=>['owner','manager'].includes(u.role);
  const financial=u=>['owner','finance'].includes(u.role);
  const c=delivery.context;
  const audit=(u,type,rid,action,payload={})=>run('INSERT INTO workflow_audit VALUES(?,?,?,?,?,?,?)',id('audit'),type,rid,u.id,action,JSON.stringify(payload),now());
  const today=()=>now().slice(0,10);
  const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
  const optional=(v,label,max=4000)=>{requireThat(v===undefined||v===null||typeof v==='string',400,label+' must contain text.');requireThat(!v||v.length<=max,400,label+' is too long.');return (v||'').trim();};
  const campaign=cid=>{textField(cid,'Campaign',100);const result=row('SELECT * FROM campaigns WHERE id=?',cid);requireThat(result,404,'Campaign not found.');return result;};
  const scope=(u,camp)=>agency(u)||(u.role==='brand'&&u.brand_id===camp.brand_id)||(u.role==='creator'&&!!row('SELECT id FROM assignments WHERE campaign_id=? AND creator_id=?',camp.id,u.creator_id));
  function brandAccess(u,bid){const brand=row('SELECT * FROM brands WHERE id=?',bid);requireThat(brand,404,'Brand not found.');requireThat(agency(u)||(u.role==='brand'&&u.brand_id===bid)||(u.role==='creator'&&row('SELECT a.id FROM assignments a JOIN campaigns c ON c.id=a.campaign_id WHERE c.brand_id=? AND a.creator_id=?',bid,u.creator_id)),403,'This knowledge library is outside your workspace.');return brand;}
  const canReadTask=(u,t)=>!!t&&(t.visibility==='finance'?financial(u):(t.visibility==='agency'?agency(u):scope(u,campaign(t.campaign_id))&&(u.role!=='creator'||t.owner_id===u.id)));
  function task(u,tid){textField(tid,'Task',100);const t=row('SELECT * FROM workflow_tasks WHERE id=?',tid);requireThat(t,404,'Task not found.');requireThat(canReadTask(u,t),403,'This task is outside your workspace.');return t;}
  const dependencies=tid=>rows('SELECT depends_on FROM task_dependencies WHERE task_id=? ORDER BY depends_on',tid).map(d=>d.depends_on);
  const taskView=(u,t)=>({...t,owner_name:row('SELECT name FROM users WHERE id=?',t.owner_id)?.name,dependencies:dependencies(t.id).map(did=>{const d=row('SELECT * FROM workflow_tasks WHERE id=?',did);return canReadTask(u,d)?{id:d.id,title:d.title,status:d.status}:{id:did,title:'Restricted dependency',status:d?.status==='Done'?'Done':'Incomplete'};}),comments:rows('SELECT tc.*,u.name AS author_name FROM task_comments tc JOIN users u ON u.id=tc.author_id WHERE task_id=? ORDER BY tc.rowid',t.id).filter(x=>x.visibility!=='agency'||agency(u)),history:rows('SELECT a.action,a.payload,a.created,u.name AS actor_name FROM workflow_audit a JOIN users u ON u.id=a.actor_id WHERE record_type=? AND record_id=? ORDER BY a.rowid','task',t.id).map(x=>({...x,payload:JSON.parse(x.payload)}))});
  function eligibleUsers(camp){return rows('SELECT id,name,role,brand_id,creator_id FROM users').filter(u=>agency(u)||u.role==='finance'||(u.role==='brand'&&u.brand_id===camp.brand_id)||(u.role==='creator'&&row('SELECT id FROM assignments WHERE campaign_id=? AND creator_id=?',camp.id,u.creator_id)));}
  function hasCycle(tid,deps){const visit=(next,seen=new Set())=>{if(next===tid)return true;if(seen.has(next))return false;seen.add(next);return dependencies(next).some(d=>visit(d,seen));};return deps.some(d=>visit(d));}
  function validateDependencies(t,deps){requireThat(Array.isArray(deps)&&deps.length<=30&&deps.every(x=>typeof x==='string'),400,'Choose up to 30 task dependencies.');requireThat(new Set(deps).size===deps.length,400,'A dependency cannot be repeated.');const owner=row('SELECT * FROM users WHERE id=?',t.owner_id);for(const dep of deps){const d=row('SELECT * FROM workflow_tasks WHERE id=?',dep);requireThat(d&&d.campaign_id===t.campaign_id,400,'Dependencies must belong to this campaign.');requireThat(canReadTask(owner,d)&&(t.visibility!=='shared'||d.visibility==='shared'),400,'The assignee must be able to read every dependency.');}requireThat(!hasCycle(t.id,deps),409,'These dependencies would create a cycle.');if(t.status==='Done')requireThat(deps.every(x=>row('SELECT status FROM workflow_tasks WHERE id=?',x).status==='Done'),409,'A completed task cannot depend on incomplete work.');}
  function latestKnowledge(bid){const k=row('SELECT k.*,u.name AS author_name FROM knowledge_versions k JOIN users u ON u.id=k.author_id WHERE k.brand_id=? ORDER BY version DESC LIMIT 1',bid);return k?{...k,payload:JSON.parse(k.payload)}:null;}
  const rules=()=>row('SELECT * FROM workflow_rules WHERE id=1');
  function exceptions(u){
    const result=[],rule=rules(),time=Date.parse(now());
    const add=(key,kind,title,detail,action,since,severity='warning')=>result.push({key,kind,title,detail,action,since,severity,age_hours:Math.max(0,(time-Date.parse(since))/3600000)});
    for(const t of rows("SELECT * FROM workflow_tasks WHERE status!='Done' AND due_on<?",today()).filter(t=>canReadTask(u,t)))add('task:'+t.id+':'+t.due_on+':'+t.revision,'task','Overdue task: '+t.title,'Assigned to '+row('SELECT name FROM users WHERE id=?',t.owner_id).name+'. Due '+t.due_on+'.','wf-task:'+t.id,t.due_on+'T00:00:00.000Z');
    if(u.role!=='finance')for(const d of rows('SELECT d.*,a.campaign_id,a.creator_id,c.brand_id FROM deliverables d JOIN assignments a ON a.id=d.assignment_id JOIN campaigns c ON c.id=a.campaign_id')){
      if(!scope(u,{id:d.campaign_id,brand_id:d.brand_id})||(u.role==='creator'&&d.creator_id!==u.creator_id))continue;
      const version=c.latestVersion(d.id),status=c.currentStatus(d);
      if(d.due_date&&d.due_date<today()&&(!version||['Changes requested','Brief changed'].includes(status)))add('draft:'+d.id+':'+d.due_date+':'+(version?.id||'none'),'draft','Draft overdue: '+d.title,'The assigned draft or revision has not reached review.','deliverable:'+d.id,d.due_date+'T00:00:00.000Z');
      if(version){
        const shared=row("SELECT created FROM approvals WHERE content_version_id=? AND stage='agency' ORDER BY created DESC LIMIT 1",version.id);
        const since=status==='Brand review'?shared?.created:version.created;
        if(['Agency review','Brand review'].includes(status)&&since&&time-Date.parse(since)>=rule.review_hours*3600000&&(agency(u)||(u.role==='brand'&&status==='Brand review')))
          add('review:'+version.id+':'+status,'review','Review overdue: '+d.title,status+' has been waiting since '+since.slice(0,10)+'.','deliverable:'+d.id,new Date(Date.parse(since)+rule.review_hours*3600000).toISOString());
        const job=row("SELECT * FROM processing_jobs WHERE version_id=? AND state='Failed'",version.id);
        if(job&&(agency(u)||u.role==='creator'))add('job:'+job.id+':'+job.updated,'processing','Processing failed: '+d.title,job.error||'Technical checks need recovery.','nav:operations',job.updated,'error');
      }
    }
    if(u.role!=='finance')for(const s of rows("SELECT s.*,a.campaign_id,a.creator_id,c.brand_id FROM shipments s JOIN assignments a ON a.id=s.assignment_id JOIN campaigns c ON c.id=a.campaign_id WHERE s.status!='Received'")){
      if(!scope(u,{id:s.campaign_id,brand_id:s.brand_id})||(u.role==='creator'&&s.creator_id!==u.creator_id))continue;
      if(time-Date.parse(s.updated)>=rule.shipment_days*86400000)add('shipment:'+s.id+':'+s.updated,'dispatch','Product receipt still pending: '+s.product,'Status: '+s.status+'. Confirm delivery before filming.','campaign:'+s.campaign_id,new Date(Date.parse(s.updated)+rule.shipment_days*86400000).toISOString());
    }
    if(u.role!=='finance')for(const rights of rows('SELECT r.*,c.brand_id FROM rights_records r JOIN campaigns c ON c.id=r.campaign_id')){
      if(!scope(u,{id:rights.campaign_id,brand_id:rights.brand_id}))continue;
      const payload=JSON.parse(rights.payload),remaining=(Date.parse(payload.end+'T23:59:59Z')-time)/86400000;
      if(remaining<=rule.rights_days)add('rights:'+rights.campaign_id+':'+payload.end,'rights',remaining<0?'Recorded usage rights have expired':'Recorded usage rights approach expiry','Recorded end date: '+payload.end+'. Review the agreement before further use.','campaign:'+rights.campaign_id,payload.end+'T00:00:00.000Z',remaining<0?'error':'warning');
    }
    if(agency(u))for(const s of rows("SELECT * FROM handoff_schedule WHERE state IN ('Scheduled','Ready for manual handoff','Blocked')")){
      if(connectionVerified(s.version_id)!==true)add('connection:'+s.version_id,'connection','Publishing connection needs verification','This scheduled package currently needs manual handoff or a verified provider connection.','nav:connections',s.created);
    }
    if(financial(u)||u.role==='brand')for(const i of rows("SELECT i.*,c.brand_id FROM invoices i JOIN campaigns c ON c.id=i.campaign_id WHERE i.state='Issued' AND i.due_on<?",today())){
      if(u.role==='brand'&&u.brand_id!==i.brand_id)continue;
      const paid=row("SELECT COALESCE(SUM(CASE WHEN reversal_of IS NULL THEN amount ELSE -amount END),0) total FROM settlements WHERE parent_type='invoice' AND parent_id=?",i.id).total;
      if(paid<i.total)add('invoice:'+i.id+':'+i.due_on,'invoice','Invoice payment overdue','VOQ-'+String(i.seq).padStart(6,'0')+' · '+i.title+'. Review the recorded outstanding balance.','nav:finance',i.due_on+'T00:00:00.000Z');
    }
    return result.sort((a,b)=>b.age_hours-a.age_hours||a.key.localeCompare(b.key));
  }
  function notificationVisible(u,n){
    if(!u||!n||n.user_id!==u.id||typeof n.event_key!=='string')return false;
    const [kind,rid]=n.event_key.split(':');
    if(kind==='task')return canReadTask(u,row('SELECT * FROM workflow_tasks WHERE id=?',rid));
    if(kind==='invoice'){const invoice=row('SELECT i.*,c.brand_id FROM invoices i JOIN campaigns c ON c.id=i.campaign_id WHERE i.id=?',rid);return !!invoice&&(financial(u)||(u.role==='brand'&&u.brand_id===invoice.brand_id));}
    if(kind==='connection')return agency(u);
    if(kind==='rights'){const camp=row('SELECT * FROM campaigns WHERE id=?',rid);return !!camp&&scope(u,camp);}
    if(kind==='shipment'){const shipment=row('SELECT a.campaign_id,a.creator_id FROM shipments s JOIN assignments a ON a.id=s.assignment_id WHERE s.id=?',rid);return !!shipment&&scope(u,campaign(shipment.campaign_id))&&(u.role!=='creator'||u.creator_id===shipment.creator_id);}
    let did=kind==='draft'?rid:null;
    if(kind==='review')did=row('SELECT deliverable_id FROM content_versions WHERE id=?',rid)?.deliverable_id;
    if(kind==='job')did=row('SELECT v.deliverable_id FROM processing_jobs j JOIN content_versions v ON v.id=j.version_id WHERE j.id=?',rid)?.deliverable_id;
    if(did){try{c.deliverableAccess(u,did);return kind==='job'?agency(u)||u.role==='creator':kind==='review'?agency(u)||(u.role==='brand'&&n.event_key.includes(':Brand review:')):true;}catch{return false;}}
    return false;
  }
  function tick(){const rule=rules();if(!rule.enabled)return {created:0};let created=0;transaction(()=>{for(const user of rows('SELECT * FROM users')){
      const assignments=rows("SELECT * FROM workflow_tasks WHERE owner_id=? AND status!='Done'",user.id).filter(t=>canReadTask(user,t)).map(t=>({key:'task:'+t.id+':assigned:'+t.owner_id,title:'Task assigned: '+t.title,detail:'Due '+t.due_on+'. '+(t.description||'Open the task for its dependencies and discussion.'),action:'wf-task:'+t.id,severity:'info',age_hours:0}));const events=[...exceptions(user),...assignments],active=new Set();
      for(const event of events){const stages=['reminder'];if(user.role==='owner'&&event.age_hours>=rule.escalation_hours)stages.push('escalation');for(const stage of stages){const key=event.key+':'+stage;active.add(key);const prior=row('SELECT id FROM workflow_notifications WHERE user_id=? AND event_key=?',user.id,key);if(!prior){run('INSERT INTO workflow_notifications VALUES(?,?,?,?,?,?,?,?,?,0)',id('notification'),user.id,key,(stage==='escalation'?'Escalation · ':'')+event.title,event.detail,event.action,stage==='escalation'?'error':event.severity,now(),null);created++;}else run('UPDATE workflow_notifications SET resolved=0 WHERE id=?',prior.id);}}
      for(const notification of rows('SELECT id,event_key FROM workflow_notifications WHERE user_id=? AND resolved=0',user.id))if(!active.has(notification.event_key))run('UPDATE workflow_notifications SET resolved=1 WHERE id=?',notification.id);
    }});return {created};}
  let timer;
  const start=()=>{if(timer)return;tick();timer=setInterval(()=>{try{tick();}catch(e){console.error('Workflow reminder tick failed:',e.name);}},60000);timer.unref();};
  const stop=()=>{clearInterval(timer);timer=null;};
  async function handler(req,res,path,u){
    if(!path.startsWith('/api/workflow'))return false;
    requireThat(['owner','manager','reviewer','finance','brand','creator'].includes(u.role),403,'Workspace membership required.');
    if(req.method==='GET'&&path==='/api/workflow'){
      tick();const campaigns=rows('SELECT id,brand_id,name FROM campaigns').filter(camp=>scope(u,camp)||financial(u));
      const visibleTasks=rows('SELECT * FROM workflow_tasks ORDER BY due_on,created').filter(t=>canReadTask(u,t));
      const brands=rows('SELECT id,name FROM brands').filter(b=>{try{brandAccess(u,b.id);return true;}catch{return false;}});
      send(res,200,{campaigns,brands,tasks:visibleTasks.map(t=>taskView(u,t)),knowledge:brands.map(b=>({brand_id:b.id,brand_name:b.name,latest:latestKnowledge(b.id)})),assignees:manage(u)?campaigns.map(camp=>({campaign_id:camp.id,users:eligibleUsers(camp)})):[],notifications:rows('SELECT * FROM workflow_notifications WHERE user_id=? ORDER BY created DESC,rowid DESC LIMIT 200',u.id).filter(n=>notificationVisible(u,n)),exceptions:exceptions(u),rules:u.role==='owner'?rules():null,capabilities:{manage_tasks:manage(u),edit_knowledge:manage(u)||u.role==='brand',manage_rules:u.role==='owner'},notification_channel:'In-app only; no external email or messages are sent.'});return true;
    }
    const km=path.match(/^\/api\/workflow\/knowledge\/([\w-]+)$/);
    if(req.method==='GET'&&km){brandAccess(u,km[1]);send(res,200,{latest:latestKnowledge(km[1]),history:rows('SELECT k.id,k.version,k.created,u.name AS author_name FROM knowledge_versions k JOIN users u ON u.id=k.author_id WHERE k.brand_id=? ORDER BY version DESC',km[1])});return true;}
    const kv=path.match(/^\/api\/workflow\/knowledge-version\/([\w-]+)$/);
    if(req.method==='GET'&&kv){const record=row('SELECT k.*,u.name AS author_name FROM knowledge_versions k JOIN users u ON u.id=k.author_id WHERE k.id=?',kv[1]);requireThat(record,404,'Knowledge version not found.');brandAccess(u,record.brand_id);send(res,200,{...record,payload:JSON.parse(record.payload)});return true;}
    const tm=path.match(/^\/api\/workflow\/tasks\/([\w-]+)$/);
    if(req.method==='GET'&&tm){send(res,200,taskView(u,task(u,tm[1])));return true;}
    requireThat(req.method==='POST',405,'Use POST for this workflow operation.');const b=await body(req);requireThat(b&&typeof b==='object'&&!Array.isArray(b),400,'Send a workflow record object.');
    if(path==='/api/workflow/knowledge'){
      textField(b.brand_id,'Brand',100);brandAccess(u,b.brand_id);requireThat(manage(u)||(u.role==='brand'&&u.brand_id===b.brand_id),403,'Only the account team and matching brand can update knowledge.');
      const references=b.references||[];requireThat(Array.isArray(references)&&references.length<=20,400,'Add up to 20 reference links.');const links=references.map(x=>{requireThat(x&&typeof x==='object',400,'Invalid reference.');const label=textField(x.label,'Reference label',200),value=textField(x.url,'Reference URL',2000);let url;try{url=new URL(value);}catch{}requireThat(url?.protocol==='https:'&&!url.username&&!url.password,400,'Reference links must use HTTPS without embedded credentials.');return {label,url:url.href};});
      const payload={tone:optional(b.tone,'Tone'),facts:optional(b.facts,'Product facts'),claims:optional(b.claims,'Approved claims'),prohibited:optional(b.prohibited,'Prohibited wording'),disclosure:optional(b.disclosure,'Disclosure',1000),notes:optional(b.notes,'Knowledge notes'),references:links};
      const result=transaction(()=>{const prev=latestKnowledge(b.brand_id);requireThat((b.base_version_id||null)===(prev?.id||null),409,'The brand knowledge changed. Reload before saving.');const kid=id('knowledge');run('INSERT INTO knowledge_versions VALUES(?,?,?,?,?,?)',kid,b.brand_id,(prev?.version||0)+1,JSON.stringify(payload),u.id,now());audit(u,'knowledge',kid,'version_created',{version:(prev?.version||0)+1});return {id:kid,version:(prev?.version||0)+1};});send(res,201,result);return true;
    }
    if(path==='/api/workflow/tasks'){
      requireThat(manage(u),403,'Only the owner and account manager can plan tasks.');const camp=campaign(b.campaign_id),existing=b.id?task(u,b.id):null;requireThat(!existing||existing.campaign_id===camp.id,400,'A task cannot move between campaigns.');requireThat(!existing||existing.visibility===b.visibility,409,'Task visibility is fixed to preserve discussion privacy. Create a new task for a different audience.');const owner=row('SELECT * FROM users WHERE id=?',textField(b.owner_id,'Assignee',100));requireThat(owner&&eligibleUsers(camp).some(x=>x.id===owner.id),400,'Choose an assignee with access to this campaign.');requireThat(validDate(b.due_on),400,'Choose a valid task due date.');requireThat(['shared','agency','finance'].includes(b.visibility),400,'Choose shared, agency or finance visibility.');requireThat(b.visibility!=='finance'||u.role==='owner',403,'Only the owner can manage finance tasks.');
      const next={id:existing?.id||id('task'),campaign_id:camp.id,owner_id:owner.id,title:textField(b.title,'Task title',200),description:optional(b.description,'Task description'),due_on:b.due_on,visibility:b.visibility,status:existing?.status||'Open'};
      requireThat(canReadTask(owner,next),400,'The assignee cannot access this visibility.');if(existing)for(const dependent of rows('SELECT t.* FROM workflow_tasks t JOIN task_dependencies d ON d.task_id=t.id WHERE d.depends_on=?',existing.id)){const dependentOwner=row('SELECT * FROM users WHERE id=?',dependent.owner_id);requireThat(canReadTask(dependentOwner,next),409,'Changing this assignee would hide a prerequisite from a dependent task. Update those dependencies first.');}const deps=b.dependencies||[];
      transaction(()=>{if(existing)requireThat(Number.isInteger(b.revision)&&b.revision===existing.revision,409,'The task changed. Reload before saving.');validateDependencies(next,deps);run('INSERT INTO workflow_tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,title=excluded.title,description=excluded.description,due_on=excluded.due_on,visibility=excluded.visibility,revision=excluded.revision,updated=excluded.updated',next.id,camp.id,owner.id,next.title,next.description,next.due_on,next.visibility,next.status,(existing?.revision||0)+1,existing?.completed_at||null,existing?.created_by||u.id,existing?.created||now(),now());run('DELETE FROM task_dependencies WHERE task_id=?',next.id);for(const dep of deps)run('INSERT INTO task_dependencies VALUES(?,?)',next.id,dep);audit(u,'task',next.id,existing?'updated':'created',{title:next.title,owner:owner.name,due_on:next.due_on,visibility:next.visibility});});send(res,existing?200:201,taskView(u,row('SELECT * FROM workflow_tasks WHERE id=?',next.id)));return true;
    }
    if(path==='/api/workflow/tasks/status'){
      const t=task(u,b.id);requireThat(manage(u)||u.id===t.owner_id,403,'Only the assignee or account team can update task progress.');requireThat(['Open','In progress','Done'].includes(b.status),400,'Invalid task status.');
      transaction(()=>{requireThat(b.revision===t.revision,409,'The task changed. Reload before updating.');if(b.status==='Done')requireThat(dependencies(t.id).every(dep=>row('SELECT status FROM workflow_tasks WHERE id=?',dep).status==='Done'),409,'Complete all dependencies before this task.');if(t.status==='Done'&&b.status!=='Done')requireThat(!row("SELECT t.id FROM workflow_tasks t JOIN task_dependencies d ON d.task_id=t.id WHERE d.depends_on=? AND t.status='Done'",t.id),409,'Reopen completed dependent tasks first.');if(t.status!==b.status){run('UPDATE workflow_tasks SET status=?,completed_at=?,revision=revision+1,updated=? WHERE id=?',b.status,b.status==='Done'?now():null,now(),t.id);audit(u,'task',t.id,'status_changed',{from:t.status,to:b.status});}});send(res,200,taskView(u,row('SELECT * FROM workflow_tasks WHERE id=?',t.id)));return true;
    }
    if(path==='/api/workflow/tasks/comment'){
      const t=task(u,b.id),message=textField(b.message,'Comment',4000),visibility=b.visibility||'shared';requireThat(['shared','agency'].includes(visibility),400,'Invalid comment visibility.');requireThat(visibility!=='agency'||agency(u),403,'Agency-only comments require agency access.');run('INSERT INTO task_comments VALUES(?,?,?,?,?,?)',id('comment'),t.id,u.id,message,visibility,now());send(res,201,{ok:true});return true;
    }
    if(path==='/api/workflow/notifications/read'){
      requireThat(b.all===true||typeof b.id==='string',400,'Choose a notification.');if(b.all)run('UPDATE workflow_notifications SET read_at=? WHERE user_id=? AND read_at IS NULL',now(),u.id);else{const n=row('SELECT * FROM workflow_notifications WHERE id=? AND user_id=?',b.id,u.id);requireThat(n&&notificationVisible(u,n),404,'Notification not found.');run('UPDATE workflow_notifications SET read_at=COALESCE(read_at,?) WHERE id=?',now(),n.id);}send(res,200,{ok:true});return true;
    }
    if(path==='/api/workflow/rules'){
      requireThat(u.role==='owner',403,'Only the owner can change reminder rules.');requireThat(typeof b.enabled==='boolean',400,'Choose whether reminders are enabled.');for(const [key,max] of [['review_hours',720],['shipment_days',90],['rights_days',90],['escalation_hours',720]])requireThat(Number.isInteger(b[key])&&b[key]>=1&&b[key]<=max,400,key+' is outside its supported range.');run('UPDATE workflow_rules SET enabled=?,review_hours=?,shipment_days=?,rights_days=?,escalation_hours=?,updated_by=?,updated=? WHERE id=1',Number(b.enabled),b.review_hours,b.shipment_days,b.rights_days,b.escalation_hours,u.id,now());audit(u,'rules','1','updated',{enabled:b.enabled,review_hours:b.review_hours,shipment_days:b.shipment_days,rights_days:b.rights_days,escalation_hours:b.escalation_hours});send(res,200,rules());return true;
    }
    requireThat(false,404,'Workflow endpoint not found.');
  }
  return {handler,tick,start,stop,exceptions,canSeeNotification:notificationVisible};
}
