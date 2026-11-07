import {createHash, randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const derive = promisify(scrypt);
const issuer = 'urn:voqro:password';
const hash = value => createHash('sha256').update(value).digest('hex');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const options = {N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024};
const dummySalt = Buffer.alloc(32, 73).toString('base64url');
const dummyHash = Buffer.alloc(64).toString('base64url');
const same = (left, right) => timingSafeEqual(Buffer.from(hash(left), 'hex'), Buffer.from(hash(right), 'hex'));

/** Password membership shares the application's durable accounts and sessions.
 * Invitation possession authorizes membership; it does not verify an inbox. */
export function createPasswordIdentity({db, row, rows, run, id, now, transaction, requireThat, textField, send, body, cfg, scope, audit, issueSession, sessionHeaders, authorizeOwner}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_credentials(user_id TEXT PRIMARY KEY REFERENCES users(id),salt TEXT NOT NULL,password_hash TEXT NOT NULL,updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS password_invitation_tokens(invitation_id TEXT PRIMARY KEY REFERENCES identity_invitations(id),token_hash TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS password_auth_attempts(key_hash TEXT PRIMARY KEY,window_start INTEGER NOT NULL,attempts INTEGER NOT NULL,expires INTEGER NOT NULL);
  `);
  const enabled = () => cfg.provider === 'password' && cfg.configured && !cfg.demoMode;
  const bootstrapRequired = () => !row('SELECT user_id FROM identity_accounts LIMIT 1') && !row('SELECT id FROM identity_bootstrap WHERE id=1');
  const active = () => requireThat(enabled(), 503, 'Password sign-in is not enabled for this application.');
  const origin = req => requireThat(req.headers.origin === cfg.baseURL, 403, 'A request from the configured application origin is required.');
  const email = value => { const result = textField(value, 'Email', 254).toLowerCase(); requireThat(emailPattern.test(result), 400, 'Enter a valid email address.'); return result; };
  function password(value) {
    requireThat(typeof value === 'string' && value.length >= 12 && value.length <= 128 && Buffer.byteLength(value) <= 512, 400, 'Use a password of 12–128 characters (maximum 512 UTF-8 bytes).');
    return value;
  }
  function boundedCredential(value) {
    requireThat(typeof value === 'string' && value.length > 0 && value.length <= 128 && Buffer.byteLength(value) <= 512, 400, 'Enter a password of at most 128 characters.');
    return value;
  }
  function throttle(key) {
    const time = Date.now(), keyHash = hash(key), window = 15 * 60 * 1000;
    transaction(() => {
      run('DELETE FROM password_auth_attempts WHERE expires<=?', time);
      const record = row('SELECT * FROM password_auth_attempts WHERE key_hash=?', keyHash);
      if (record && record.attempts >= 10) {
        const retry = Math.max(1, Math.ceil((record.expires - time) / 1000));
        throw Object.assign(new Error('Too many sign-in attempts. Please wait before trying again.'), {status: 429, headers: {'Retry-After': String(retry)}});
      }
      requireThat(record || row('SELECT COUNT(*) AS n FROM password_auth_attempts').n < 10000, 429, 'Too many sign-in requests. Please retry later.');
      run('INSERT INTO password_auth_attempts VALUES(?,?,1,?) ON CONFLICT(key_hash) DO UPDATE SET attempts=attempts+1', keyHash, time, time + window);
    });
  }
  let running = 0;
  async function compute(value, salt) {
    requireThat(running < 2, 429, 'Sign-in is busy. Please retry shortly.');
    running++;
    try { return (await derive(value, Buffer.from(salt, 'base64url'), 64, options)).toString('base64url'); }
    finally { running--; }
  }
  async function makeCredential(value) {
    const salt = randomBytes(32).toString('base64url');
    return {salt, password_hash: await compute(password(value), salt)};
  }
  async function matches(value, credential) {
    const salt = credential?.salt || dummySalt, expected = credential?.password_hash || dummyHash;
    const actual = await compute(boundedCredential(value), salt);
    return same(actual, expected) && !!credential;
  }
  function availableAccount(address) { return row("SELECT a.*,p.salt,p.password_hash FROM identity_accounts a JOIN password_credentials p ON p.user_id=a.user_id WHERE a.email=? AND a.issuer=? AND a.status='Active'", address, issuer); }
  function userAndSession(req, userId) { return {user: row('SELECT id,name,role,brand_id,creator_id FROM users WHERE id=?', userId), session: issueSession(req, userId)}; }
  function respond(res, result, status = 200) { send(res, status, {user: result.user}, sessionHeaders(result.session)); }
  async function handlePublic(req, res, path) {
    if (!['/api/identity/password/login', '/api/identity/password/register', '/api/identity/password/bootstrap'].includes(path)) return false;
    requireThat(req.method === 'POST', 405, 'Use POST for password sign-in.'); active(); origin(req);
    const input = await body(req);
    requireThat(input && typeof input === 'object' && !Array.isArray(input), 400, 'Send a sign-in object.');
    const address = email(input.email);
    throttle(path + ':' + address);
    if (path.endsWith('/login')) {
      const account = availableAccount(address);
      requireThat(await matches(input.password, account), 401, 'Email or password is incorrect.');
      const result = transaction(() => {
        const current = availableAccount(address);
        requireThat(current && current.password_hash === account.password_hash && current.salt === account.salt, 401, 'Email or password is incorrect.');
        audit(current.user_id, 'password-sign-in', current.user_id, 'Password verified; a new local session was created.');
        return userAndSession(req, current.user_id);
      });
      respond(res, result); return true;
    }
    const name = textField(input.name, 'Name', 120);
    let invitation;
    if (path.endsWith('/bootstrap')) {
      throttle('bootstrap');
      requireThat(cfg.bootstrapEmail && cfg.bootstrapSecret && cfg.bootstrapSecret.length >= 32, 503, 'The server owner must configure the bootstrap email and secret before setup.');
      requireThat(typeof input.bootstrap_secret === 'string' && input.bootstrap_secret.length <= 256 && same(input.bootstrap_secret, cfg.bootstrapSecret) && address === cfg.bootstrapEmail, 403, 'The bootstrap credentials are incorrect.');
      requireThat(bootstrapRequired(), 409, 'Owner setup is already complete. Sign in with an existing account.');
    } else {
      requireThat(typeof input.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(input.token), 400, 'Enter a valid invitation token.');
      throttle('invitation:' + input.token);
      invitation = row("SELECT i.* FROM identity_invitations i JOIN password_invitation_tokens t ON t.invitation_id=i.id WHERE t.token_hash=? AND i.email=? AND i.status='Pending' AND i.expires>?", hash(input.token), address, Date.now());
      requireThat(invitation, 403, 'This invitation is invalid, expired or already used. Ask the owner for a new invitation.');
      requireThat(!row('SELECT user_id FROM identity_accounts WHERE email=?', address), 409, 'This email already has an account. Sign in instead.');
    }
    const credential = await makeCredential(input.password);
    const result = transaction(() => {
      if (invitation) {
        const current = row("SELECT i.* FROM identity_invitations i JOIN password_invitation_tokens t ON t.invitation_id=i.id WHERE i.id=? AND t.token_hash=? AND i.email=? AND i.status='Pending' AND i.expires>?", invitation.id, hash(input.token), address, Date.now());
        requireThat(current, 409, 'The invitation was already used, revoked or expired.');
        invitation = current;
      } else requireThat(bootstrapRequired(), 409, 'Owner setup is already complete.');
      requireThat(!row('SELECT user_id FROM identity_accounts WHERE email=?', address), 409, 'This email already has an account.');
      const userId = id('member'), membership = invitation ? scope(invitation) : {role: 'owner', brand_id: null, creator_id: null};
      run('INSERT INTO users(id,name,role,brand_id,creator_id) VALUES(?,?,?,?,?)', userId, name, membership.role, membership.brand_id, membership.creator_id);
      run('INSERT INTO identity_accounts(user_id,issuer,subject,email,status,created) VALUES(?,?,?,?,?,?)', userId, issuer, userId, address, 'Active', now());
      run('INSERT INTO password_credentials VALUES(?,?,?,?)', userId, credential.salt, credential.password_hash, now());
      if (invitation) {
        run("UPDATE identity_invitations SET status='Accepted',accepted_by=?,accepted_at=? WHERE id=?", userId, now(), invitation.id);
        run('DELETE FROM password_invitation_tokens WHERE invitation_id=?', invitation.id);
        audit(userId, 'accept-password-invitation', invitation.id, 'Single-use owner-issued token matched the invited email; inbox ownership was not independently verified.');
      } else {
        run('INSERT INTO identity_bootstrap VALUES(1,?,?)', userId, now());
        audit(userId, 'password-bootstrap', userId, 'Explicit server-configured bootstrap secret and owner email accepted.');
      }
      return userAndSession(req, userId);
    });
    respond(res, result, 201); return true;
  }
  async function handleAuthed(req, res, path, user) {
    if (path !== '/api/identity/password/change-password') return false;
    requireThat(req.method === 'POST', 405, 'Use POST to change a password.'); active(); origin(req);
    const input = await body(req); requireThat(input && typeof input === 'object' && !Array.isArray(input), 400, 'Send a password-change object.');
    throttle('change:' + user.id);
    const account = row("SELECT p.* FROM password_credentials p JOIN identity_accounts a ON a.user_id=p.user_id WHERE p.user_id=? AND a.status='Active' AND a.issuer=?", user.id, issuer);
    requireThat(await matches(input.current_password, account), 401, 'The current password is incorrect.');
    const credential = await makeCredential(input.new_password);
    const result = transaction(() => {
      const current = row("SELECT p.* FROM password_credentials p JOIN identity_accounts a ON a.user_id=p.user_id WHERE p.user_id=? AND a.status='Active'", user.id);
      requireThat(current && current.password_hash === account.password_hash, 409, 'The account changed. Sign in again before changing its password.');
      run('UPDATE password_credentials SET salt=?,password_hash=?,updated=? WHERE user_id=?', credential.salt, credential.password_hash, now(), user.id);
      run('DELETE FROM identity_sessions WHERE user_id=?', user.id);
      audit(user.id, 'change-password', user.id, 'Password changed; all previous sessions were revoked.');
      return userAndSession(req, user.id);
    });
    send(res, 200, {user: result.user, sessions_revoked: true}, sessionHeaders(result.session)); return true;
  }
  function invite(input, user, req) {
    active();
    const address = email(input.email), membership = scope(input), days = input.days === undefined ? 7 : input.days;
    requireThat(Number.isInteger(days) && days >= 1 && days <= 30, 400, 'Invitation expiry must be 1–30 days.');
    const token = randomBytes(32).toString('base64url');
    const result = transaction(() => {
      authorizeOwner(user,req);
      requireThat(!row('SELECT user_id FROM identity_accounts WHERE email=?', address), 409, 'This email already has a membership. Update that member instead.');
      run("UPDATE identity_invitations SET status='Expired' WHERE status='Pending' AND expires<=?", Date.now());
      requireThat(!row("SELECT id FROM identity_invitations WHERE email=? AND status='Pending'", address), 409, 'A pending invitation already exists. Its secret is shown once; revoke it before issuing another.');
      const invitationId = id('invite');
      run('INSERT INTO identity_invitations VALUES(?,?,?,?,?,?,?,?,?,?,?)', invitationId, address, membership.role, membership.brand_id, membership.creator_id, 'Pending', Date.now() + days * 86400000, user.id, now(), null, null);
      run('INSERT INTO password_invitation_tokens VALUES(?,?)', invitationId, hash(token));
      audit(user.id, 'password-invite', invitationId, 'Owner issued a single-use registration token for the selected role and workspace.');
      return row('SELECT * FROM identity_invitations WHERE id=?', invitationId);
    });
    return {...result, invitation_token: token, registration_url: cfg.baseURL + '/register#' + new URLSearchParams({token, email: address}), email_sent: false, provider_user_created: false};
  }
  return {handlePublic, handleAuthed, invite, bootstrapRequired};
}
