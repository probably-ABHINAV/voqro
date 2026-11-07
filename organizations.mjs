// Clerk organizations are flat. Voqro owns the explicit agency -> brand/creator
// hierarchy and business grants; neither names nor client metadata confer access.
export function createOrganizations({db, api, issuer, call = fn => fn()}) {
  const row = (sql,...args) => db.prepare(sql).get(...args);
  const rows = (sql,...args) => db.prepare(sql).all(...args);
  const run = (sql,...args) => db.prepare(sql).run(...args);
  const check = (ok,status,message) => {if(!ok)throw Object.assign(Error(message),{status});};
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_org_config(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS workspace_organizations(id TEXT PRIMARY KEY,issuer TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('agency','brand','creator')),entity_id TEXT NOT NULL,parent_id TEXT REFERENCES workspace_organizations(id),name TEXT NOT NULL,created TEXT NOT NULL,UNIQUE(issuer,kind,entity_id));
    CREATE TABLE IF NOT EXISTS workspace_org_members(organization_id TEXT NOT NULL REFERENCES workspace_organizations(id),user_id TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL,PRIMARY KEY(organization_id,user_id));
    CREATE TABLE IF NOT EXISTS workspace_org_enrollments(user_id TEXT PRIMARY KEY REFERENCES users(id),organization_id TEXT NOT NULL REFERENCES workspace_organizations(id),invited_by TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS clerk_session_organizations(token TEXT PRIMARY KEY REFERENCES identity_sessions(token) ON DELETE CASCADE,organization_id TEXT NOT NULL REFERENCES workspace_organizations(id));
  `);
  const enabled = () => row('SELECT enabled FROM workspace_org_config WHERE id=1')?.enabled === 1;
  const members = () => rows("SELECT u.*,c.subject FROM users u JOIN identity_accounts a ON a.user_id=u.id JOIN clerk_bindings c ON c.user_id=u.id AND c.email=a.email WHERE a.status='Active' AND c.issuer=?",issuer);
  const organization = id => row('SELECT * FROM workspace_organizations WHERE id=? AND issuer=?',id,issuer);
  const root = () => row("SELECT * FROM workspace_organizations WHERE issuer=? AND kind='agency' AND entity_id='voqro'",issuer);
  const staff = u => ['owner','manager','reviewer','finance'].includes(u.role);
  function scope(user,orgId) {
    const org=organization(orgId);
    check(org && row('SELECT user_id FROM workspace_org_members WHERE organization_id=? AND user_id=?',orgId,user.id),403,'You do not have access to this organization. Ask the agency owner.');
    check(org.kind==='agency' ? org.entity_id==='voqro' && !org.parent_id && staff(user) : org.parent_id===root()?.id,403,'This workspace hierarchy is unavailable.');
    if(org.kind==='brand') check(row('SELECT id FROM brands WHERE id=?',org.entity_id),403,'Brand workspace is unavailable.');
    if(org.kind==='creator') check(row('SELECT id FROM creators WHERE id=?',org.entity_id),403,'Creator workspace is unavailable.');
    return {...user,role:org.kind==='agency'?user.role:org.kind,brand_id:org.kind==='brand'?org.entity_id:null,creator_id:org.kind==='creator'?org.entity_id:null,organization:{id:org.id,name:org.name,kind:org.kind,parent_id:org.parent_id}};
  }
  function defaultOrganization(user) {
    const kind=staff(user)?'agency':user.role,entity=staff(user)?'voqro':user.brand_id||user.creator_id;
    const org=row('SELECT o.id FROM workspace_organizations o JOIN workspace_org_members m ON m.organization_id=o.id WHERE o.issuer=? AND o.kind=? AND o.entity_id=? AND m.user_id=?',issuer,kind,entity,user.id);
    check(org,403,'Your organization access is not ready. Ask the agency owner to sync team access.');return org.id;
  }
  async function verifyMembership(subject,orgId) {
    const result=await call(()=>api().organizations.getOrganizationMembershipList({organizationId:orgId,userId:[subject],limit:10}));
    check(result.data.some(m=>m.organization.id===orgId && m.publicUserData?.userId===subject),403,'Your Clerk organization membership has ended. Choose an available workspace.');
  }
  async function authorize(user,subject,orgId) {scope(user,orgId);await verifyMembership(subject,orgId);return scope(user,orgId);}
  function list(user) {
    return rows('SELECT o.* FROM workspace_organizations o JOIN workspace_org_members m ON m.organization_id=o.id WHERE m.user_id=? AND o.issuer=? ORDER BY CASE o.kind WHEN \'agency\' THEN 0 ELSE 1 END,o.name',user.id,issuer).filter(o=>{try{scope(user,o.id);return true;}catch{return false;}});
  }
  async function grant(orgId,userId,actorId) {
    if(actorId)check(members().some(u=>u.id===actorId&&u.role==='owner'),403,'An active agency owner is required.');
    const org=organization(orgId), user=members().find(u=>u.id===userId);
    check(org&&user,404,'Organization or active Clerk-linked member not found.');
    check(org.kind!=='agency'||staff(user),400,'Client and creator accounts cannot join the agency workspace.');
    const memberships=await call(()=>api().organizations.getOrganizationMembershipList({organizationId:orgId,userId:[user.subject],limit:10}));
    const existing=memberships.data.find(m=>m.publicUserData?.userId===user.subject&&m.organization.id===orgId),role=user.role==='owner'?'org:admin':'org:member';
    if(!existing)await call(()=>api().organizations.createOrganizationMembership({organizationId:orgId,userId:user.subject,role}));
    else if(existing.role!==role)await call(()=>api().organizations.updateOrganizationMembership({organizationId:orgId,userId:user.subject,role}));
    // Recheck local membership after asynchronous provider operations.
    check(members().some(u=>u.id===user.id&&u.subject===user.subject&&u.role===user.role&&u.brand_id===user.brand_id&&u.creator_id===user.creator_id),409,'Membership changed. Retry after reviewing team access.');
    if(actorId)check(members().some(u=>u.id===actorId&&u.role==='owner'),403,'Owner access changed.');
    run('INSERT OR IGNORE INTO workspace_org_members VALUES(?,?,?)',orgId,userId,new Date().toISOString());
  }
  async function provision({kind,entityId,actorId,existingOrganizationId}) {
    const actor=members().find(u=>u.id===actorId&&u.role==='owner');check(actor,403,'An active agency owner is required.');
    check(['agency','brand','creator'].includes(kind),400,'Choose an agency, brand or creator workspace.');
    const entity=kind==='agency'?{id:'voqro',name:'Voqro'}:row(`SELECT id,name FROM ${kind==='brand'?'brands':'creators'} WHERE id=?`,entityId);
    check(entity,404,'Create the brand or creator record before its organization.');
    const parent=kind==='agency'?null:root();check(kind==='agency'||parent,409,'Set up the agency organization first.');
    let org=row('SELECT * FROM workspace_organizations WHERE issuer=? AND kind=? AND entity_id=?',issuer,kind,entity.id);
    const provenance={source:'voqro-organizations-v1',issuer,kind,entityId:entity.id,parentId:parent?.id||null};
    if(!org){
      let remote;
      if(existingOrganizationId){
        check(kind==='agency',400,'Only the initial agency can adopt an existing organization.');
        remote=await call(()=>api().organizations.getOrganization({organizationId:existingOrganizationId}));
        const membership=await call(()=>api().organizations.getOrganizationMembershipList({organizationId:remote.id,userId:[actor.subject],limit:10}));
        check(membership.data.some(m=>m.publicUserData?.userId===actor.subject&&m.role==='org:admin'),403,'The owner must already administer the organization being connected.');
        const prior=remote.privateMetadata?.voqroWorkspace;
        check(!prior||Object.entries(provenance).every(([k,v])=>prior[k]===v),409,'This organization is already mapped elsewhere.');
        await call(()=>api().organizations.updateOrganizationMetadata(remote.id,{privateMetadata:{voqroWorkspace:provenance}}));
        await call(()=>api().organizations.updateOrganization(remote.id,{name:entity.name,adminDeleteEnabled:false}));
      }else{
        // Resume only our own provider-side write after a partial failure.
        let offset=0;
        do {const page=await call(()=>api().organizations.getOrganizationList({limit:100,offset}));remote=page.data.find(o=>{const p=o.privateMetadata?.voqroWorkspace;return p?.source===provenance.source&&p.issuer===issuer&&p.kind===kind&&p.entityId===entity.id&&p.parentId===provenance.parentId;});offset+=page.data.length;if(remote||offset>=page.totalCount)break;check(page.data.length,503,'Organization listing was incomplete.');}while(true);
        if(!remote)remote=await call(()=>api().organizations.createOrganization({name:entity.name,createdBy:actor.subject,privateMetadata:{voqroWorkspace:provenance}}));
      }
      await call(()=>api().organizations.updateOrganization(remote.id,{adminDeleteEnabled:false}));
      check(members().some(u=>u.id===actorId&&u.role==='owner'),403,'Owner access changed during provisioning.');
      run('INSERT INTO workspace_organizations VALUES(?,?,?,?,?,?,?)',remote.id,issuer,kind,entity.id,parent?.id||null,entity.name,new Date().toISOString());org=organization(remote.id);
    }
    const targets=members().filter(u=>u.role==='owner'||(kind==='agency'?staff(u):kind==='brand'?u.role==='brand'&&u.brand_id===entity.id:u.role==='creator'&&u.creator_id===entity.id));
    for(const target of targets)await grant(org.id,target.id,actorId);
    return org;
  }
  function invitationOrganization(membership) {
    const kind=staff(membership)?'agency':membership.role,entity=staff(membership)?'voqro':membership.brand_id||membership.creator_id;
    const org=row('SELECT id FROM workspace_organizations WHERE issuer=? AND kind=? AND entity_id=?',issuer,kind,entity);
    check(org,409,'Create this workspace in Organizations before inviting its members.');return org.id;
  }
  function queueInvitation(userId,invite){if(enabled())run('INSERT INTO workspace_org_enrollments VALUES(?,?,?)',userId,invitationOrganization(invite),invite.created_by);}
  async function enroll(userId){const pending=row('SELECT * FROM workspace_org_enrollments WHERE user_id=?',userId);if(!pending)return;await grant(pending.organization_id,userId,pending.invited_by);run('DELETE FROM workspace_org_enrollments WHERE user_id=?',userId);}
  function activate(){for(const user of members())defaultOrganization(user);check(root(),409,'Agency organization is missing.');run('INSERT INTO workspace_org_config VALUES(1,1) ON CONFLICT(id) DO UPDATE SET enabled=1');}
  return {enabled,scope,defaultOrganization,authorize,list,provision,grant,activate,root,organization,members,invitationOrganization,queueInvitation,enroll};
}
