import {randomUUID} from 'node:crypto';
// Workspaces belong to Voqro. Clerk supplies identity only; organization claims
// and provider organization membership have no influence on business access.
export function createOrganizations({db, issuer}) {
  const row=(sql,...args)=>db.prepare(sql).get(...args),rows=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  const check=(ok,status,message)=>{if(!ok)throw Object.assign(Error(message),{status});};
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_org_config(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS workspace_organizations(id TEXT PRIMARY KEY,issuer TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('agency','brand','creator')),entity_id TEXT NOT NULL,parent_id TEXT REFERENCES workspace_organizations(id),name TEXT NOT NULL,created TEXT NOT NULL,UNIQUE(issuer,kind,entity_id));
    CREATE TABLE IF NOT EXISTS workspace_org_members(organization_id TEXT NOT NULL REFERENCES workspace_organizations(id),user_id TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL,PRIMARY KEY(organization_id,user_id));
    CREATE TABLE IF NOT EXISTS workspace_org_enrollments(user_id TEXT PRIMARY KEY REFERENCES users(id),organization_id TEXT NOT NULL REFERENCES workspace_organizations(id),invited_by TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS clerk_session_organizations(token TEXT PRIMARY KEY REFERENCES identity_sessions(token) ON DELETE CASCADE,organization_id TEXT NOT NULL REFERENCES workspace_organizations(id));
  `);
  const enabled=()=>row('SELECT enabled FROM workspace_org_config WHERE id=1')?.enabled===1;
  const members=()=>rows("SELECT u.*,c.subject FROM users u JOIN identity_accounts a ON a.user_id=u.id JOIN clerk_bindings c ON c.user_id=u.id AND c.email=a.email WHERE a.status='Active' AND c.issuer=?",issuer);
  const organization=id=>row('SELECT * FROM workspace_organizations WHERE id=? AND issuer=?',id,issuer);
  const root=()=>row("SELECT * FROM workspace_organizations WHERE issuer=? AND kind='agency' AND entity_id='voqro'",issuer);
  const staff=u=>['owner','manager','reviewer','finance'].includes(u.role);
  const activeOwner=id=>members().some(u=>u.id===id&&u.role==='owner');
  function scope(user,orgId){
    const org=organization(orgId);
    check(org&&row("SELECT a.user_id FROM identity_accounts a JOIN workspace_org_members m ON m.user_id=a.user_id WHERE a.user_id=? AND a.status='Active' AND m.organization_id=?",user.id,orgId),403,'You do not have access to this workspace. Ask the agency owner.');
    check(org.kind==='agency'?org.entity_id==='voqro'&&!org.parent_id&&staff(user):org.parent_id===root()?.id,403,'This workspace hierarchy is unavailable.');
    if(org.kind!=='agency')check(row(`SELECT id FROM ${org.kind==='brand'?'brands':'creators'} WHERE id=?`,org.entity_id),403,'This workspace record is unavailable.');
    return {...user,role:org.kind==='agency'?user.role:org.kind,brand_id:org.kind==='brand'?org.entity_id:null,creator_id:org.kind==='creator'?org.entity_id:null,organization:{id:org.id,name:org.name,kind:org.kind,parent_id:org.parent_id}};
  }
  function defaultOrganization(user){
    const org=row('SELECT o.id FROM workspace_organizations o JOIN workspace_org_members m ON m.organization_id=o.id WHERE o.issuer=? AND o.kind=? AND o.entity_id=? AND m.user_id=?',issuer,staff(user)?'agency':user.role,staff(user)?'voqro':user.brand_id||user.creator_id,user.id);
    check(org,403,'Your workspace access is not ready. Ask the agency owner to sync team access.');scope(user,org.id);return org.id;
  }
  const authorize=async(user,_subject,orgId)=>scope(user,orgId);
  function list(user){return rows('SELECT o.* FROM workspace_organizations o JOIN workspace_org_members m ON m.organization_id=o.id WHERE m.user_id=? AND o.issuer=? ORDER BY CASE o.kind WHEN \'agency\' THEN 0 ELSE 1 END,o.name',user.id,issuer).filter(o=>{try{scope(user,o.id);return true;}catch{return false;}});}
  async function grant(orgId,userId,actorId){
    check(activeOwner(actorId),403,'An active agency owner is required.');const org=organization(orgId),user=members().find(u=>u.id===userId);
    check(org&&user,404,'Workspace or active member not found.');check(org.kind!=='agency'||staff(user),400,'Client and creator accounts cannot join the agency workspace.');
    run('INSERT OR IGNORE INTO workspace_org_members VALUES(?,?,?)',orgId,userId,new Date().toISOString());
  }
  async function provision({kind,entityId,actorId}){
    check(activeOwner(actorId),403,'An active agency owner is required.');check(['agency','brand','creator'].includes(kind),400,'Choose an agency, brand or creator workspace.');
    const entity=kind==='agency'?{id:'voqro',name:'Voqro'}:row(`SELECT id,name FROM ${kind==='brand'?'brands':'creators'} WHERE id=?`,entityId);check(entity,404,'Create the brand or creator record first.');
    const parent=kind==='agency'?null:root();check(kind==='agency'||parent,409,'Set up the agency workspace first.');
    let org=row('SELECT * FROM workspace_organizations WHERE issuer=? AND kind=? AND entity_id=?',issuer,kind,entity.id);
    if(!org){const key='workspace_'+randomUUID().replaceAll('-','');run('INSERT INTO workspace_organizations VALUES(?,?,?,?,?,?,?)',key,issuer,kind,entity.id,parent?.id||null,entity.name,new Date().toISOString());org=organization(key);}
    else{run('UPDATE workspace_organizations SET name=? WHERE id=?',entity.name,org.id);org=organization(org.id);}
    const targets=members().filter(u=>u.role==='owner'||(kind==='agency'?staff(u):kind==='brand'?u.role==='brand'&&u.brand_id===entity.id:u.role==='creator'&&u.creator_id===entity.id));
    for(const target of targets)await grant(org.id,target.id,actorId);
    return org;
  }
  function invitationOrganization(membership){
    const org=row('SELECT id FROM workspace_organizations WHERE issuer=? AND kind=? AND entity_id=?',issuer,staff(membership)?'agency':membership.role,staff(membership)?'voqro':membership.brand_id||membership.creator_id);
    check(org,409,'Create this workspace in Workspaces before inviting its members.');return org.id;
  }
  function queueInvitation(userId,invite){if(enabled())run('INSERT INTO workspace_org_enrollments VALUES(?,?,?)',userId,invitationOrganization(invite),invite.created_by);}
  async function enroll(userId){const pending=row('SELECT * FROM workspace_org_enrollments WHERE user_id=?',userId);if(!pending)return;await grant(pending.organization_id,userId,pending.invited_by);run('DELETE FROM workspace_org_enrollments WHERE user_id=?',userId);}
  function activate(){for(const user of members())defaultOrganization(user);check(root(),409,'Agency workspace is missing.');run('INSERT INTO workspace_org_config VALUES(1,1) ON CONFLICT(id) DO UPDATE SET enabled=1');}
  return {enabled,scope,defaultOrganization,authorize,list,provision,grant,activate,root,organization,members,invitationOrganization,queueInvitation,enroll};
}
