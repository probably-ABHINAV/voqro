import {DatabaseSync, backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, copyFile, chmod, writeFile, readFile, lstat, rm} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const safeId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
function check(condition, message) { if (!condition) throw new Error(message); }
async function digest(path) {
  check((await lstat(path)).isFile(), `Expected a regular file: ${path}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function privateCopy(from, to) { await copyFile(from, to); await chmod(to, 0o600); }
const hasTable = (db,name) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
function databaseChecks(db) {
  const integrity = db.prepare('PRAGMA integrity_check').all();
  check(integrity.length === 1 && integrity[0].integrity_check === 'ok', 'SQLite integrity check failed.');
  check(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'SQLite foreign key check failed.');
  check(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n === 0, 'Backup contains active sessions.');
  for(const table of ['identity_sessions','identity_flows','instagram_oauth_states'])if(hasTable(db,table))check(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n===0,'Backup contains authentication or OAuth state.');
  if(hasTable(db,'instagram_connections'))check(db.prepare('SELECT COUNT(*) AS n FROM instagram_connections WHERE token_cipher IS NOT NULL').get().n===0,'Backup contains provider credentials.');
  check(db.prepare("SELECT COUNT(*) AS n FROM uploads WHERE status!='Complete'").get().n === 0, 'Backup contains incomplete uploads.');
  const uploads = db.prepare('SELECT id,size,sha256 FROM uploads ORDER BY id').all();
  const byId = new Map(uploads.map(u => [u.id, u]));
  for (const version of db.prepare('SELECT id,package_json FROM content_versions').all()) {
    const pkg = JSON.parse(version.package_json);
    for (const kind of ['video', 'cover']) {
      const asset = byId.get(pkg[kind + '_id']);
      check(asset && asset.sha256 === pkg[kind + '_sha256'], `Broken ${kind} reference in ${version.id}.`);
    }
  }
  return uploads;
}

export async function verifyBackup(directory) {
  const dest = resolve(directory);
  check((await lstat(dest)).isDirectory(), 'Backup path must be a directory, not a symlink.');
  check((await lstat(resolve(dest, 'uploads'))).isDirectory(), 'Uploads must be a directory, not a symlink.');
  check((await lstat(resolve(dest, 'manifest.json'))).isFile(), 'Expected a regular manifest file.');
  const manifest = JSON.parse(await readFile(resolve(dest, 'manifest.json'), 'utf8'));
  check(manifest.format === 1 && Array.isArray(manifest.uploads), 'Unsupported backup manifest.');
  const database = resolve(dest, 'voqro.sqlite');
  check(await digest(database) === manifest.database_sha256, 'Database checksum mismatch.');
  const db = new DatabaseSync(database, {readOnly: true});
  let uploads;
  try { uploads = databaseChecks(db); } finally { db.close(); }
  const listed = new Map(manifest.uploads.map(u => [u.id, u]));
  check(listed.size === manifest.uploads.length && listed.size === uploads.length, 'Manifest upload count mismatch.');
  for (const asset of uploads) {
    check(safeId(asset.id), 'Invalid upload ID.');
    const entry = listed.get(asset.id), path = resolve(dest, 'uploads', asset.id);
    check(entry && entry.sha256 === asset.sha256 && entry.size === asset.size, `Manifest mismatch for ${asset.id}.`);
    check((await lstat(path)).size === asset.size && await digest(path) === asset.sha256, `Media checksum mismatch for ${asset.id}.`);
  }
  return {directory: dest, database, uploads: uploads.length, created: manifest.created};
}

export async function createBackup({database, uploads, destination}) {
  const dbPath = resolve(database), dest = resolve(destination), media = resolve(uploads);
  check((await lstat(dbPath)).isFile(), 'Source database must already exist.');
  await mkdir(dirname(dest), {recursive: true, mode: 0o700});
  await mkdir(dest, {mode: 0o700}); // Exclusive: never overwrite a backup or workspace.
  try {
    await mkdir(resolve(dest, 'uploads'), {mode: 0o700});
    const source = new DatabaseSync(dbPath, {readOnly: true});
    try {
      source.exec('PRAGMA busy_timeout=5000');
      await backup(source, resolve(dest, 'voqro.sqlite'));
    } finally { source.close(); }
    await chmod(resolve(dest, 'voqro.sqlite'), 0o600);
    const snapshot = new DatabaseSync(resolve(dest, 'voqro.sqlite'));
    let assets, sessionsRemoved, incompleteRemoved;const recovery={};
    try {
      snapshot.exec('PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
      sessionsRemoved = snapshot.prepare('DELETE FROM sessions').run().changes;
      for(const table of ['identity_sessions','identity_flows','instagram_oauth_states'])if(hasTable(snapshot,table))recovery[table+'_removed']=snapshot.prepare(`DELETE FROM ${table}`).run().changes;
      if(hasTable(snapshot,'instagram_connections'))recovery.instagram_connections_disconnected=snapshot.prepare("UPDATE instagram_connections SET token_cipher=NULL,status='Disconnected',last_error='Restore requires fresh authorisation.'").run().changes;
      if(hasTable(snapshot,'instagram_jobs'))snapshot.exec("UPDATE instagram_jobs SET state=CASE WHEN state='Publishing' THEN 'Publish unknown' WHEN state='CreatingContainer' THEN 'Container unknown' WHEN state IN ('Queued','Awaiting container','Verifying') THEN 'Blocked' ELSE state END,lease_token=NULL,lease_until=NULL,last_error=CASE WHEN state IN ('Queued','Awaiting container','Verifying','Publishing','CreatingContainer') THEN 'Recovered snapshot: reconnect and reconcile provider state before any action.' ELSE last_error END");
      if(hasTable(snapshot,'cloud_uploads'))recovery.cloud_uploads_held=snapshot.prepare("UPDATE cloud_uploads SET state='Needs reconciliation',error='Restored snapshot: reconcile provider upload before resuming.' WHERE state!='Verified'").run().changes;
      if(hasTable(snapshot,'cloud_ai_jobs'))recovery.cloud_jobs_paused=snapshot.prepare("UPDATE cloud_ai_jobs SET state='Failed',error='Restored snapshot: derived evidence files are not included. Reconcile external work before a new attempt.',lease_token=NULL,lease_until=NULL WHERE state NOT IN ('Completed','Failed')").run().changes;
      if(hasTable(snapshot,'notification_email_outbox'))recovery.email_deliveries_held=snapshot.prepare("UPDATE notification_email_outbox SET state='Unknown',lease_token=NULL,lease_until=NULL,error='Restored snapshot; reconcile SES events before further action.' WHERE state IN ('Queued','Sending','Failed')").run().changes;
      if(hasTable(snapshot,'cloud_state'))snapshot.prepare("DELETE FROM cloud_state WHERE name='storage_verified'").run();
      snapshot.exec('DELETE FROM upload_chunks');
      incompleteRemoved = snapshot.prepare("DELETE FROM uploads WHERE status!='Complete'").run().changes;
      snapshot.exec('COMMIT');
      assets = databaseChecks(snapshot);
    } finally { snapshot.close(); }
    for (const asset of assets) {
      check(safeId(asset.id), 'Invalid upload ID.');
      const from = resolve(media, asset.id), to = resolve(dest, 'uploads', asset.id);
      check((await lstat(from)).isFile(), `Missing regular media file: ${asset.id}`);
      await privateCopy(from, to);
      check((await lstat(to)).size === asset.size && await digest(to) === asset.sha256, `Source media is corrupt: ${asset.id}`);
    }
    const manifest = {
      format: 1, created: new Date().toISOString(),
      database_sha256: await digest(resolve(dest, 'voqro.sqlite')),
      uploads: assets, recovery, sessions_removed: sessionsRemoved, incomplete_uploads_removed: incompleteRemoved,
      note: 'Consistent SQLite snapshot and completed immutable media. Credentials, sessions and incomplete local uploads are excluded. Provider connections require fresh authorisation; unfinished cloud work is held for reconciliation. Derived frame/audio cache files are not included.'
    };
    await writeFile(resolve(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
    return await verifyBackup(dest);
  } catch (error) {
    await rm(dest, {recursive: true, force: true});
    throw error;
  }
}

export async function restoreBackup(directory, destination) {
  const verified = await verifyBackup(directory), dest = resolve(destination);
  await mkdir(dirname(dest), {recursive: true, mode: 0o700});
  await mkdir(dest, {mode: 0o700}); // Restores always go into a new directory.
  try {
    await mkdir(resolve(dest, 'uploads'), {mode: 0o700});
    const manifest = JSON.parse(await readFile(resolve(verified.directory, 'manifest.json'), 'utf8'));
    for (const filename of ['voqro.sqlite', 'manifest.json']) await privateCopy(resolve(verified.directory, filename), resolve(dest, filename));
    for (const asset of manifest.uploads) {
      check(safeId(asset.id), 'Invalid upload ID.');
      await privateCopy(resolve(verified.directory, 'uploads', asset.id), resolve(dest, 'uploads', asset.id));
    }
    return await verifyBackup(dest);
  } catch (error) {
    await rm(dest, {recursive: true, force: true});
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, arg, target] = process.argv.slice(2);
    let result;
    if (command === 'create') {
      const database = process.env.DB_PATH || resolve(root, '.data/voqro.sqlite');
      check(database !== ':memory:', 'Backups require a persistent database.');
      const uploads = process.env.UPLOAD_PATH || resolve(database, '..', 'uploads');
      const destination = arg || resolve(root, '.data/backups', new Date().toISOString().replaceAll(':', '-'));
      result = await createBackup({database, uploads, destination});
    } else if (command === 'verify' && arg) result = await verifyBackup(arg);
    else if (command === 'restore' && arg && target) result = await restoreBackup(arg, target);
    else throw new Error('Usage: node scripts/backup.mjs create [new-directory] | verify <backup-directory> | restore <backup-directory> <new-directory>');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
