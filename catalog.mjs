export function createCatalog({db,row,rows,run,id,now,transaction,requireThat,textField,send,body}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS creator_profiles(creator_id TEXT PRIMARY KEY REFERENCES creators(id),visibility TEXT,portfolio TEXT,collaborations TEXT,metric_source TEXT,observed_on TEXT,sample_size INTEGER,sample_kind TEXT,evidence_url TEXT,updated TEXT);
    CREATE TABLE IF NOT EXISTS public_content(id TEXT PRIMARY KEY,kind TEXT,title TEXT,summary TEXT,details TEXT,evidence_url TEXT,state TEXT,created TEXT,updated TEXT);
    CREATE TABLE IF NOT EXISTS catalog_audit(id TEXT PRIMARY KEY,record_type TEXT,record_id TEXT,actor_id TEXT REFERENCES users(id),before_json TEXT,after_json TEXT,created TEXT);
  `);
  if(process.env.DEMO_MODE==='1')for(const c of rows("SELECT id FROM creators WHERE id IN ('c_asha','c_rohan','c_meera','c_zoya','c_arjun','c_tara')"))run('INSERT OR IGNORE INTO creator_profiles VALUES(?,?,?,?,?,?,?,?,?,?)',c.id,'Approved','[]','','Demonstration','2026-11-06',12,'Mixed / unknown','',now());
  const editors=u=>['owner','manager'].includes(u?.role);
  const optional=(v,name,max=1000)=>v==null||v===''?'':textField(v,name,max);
  const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v&&v<=now().slice(0,10);
  function url(v){if(!v)return '';let u;try{u=new URL(v);}catch{}requireThat(u&&u.protocol==='https:'&&!u.username&&!u.password,400,'Use an HTTPS reference URL.');return u.href;}
  const privateCreators=()=>rows("SELECT c.*,p.visibility,p.portfolio,p.collaborations,p.metric_source,p.observed_on,p.sample_size,p.sample_kind,p.evidence_url FROM creators c LEFT JOIN creator_profiles p ON p.creator_id=c.id").map(c=>({...c,portfolio:JSON.parse(c.portfolio||'[]'),visibility:c.visibility||'Draft',metric_source:c.metric_source||'Not supplied',verified:false}));
  function publicCreators({all=false}={}){return privateCreators().filter(c=>all||c.visibility==='Approved').map(({fee,visibility,...c})=>c);}
  function content(){return rows("SELECT id,kind,title,summary,details,evidence_url,updated FROM public_content WHERE state='Published' ORDER BY created");}
  function audit(type,key,u,before,after){run('INSERT INTO catalog_audit VALUES(?,?,?,?,?,?,?)',id('catalog_event'),type,key,u.id,JSON.stringify(before||null),JSON.stringify(after),now());}
  async function handler(req,res,path,u){
    if(!path.startsWith('/api/catalog'))return false;
    requireThat(editors(u),403,'Only the owner and account managers can manage the catalogue.');
    if(path==='/api/catalog'&&req.method==='GET'){send(res,200,{creators:privateCreators(),brands:rows('SELECT * FROM brands'),content:rows('SELECT * FROM public_content ORDER BY created DESC'),audit:rows('SELECT id,record_type,record_id,actor_id,created FROM catalog_audit ORDER BY rowid DESC LIMIT 50')});return true;}
    requireThat(req.method==='POST',405,'Use POST for catalogue changes.');const b=await body(req);requireThat(b&&typeof b==='object'&&!Array.isArray(b),400,'Send a catalogue record.');
    if(path==='/api/catalog/brands'){
      const name=textField(b.name,'Brand name',160),industry=textField(b.industry,'Industry',120),color=b.color||'#c5b5a0';requireThat(/^#[a-fA-F0-9]{6}$/.test(color),400,'Choose a hexadecimal colour.');
      const old=b.id?row('SELECT * FROM brands WHERE id=?',textField(b.id,'Brand ID',100)):null;requireThat(!b.id||old,404,'Brand not found.');const key=old?.id||id('brand');transaction(()=>{run('INSERT INTO brands VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,industry=excluded.industry,color=excluded.color',key,name,industry,color);audit('brand',key,u,old,{name,industry,color});});send(res,201,{id:key});return true;
    }
    if(path==='/api/catalog/creators'){
      const old=b.id?row('SELECT * FROM creators WHERE id=?',textField(b.id,'Creator ID',100)):null;requireThat(!b.id||old,404,'Creator not found.');
      const key=old?.id||id('creator'),name=textField(b.name,'Name',120),handle=textField(b.handle,'Handle',60).replace(/^@/,'');requireThat(/^[a-zA-Z0-9_.]{1,30}$/.test(handle),400,'Use a valid Instagram handle.');
      const niche=textField(b.niche,'Niche',100),location=textField(b.location,'Geography',120),language=textField(b.language,'Languages',200),bio=textField(b.bio,'Biography',2000),fee=b.fee;
      requireThat(Number.isSafeInteger(fee)&&fee>0&&fee<=10000000000,400,'Planning fee must be positive integer paise.');requireThat(typeof b.available==='boolean',400,'Specify availability.');
      const followers=b.followers??null,engagement=b.engagement??null;requireThat(followers===null||Number.isSafeInteger(followers)&&followers>=0,400,'Followers must be a nonnegative integer or unknown.');requireThat(engagement===null||typeof engagement==='number'&&Number.isFinite(engagement)&&engagement>=0&&engagement<=100,400,'Engagement must be 0–100% or unknown.');
      const source=textField(b.metric_source,'Metric source',80);requireThat(['Not supplied','Self-reported','Uploaded evidence'].includes(source),400,'Choose a supported evidence source. Connected verification cannot be entered manually.');const observed=b.observed_on||null,sample=b.sample_size??null;
      if(followers!==null||engagement!==null)requireThat(source!=='Not supplied'&&validDate(observed),400,'Figures require a source and a valid observation date.');else requireThat(!observed||validDate(observed),400,'Invalid observation date.');
      requireThat(sample===null||Number.isInteger(sample)&&sample>0&&sample<=10000,400,'Sample size must be 1–10,000 posts or unknown.');if(engagement!==null)requireThat(sample!==null,400,'Engagement needs a defined post sample.');
      const sampleKind=b.sample_kind||'Mixed / unknown';requireThat(['Mixed / unknown','Sponsored','Organic'].includes(sampleKind),400,'Choose a sample type.');const evidence=url(b.evidence_url);if(source==='Uploaded evidence')requireThat(evidence,400,'Evidence URL is required.');
      const visibility=b.visibility||'Draft';requireThat(['Draft','Approved','Hidden'].includes(visibility),400,'Invalid profile visibility.');requireThat(Array.isArray(b.portfolio)&&b.portfolio.length<=20,400,'Supply up to 20 portfolio URLs.');const portfolio=b.portfolio.map(url);requireThat(portfolio.every(Boolean),400,'Portfolio links cannot be empty.');
      const collaborations=optional(b.collaborations,'Previous collaborations',2000),initials=name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
      transaction(()=>{run('INSERT INTO creators VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,handle=excluded.handle,niche=excluded.niche,location=excluded.location,language=excluded.language,followers=excluded.followers,engagement=excluded.engagement,fee=excluded.fee,bio=excluded.bio,available=excluded.available,initials=excluded.initials',key,name,handle,niche,location,language,followers,engagement,fee,'#c5b5a0',initials,bio,b.available?1:0);run('INSERT INTO creator_profiles VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(creator_id) DO UPDATE SET visibility=excluded.visibility,portfolio=excluded.portfolio,collaborations=excluded.collaborations,metric_source=excluded.metric_source,observed_on=excluded.observed_on,sample_size=excluded.sample_size,sample_kind=excluded.sample_kind,evidence_url=excluded.evidence_url,updated=excluded.updated',key,visibility,JSON.stringify(portfolio),collaborations,source,observed,sample,sampleKind,evidence,now());audit('creator',key,u,old,{...b,id:key});});send(res,201,{id:key});return true;
    }
    if(path==='/api/catalog/content'){
      const kind=b.kind;requireThat(['Service','Case study'].includes(kind),400,'Choose a service or case study.');const state=b.state||'Draft';requireThat(['Draft','Published','Hidden'].includes(state),400,'Invalid publication state.');const title=textField(b.title,'Title',160),summary=textField(b.summary,'Summary',400),details=textField(b.details,'Details',5000),evidence=url(b.evidence_url);if(kind==='Case study'&&state==='Published')requireThat(evidence,400,'A published case study requires an evidence/source reference.');
      const old=b.id?row('SELECT * FROM public_content WHERE id=?',textField(b.id,'Content ID',100)):null;requireThat(!b.id||old,404,'Content not found.');const key=old?.id||id('content');transaction(()=>{run('INSERT INTO public_content VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,summary=excluded.summary,details=excluded.details,evidence_url=excluded.evidence_url,state=excluded.state,updated=excluded.updated',key,kind,title,summary,details,evidence,state,old?.created||now(),now());audit('content',key,u,old,{kind,title,summary,details,evidence,state});});send(res,201,{id:key});return true;
    }
    requireThat(false,404,'Catalogue endpoint not found.');
  }
  return {handler,publicCreators,content};
}
