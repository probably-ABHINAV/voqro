import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClerkClient} from '@clerk/backend';
import {clerkConfig} from '../clerk-identity.mjs';

const source = 'voqro-admin-import-v1';
const check = (condition, message) => { if (!condition) throw Error(message); };
const query = "SELECT u.id,u.name,u.role,u.brand_id,u.creator_id,a.email,a.issuer,a.status FROM users u JOIN identity_accounts a ON a.user_id=u.id WHERE a.status='Active' ORDER BY u.id";
const address = user => user.emailAddresses?.find(e => e.id === user.primaryEmailAddressId)?.emailAddress?.toLowerCase();

// Administrative import, never called by an HTTP request or by email matching
// during login. Reserved addresses require Clerk verification before app access.
export async function migrateClerkUsers({db, client, issuer, instanceId, apply = false}) {
  const instance = await client.instance.get();
  check(instance.id === instanceId && instance.environmentType === 'production', 'Selected production instance does not match.');
  const accounts = db.prepare(query).all();
  const owner = accounts.find(a => a.role === 'owner');
  check(owner && accounts.length <= 100, 'An active owner and a bounded migration batch are required.');
  const plans = [];
  for (const account of accounts) {
    check(account.issuer === 'urn:voqro:password', 'This importer only migrates existing password memberships.');
    const binding = db.prepare('SELECT * FROM clerk_bindings WHERE user_id=? AND issuer=?').get(account.id, issuer);
    let user;
    if (binding) {
      user = await client.users.getUser(binding.subject);
      check(address(user) === account.email && !user.banned && !user.locked, 'An existing binding is unavailable or its email changed.');
    } else {
      const byEmail = await client.users.getUserList({emailAddress: [account.email], limit: 100});
      const byExternal = await client.users.getUserList({externalId: [account.id], limit: 100});
      const candidates = [...new Map([...byEmail.data, ...byExternal.data].map(u => [u.id, u])).values()];
      check(candidates.length <= 1, 'Conflicting provider accounts require manual review.');
      user = candidates[0];
      if (user) {
        const marker = user.privateMetadata?.voqroMigration;
        check(user.externalId === account.id && address(user) === account.email && marker?.source === source && marker?.userId === account.id && marker?.issuer === issuer && !user.banned && !user.locked,
          'Existing provider account was not created by this migration; refusing an email-only merge.');
      }
    }
    plans.push({account, binding, user});
  }
  if (!apply) return {dryRun: true, members: plans.length, create: plans.filter(p => !p.user).length, alreadyBound: plans.filter(p => p.binding).length};
  let created = 0, bound = 0;
  for (const plan of plans) {
    const {account, binding} = plan;
    if (binding) continue;
    let user = plan.user;
    if (!user) {
      user = await client.users.createUser({
        externalId: account.id, emailAddress: [account.email], emailAddressIdentificationStatus: ['reserved'],
        firstName: account.name.slice(0, 64), skipPasswordRequirement: true,
        privateMetadata: {voqroMigration: {source, userId: account.id, issuer}},
      });
      created++;
    }
    check(user.externalId === account.id && address(user) === account.email && /^user_[A-Za-z0-9]+$/.test(user.id), 'Provider returned a different identity.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = db.prepare(query).all().find(a => a.id === account.id);
      check(current && Object.keys(account).every(k => current[k] === account[k]), 'Membership changed during import; retry after reviewing it.');
      const existing = db.prepare('SELECT * FROM clerk_bindings WHERE user_id=? AND issuer=?').get(account.id, issuer);
      check(!existing || existing.subject === user.id, 'Binding changed during import.');
      if (!existing) {
        const time = new Date().toISOString();
        db.prepare('INSERT INTO clerk_bindings VALUES(?,?,?,?,?)').run(account.id, issuer, user.id, account.email, time);
        db.prepare('INSERT INTO identity_audit VALUES(?,?,?,?,?,?)').run('authaudit_' + randomUUID(), owner.id, 'admin-import-clerk', account.id,
          'Owner-authorized administrative migration; stable external ID and reserved email; Clerk verification required before sign-in.', time);
        bound++;
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return {dryRun: false, members: plans.length, created, bound};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let db;
  try {
    const cfg = clerkConfig();
    check(cfg.configured && process.env.AUTH_PROVIDER === 'password' && process.env.CLERK_SECRET_KEY?.startsWith('sk_live_'), 'Use configured production Clerk keys while password mode is retained.');
    const args = process.argv.slice(2), at = args.indexOf('--instance'), instanceId = at >= 0 ? args[at + 1] : '';
    check(/^ins_[A-Za-z0-9]+$/.test(instanceId), 'Pass the selected production instance with --instance.');
    db = new DatabaseSync(process.env.DB_PATH); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    console.log(JSON.stringify(await migrateClerkUsers({db, client: createClerkClient({secretKey: cfg.secretKey, telemetry: {disabled: true}}), issuer: cfg.issuer, instanceId, apply: args.includes('--apply')})));
  } catch (error) {
    console.error(JSON.stringify({failed: true, message: error.errors ? 'Clerk rejected the migration request.' : error.message, status: error.status || null, codes: error.errors?.map(e => e.code)}));
    process.exitCode = 1;
  } finally { db?.close(); }
}
