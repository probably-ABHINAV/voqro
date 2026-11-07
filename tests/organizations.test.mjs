import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createOrganizations} from '../organizations.mjs';
function fixture(t){
 const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,brand_id TEXT,creator_id TEXT);CREATE TABLE brands(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE creators(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE identity_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id),email TEXT,status TEXT);CREATE TABLE clerk_bindings(user_id TEXT,subject TEXT,email TEXT,issuer TEXT);CREATE TABLE identity_sessions(token TEXT PRIMARY KEY);INSERT INTO users VALUES('owner','Owner','owner',NULL,NULL),('manager','Manager','manager',NULL,NULL),('client','Client','brand','brand-a',NULL);INSERT INTO brands VALUES('brand-a','A'),('brand-b','B');`);
 for(const id of ['owner','manager','client']){db.prepare('INSERT INTO identity_accounts VALUES(?,?,?)').run(id,id+'@example.test','Active');db.prepare('INSERT INTO clerk_bindings VALUES(?,?,?,?)').run(id,'user_'+id,id+'@example.test','https://issuer.example');}
 const orgs=createOrganizations({db,issuer:'https://issuer.example',api:()=>{throw Error('Workspace operations must never call Clerk');}});t.after(()=>db.close());return {db,orgs};
}
test('backend provisions hierarchy and scoped memberships without a Clerk organization API',async t=>{
 const f=fixture(t),root=await f.orgs.provision({kind:'agency',actorId:'owner'}),brand=await f.orgs.provision({kind:'brand',entityId:'brand-a',actorId:'owner'});
 assert.match(root.id,/^workspace_/);assert.equal(brand.parent_id,root.id);f.orgs.activate();assert.equal(f.orgs.enabled(),true);
 const client=f.orgs.members().find(u=>u.id==='client'),manager=f.orgs.members().find(u=>u.id==='manager');
 assert.equal(f.orgs.defaultOrganization(client),brand.id);assert.equal(f.orgs.defaultOrganization(manager),root.id);
 assert.throws(()=>f.orgs.scope(client,root.id),{status:403});await assert.rejects(()=>f.orgs.grant(root.id,'client','owner'),{status:400});
 await f.orgs.grant(brand.id,'manager','owner');assert.equal((await f.orgs.authorize(manager,manager.subject,brand.id)).role,'brand');
});
test('provisioning retries keep workspace IDs and business records; names follow their records',async t=>{
 const f=fixture(t);await f.orgs.provision({kind:'agency',actorId:'owner'});const before=await f.orgs.provision({kind:'brand',entityId:'brand-a',actorId:'owner'});
 f.db.prepare('UPDATE brands SET name=? WHERE id=?').run('Renamed brand','brand-a');const after=await f.orgs.provision({kind:'brand',entityId:'brand-a',actorId:'owner'});
 assert.equal(after.id,before.id);assert.equal(after.name,'Renamed brand');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM workspace_organizations').get().n,2);
});
test('owner authorization, membership status and hierarchy are checked locally',async t=>{
 const f=fixture(t);await assert.rejects(()=>f.orgs.provision({kind:'agency',actorId:'manager'}),{status:403});
 await f.orgs.provision({kind:'agency',actorId:'owner'});const brand=await f.orgs.provision({kind:'brand',entityId:'brand-a',actorId:'owner'}),client=f.orgs.members().find(u=>u.id==='client');
 f.db.prepare("UPDATE identity_accounts SET status='Disabled' WHERE user_id='client'").run();assert.throws(()=>f.orgs.scope(client,brand.id),{status:403});
 f.db.prepare("UPDATE identity_accounts SET status='Active' WHERE user_id='client'").run();f.db.prepare('UPDATE workspace_organizations SET parent_id=NULL WHERE id=?').run(brand.id);assert.throws(()=>f.orgs.scope(client,brand.id),{status:403});
});
