import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createBackup,verifyBackup,restoreBackup} from '../scripts/backup.mjs';
const directory=mkdtempSync(resolve(tmpdir(),'voqro-backup-test-'));
const database=resolve(directory,'live.sqlite'),uploads=resolve(directory,'uploads'),destination=resolve(directory,'snapshot');
process.env.NODE_ENV='test';process.env.DEMO_MODE='1';process.env.DB_PATH=database;process.env.UPLOAD_PATH=uploads;
const {server}=await import('../server.mjs');let base,cookie,invoiceId;
before(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:'u_owner'})});cookie=login.headers.get('set-cookie').split(';')[0];
 const r=await fetch(base+'/api/commerce/invoices',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({campaign_id:'cam_1',title:'Durable financial record',request_key:'backup-invoice',due_on:'2099-12-31',items:[{label:'Fee',quantity:1,unit_price:50001,tax_bps:1800}]})});assert.equal(r.status,201);invoiceId=(await r.json()).id;
 // Fixture records use the application's actual schema and a live WAL connection.
 const db=new DatabaseSync(database);const assets={};
 for(const [kind,name,mime] of [['video','draft.mp4','video/mp4'],['cover','cover.png','image/png']]){
  const bytes=readFileSync(new URL('./fixtures/'+name,import.meta.url)),id='upload_'+kind,hash=createHash('sha256').update(bytes).digest('hex');writeFileSync(resolve(uploads,id),bytes);db.prepare('INSERT INTO uploads VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'d1','u_owner',name,mime,bytes.length,kind,'Complete',hash,new Date().toISOString());assets[kind+'_id']=id;assets[kind+'_sha256']=hash;
 }
 db.prepare('INSERT INTO cloud_uploads(id,deliverable_id,owner_id,name,mime,size,kind,sha256,object_key,version_id,state,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('upload_video','d1','u_owner','draft.mp4','video/mp4',readFileSync(resolve(uploads,'upload_video')).length,'video',assets.video_sha256,'originals/upload_video','s3-version','Verified','backup-cloud-upload');
 db.prepare('INSERT INTO content_versions VALUES(?,?,?,?,?)').run('version_backup','d1',1,JSON.stringify(assets),new Date().toISOString());
 db.prepare('INSERT INTO uploads VALUES(?,?,?,?,?,?,?,?,?,?)').run('upload_pending','d1','u_owner','partial.mp4','video/mp4',100,'video','Uploading',null,new Date().toISOString());
 db.prepare('INSERT INTO upload_chunks VALUES(?,?,?,?)').run('upload_pending',0,10,'partial');
 db.prepare('INSERT INTO identity_sessions VALUES(?,?,?,?)').run('session-hash','u_owner',Date.now()+60000,new Date().toISOString());
 db.prepare('INSERT INTO identity_flows VALUES(?,?,?,?,?,?)').run('state-hash','browser-hash','private-nonce','private-pkce',Date.now(),Date.now()+60000);
 db.prepare('INSERT INTO password_credentials VALUES(?,?,?,?)').run('u_owner','test-salt','test-password-hash',new Date().toISOString());
 db.prepare('INSERT INTO identity_invitations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('invite-backup','invite@example.com','manager',null,null,'Pending',Date.now()+86400000,'u_owner',new Date().toISOString(),null,null);
 db.prepare('INSERT INTO password_invitation_tokens VALUES(?,?)').run('invite-backup','test-invitation-token-hash');
 db.prepare('INSERT INTO instagram_oauth_states(id,user_id,brand_id,state,selection_cipher,expires_at,created) VALUES(?,?,?,?,?,?,?)').run('oauth-state','u_owner','b_olive','Choose account','private-ciphertext',Date.now()+60000,new Date().toISOString());
 db.prepare('INSERT INTO instagram_connections(id,brand_id,account_id,username,token_cipher,status) VALUES(?,?,?,?,?,?)').run('ig-backup','b_olive','test-account','oliveandearth','private-token-ciphertext','Connected');
 db.prepare('INSERT INTO cloud_ai_jobs(id,version_id,campaign_id,mode,state,reserved_cents,external_started) VALUES(?,?,?,?,?,?,?)').run('ai-backup','version_backup','cam_1','aws','Transcribing',50,1);
 db.prepare('INSERT INTO workflow_notifications(id,user_id,event_key,title,detail,action,severity,created) VALUES(?,?,?,?,?,?,?,?)').run('notice-backup','u_owner','test-notice','Example reminder','Private task context','nav:workflow','info',new Date().toISOString());
 db.prepare('INSERT INTO notification_email_outbox(id,notification_id,user_id,event_key,state) VALUES(?,?,?,?,?)').run('email-backup','notice-backup','u_owner','test-notice','Queued');
 db.close();
});
after(async()=>{await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});});

test('live WAL snapshot restores financial records and referenced media, revokes sessions and excludes partial uploads',async()=>{
 assert.ok(statSync(database+'-wal').size>0);
 const saved=await createBackup({database,uploads,destination});assert.equal(saved.uploads,2);
 const restored=await restoreBackup(destination,resolve(directory,'restored'));const db=new DatabaseSync(restored.database,{readOnly:true});
 try{assert.equal(db.prepare('SELECT total FROM invoices WHERE id=?').get(invoiceId).total,59001);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM upload_chunks').get().n,0);assert.equal(db.prepare("SELECT id FROM uploads WHERE status!='Complete'").get(),undefined);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM content_versions').get().n,1);
  for(const table of ['identity_sessions','identity_flows','instagram_oauth_states'])assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM password_invitation_tokens').get().n,0);assert.equal(db.prepare("SELECT status FROM identity_invitations WHERE id='invite-backup'").get().status,'Revoked');assert.equal(db.prepare("SELECT password_hash FROM password_credentials WHERE user_id='u_owner'").get().password_hash,'test-password-hash');
  const connection=db.prepare("SELECT * FROM instagram_connections WHERE id='ig-backup'").get();assert.equal(connection.token_cipher,null);assert.equal(connection.status,'Disconnected');
  const ai=db.prepare("SELECT * FROM cloud_ai_jobs WHERE id='ai-backup'").get();assert.equal(ai.state,'Failed');assert.equal(ai.reserved_cents,50);assert.equal(ai.external_started,1);assert.equal(db.prepare("SELECT state FROM cloud_uploads WHERE id='upload_video'").get().state,'Verified');assert.equal(db.prepare("SELECT state FROM notification_email_outbox WHERE id='email-backup'").get().state,'Unknown');}finally{db.close();}
 assert.deepEqual(readFileSync(resolve(directory,'restored/uploads/upload_video')),readFileSync(resolve(uploads,'upload_video')));
 const live=new DatabaseSync(database,{readOnly:true});try{assert.equal(live.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);assert.ok(live.prepare("SELECT id FROM uploads WHERE id='upload_pending'").get());assert.equal(live.prepare('SELECT COUNT(*) AS n FROM identity_sessions').get().n,1);assert.equal(live.prepare("SELECT token_cipher FROM instagram_connections WHERE id='ig-backup'").get().token_cipher,'private-token-ciphertext');}finally{live.close();}
 assert.equal((await fetch(base+'/api/workspace',{headers:{Cookie:cookie}})).status,200);
 const passwords=new DatabaseSync(database,{readOnly:true});try{assert.equal(passwords.prepare('SELECT COUNT(*) n FROM password_invitation_tokens').get().n,1);assert.equal(passwords.prepare("SELECT status FROM identity_invitations WHERE id='invite-backup'").get().status,'Pending');}finally{passwords.close();}
});

test('backup and restore never overwrite existing destinations',async()=>{
 await assert.rejects(createBackup({database,uploads,destination}),/EEXIST/);
 await assert.rejects(restoreBackup(destination,resolve(directory,'restored')),/EEXIST/);
 assert.equal((await verifyBackup(destination)).uploads,2);
});

test('corrupt media and corrupt database snapshots fail verification before restore',async()=>{
 const media=resolve(destination,'uploads/upload_video'),original=readFileSync(media);writeFileSync(media,Buffer.alloc(original.length));await assert.rejects(verifyBackup(destination),/Media checksum mismatch/);await assert.rejects(restoreBackup(destination,resolve(directory,'bad-restore')),/checksum/);assert.equal(existsSync(resolve(directory,'bad-restore')),false);writeFileSync(media,original);
 const file=resolve(destination,'voqro.sqlite'),bytes=readFileSync(file);writeFileSync(file,Buffer.alloc(bytes.length));await assert.rejects(verifyBackup(destination),/Database checksum mismatch/);writeFileSync(file,bytes);
 const source=resolve(uploads,'upload_cover'),cover=readFileSync(source);writeFileSync(source,'broken');await assert.rejects(createBackup({database,uploads,destination:resolve(directory,'bad-source')}),/Source media is corrupt/);assert.equal(existsSync(resolve(directory,'bad-source')),false);writeFileSync(source,cover);
});
