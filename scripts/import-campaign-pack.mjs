import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const check=(v,message)=>{if(!v)throw Error(message);};
export function importCampaignPack({db,pack,actorId,apply=false}){
 const rows=(s,...a)=>db.prepare(s).all(...a),row=(s,...a)=>db.prepare(s).get(...a),run=(s,...a)=>db.prepare(s).run(...a);
 const uid=p=>p+'_'+randomUUID().replaceAll('-',''),time=new Date().toISOString();
 const text=(v,n,max)=>check(typeof v==='string'&&v.trim()&&v.length<=max,`Invalid ${n}.`);
 text(pack.source_id,'source ID',100);text(pack.title,'title',180);text(pack.source_text,'source text',100000);text(pack.brand?.name,'brand',160);text(pack.brand?.industry,'industry',120);
 check(Array.isArray(pack.creators)&&pack.creators.length>0&&pack.creators.length<=20,'Supply 1–20 creators.');
 check(new Set(pack.creators.map(c=>c.handle.toLowerCase())).size===pack.creators.length,'Creator handles must be unique.');
 for(const c of pack.creators){text(c.name,'creator name',120);check(/^[a-zA-Z0-9_.]{1,30}$/.test(c.handle),'Invalid creator handle.');text(c.concept,'concept',180);text(c.script,'script',15000);text(c.caption,'caption',2200);text(c.bio,'bio',2000);check(Array.isArray(c.allocation)&&c.allocation.length===3&&c.allocation.every(n=>Number.isSafeInteger(n)&&n>=0)&&c.allocation.reduce((a,b)=>a+b,0)===3,'Each creator must have three allocated boxes.');}
 const sha=createHash('sha256').update(JSON.stringify(pack)).digest('hex');
 const existing=row('SELECT source_sha256,campaign_id FROM campaign_reference_packs WHERE source_id=?',pack.source_id);
 if(existing){check(existing.source_sha256===sha,'This source was already imported with different contents. Review changes rather than overwriting live records.');return {unchanged:true,campaign_id:existing.campaign_id};}
 const actor=row("SELECT u.* FROM users u JOIN identity_accounts a ON a.user_id=u.id WHERE u.id=? AND u.role='owner' AND a.status='Active'",actorId);check(actor,'An active owner is required.');
 const brands=rows('SELECT * FROM brands WHERE lower(name)=lower(?)',pack.brand.name);check(brands.length<=1,'Brand name is ambiguous.');
 for(const c of pack.creators)check(rows("SELECT id FROM creators WHERE lower(ltrim(handle,'@'))=lower(?)",c.handle).length<=1,'Creator handle is ambiguous.');
 if(!apply)return {dryRun:true,brand:pack.brand.name,creators:pack.creators.length,deliverables:pack.creators.length,source_sha256:sha};
 db.exec('BEGIN IMMEDIATE');
 try{
  const brandId=brands[0]?.id||uid('brand'),campaignId=uid('campaign');
  if(!brands.length)run('INSERT INTO brands VALUES(?,?,?,?)',brandId,pack.brand.name,pack.brand.industry,'#a67947');
  run('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?,?,?,?)',campaignId,brandId,null,null,pack.title,null,'Planning',null,null,'Imported planning brief: five proposed barter Reels. Cash fees, dates, agreements, dispatch and publication are not confirmed.');
  const importedCreators=[];
  for(const c of pack.creators){
   let creatorId=row("SELECT id FROM creators WHERE lower(ltrim(handle,'@'))=lower(?)",c.handle)?.id;
   if(!creatorId){creatorId=uid('creator');run('INSERT INTO creators VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',creatorId,c.name,'@'+c.handle,c.niche,'Not supplied','Not supplied',null,null,null,'#a67947',c.name.slice(0,2).toUpperCase(),c.bio,null);run('INSERT INTO creator_profiles VALUES(?,?,?,?,?,?,?,?,?,?)',creatorId,'Draft',JSON.stringify(['https://www.instagram.com/'+c.handle+'/']),'','Not supplied',null,null,'Mixed / unknown','',time);}
   const assignmentId=uid('assignment');run('INSERT INTO assignments VALUES(?,?,?)',assignmentId,campaignId,creatorId);
   run('INSERT INTO deliverables VALUES(?,?,?,?,?,?,?)',uid('deliverable'),assignmentId,c.name+' · '+c.concept,null,'Brief prepared',c.name,'@'+c.handle);
   const product=c.allocation.map((n,i)=>n?`${n} × ${pack.products[i]}`:null).filter(Boolean).join('; ');
   run('INSERT INTO shipments VALUES(?,?,?,?,?,?,?,?)',uid('shipment'),assignmentId,product,3,'','','Pending',time);
   importedCreators.push({...c,creator_id:creatorId});
  }
  const payload={...pack,creators:importedCreators};
  run('INSERT INTO campaign_reference_packs VALUES(?,?,?,?,?,?)',campaignId,pack.source_id,sha,JSON.stringify(payload),actorId,time);
  const version=(row('SELECT MAX(version) n FROM knowledge_versions WHERE brand_id=?',brandId)?.n||0)+1;
  // Existing knowledge is never overwritten; the imported source is a new version.
  run('INSERT INTO knowledge_versions VALUES(?,?,?,?,?,?)',uid('knowledge'),brandId,version,JSON.stringify(pack.knowledge),actorId,time);
  run('INSERT INTO brief_versions VALUES(?,?,?,?,?,?)',uid('brief'),campaignId,1,JSON.stringify(pack.brief),actor.name,time);
  for(const task of pack.tasks||[])run('INSERT INTO workflow_tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',uid('task'),campaignId,actorId,task.title,task.description,null,'agency','Open',1,null,actorId,time,time);
  run('INSERT INTO activities VALUES(?,?,?,?,?)',uid('activity'),brandId,actor.name,'Imported the supplied Veda Munch campaign pack and 5 November caption update as pending planning records.',time);
  db.exec('COMMIT');return {campaign_id:campaignId,brand_id:brandId,creators:importedCreators.map(c=>({id:c.creator_id,name:c.name})),deliverables:importedCreators.length};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let db;try{const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];check(args.includes('--file')&&args.includes('--owner'),'Pass --file and --owner.');check(process.env.DEMO_MODE==='0','Use the production database.');db=new DatabaseSync(process.env.DB_PATH);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');console.log(JSON.stringify(importCampaignPack({db,pack:JSON.parse(readFileSync(arg('--file'),'utf8')),actorId:arg('--owner'),apply:args.includes('--apply')})));}catch(e){console.error(JSON.stringify({failed:true,message:e.message}));process.exitCode=1;}finally{db?.close();}
}
