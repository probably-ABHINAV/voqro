import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createOrganizations} from '../organizations.mjs';
function fixture(t){
 const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,brand_id TEXT,creator_id TEXT);CREATE TABLE brands(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE creators(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE identity_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id),email TEXT,status TEXT);CREATE TABLE clerk_bindings(user_id TEXT,subject TEXT,email TEXT,issuer TEXT);CREATE TABLE identity_sessions(token TEXT PRIMARY KEY);INSERT INTO users VALUES('owner','Owner','owner',NULL,NULL),('manager','Manager','manager',NULL,NULL),('client','Client','brand','brand-a',NULL);INSERT INTO brands VALUES('brand-a','A'),('brand-b','B');`);
 for(const id of ['owner','manager','client']){db.prepare('INSERT INTO identity_accounts VALUES(?,?,?)').run(id,id+'@example.test','Active');db.prepare('INSERT INTO clerk_bindings VALUES(?,?,?,?)').run(id,'user_'+id,id+'@example.test','https://issuer.example');}
 const remote=new Map(), memberships=new Map();let created=0,failNext=false;
 remote.set('org_root',{id:'org_root',name:'My Organization',privateMetadata:{existing:'kept'}});memberships.set('org_root',new Map([['user_owner','org:admin']]));
 const provider={organizations:{
  getOrganization:async({organizationId})=>remote.get(organizationId),
  getOrganizationList:async({limit,offset=0})=>({data:[...remote.values()].slice(offset,offset+limit),totalCount:remote.size}),
  getOrganizationMembershipList:async({organizationId,userId})=>({data:[...(memberships.get(organizationId)||[])].filter(([id])=>userId.includes(id)).map(([id,role])=>({organization:{id:organizationId},publicUserData:{userId:id},role}))}),
  updateOrganizationMetadata:async(id,{privateMetadata})=>{remote.get(id).privateMetadata={...remote.get(id).privateMetadata,...privateMetadata};},
  updateOrganization:async(id,body)=>{if(failNext){failNext=false;throw Error('provider write interrupted');}Object.assign(remote.get(id),body);},
  createOrganization:async body=>{const id='org_child'+(++created),org={id,...body};remote.set(id,org);memberships.set(id,new Map([[body.createdBy,'org:admin']]));return org;},
  updateOrganizationMembership:async({organizationId,userId,role})=>{memberships.get(organizationId).set(userId,role);},
  createOrganizationMembership:async({organizationId,userId,role})=>{memberships.get(organizationId).set(userId,role);},
 }};
 const orgs=createOrganizations({db,api:()=>provider,issuer:'https://issuer.example'});t.after(()=>db.close());return {db,remote,memberships,orgs,created:()=>created,fail:()=>{failNext=true;}};
}
test('organization setup adopts an owner-administered root and creates scoped child memberships',async t=>{
 const f=fixture(t);const root=await f.orgs.provision({kind:'agency',actorId:'owner',existingOrganizationId:'org_root'});assert.equal(root.name,'Voqro');assert.equal(f.remote.get(root.id).privateMetadata.existing,'kept');assert.equal(f.remote.get(root.id).adminDeleteEnabled,false);
 assert.equal(f.memberships.get(root.id).has('user_client'),false);assert.equal(f.memberships.get(root.id).get('user_manager'),'org:member');
 const brand=await f.orgs.provision({kind:'brand',entityId:'brand-a',actorId:'owner'});assert.equal(brand.parent_id,root.id);assert.equal(f.memberships.get(brand.id).has('user_client'),true);assert.equal(f.memberships.get(brand.id).has('user_manager'),false);
 f.orgs.activate();assert.equal(f.orgs.enabled(),true);
 const client=f.orgs.members().find(x=>x.id==='client');assert.equal(f.orgs.defaultOrganization(client),brand.id);assert.throws(()=>f.orgs.scope(client,root.id),{status:403});
 await assert.rejects(()=>f.orgs.grant(root.id,'client','owner'),{status:400});
});
test('partial provider creation resumes by private provenance without making duplicate organizations',async t=>{
 const f=fixture(t);await f.orgs.provision({kind:'agency',actorId:'owner',existingOrganizationId:'org_root'});f.fail();
 await assert.rejects(()=>f.orgs.provision({kind:'brand',entityId:'brand-a',actorId:'owner'}),/interrupted/);assert.equal(f.created(),1);
 await f.orgs.provision({kind:'brand',entityId:'brand-a',actorId:'owner'});assert.equal(f.created(),1);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM workspace_organizations WHERE kind='brand'").get().n,1);
});
test('only an active owner can provision; foreign root ownership and incorrect hierarchy are rejected',async t=>{
 const f=fixture(t);await assert.rejects(()=>f.orgs.provision({kind:'agency',actorId:'manager',existingOrganizationId:'org_root'}),{status:403});
 f.memberships.get('org_root').set('user_owner','org:member');await assert.rejects(()=>f.orgs.provision({kind:'agency',actorId:'owner',existingOrganizationId:'org_root'}),{status:403});
 f.memberships.get('org_root').set('user_owner','org:admin');await f.orgs.provision({kind:'agency',actorId:'owner',existingOrganizationId:'org_root'});
 const brand=await f.orgs.provision({kind:'brand',entityId:'brand-a',actorId:'owner'});f.db.prepare('UPDATE workspace_organizations SET parent_id=NULL WHERE id=?').run(brand.id);
 assert.throws(()=>f.orgs.scope(f.orgs.members()[0],brand.id),{status:403});
});
