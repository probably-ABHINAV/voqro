import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createOrganizations} from '../organizations.mjs';
function fixture(t){
 const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,brand_id TEXT,creator_id TEXT);CREATE TABLE brands(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE creators(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE identity_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id),email TEXT,status TEXT);CREATE TABLE clerk_bindings(user_id TEXT,subject TEXT,email TEXT,issuer TEXT);CREATE TABLE identity_sessions(token TEXT PRIMARY KEY);INSERT INTO users VALUES('owner','Owner','owner',NULL,NULL),('manager','Manager','manager',NULL,NULL),('client','Client','brand','brand-a',NULL);INSERT INTO brands VALUES('brand-a','A'),('brand-b','B');`);
 for(const id of ['owner','manager','client']){db.prepare('INSERT INTO identity_accounts VALUES(?,?,?)').run(id,id+'@example.test','Active');db.prepare('INSERT INTO clerk_bindings VALUES(?,?,?,?)').run(id,'user_'+id,id+'@example.test','https://issuer.example');}
 const orgs=createOrganizations({db,issuer:'https://issuer.example',api:()=>{throw Error('Workspace operations must never call Clerk');}});t.after(()=>db.close());return {db,orgs};
}
test('one agency preserves staff, brand and creator roles without calling Clerk organizations',async t=>{
 const f=fixture(t),root=await f.orgs.provision({kind:'agency',actorId:'owner'});
 f.orgs.activate();assert.equal(f.orgs.enabled(),true);
 for(const role of ['owner','manager','brand']){
  const member=f.orgs.members().find(u=>u.role===role),scoped=f.orgs.scope(member,root.id);
  assert.equal(scoped.role,role);assert.equal(scoped.brand_id,member.brand_id);
  assert.equal(f.orgs.defaultOrganization(member),root.id);assert.deepEqual(f.orgs.list(member).map(o=>o.id),[root.id]);
 }
 f.db.exec("INSERT INTO creators VALUES('creator-a','Creator'); INSERT INTO users VALUES('creator','Creator','creator',NULL,'creator-a'); INSERT INTO identity_accounts VALUES('creator','creator@example.test','Active'); INSERT INTO clerk_bindings VALUES('creator','user_creator','creator@example.test','https://issuer.example')");
 await f.orgs.grant(root.id,'creator','owner');
 const creator=f.orgs.scope(f.orgs.members().find(u=>u.id==='creator'),root.id);
 assert.equal(creator.role,'creator');assert.equal(creator.creator_id,'creator-a');
 for(const kind of ['brand','creator'])await assert.rejects(()=>f.orgs.provision({kind,actorId:'owner'}),{status:400});
});
test('correction archives child scopes and migrates sessions without deleting business records',async t=>{
 const f=fixture(t),root=await f.orgs.provision({kind:'agency',actorId:'owner'});
 f.db.prepare('INSERT INTO workspace_organizations VALUES(?,?,?,?,?,?,?)').run('old-brand','https://issuer.example','brand','brand-a',root.id,'A','2026-01-01');
 f.db.exec("INSERT INTO identity_sessions VALUES('session'); INSERT INTO clerk_session_organizations VALUES('session','old-brand'); INSERT INTO workspace_org_enrollments VALUES('client','old-brand','owner')");
 const user=f.orgs.members().find(u=>u.id==='client');
 assert.throws(()=>f.orgs.scope(user,'old-brand'),{status:403});
 f.orgs.retireChildWorkspaces('owner');f.orgs.retireChildWorkspaces('owner');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM archived_workspace_records').get().n,1);
 assert.equal(f.db.prepare('SELECT organization_id FROM clerk_session_organizations').get().organization_id,root.id);
 assert.equal(f.db.prepare('SELECT organization_id FROM workspace_org_enrollments').get().organization_id,root.id);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM brands').get().n,2);
 assert.equal((await f.orgs.provision({kind:'agency',actorId:'owner'})).id,root.id);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM workspace_organizations').get().n,2);
});
test('owner authorization and active local membership are required',async t=>{
 const f=fixture(t);await assert.rejects(()=>f.orgs.provision({kind:'agency',actorId:'manager'}),{status:403});
 const root=await f.orgs.provision({kind:'agency',actorId:'owner'}),client=f.orgs.members().find(u=>u.id==='client');
 f.db.prepare("UPDATE identity_accounts SET status='Disabled' WHERE user_id='client'").run();assert.throws(()=>f.orgs.scope(client,root.id),{status:403});
 f.db.prepare("UPDATE identity_accounts SET status='Active' WHERE user_id='client'").run();
 f.db.prepare('DELETE FROM workspace_org_members WHERE user_id=?').run('client');assert.throws(()=>f.orgs.scope(client,root.id),{status:403});
});
