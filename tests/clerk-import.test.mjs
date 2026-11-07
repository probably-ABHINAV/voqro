import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {migrateClerkUsers} from '../scripts/migrate-clerk-users.mjs';
const issuer='https://agency.example/__clerk',instanceId='ins_selected';
function fixture(t) {
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,brand_id TEXT,creator_id TEXT);
 CREATE TABLE identity_accounts(user_id TEXT PRIMARY KEY,email TEXT,issuer TEXT,status TEXT);
 CREATE TABLE clerk_bindings(user_id TEXT,issuer TEXT,subject TEXT,email TEXT,created TEXT,UNIQUE(user_id,issuer),UNIQUE(issuer,subject));
 CREATE TABLE identity_audit(id TEXT,actor_id TEXT,action TEXT,target_id TEXT,reason TEXT,created TEXT);
 INSERT INTO users VALUES('owner','Owner','owner',NULL,NULL),('brand','Brand','brand','brand-a',NULL);
 INSERT INTO identity_accounts VALUES('owner','owner@example.com','urn:voqro:password','Active'),('brand','brand@example.com','urn:voqro:password','Active');`);
 const users=new Map(),created=[];let onCreate;
 const client={instance:{get:async()=>({id:instanceId,environmentType:'production'})},users:{
  getUser:async id=>users.get(id),
  getUserList:async params=>({data:[...users.values()].filter(u=>params.emailAddress?u.emailAddresses.some(e=>params.emailAddress.includes(e.emailAddress)):params.externalId.includes(u.externalId))}),
  createUser:async params=>{created.push(params);const user={id:'user_'+params.externalId,externalId:params.externalId,privateMetadata:params.privateMetadata,primaryEmailAddressId:'email1',emailAddresses:[{id:'email1',emailAddress:params.emailAddress[0],verification:{status:'unverified'}}]};users.set(user.id,user);onCreate?.(params);return user;},
 }};
 return {db,users,created,client,onCreate:fn=>{onCreate=fn;},run:(apply=true)=>migrateClerkUsers({db,client,issuer,instanceId,apply})};
}
test('dry run is read-only; import preserves scopes, reserves emails and binds stable IDs without passwords',async t=>{
 const f=fixture(t),before=f.db.prepare('SELECT * FROM users ORDER BY id').all();
 assert.deepEqual(await f.run(false),{dryRun:true,members:2,create:2,alreadyBound:0});assert.equal(f.created.length,0);
 assert.deepEqual(await f.run(),{dryRun:false,members:2,created:2,bound:2});
 assert.deepEqual(f.db.prepare('SELECT * FROM users ORDER BY id').all(),before);
 for(const params of f.created){assert.deepEqual(params.emailAddressIdentificationStatus,['reserved']);assert.equal(params.skipPasswordRequirement,true);assert.equal(params.password,undefined);assert.equal(params.passwordDigest,undefined);}
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM identity_audit').get().n,2);
 assert.deepEqual(await f.run(),{dryRun:false,members:2,created:0,bound:0});
});
test('unrelated existing Clerk account blocks the entire import before any creation',async t=>{
 const f=fixture(t);f.users.set('user_unrelated',{id:'user_unrelated',primaryEmailAddressId:'e',emailAddresses:[{id:'e',emailAddress:'owner@example.com'}],privateMetadata:{}});
 await assert.rejects(f.run(),/refusing an email-only merge/);assert.equal(f.created.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM clerk_bindings').get().n,0);
});
test('wrong provider instance blocks import',async t=>{
 const f=fixture(t);f.client.instance.get=async()=>({id:'ins_wrong',environmentType:'production'});
 await assert.rejects(f.run(),/does not match/);assert.equal(f.created.length,0);
});
test('membership changes after provider creation reject binding; retry safely resumes the owned identity',async t=>{
 const f=fixture(t);let once=true;
 f.onCreate(p=>{if(once){once=false;f.db.prepare('UPDATE users SET name=? WHERE id=?').run('Changed',p.externalId);}});
 await assert.rejects(f.run(),/Membership changed/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM clerk_bindings').get().n,0);
 assert.deepEqual(await f.run(),{dryRun:false,members:2,created:1,bound:2});assert.equal(f.created.length,2);
});
test('client-controlled metadata or external ID alone cannot authorize an existing account',async t=>{
 const f=fixture(t);f.users.set('user_other',{id:'user_other',externalId:'owner',primaryEmailAddressId:'e',emailAddresses:[{id:'e',emailAddress:'owner@example.com'}],unsafeMetadata:{voqroMigration:{source:'voqro-admin-import-v1',userId:'owner',issuer}}});
 await assert.rejects(f.run(),/refusing an email-only merge/);assert.equal(f.created.length,0);
});
