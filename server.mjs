import {createSalesAssistant} from './sales-assistant.mjs';
import {backupStatus} from './offsite-backups.mjs';
import {createCampaignPacks} from './campaign-packs.mjs';
import {createRequestGuards} from './request-guards.mjs';
import {createNotifications} from './notifications.mjs';
import {createIdentity} from './identity.mjs';
import {createOptimization} from './optimization.mjs';
import {createWorkflow} from './workflow.mjs';
import {createReporting} from './reporting.mjs';
import {createCloud} from './cloud.mjs';
import {createInstagram} from './instagram.mjs';
import {createCatalog} from './catalog.mjs';
import {createCommerce} from './commerce.mjs';
import {createOperations} from './operations.mjs';
import { createDelivery } from './delivery.mjs';
import http from 'node:http';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const dbPath = process.env.DB_PATH || resolve(root, '.data/voqro.sqlite');
if (dbPath !== ':memory:') mkdirSync(resolve(dbPath, '..'), {recursive:true,mode:0o700});
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT,role TEXT,brand_id TEXT,creator_id TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER);
CREATE TABLE IF NOT EXISTS brands(id TEXT PRIMARY KEY,name TEXT,industry TEXT,color TEXT);
CREATE TABLE IF NOT EXISTS creators(id TEXT PRIMARY KEY,name TEXT,handle TEXT,niche TEXT,location TEXT,language TEXT,followers INTEGER,engagement REAL,fee INTEGER,color TEXT,initials TEXT,bio TEXT,available INTEGER);
CREATE TABLE IF NOT EXISTS leads(id TEXT PRIMARY KEY,brand_id TEXT REFERENCES brands(id),name TEXT,email TEXT,company TEXT,brief TEXT,budget INTEGER,stage TEXT,owner TEXT,follow_up TEXT,source TEXT,created TEXT);
CREATE TABLE IF NOT EXISTS shortlists(brand_id TEXT REFERENCES brands(id),creator_id TEXT REFERENCES creators(id),PRIMARY KEY(brand_id,creator_id));
CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY,brand_id TEXT REFERENCES brands(id),lead_id TEXT REFERENCES leads(id),title TEXT,status TEXT,created TEXT);
CREATE TABLE IF NOT EXISTS proposal_versions(id TEXT PRIMARY KEY,proposal_id TEXT REFERENCES proposals(id),version INTEGER,payload TEXT,total INTEGER,created TEXT,UNIQUE(proposal_id,version));
CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,brand_id TEXT REFERENCES brands(id),proposal_id TEXT UNIQUE REFERENCES proposals(id),accepted_version_id TEXT REFERENCES proposal_versions(id),name TEXT,budget INTEGER,status TEXT,start_date TEXT,end_date TEXT,description TEXT);
CREATE TABLE IF NOT EXISTS assignments(id TEXT PRIMARY KEY,campaign_id TEXT REFERENCES campaigns(id),creator_id TEXT REFERENCES creators(id),UNIQUE(campaign_id,creator_id));
CREATE TABLE IF NOT EXISTS deliverables(id TEXT PRIMARY KEY,assignment_id TEXT REFERENCES assignments(id),title TEXT,due_date TEXT,status TEXT,owner TEXT,publishing_account TEXT);
CREATE TABLE IF NOT EXISTS content_versions(id TEXT PRIMARY KEY,deliverable_id TEXT REFERENCES deliverables(id),version INTEGER,package_json TEXT,created TEXT,UNIQUE(deliverable_id,version));
CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,content_version_id TEXT REFERENCES content_versions(id),reviewer_id TEXT REFERENCES users(id),stage TEXT,created TEXT);
CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY,brand_id TEXT,actor TEXT,message TEXT,created TEXT);
`);
const now = () => new Date().toISOString();
const id = prefix => prefix+'_'+randomBytes(8).toString('hex');
const rows = (sql,...args) => db.prepare(sql).all(...args);
const row = (sql,...args) => db.prepare(sql).get(...args);
const run = (sql,...args) => db.prepare(sql).run(...args);
const activity = (brand,actor,message) => run('INSERT INTO activities VALUES(?,?,?,?,?)',id('act'),brand,actor,message,now());
function transaction(fn){ db.exec('BEGIN IMMEDIATE'); try {const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;} }
if(process.env.DEMO_MODE==='1'&&row("SELECT name FROM sqlite_master WHERE type='table' AND name='identity_accounts'")&&row('SELECT user_id FROM identity_accounts LIMIT 1'))throw new Error('Demonstration startup refused: this database contains production identities. Keep DEMO_MODE=0 and use a separate DB_PATH for demonstrations; no sample records were added.');
if (process.env.DEMO_MODE==='1'&&!row('SELECT id FROM brands LIMIT 1')) transaction(()=>{
 for (const b of [['b_olive','Olive & Earth','Beauty & wellness','#a8b598'],['b_north','Northstar','Outdoor & lifestyle','#adc1d2'],['b_form','Form Studio','Home & design','#dfb59c']]) run('INSERT INTO brands VALUES(?,?,?,?)',...b);
 const cs=[['c_asha','Asha Mehta','ashamehta','Lifestyle','Mumbai','English, Hindi',128400,4.8,2500000,'#e3b9a8','AM','Everyday rituals, thoughtfully told. Beauty, slow living and a little bit of sunshine.',1],['c_rohan','Rohan Kapoor','rohanexplores','Travel','Bengaluru','English, Hindi',246000,5.2,4000000,'#acc1b4','RK','Finding extraordinary stories in the outdoors, one trail at a time.',1],['c_meera','Meera Iyer','madebymeera','Design','Chennai','English, Tamil',86200,6.1,1800000,'#bfb5ce','MI','Spaces, objects and the people who make them. A considered approach to design.',1],['c_zoya','Zoya Khan','zoyaeats','Food','Delhi','English, Hindi',174000,4.3,3000000,'#e0c091','ZK','Good food brings us together. Recipes, restaurants and stories worth sharing.',1],['c_arjun','Arjun Sen','arjunmoves','Fitness','Pune','English, Bengali',96000,5.6,2200000,'#a7b8ce','AS','Making movement feel good. Accessible training and honest wellness conversations.',0],['c_tara','Tara Desai','tarainframes','Lifestyle','Mumbai','English, Gujarati',312000,3.9,5500000,'#d8b8b0','TD','Style with a point of view. A visual diary of fashion, travel and everyday life.',1]];
 for(const c of cs) run('INSERT INTO creators VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',...c);
 for(const u of [['u_owner','Abhinav','owner',null,null],['u_manager','Naina Sharma','manager',null,null],['u_reviewer','Dev Patel','reviewer',null,null],['u_finance','Sam Rao','finance',null,null],['u_brand','Priya · Olive & Earth','brand','b_olive',null],['u_other','Alex · Northstar','brand','b_north',null],['u_creator','Asha Mehta','creator',null,'c_asha']]) run('INSERT INTO users VALUES(?,?,?,?,?)',...u);
 for(const l of [['l_1','b_olive','Priya Shah','priya@example.com','Olive & Earth','A fresh perspective on everyday skincare.',65000000,'Proposal','Naina Sharma','2026-11-09','Website'],['l_2','b_north','Alex Morgan','alex@example.com','Northstar','Winter trails, real stories.',42000000,'Discovery','Naina Sharma','2026-11-10','Referral'],['l_3','b_form','Leah Singh','leah@example.com','Form Studio','Meet the objects that make a home.',28000000,'Qualified','Abhinav','2026-11-12','Instagram']]) run('INSERT INTO leads VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',...l,now());
 for(const c of [['cam_1','b_olive',null,null,'The everyday ritual',65000000,'Active','2026-11-02','2026-11-24','A slower morning. A little more care. Creator-led stories for Olive & Earth’s new skincare collection.'],['cam_2','b_north',null,null,'Out of office',42000000,'Active','2026-11-05','2026-11-28','Honest stories from the trail. An invitation to step outside.'],['cam_3','b_form',null,null,'Objects with a story',28000000,'Planning','2026-11-12','2026-12-04','Introducing the makers behind Form’s newest collection.']]) run('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?,?,?,?)',...c);
 for(const a of [['a1','cam_1','c_asha'],['a2','cam_1','c_tara'],['a3','cam_2','c_rohan'],['a4','cam_3','c_meera']]) run('INSERT INTO assignments VALUES(?,?,?)',...a);
 for(const d of [['d1','a1','Morning ritual · Instagram Reel','2026-11-09','Draft due','Asha Mehta','@oliveandearth'],['d2','a2','Skincare essentials · Instagram Reel','2026-11-11','Brief sent','Tara Desai','@oliveandearth'],['d3','a3','A weekend outside · Instagram Reel','2026-11-13','Draft due','Rohan Kapoor','@northstar'],['d4','a4','Meet the maker · Instagram Reel','2026-11-17','Brief sent','Meera Iyer','@formstudio']]) run('INSERT INTO deliverables VALUES(?,?,?,?,?,?,?)',...d);
 run('INSERT INTO shortlists VALUES(?,?)','b_olive','c_asha');
 const payload={items:[{label:'Instagram Reel · Asha Mehta',quantity:2,unit_price:2500000,creator_id:'c_asha'},{label:'Creative direction & campaign management',quantity:1,unit_price:1500000}],terms:'50% deposit, balance within 15 days of delivery. Two revision rounds included.',rights:'Organic Instagram use in India for 90 days. Paid usage and exclusivity excluded.',expires:'2026-11-30'};
 run('INSERT INTO proposals VALUES(?,?,?,?,?,?)','p_1','b_olive','l_1','Everyday rituals · Creator partnership','Sent',now());
 run('INSERT INTO proposal_versions VALUES(?,?,?,?,?,?)','pv_1','p_1',1,JSON.stringify(payload),6500000,now());
 activity('b_olive','Naina Sharma','Shared a creator partnership proposal with Olive & Earth');
 activity('b_north','Rohan Kapoor','Received the brief for Out of office');
 activity('b_form','Abhinav','Created Objects with a story');
});
if(process.env.DEMO_MODE!=='1'&&row("SELECT id FROM users WHERE id IN ('u_owner','u_manager','u_reviewer','u_finance','u_brand','u_other','u_creator') LIMIT 1"))throw new Error('Production startup refused: this database contains shared demonstration identities. Configure a fresh DB_PATH and UPLOAD_PATH or perform a reviewed migration; source records were not deleted.');
class APIError extends Error { constructor(status,message){super(message);this.status=status;} }
const requireThat=(condition,status,message)=>{if(!condition)throw new APIError(status,message);};
const staff=u=>['owner','manager','reviewer','finance'].includes(u.role);
const sales=u=>['owner','manager'].includes(u.role);
const money=u=>['owner','finance'].includes(u.role);
function accessBrand(u,brand){requireThat(staff(u)||(u.role==='brand'&&u.brand_id===brand),403,'You do not have access to this brand.');}
function textField(v,name,max=5000){requireThat(typeof v==='string'&&v.trim().length>0&&v.length<=max,400,`${name} is required (maximum ${max} characters).`);return v.trim();}
const catalog=createCatalog({db,row,rows,run,id,now,transaction,requireThat,textField,send,body});
const publicCreators=(options)=>catalog.publicCreators(options);
const hash=s=>createHash('sha256').update(s).digest('hex');
function session(req){const verified=identity.session(req);if(verified)return verified;if(process.env.DEMO_MODE!=='1')return null;const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('voqro_session='))?.split('=')[1];if(!token)return null;const u=row('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?',hash(token),Date.now());return u&&identity.isDemoUser(u.id)?u:null;}
function send(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));}
async function body(req){let data='';for await(const chunk of req){data+=chunk;requireThat(data.length<100000,413,'Request is too large.');}try{return JSON.parse(data||'{}');}catch{throw new APIError(400,'Invalid JSON.');}}
const campaignPacks=createCampaignPacks({db,send,requireThat});
const delivery=createDelivery({db,row,rows,run,id,now,transaction,requireThat,textField,send,body,activity,dbPath});
export const operations=createOperations({db,row,rows,run,id,now,transaction,requireThat,textField,send,body,activity,delivery});
const commerce=createCommerce({db,row,rows,run,id,now,transaction,requireThat,textField,send,body});
const identity=createIdentity({db,row,rows,run,id,now,transaction,requireThat,textField,send,body});
const optimization=createOptimization({db,row,rows,run,id,now,transaction,requireThat,textField,send,body});
const reporting=createReporting({db,row,rows,run,id,now,transaction,requireThat,textField,send,body});
export const cloud=createCloud({db,row,rows,run,id,now,transaction,requireThat,textField,send,body,delivery});
delivery.analysisFor=cloud.analysisFor;
export const instagram=createInstagram({db,row,rows,run,id,now,transaction,requireThat,textField,send,body,delivery,operations,mediaURL:cloud.publishingMedia});
export const workflow=createWorkflow({db,row,rows,run,id,now,transaction,requireThat,textField,send,body,delivery,connectionVerified:versionId=>{
 const v=row('SELECT package_json,deliverable_id FROM content_versions WHERE id=?',versionId);if(!v)return false;
 const p=JSON.parse(v.package_json),brand=row('SELECT c.brand_id FROM campaigns c JOIN assignments a ON a.campaign_id=c.id JOIN deliverables d ON d.assignment_id=a.id WHERE d.id=?',v.deliverable_id);
 return !!row("SELECT id FROM instagram_connections WHERE brand_id=? AND status='Connected' AND (expires_at IS NULL OR expires_at>?) AND LOWER(username)=?",brand?.brand_id||'',Date.now(),String(p.account||'').replace(/^@/,'').toLowerCase());
}});
export const notifications=createNotifications({db,row,rows,run,id,now,transaction,requireThat,textField,send,body,workflow});
function connectionState(u){const visible=u.role==='brand'?[u.brand_id]:u.role==='creator'?rows('SELECT DISTINCT c.brand_id FROM campaigns c JOIN assignments a ON a.campaign_id=c.id WHERE a.creator_id=?',u.creator_id).map(c=>c.brand_id):rows('SELECT id FROM brands').map(b=>b.id);const connected=rows("SELECT brand_id,expires_at FROM instagram_connections WHERE status='Connected'").filter(c=>visible.includes(c.brand_id)&&(!c.expires_at||c.expires_at>Date.now())).length;const cloudState=cloud.status();if(!['owner','manager'].includes(u.role)){delete cloudState.monthly_limit_cents;delete cloudState.reservation_cents;}return {...(u.role==='owner'?{backups:backupStatus()}:{}),identity:identity.publicConfig(),cloud:cloudState,instagram:{...instagram.status(),connected_accounts:connected},notifications:{in_app:'Available',email:notifications.status().enabled?'Enabled for owner-queued notifications':notifications.status().configured?'Configured; sending disabled':'Not configured'},payments:'Manual records; payment provider not connected',signing:'Operational acknowledgements; signing provider not connected'};}

export const salesAssistant=createSalesAssistant({db,row,rows,run,id,now,transaction,requireThat,textField,send,body});

const requestGuards=createRequestGuards({db});
async function api(req,res,path){
 if(!['GET','HEAD'].includes(req.method)){
  const origin=req.headers.origin;
  requireThat(!origin||origin===(process.env.APP_BASE_URL?new URL(process.env.APP_BASE_URL).origin:`${req.socket.encrypted?'https':'http'}://${req.headers.host}`),403,'Cross-origin requests are not allowed.');
  requireThat((req.headers['content-type']||'').includes(path.includes('/chunks/')?'application/octet-stream':'application/json'),415,'Use the required request content type.');
 }
 if(req.method==='GET'&&path==='/api/identity/start')requestGuards.check(req,'auth');
 if(req.method==='POST'&&(path.startsWith('/api/identity/password/')||path.startsWith('/api/identity/clerk/')))requestGuards.check(req,'auth');
 if(await identity.handlePublic(req,res,path))return;
 if(await instagram.handlePublic(req,res,path))return;
 if(path==='/api/health')return send(res,200,{ok:true,database:'sqlite',demo:process.env.DEMO_MODE==='1'});
 if(path==='/api/public'&&req.method==='GET')return send(res,200,{creators:publicCreators(),content:catalog.content(),identity:identity.publicConfig(),demo:process.env.DEMO_MODE==='1'&&identity.isDemoUser('u_owner')});
 if(path==='/api/enquiries'&&req.method==='POST'){
  requestGuards.check(req,'enquiry');
  const b=await body(req);const name=textField(b.name,'Name',120), email=textField(b.email,'Email',200),company=textField(b.company,'Company',160),brief=textField(b.brief,'Brief');
  requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),400,'Enter a valid email address.');
  const budget=Number(b.budget);requireThat(Number.isSafeInteger(budget)&&budget>0&&budget<=10000000000,400,'Enter a valid budget.');
  const leadId=id('lead');run('INSERT INTO leads VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',leadId,null,name,email,company,brief,budget,'Enquiry','Unassigned',null,'Website',now());return send(res,201,{id:leadId});
 }
 if(path==='/api/login'&&req.method==='POST'){
  requestGuards.check(req,'auth');
  requireThat(process.env.DEMO_MODE==='1',403,'Demo sign-in is disabled. Production identity integration is not configured.');
  const b=await body(req);const u=row('SELECT * FROM users WHERE id=?',b.user_id);requireThat(u&&identity.isDemoUser(u.id),400,'Select an available demonstration workspace. Production identities cannot use demo sign-in.');
  const token=randomBytes(32).toString('hex');run('INSERT INTO sessions VALUES(?,?,?)',hash(token),u.id,Date.now()+86400000);
  return send(res,200,{user:u},{'Set-Cookie':`voqro_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.COOKIE_SECURE==='1'?'; Secure':''}`});
 }
 await identity.prepare(req);
 const u=session(req);requireThat(u,401,'Sign in to open your workspace.');
 // Keep personal-account access before every business module; all other routes fail closed.
 if(u.role==='member'){
  if(path==='/api/logout'&&req.method==='POST')return identity.logout(req,res);
  if(path==='/api/workspace'&&req.method==='GET')return send(res,200,{user:u,demo:false,connections:{identity:identity.publicConfig()},brands:[],creators:[],campaigns:[],assignments:[],deliverables:[],proposals:[],activities:[],leads:[],shortlists:[],finance:null});
  requireThat(false,403,'This account does not have access to agency business records.');
 }
 if(await identity.handleAuthed(req,res,path,u))return;
 if(await salesAssistant.handler(req,res,path,u))return;
 if(await notifications.handler(req,res,path,u))return;
 if(await optimization.handler(req,res,path,u))return;
 if(await workflow.handler(req,res,path,u))return;
 if(await reporting.handler(req,res,path,u))return;
 if(await cloud.handler(req,res,path,u))return;
 if(await instagram.handler(req,res,path,u))return;
 if(path==='/api/connections'&&req.method==='GET')return send(res,200,connectionState(u));
 if(await campaignPacks.handler(req,res,path,u))return;
 if(await catalog.handler(req,res,path,u))return;
 if(await commerce(req,res,path,u))return;
 if(await operations.handler(req,res,path,u))return;
 if(await delivery(req,res,path,u))return;
 if(path==='/api/logout'&&req.method==='POST')return identity.logout(req,res);
 if(path==='/api/workspace'&&req.method==='GET'){
  const brands=u.role==='brand'?rows('SELECT * FROM brands WHERE id=?',u.brand_id):u.role==='creator'?rows('SELECT DISTINCT b.* FROM brands b JOIN campaigns c ON c.brand_id=b.id JOIN assignments a ON a.campaign_id=c.id WHERE a.creator_id=?',u.creator_id):rows('SELECT * FROM brands');
  let campaigns=u.role==='brand'?rows('SELECT * FROM campaigns WHERE brand_id=?',u.brand_id):u.role==='creator'?rows('SELECT DISTINCT c.* FROM campaigns c JOIN assignments a ON a.campaign_id=c.id WHERE a.creator_id=?',u.creator_id):rows('SELECT * FROM campaigns');
  campaigns=campaigns.map(c=>({...c,has_campaign_pack:!!row('SELECT campaign_id FROM campaign_reference_packs WHERE campaign_id=?',c.id)}));
  const assignments=u.role==='creator'?rows('SELECT * FROM assignments WHERE creator_id=?',u.creator_id):rows('SELECT a.* FROM assignments a JOIN campaigns c ON c.id=a.campaign_id'+(u.role==='brand'?' WHERE c.brand_id=?':''),...(u.role==='brand'?[u.brand_id]:[]));
  const allowed=new Set(assignments.map(a=>a.id));const deliverables=rows('SELECT * FROM deliverables').filter(d=>allowed.has(d.assignment_id)).map(d=>{const assignment=assignments.find(a=>a.id===d.assignment_id),latest=delivery.context.latestVersion(d.id),published=row('SELECT source,version_id FROM live_posts WHERE deliverable_id=?',d.id);const verified=latest&&published?.version_id===latest.id&&row("SELECT id FROM instagram_jobs WHERE deliverable_id=? AND version_id=? AND state='Verified'",d.id,latest.id);return {...d,status:verified?'Published':latest&&published?.version_id===latest.id?'Reported live':delivery.context.currentStatus({...d,campaign_id:assignment.campaign_id})};});
  const approvedCreators=publicCreators(),assignedCreatorIds=new Set(assignments.map(a=>a.creator_id));const workspaceCreators=staff(u)?publicCreators({all:true}):publicCreators({all:true}).filter(c=>approvedCreators.some(p=>p.id===c.id)||assignedCreatorIds.has(c.id)||(u.role==='creator'&&u.creator_id===c.id));
  if(u.role==='creator')campaigns=campaigns.map(({budget,proposal_id,accepted_version_id,...c})=>c);
  const proposals=(staff(u)?rows('SELECT * FROM proposals'):u.role==='brand'?rows('SELECT * FROM proposals WHERE brand_id=?',u.brand_id):[]).map(p=>({...p,versions:rows('SELECT * FROM proposal_versions WHERE proposal_id=? ORDER BY version DESC',p.id).map(v=>({...v,payload:JSON.parse(v.payload)}))}));
  const activities=u.role==='creator'?[]:staff(u)?rows('SELECT * FROM activities ORDER BY created DESC LIMIT 20'):rows('SELECT * FROM activities WHERE brand_id=? ORDER BY created DESC LIMIT 20',u.brand_id);
  return send(res,200,{user:u,demo:process.env.DEMO_MODE==='1',connections:connectionState(u),brands,creators:workspaceCreators,campaigns,assignments,deliverables,proposals,activities,leads:sales(u)?rows('SELECT * FROM leads ORDER BY created DESC'):[],shortlists:u.role==='brand'?rows('SELECT * FROM shortlists WHERE brand_id=?',u.brand_id):staff(u)?rows('SELECT * FROM shortlists'):[],finance:money(u)?{campaign_budgets:campaigns.reduce((s,c)=>s+c.budget,0),committed_creator_fees:rows('SELECT SUM(cr.fee) AS total FROM assignments a JOIN creators cr ON cr.id=a.creator_id')[0].total||0,currency:'INR',invoices_connected:false}:null});
 }
 if(path==='/api/shortlist'&&req.method==='POST'){
  const b=await body(req);accessBrand(u,b.brand_id);requireThat(sales(u)||u.role==='brand',403,'Only brand and sales teams can edit shortlists.');requireThat(row('SELECT id FROM creators WHERE id=?',b.creator_id),404,'Creator not found.');requireThat(row('SELECT id FROM brands WHERE id=?',b.brand_id),404,'Brand not found.');
  if(b.remove)run('DELETE FROM shortlists WHERE brand_id=? AND creator_id=?',b.brand_id,b.creator_id);else run('INSERT OR IGNORE INTO shortlists VALUES(?,?)',b.brand_id,b.creator_id);
  return send(res,200,{ok:true});
 }
 if(path==='/api/leads/update'&&req.method==='POST'){
  requireThat(sales(u),403,'Sales access required.');const b=await body(req);requireThat(row('SELECT id FROM leads WHERE id=?',b.id),404,'Enquiry not found.');requireThat(['Enquiry','Qualified','Discovery','Proposal','Negotiation','Won','Lost'].includes(b.stage),400,'Invalid stage.');requireThat(!['Won','Proposal'].includes(b.stage),400,'Create a proposal or accept it to reach this stage.');
  run('UPDATE leads SET stage=? WHERE id=?',b.stage,b.id);return send(res,200,{ok:true});
 }
 if(path==='/api/proposals'&&req.method==='POST'){
  requireThat(sales(u),403,'Sales access required.');const b=await body(req);
  const lead=b.lead_id?row('SELECT * FROM leads WHERE id=?',b.lead_id):null;requireThat(!b.lead_id||lead,404,'Enquiry not found.');
  const title=textField(b.title,'Proposal title',180);
  requireThat(Array.isArray(b.items)&&b.items.length>0&&b.items.length<=30,400,'Add between 1 and 30 line items.');
  const items=b.items.map(it=>{const label=textField(it.label,'Line item',200),quantity=Number(it.quantity),unit_price=Number(it.unit_price);requireThat(Number.isInteger(quantity)&&quantity>0&&quantity<=100&&Number.isSafeInteger(unit_price)&&unit_price>0&&unit_price<=1000000000,400,'Line items need positive quantities and prices.');if(it.creator_id)requireThat(row('SELECT id FROM creators WHERE id=?',it.creator_id),400,'Unknown creator.');return {label,quantity,unit_price,creator_id:it.creator_id||null};});
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(b.expires)&&!isNaN(Date.parse(b.expires))&&b.expires>=now().slice(0,10),400,'Choose a future expiry date.');
  const payload={title,items,terms:textField(b.terms,'Payment terms',2000),rights:textField(b.rights,'Usage rights',2000),expires:b.expires};const total=items.reduce((s,i)=>s+i.quantity*i.unit_price,0);requireThat(Number.isSafeInteger(total)&&total<=10000000000,400,'Proposal total is too large.');
  const result=transaction(()=>{
   let brand=b.brand_id||lead?.brand_id;
   if(lead?.brand_id)requireThat(brand===lead.brand_id,400,'Use the brand associated with this enquiry.');
   if(!brand&&lead){brand=id('brand');run('INSERT INTO brands VALUES(?,?,?,?)',brand,lead.company,'New partner','#c5b5a0');run('UPDATE leads SET brand_id=? WHERE id=?',brand,lead.id);}
   requireThat(row('SELECT id FROM brands WHERE id=?',brand||''),400,'Choose a brand or enquiry.');
   if(lead&&!lead.brand_id)run('UPDATE leads SET brand_id=? WHERE id=?',brand,lead.id);
   let proposalId=b.proposal_id;
   if(proposalId){const existing=row('SELECT * FROM proposals WHERE id=?',proposalId);requireThat(existing&&existing.brand_id===brand,404,'Proposal not found.');requireThat(existing.status!=='Accepted',409,'Accepted proposals cannot be changed.');run('UPDATE proposals SET title=?,status=? WHERE id=?',title,'Sent',proposalId);}
   else {proposalId=id('proposal');run('INSERT INTO proposals VALUES(?,?,?,?,?,?)',proposalId,brand,lead?.id||null,title,'Sent',now());}
   const version=(row('SELECT MAX(version) AS v FROM proposal_versions WHERE proposal_id=?',proposalId).v||0)+1;
   run('INSERT INTO proposal_versions VALUES(?,?,?,?,?,?)',id('pv'),proposalId,version,JSON.stringify(payload),total,now());
   if(lead)run('UPDATE leads SET stage=? WHERE id=?','Proposal',lead.id);
   activity(brand,u.name,`Shared version ${version} of ${title}`);return {id:proposalId,version};
  });return send(res,201,result);
 }
 if(path==='/api/proposals/accept'&&req.method==='POST'){
  requireThat(u.role==='brand',403,'The brand must accept its own proposal.');const b=await body(req);const p=row('SELECT * FROM proposals WHERE id=?',b.id);requireThat(p,404,'Proposal not found.');accessBrand(u,p.brand_id);
  const result=transaction(()=>{
   const existing=row('SELECT id FROM campaigns WHERE proposal_id=?',p.id);if(existing)return {campaign_id:existing.id,already_accepted:true};
   const v=row('SELECT * FROM proposal_versions WHERE proposal_id=? ORDER BY version DESC LIMIT 1',p.id);requireThat(v&&v.id===b.version_id,409,'A newer proposal is available. Refresh before accepting.');const payload=JSON.parse(v.payload);requireThat(payload.expires>=now().slice(0,10),409,'This proposal has expired. Ask your account manager for a new version.');
   const campaign=id('campaign');run('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?,?,?,?)',campaign,p.brand_id,p.id,v.id,payload.title||p.title,v.total,'Planning',now().slice(0,10),null,'Campaign created from the accepted proposal. Set delivery dates and prepare the campaign brief to begin.');
   for(const item of payload.items.filter(i=>i.creator_id)){let a=row('SELECT id FROM assignments WHERE campaign_id=? AND creator_id=?',campaign,item.creator_id)?.id;if(!a){a=id('assignment');run('INSERT INTO assignments VALUES(?,?,?)',a,campaign,item.creator_id);}for(let n=0;n<item.quantity;n++)run('INSERT INTO deliverables VALUES(?,?,?,?,?,?,?)',id('deliverable'),a,item.label+(item.quantity>1?` · ${n+1}`:''),null,'Brief needed',row('SELECT name FROM creators WHERE id=?',item.creator_id).name,'Not assigned');}
   run('UPDATE proposals SET status=? WHERE id=?','Accepted',p.id);if(p.lead_id)run('UPDATE leads SET stage=? WHERE id=?','Won',p.lead_id);activity(p.brand_id,u.name,`Accepted ${p.title} · version ${v.version}`);return {campaign_id:campaign};
  });return send(res,200,result);
 }
 throw new APIError(404,'This endpoint does not exist.');
}
export const app=express();
app.disable('x-powered-by');
app.set('trust proxy',false);
// Preserve raw request streams: upload chunks and the bounded JSON reader are
// consumed by their existing handlers, never by a global body parser.
app.use((req,res,next)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');const cloudConnect=process.env.AWS_MEDIA_ENABLED==='1'&&/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(process.env.AWS_MEDIA_BUCKET||'')?` https://${process.env.AWS_MEDIA_BUCKET}.s3.ap-south-1.amazonaws.com`:'';res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'"+cloudConnect+"; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
 next();
});
app.use('/api',async(req,res)=>api(req,res,new URL(req.originalUrl,'http://localhost').pathname));
app.use((req,res)=>{
  const path=new URL(req.originalUrl,'http://localhost').pathname;
  requireThat(req.method==='GET'||req.method==='HEAD',405,'Method not allowed.');const allowed={'/':'index.html','/app.js':'app.js','/delivery.js':'delivery.js','/operations.js':'operations.js','/commerce.js':'commerce.js','/catalog.js':'catalog.js','/identity.js':'identity.js','/optimization.js':'optimization.js','/workflow.js':'workflow.js','/reporting.js':'reporting.js','/cloud.js':'cloud.js','/instagram.js':'instagram.js','/notifications.js':'notifications.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};const file=allowed[path]||(/^\/art\/[a-z]+\.svg$/.test(path)?path.slice(1):null);requireThat(file,404,'Page not found.');const data=readFileSync(resolve(root,'public',file));res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'})[extname(file)]});res.end(req.method==='HEAD'?undefined:data);
});
app.use((e,req,res,next)=>{if(res.headersSent)return next(e);if(!e.status)console.error(e);send(res,e.status||500,{error:e.status?e.message:'Something went wrong. Please retry.'},e.headers||{});});
export const server=http.createServer(app);
server.on('close',()=>{salesAssistant.stop();operations.stop();workflow.stop();cloud.stop();instagram.stop();notifications.stop();});
if(process.env.NODE_ENV!=='test'){salesAssistant.start();operations.start();workflow.start();cloud.start();instagram.start();notifications.start();server.listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0',()=>console.log(`Voqro listening on port ${process.env.PORT||3000}. Demo access ${process.env.DEMO_MODE==='1'?'enabled':'disabled'}.`));}
