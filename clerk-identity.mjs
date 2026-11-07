import {createHash} from 'node:crypto';
import {createClerkClient, verifyToken} from '@clerk/backend';

const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };

export function clerkConfig(env = process.env) {
  const requested = env.CLERK_MIGRATION_ENABLED === '1' || env.AUTH_PROVIDER === 'clerk';
  const cfg = {requested, issuer: env.CLERK_ISSUER || '', secretKey: env.CLERK_SECRET_KEY || '', baseURL: env.APP_BASE_URL || '', jwtKey: env.CLERK_JWT_KEY || ''};
  let configured = requested && env.DEMO_MODE !== '1';
  try {
    const issuer = new URL(cfg.issuer), origin = new URL(cfg.baseURL);
    const local = env.AUTH_ALLOW_INSECURE_LOCAL === '1' && origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    const issuerMatches = issuer.origin === cfg.issuer || (issuer.origin === origin.origin && cfg.issuer === origin.origin + '/__clerk');
    if (issuer.protocol !== 'https:' || !issuerMatches || issuer.username || issuer.password || origin.origin !== cfg.baseURL || origin.username || origin.password || (origin.protocol !== 'https:' && !local) || !/^sk_(test|live)_[A-Za-z0-9]+$/.test(cfg.secretKey)) configured = false;
  } catch { configured = false; }
  return {...cfg, configured};
}

// Verify with Clerk's SDK, then require a session token from this exact instance
// and frontend. Machine tokens and organization role claims grant no app access.
export async function verifyClerkSessionToken(token, cfg) {
  if (typeof token !== 'string' || token.length > 20000) fail(401, 'Sign in with Clerk again.');
  try {
    const claims = await verifyToken(token, {secretKey: cfg.secretKey, ...(cfg.jwtKey ? {jwtKey: cfg.jwtKey} : {}), issuer: cfg.issuer, authorizedParties: [cfg.baseURL], clockSkewInMs: 0});
    const time = Math.floor(Date.now() / 1000);
    if (claims.iss !== cfg.issuer || claims.azp !== cfg.baseURL || !/^user_[A-Za-z0-9]+$/.test(claims.sub) || !/^sess_[A-Za-z0-9]+$/.test(claims.sid) || !Number.isInteger(claims.exp) || claims.exp <= time || !Number.isInteger(claims.iat) || claims.iat > time || (claims.sts && claims.sts !== 'active') || claims.act) throw Error();
    return claims;
  } catch { fail(401, 'Clerk sign-in could not be verified. Sign in again.'); }
}

export function createClerkIdentity({db, row, run, id, now, transaction, requireThat, send, body, cfg, configuration = clerkConfig(), provider, verify = verifyClerkSessionToken, passwordProof, localSession, issueSession, sessionHeaders, tokenHash, audit}) {
  const settings = configuration;
  const enabled = () => settings.configured && !cfg.demoMode && ['password', 'clerk'].includes(cfg.provider);
  let client = provider;
  const api = () => client ||= createClerkClient({secretKey: settings.secretKey, telemetry: {disabled: true}});
  db.exec(`
    CREATE TABLE IF NOT EXISTS clerk_bindings(user_id TEXT NOT NULL REFERENCES users(id),issuer TEXT NOT NULL,subject TEXT NOT NULL,email TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(issuer,subject),UNIQUE(user_id,issuer));
    CREATE TABLE IF NOT EXISTS clerk_local_sessions(token TEXT PRIMARY KEY REFERENCES identity_sessions(token) ON DELETE CASCADE,issuer TEXT NOT NULL,subject TEXT NOT NULL,session_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS clerk_revocations(user_id TEXT PRIMARY KEY REFERENCES users(id),revoked_before INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS clerk_blocked_sessions(issuer TEXT NOT NULL,session_id TEXT NOT NULL,PRIMARY KEY(issuer,session_id));
  `);
  const proofs = new WeakMap();
  const status = () => ({clerk_migration_available: enabled() && cfg.provider === 'password', clerk_available: enabled(), clerk_link_path: enabled() ? '/account/clerk' : null});
  async function call(fn) {
    let timer;
    try { return await Promise.race([fn(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('timeout')), 10000); })]); }
    catch { fail(503, 'The identity provider is unavailable. Please retry.'); }
    finally { clearTimeout(timer); }
  }
  async function providerIdentity(subject, sid) {
    const [session, user] = await Promise.all([call(() => api().sessions.getSession(sid)), call(() => api().users.getUser(subject))]);
    requireThat(session.id === sid && session.userId === subject && session.status === 'active' && session.expireAt > Date.now() && Number.isFinite(session.createdAt) && session.createdAt > 0 && session.createdAt <= Date.now() + 1000, 401, 'This Clerk session has ended. Sign out and sign in again.');
    requireThat(user.id === subject && !user.banned && !user.locked, 403, 'This Clerk account is unavailable.');
    const email = user.emailAddresses?.find(e => e.id === user.primaryEmailAddressId && e.verification?.status === 'verified')?.emailAddress?.toLowerCase();
    requireThat(typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254, 403, 'Verify your primary email address in Clerk before continuing.');
    return {subject, sid, email, created: session.createdAt, name: [user.firstName, user.lastName].filter(Boolean).join(' ').slice(0,120) || email.split('@')[0]};
  }
  function allowed(userId, identity) {
    requireThat(!row('SELECT session_id FROM clerk_blocked_sessions WHERE issuer=? AND session_id=?', settings.issuer, identity.sid), 401, 'This session was signed out. Sign out of Clerk and sign in again.');
    const cutoff = row('SELECT revoked_before FROM clerk_revocations WHERE user_id=?', userId)?.revoked_before;
    requireThat(cutoff === undefined || identity.created > cutoff, 401, 'Your sessions were revoked. Sign out of Clerk and sign in again.');
  }
  function revokeUser(userId) {
    run('INSERT INTO clerk_revocations VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET revoked_before=excluded.revoked_before', userId, Date.now());
  }
  function logout(req) {
    const s = row('SELECT issuer,session_id FROM clerk_local_sessions WHERE token=?', tokenHash(req));
    if (s) run('INSERT OR IGNORE INTO clerk_blocked_sessions VALUES(?,?)', s.issuer, s.session_id);
  }
  async function prepare(req) {
    proofs.delete(req);
    if (cfg.provider !== 'clerk' || !enabled()) return;
    const s = row("SELECT c.*,a.email FROM clerk_local_sessions c JOIN identity_sessions s ON s.token=c.token JOIN identity_accounts a ON a.user_id=s.user_id WHERE c.token=? AND s.expires>? AND a.status='Active'", tokenHash(req), Date.now());
    if (!s || s.issuer !== settings.issuer) return;
    const verified = await providerIdentity(s.subject, s.session_id);
    if (verified.email !== s.email) return;
    proofs.set(req, verified);
  }
  function sessionAllowed(req, userId) {
    const verified = proofs.get(req);
    if (!verified || !enabled()) return false;
    const binding = row('SELECT user_id FROM clerk_bindings WHERE issuer=? AND subject=?', settings.issuer, verified.subject);
    if (binding?.user_id !== userId) return false;
    try { allowed(userId, verified); return true; } catch { return false; }
  }
  async function handlePublic(req, res, path) {
    if (!['/api/identity/clerk/link', '/api/identity/clerk/exchange'].includes(path)) return false;
    requireThat(req.method === 'POST', 405, 'Use POST for Clerk sign-in.');
    requireThat(enabled(), 503, 'Clerk is not configured for this application.');
    requireThat(req.headers.origin === cfg.baseURL, 403, 'Use the configured application origin.');
    const linking = path.endsWith('/link');
    requireThat(linking ? cfg.provider === 'password' : cfg.provider === 'clerk', 409, linking ? 'Account linking is only available during migration.' : 'Clerk sign-in has not been activated. Continue using your Voqro password.');
    const original = linking ? localSession(req) : null;
    if (linking) requireThat(original, 401, 'Sign in with your existing Voqro account before linking Clerk.');
    const input = await body(req);
    requireThat(input && typeof input === 'object' && !Array.isArray(input), 400, 'Send a sign-in object.');
    const auth = req.headers.authorization || '';
    requireThat(auth.startsWith('Bearer '), 401, 'Sign in with Clerk before continuing.');
    const claims = await verify(auth.slice(7), settings);
    const verified = await providerIdentity(claims.sub, claims.sid);
    const proof = linking ? await passwordProof(original.id, input.current_password) : null;
    const result = transaction(() => {
      let binding = row('SELECT * FROM clerk_bindings WHERE issuer=? AND subject=?', settings.issuer, verified.subject);
      if (linking) {
        requireThat(localSession(req)?.id === original.id && proof(), 401, 'Your Voqro account or session changed. Sign in again.');
        const account = row("SELECT * FROM identity_accounts WHERE user_id=? AND status='Active'", original.id);
        requireThat(account?.email === verified.email, 403, 'Your verified Clerk email must match your existing Voqro account.');
        requireThat(!binding || binding.user_id === original.id, 409, 'This Clerk identity is already linked to another membership.');
        const previous = row('SELECT subject FROM clerk_bindings WHERE user_id=? AND issuer=?', original.id, settings.issuer);
        requireThat(!previous || previous.subject === verified.subject, 409, 'This membership already has a different Clerk identity.');
        if (!binding) { run('INSERT INTO clerk_bindings VALUES(?,?,?,?,?)', original.id, settings.issuer, verified.subject, verified.email, now()); audit(original.id, 'link-clerk', original.id, 'Verified Clerk email and existing Voqro password; application user ID preserved.'); }
        return {linked: true};
      }
      if (!binding) {
        // Existing emails must go through explicit password reauthentication;
        // only a new, invited email can create an application membership here.
        requireThat(!row('SELECT user_id FROM identity_accounts WHERE email=?', verified.email), 403, 'This existing membership must be linked before Clerk sign-in is activated. Contact the owner.');
        const invite = row("SELECT * FROM identity_invitations WHERE email=? AND status='Pending' AND expires>?", verified.email, Date.now());
        requireThat(invite, 403, 'Your verified email needs an active invitation from the agency owner.');
        const uid = id('member');
        run('INSERT INTO users(id,name,role,brand_id,creator_id) VALUES(?,?,?,?,?)', uid, verified.name, invite.role, invite.brand_id, invite.creator_id);
        run('INSERT INTO identity_accounts VALUES(?,?,?,?,?,?)', uid, settings.issuer, verified.subject, verified.email, 'Active', now());
        run('INSERT INTO clerk_bindings VALUES(?,?,?,?,?)', uid, settings.issuer, verified.subject, verified.email, now());
        run("UPDATE identity_invitations SET status='Accepted',accepted_by=?,accepted_at=? WHERE id=?", uid, now(), invite.id);
        run('DELETE FROM password_invitation_tokens WHERE invitation_id=?', invite.id);
        audit(uid, 'accept-clerk-invitation', invite.id, 'Verified Clerk email matched an owner-issued invitation.');
        binding = {user_id: uid};
      }
      const account = row("SELECT * FROM identity_accounts WHERE user_id=? AND status='Active'", binding.user_id);
      requireThat(account?.email === verified.email, 403, 'This membership is disabled or its verified email has changed.');
      allowed(binding.user_id, verified);
      const session = issueSession(req, binding.user_id);
      run('INSERT INTO clerk_local_sessions VALUES(?,?,?,?)', digest(session.token), settings.issuer, verified.subject, verified.sid);
      audit(binding.user_id, 'clerk-sign-in', binding.user_id, 'Verified Clerk session; application permissions remain database-controlled.');
      return {session};
    });
    send(res, 200, linking ? result : {ok: true}, result.session ? sessionHeaders(result.session) : {});
    return true;
  }
  const isProviderSession = req => !!row('SELECT token FROM clerk_local_sessions WHERE token=?', tokenHash(req));
  return {status, prepare, sessionAllowed, isProviderSession, revokeUser, logout, handlePublic};
}
