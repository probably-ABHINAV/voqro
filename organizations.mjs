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
  const activeOwner=id=>members().some(u=>u.id===id&&u.role==='owner');
  function scope(user,orgId){
    const org=organization(orgId);
    check(org&&org.kind==='agency'&&org.entity_id==='voqro'&&!org.parent_id,403,'Voqro is the only agency workspace. Open the brand or creator record within it.');
    check(row("SELECT a.user_id FROM identity_accounts a JOIN workspace_org_members m ON m.user_id=a.user_id WHERE a.user_id=? AND a.status='Active' AND m.organization_id=?",user.id,orgId),403,'Your agency access is unavailable. Contact the owner.');
    if(user.role==='brand')check(row('SELECT id FROM brands WHERE id=?',user.brand_id),403,'Your assigned brand is unavailable.');
    if(user.role==='creator')check(row('SELECT id FROM creators WHERE id=?',user.creator_id),403,'Your assigned creator record is unavailable.');
    // Agency membership does not promote clients: retain each user's exact
    // business role and brand/creator scope for all existing authorization.
    return {...user,organization:{id:org.id,name:org.name,kind:'agency',parent_id:null}};
  }
  function defaultOrganization(user){const org=root();check(org,403,'Agency access is not ready. Contact the owner.');scope(user,org.id);return org.id;}
  const authorize=async(user,_subject,orgId)=>scope(user,orgId);
  function list(user){const org=root();if(!org)return [];try{scope(user,org.id);return [org];}catch{return [];}}
  async function grant(orgId,userId,actorId){
    check(activeOwner(actorId),403,'An active agency owner is required.');const org=organization(orgId),user=members().find(u=>u.id===userId);
    check(org&&org.kind==='agency'&&org.entity_id==='voqro'&&!org.parent_id&&user,404,'Agency or active member not found.');
    run('INSERT OR IGNORE INTO workspace_org_members VALUES(?,?,?)',orgId,userId,new Date().toISOString());
  }
  async function provision({kind,actorId}){
    check(activeOwner(actorId),403,'An active agency owner is required.');check(kind==='agency',400,'Brands and creators are records within Voqro, not separate workspaces.');
    let org=root();
    if(!org){const key='workspace_'+randomUUID().replaceAll('-','');run('INSERT INTO workspace_organizations VALUES(?,?,?,?,?,?,?)',key,issuer,'agency','voqro',null,'Voqro',new Date().toISOString());org=organization(key);}
    for(const member of members())await grant(org.id,member.id,actorId);
    return org;
  }
  function invitationOrganization(){const org=root();check(org,409,'The agency has not been configured.');return org.id;}
  function retireChildWorkspaces(actorId){
    check(activeOwner(actorId)&&root(),403,'An active configured agency owner is required.');
    db.exec('CREATE TABLE IF NOT EXISTS archived_workspace_records(organization_id TEXT PRIMARY KEY REFERENCES workspace_organizations(id),archived_at TEXT NOT NULL,reason TEXT NOT NULL)');
    db.exec('BEGIN IMMEDIATE');
    try{
      for(const org of rows("SELECT id FROM workspace_organizations WHERE issuer=? AND kind!='agency'",issuer))run('INSERT OR IGNORE INTO archived_workspace_records VALUES(?,?,?)',org.id,new Date().toISOString(),'Agency structure correction: brand and creator records are not organizations.');
      run('UPDATE clerk_session_organizations SET organization_id=? WHERE organization_id IN (SELECT id FROM workspace_organizations WHERE issuer=?)',root().id,issuer);
      run('UPDATE workspace_org_enrollments SET organization_id=? WHERE organization_id IN (SELECT id FROM workspace_organizations WHERE issuer=?)',root().id,issuer);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function queueInvitation(userId,invite){if(enabled())run('INSERT INTO workspace_org_enrollments VALUES(?,?,?)',userId,invitationOrganization(invite),invite.created_by);}
  async function enroll(userId){const pending=row('SELECT * FROM workspace_org_enrollments WHERE user_id=?',userId);if(!pending)return;await grant(pending.organization_id,userId,pending.invited_by);run('DELETE FROM workspace_org_enrollments WHERE user_id=?',userId);}
  function activate(){for(const user of members())defaultOrganization(user);check(root(),409,'Agency workspace is missing.');run('INSERT INTO workspace_org_config VALUES(1,1) ON CONFLICT(id) DO UPDATE SET enabled=1');}
  return {enabled,scope,defaultOrganization,authorize,list,provision,grant,activate,root,organization,members,invitationOrganization,queueInvitation,enroll,retireChildWorkspaces};
}
