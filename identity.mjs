import {randomBytes,createHash,createPublicKey,verify as verifySignature,timingSafeEqual} from 'node:crypto';
import {createPasswordIdentity} from './password-identity.mjs';
import {clerkConfig, createClerkIdentity} from './clerk-identity.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const roles = ['owner','manager','reviewer','finance','brand','creator'];
const demoIds = new Set(['u_owner','u_manager','u_reviewer','u_finance','u_brand','u_other','u_creator']);
const authCookie = '__Host-voqro_auth';
const flowCookie = '__Host-voqro_oidc';
const cookie = (name,value,seconds,sameSite='Strict') => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${seconds}`;
const readCookie = (req,name) => (req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||'';
const equal = (a,b) => typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function invalid(message='Identity verification failed.') { const error=new Error(message);error.status=401;return error; }

export function identityConfig(env=process.env) {
  if(env.AUTH_PROVIDER==='clerk') {
    const base=identityConfig({...env,AUTH_PROVIDER:'password',IDENTITY_BOOTSTRAP_EMAIL:'',IDENTITY_BOOTSTRAP_SECRET:''});
    const clerk=clerkConfig(env);
    return {...base,provider:'clerk',configured:base.configured&&clerk.configured,problem:base.problem||(!clerk.configured?'Clerk identity configuration is incomplete.':null)};
  }
  if(env.AUTH_PROVIDER==='password') {
    const values={provider:'password',baseURL:env.APP_BASE_URL||'',bootstrapEmail:(env.IDENTITY_BOOTSTRAP_EMAIL||'').trim().toLowerCase(),bootstrapSecret:env.IDENTITY_BOOTSTRAP_SECRET||'',demoMode:env.DEMO_MODE==='1',insecureLocal:false};
    const missing=env.APP_BASE_URL?[]:['APP_BASE_URL'];let problem=missing.length?'Password identity is not configured.':null;
    if(!problem)try{const url=new URL(values.baseURL);const local=env.AUTH_ALLOW_INSECURE_LOCAL==='1'&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);if((url.protocol!=='https:'&&!local)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error();values.baseURL=url.origin;values.insecureLocal=local;if(values.bootstrapEmail&&!emailPattern.test(values.bootstrapEmail))throw new Error();if(values.bootstrapSecret&&(values.bootstrapSecret.length<32||values.bootstrapSecret.length>256))throw new Error();}catch{problem='Password identity configuration is invalid. Use an HTTPS application origin and a bootstrap secret of 32–256 characters.';}
    return {...values,configured:!problem,problem,missing};
  }
  const values={issuer:env.COGNITO_ISSUER||'',clientId:env.COGNITO_CLIENT_ID||'',domain:env.COGNITO_DOMAIN||'',baseURL:env.APP_BASE_URL||'',bootstrapEmail:(env.IDENTITY_BOOTSTRAP_EMAIL||'').trim().toLowerCase(),demoMode:env.DEMO_MODE==='1'};
  const missing=['COGNITO_ISSUER','COGNITO_CLIENT_ID','COGNITO_DOMAIN','APP_BASE_URL'].filter(k=>!env[k]);
  let problem=missing.length?'Production identity is not configured.':null;
  if(!problem)try{
    if(!/^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?\/[a-z0-9-]+_[A-Za-z0-9]+$/.test(values.issuer))throw new Error();
    if(!/^[A-Za-z0-9]{1,128}$/.test(values.clientId))throw new Error();
    for(const key of ['domain','baseURL']){const url=new URL(values[key]);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error();values[key]=url.origin;}
    if(values.bootstrapEmail&&!emailPattern.test(values.bootstrapEmail))throw new Error();
  }catch{problem='Production identity configuration is invalid; check the HTTPS origin, Cognito issuer and client.';}
  if(env.AUTH_PROVIDER&&!['cognito','password'].includes(env.AUTH_PROVIDER))problem='AUTH_PROVIDER must be cognito or password.';
  return {...values,provider:'cognito',configured:!problem,problem,missing};
}

async function providerJSON(url,options={}) {
  const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Provider request failed.');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>1024*1024)throw new Error('Provider response too large.');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function verifyCognitoToken(token,{issuer,clientId,nonce,jwks,nowSeconds=Math.floor(Date.now()/1000),flowCreatedSeconds=nowSeconds-600}) {
  try{
    if(typeof token!=='string'||token.length>20000)throw invalid();
    const parts=token.split('.');if(parts.length!==3||parts.some(x=>!x||!/^[A-Za-z0-9_-]+$/.test(x)))throw invalid();
    const header=JSON.parse(Buffer.from(parts[0],'base64url')),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
    if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200||header.crit||header.b64===false)throw invalid();
    if(!Array.isArray(jwks?.keys)||jwks.keys.length>20)throw invalid();
    const keys=jwks.keys.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig')&&(!k.key_ops||k.key_ops.includes('verify')));
    if(keys.length!==1)throw invalid();
    const key=createPublicKey({key:keys[0],format:'jwk'});
    if(key.asymmetricKeyDetails?.modulusLength<2048||!verifySignature('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url')))throw invalid();
    if(claims.iss!==issuer||claims.aud!==clientId||(claims.azp&&claims.azp!==clientId)||claims.token_use!=='id'||!equal(claims.nonce,nonce))throw invalid();
    if(!Number.isInteger(claims.exp)||claims.exp<=nowSeconds||!Number.isInteger(claims.iat)||claims.iat>nowSeconds+60||claims.iat<flowCreatedSeconds-60)throw invalid();
    if(claims.nbf!==undefined&&(!Number.isInteger(claims.nbf)||claims.nbf>nowSeconds))throw invalid();
    if(typeof claims.sub!=='string'||!claims.sub||claims.sub.length>256||typeof claims.email!=='string'||claims.email.length>254||!emailPattern.test(claims.email)||claims.email_verified!==true)throw invalid();
    return {subject:claims.sub,email:claims.email.toLowerCase(),name:typeof claims.name==='string'?claims.name.slice(0,120):claims.email.split('@')[0],expires:claims.exp};
  }catch{throw invalid();}
}

export function createIdentity({db,row,rows,run,id,now,transaction,requireThat,textField,send,body,config,transport=providerJSON,clerkOptions={}}) {
  const cfg=config||identityConfig();
  const enabled=()=>cfg.configured&&!cfg.demoMode;
  const sessionCookieName=cfg.insecureLocal?'voqro_auth_local':authCookie;
  const sessionCookie=(value,seconds)=>cfg.insecureLocal?`voqro_auth_local=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}`:cookie(authCookie,value,seconds);
  db.exec(`
    CREATE TABLE IF NOT EXISTS identity_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id),issuer TEXT NOT NULL,subject TEXT NOT NULL,email TEXT NOT NULL UNIQUE,status TEXT NOT NULL,created TEXT NOT NULL,UNIQUE(issuer,subject));
    CREATE TABLE IF NOT EXISTS identity_sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS identity_flows(state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,nonce TEXT NOT NULL,verifier TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS identity_invitations(id TEXT PRIMARY KEY,email TEXT NOT NULL,role TEXT NOT NULL,brand_id TEXT REFERENCES brands(id),creator_id TEXT REFERENCES creators(id),status TEXT NOT NULL,expires INTEGER NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL,accepted_by TEXT REFERENCES users(id),accepted_at TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS pending_identity_invitation ON identity_invitations(email) WHERE status='Pending';
    CREATE TABLE IF NOT EXISTS identity_audit(id TEXT PRIMARY KEY,actor_id TEXT REFERENCES users(id),action TEXT NOT NULL,target_id TEXT NOT NULL,reason TEXT NOT NULL,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS identity_bootstrap(id INTEGER PRIMARY KEY CHECK(id=1),user_id TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL);
  `);
  let keyCache=null,keyExpiry=0;
  const audit=(actor,action,target,reason)=>run('INSERT INTO identity_audit VALUES(?,?,?,?,?,?)',id('authaudit'),actor,action,target,reason,now());
  const publicConfig=()=>({provider:cfg.provider==='clerk'?'Clerk':cfg.provider==='password'?'Password':'Cognito',...clerk.status(),configured:!!cfg.configured,available:enabled(),demo:!!cfg.demoMode,sign_in_path:enabled()&&cfg.provider==='clerk'?'/login':enabled()&&cfg.provider!=='password'?'/api/identity/start':null,...(cfg.provider==='password'?{bootstrap_required:enabled()&&passwords.bootstrapRequired(),password_min_length:12,email_verification:'Owner-authorized email; inbox ownership is not independently verified.'}:{}),status:cfg.demoMode?'Demo mode; production sign-in disabled.':cfg.problem||(cfg.provider==='clerk'?'Clerk sign-in available. Agency membership requires an invitation.':cfg.provider==='password'?'Password sign-in available. Registration requires an owner-issued invitation.':'Configured; live provider sign-in must still be verified.'),missing:cfg.missing||[]});
  function owner(u,write=false,req){requireThat(u?.role==='owner',403,'Only the agency owner can manage access.');if(write){const current=row("SELECT u.role FROM users u JOIN identity_accounts a ON a.user_id=u.id WHERE u.id=? AND a.status='Active'",u.id);requireThat(enabled()&&current?.role==='owner',403,'An active production owner is required. Shared demo identities cannot grant production access.');if(req){const active=session(req);requireThat(active?.id===u.id&&active.role==='owner',401,'Your owner session changed. Sign in again before managing access.');}}}
  const ownerTransaction=(u,req,fn)=>transaction(()=>{owner(u,true,req);return fn();});
  function scope(b){requireThat(roles.includes(b.role),400,'Choose a supported role.');let brand=null,creator=null;
    if(b.role==='brand'){brand=textField(b.brand_id,'Brand',100);requireThat(row('SELECT id FROM brands WHERE id=?',brand),400,'Choose an existing brand.');requireThat(!b.creator_id,400,'Brand members cannot have a creator assignment.');}
    else if(b.role==='creator'){creator=textField(b.creator_id,'Creator',100);requireThat(row('SELECT id FROM creators WHERE id=?',creator),400,'Choose an existing creator.');requireThat(!b.brand_id,400,'Creator membership cannot include a brand role.');}
    else requireThat(!b.brand_id&&!b.creator_id,400,'Agency roles cannot have a brand or creator assignment.');
    return {role:b.role,brand_id:brand,creator_id:creator};
  }
  function localSession(req){if(!enabled())return null;const token=readCookie(req,sessionCookieName);if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;return row("SELECT u.* FROM identity_sessions s JOIN users u ON u.id=s.user_id JOIN identity_accounts a ON a.user_id=u.id WHERE s.token=? AND s.expires>? AND a.status='Active'",digest(token),Date.now())||null;}
  function session(req){const user=localSession(req);return user&&(cfg.provider==='clerk'?clerk.sessionAllowed(req,user.id):!clerk.isProviderSession(req))?user:null;}
  function issueSession(req,userId){const previous=readCookie(req,sessionCookieName);if(previous)run('DELETE FROM identity_sessions WHERE token=?',digest(previous));run('DELETE FROM identity_sessions WHERE expires<=?',Date.now());const existing=rows('SELECT token FROM identity_sessions WHERE user_id=? ORDER BY created DESC',userId);for(const old of existing.slice(9))run('DELETE FROM identity_sessions WHERE token=?',old.token);const token=random(),seconds=3600;run('INSERT INTO identity_sessions VALUES(?,?,?,?)',digest(token),userId,Date.now()+seconds*1000,now());return {token,seconds};}
  const sessionHeaders=result=>({'Set-Cookie':[sessionCookie(result.token,result.seconds),'voqro_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0']});
  function logout(req,res){clerk.logout(req);for(const name of [authCookie,'voqro_auth_local']){const token=readCookie(req,name);if(token)run('DELETE FROM identity_sessions WHERE token=?',digest(token));}const demo=readCookie(req,'voqro_session');if(demo)run('DELETE FROM sessions WHERE token=?',digest(demo));send(res,200,{ok:true},{'Set-Cookie':[cookie(authCookie,'',0),cookie(flowCookie,'',0,'Lax'),'voqro_auth_local=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0','voqro_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0']});}
  const passwords=createPasswordIdentity({db,row,rows,run,id,now,transaction,requireThat,textField,send,body,cfg,scope,audit,issueSession,sessionHeaders,authorizeOwner:(u,req)=>owner(u,true,req)});
  const clerk=createClerkIdentity({db,row,run,id,now,transaction,requireThat,send,body,cfg,passwordProof:passwords.reauthenticate,localSession,issueSession,sessionHeaders,tokenHash:req=>digest(readCookie(req,sessionCookieName)),audit,...clerkOptions});
  async function keys(force=false){if(force||!keyCache||Date.now()>=keyExpiry){keyCache=await transport(cfg.issuer+'/.well-known/jwks.json');keyExpiry=Date.now()+600000;}return keyCache;}
  async function handlePublic(req,res,path){
    if(path==='/api/identity/config'&&req.method==='GET'){send(res,200,publicConfig());return true;}
    if(await clerk.handlePublic(req,res,path))return true;
    if(await passwords.handlePublic(req,res,path))return true;
    if(!['/api/identity/start','/api/identity/callback'].includes(path))return false;
    requireThat(req.method==='GET',405,'Use GET for sign-in.');requireThat(enabled()&&cfg.provider!=='password'&&cfg.provider!=='clerk',503,cfg.demoMode?'Disable demo mode before enabling production sign-in.':cfg.problem||'Cognito sign-in is not configured.');
    if(path==='/api/identity/start'){
      const state=random(),browser=random(),nonce=random(),verifier=random(),created=Date.now();
      transaction(()=>{run('DELETE FROM identity_flows WHERE expires<=?',created);const previous=readCookie(req,flowCookie);if(previous)run('DELETE FROM identity_flows WHERE browser_hash=?',digest(previous));run('DELETE FROM identity_sessions WHERE expires<=?',created);requireThat(row('SELECT COUNT(*) AS n FROM identity_flows').n<1000,429,'Too many pending sign-ins. Retry shortly.');run('INSERT INTO identity_flows VALUES(?,?,?,?,?,?)',digest(state),digest(browser),nonce,verifier,created,created+600000);});
      const url=new URL('/oauth2/authorize',cfg.domain);url.search=new URLSearchParams({response_type:'code',client_id:cfg.clientId,redirect_uri:cfg.baseURL+'/api/identity/callback',scope:'openid email profile',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
      res.writeHead(303,{Location:url.href,'Cache-Control':'no-store','Set-Cookie':cookie(flowCookie,browser,600,'Lax')});res.end();return true;
    }
    const query=new URL(req.url,cfg.baseURL).searchParams,state=query.get('state'),browser=readCookie(req,flowCookie);
    requireThat(typeof state==='string'&&/^[A-Za-z0-9_-]{43}$/.test(state)&&/^[A-Za-z0-9_-]{43}$/.test(browser),401,'The sign-in request has expired or belongs to another browser. Start again.');
    const flow=transaction(()=>{const pending=row('SELECT * FROM identity_flows WHERE state_hash=?',digest(state));requireThat(pending&&pending.expires>Date.now()&&equal(pending.browser_hash,digest(browser)),401,'The sign-in request has expired or belongs to another browser. Start again.');run('DELETE FROM identity_flows WHERE state_hash=?',digest(state));return pending;});
    res.setHeader('Set-Cookie',cookie(flowCookie,'',0,'Lax'));
    requireThat(!query.has('error'),401,'Sign-in was not completed. Start again when ready.');const code=query.get('code');requireThat(typeof code==='string'&&code.length>0&&code.length<=4096,400,'The identity provider did not return an authorization code.');
    let claims;
    try{
      const token=await transport(cfg.domain+'/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:cfg.clientId,redirect_uri:cfg.baseURL+'/api/identity/callback',code,code_verifier:flow.verifier}).toString()});
      let jwks=await keys();let keyId;try{keyId=JSON.parse(Buffer.from(token.id_token.split('.')[0],'base64url')).kid;}catch{throw invalid();}
      if(!jwks?.keys?.some(k=>k.kid===keyId))jwks=await keys(true);
      claims=await verifyCognitoToken(token.id_token,{issuer:cfg.issuer,clientId:cfg.clientId,nonce:flow.nonce,jwks,flowCreatedSeconds:Math.floor(flow.created/1000)});
    }catch(error){if(error.status===401)throw error;requireThat(false,502,'The identity provider could not complete sign-in. Start again; no session was created.');}
    const result=transaction(()=>{
      let account=row('SELECT * FROM identity_accounts WHERE issuer=? AND subject=?',cfg.issuer,claims.subject);
      if(account){requireThat(account.status==='Active'&&account.email===claims.email,403,'This membership is disabled or its verified email changed. Contact the agency owner.');}
      else{
        requireThat(!row('SELECT user_id FROM identity_accounts WHERE email=?',claims.email),403,'This email is already bound to another provider identity. Contact the agency owner.');
        run("UPDATE identity_invitations SET status='Expired' WHERE status='Pending' AND expires<=?",Date.now());
        const invite=row("SELECT * FROM identity_invitations WHERE email=? AND status='Pending' AND expires>?",claims.email,Date.now());
        const bootstrap=cfg.bootstrapEmail===claims.email&&!row('SELECT id FROM identity_bootstrap WHERE id=1')&&!row('SELECT user_id FROM identity_accounts LIMIT 1');
        requireThat(invite||bootstrap,403,'Your verified email does not have an active invitation. Contact the agency owner.');
        const userId=id('member'),membership=bootstrap?{role:'owner',brand_id:null,creator_id:null}:invite;
        run('INSERT INTO users(id,name,role,brand_id,creator_id) VALUES(?,?,?,?,?)',userId,claims.name,membership.role,membership.brand_id,membership.creator_id);
        run('INSERT INTO identity_accounts VALUES(?,?,?,?,?,?)',userId,cfg.issuer,claims.subject,claims.email,'Active',now());
        if(bootstrap){run('INSERT INTO identity_bootstrap VALUES(1,?,?)',userId,now());audit(userId,'bootstrap',userId,'Explicit configured owner verified through Cognito.');}
        else{run("UPDATE identity_invitations SET status='Accepted',accepted_by=?,accepted_at=? WHERE id=?",userId,now(),invite.id);audit(userId,'accept-invitation',invite.id,'Verified email matched the owner-issued invitation.');}
        account={user_id:userId};
      }
      const previous=readCookie(req,authCookie);if(previous)run('DELETE FROM identity_sessions WHERE token=?',digest(previous));
      const token=random(),seconds=Math.max(1,Math.min(3600,claims.expires-Math.floor(Date.now()/1000)));run('INSERT INTO identity_sessions VALUES(?,?,?,?)',digest(token),account.user_id,Date.now()+seconds*1000,now());audit(account.user_id,'sign-in',account.user_id,'Verified Cognito identity; new local session.');return {token,seconds};
    });
    res.writeHead(303,{Location:cfg.baseURL+'/#workspace','Cache-Control':'no-store','Set-Cookie':[cookie(authCookie,result.token,result.seconds),cookie(flowCookie,'',0,'Lax'),'voqro_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0']});res.end();return true;
  }
  async function handleAuthed(req,res,path,u){
    if(await passwords.handleAuthed(req,res,path,u))return true;
    if(!path.startsWith('/api/identity/'))return false;owner(u);requireThat(row("SELECT user_id FROM identity_accounts WHERE user_id=? AND status='Active'",u.id)||!row('SELECT user_id FROM identity_accounts LIMIT 1'),403,'Demo accounts cannot inspect production access records.');
    if(path==='/api/identity/members'&&req.method==='GET'){
      send(res,200,{configuration:publicConfig(),can_manage:enabled()&&!!row("SELECT user_id FROM identity_accounts WHERE user_id=? AND status='Active'",u.id),members:rows('SELECT u.id,u.name,u.role,u.brand_id,u.creator_id,a.email,a.issuer,a.status,a.created FROM identity_accounts a JOIN users u ON u.id=a.user_id ORDER BY a.created').map(({issuer,...member})=>({...member,email_verified:issuer!=='urn:voqro:password'||(cfg.provider==='clerk'&&!!row('SELECT user_id FROM clerk_bindings WHERE user_id=? AND email=?',member.id,member.email))})),invitations:rows('SELECT * FROM identity_invitations ORDER BY created DESC').map(i=>({...i,status:i.status==='Pending'&&i.expires<=Date.now()?'Expired':i.status})),audit:rows('SELECT * FROM identity_audit ORDER BY rowid DESC LIMIT 100'),notice:cfg.provider==='password'?'Invitation secrets are shown once. Share them privately with the intended recipient. No email is sent; inbox ownership is not independently verified.':'Invitations grant app membership only. No email is sent and no provider account is created by this form.'});return true;
    }
    requireThat(req.method==='POST',405,'Use POST to manage access.');owner(u,true,req);const b=await body(req);requireThat(b&&typeof b==='object'&&!Array.isArray(b),400,'Send an access-management object.');owner(u,true,req);
    if(path==='/api/identity/invitations'){
      if(cfg.provider==='password'){send(res,201,passwords.invite(b,u,req));return true;}
      const email=textField(b.email,'Email',254).toLowerCase(),membership=scope(b);requireThat(emailPattern.test(email),400,'Enter a valid email address.');const days=b.days===undefined?7:b.days;requireThat(Number.isInteger(days)&&days>=1&&days<=30,400,'Invitation expiry must be 1–30 days.');
      const result=ownerTransaction(u,req,()=>{requireThat(!row('SELECT user_id FROM identity_accounts WHERE email=?',email),409,'This email already has a membership. Update that member instead.');run("UPDATE identity_invitations SET status='Expired' WHERE status='Pending' AND expires<=?",Date.now());const pending=row("SELECT * FROM identity_invitations WHERE email=? AND status='Pending'",email);if(pending){requireThat(pending.role===membership.role&&pending.brand_id===membership.brand_id&&pending.creator_id===membership.creator_id,409,'Revoke the pending invitation before changing its role or workspace.');return pending;}const iid=id('invite');run('INSERT INTO identity_invitations VALUES(?,?,?,?,?,?,?,?,?,?,?)',iid,email,membership.role,membership.brand_id,membership.creator_id,'Pending',Date.now()+days*86400000,u.id,now(),null,null);audit(u.id,'invite',iid,`Owner granted ${membership.role} membership to a verified email.`);return row('SELECT * FROM identity_invitations WHERE id=?',iid);});send(res,201,{...result,sign_in_url:cfg.baseURL+(cfg.provider==='clerk'?'/login':'/api/identity/start'),email_sent:false,provider_user_created:false});return true;
    }
    if(path==='/api/identity/invitations/revoke'){
      const iid=textField(b.id,'Invitation',100),reason=textField(b.reason,'Reason',1000);ownerTransaction(u,req,()=>{const i=row('SELECT * FROM identity_invitations WHERE id=?',iid);requireThat(i,404,'Invitation not found.');requireThat(i.status!=='Accepted',409,'This invitation was accepted; disable the member instead.');if(i.status!=='Revoked'){run("UPDATE identity_invitations SET status='Revoked' WHERE id=?",iid);run('DELETE FROM password_invitation_tokens WHERE invitation_id=?',iid);audit(u.id,'revoke-invitation',iid,reason);}});send(res,200,{ok:true});return true;
    }
    if(path==='/api/identity/members/update'){
      const uid=textField(b.id,'Member',100),membership=scope(b),reason=textField(b.reason,'Reason',1000);requireThat(['Active','Disabled'].includes(b.status),400,'Choose Active or Disabled.');
      ownerTransaction(u,req,()=>{const target=row('SELECT u.*,a.status FROM users u JOIN identity_accounts a ON a.user_id=u.id WHERE u.id=?',uid);requireThat(target,404,'Production member not found.');if(target.role==='owner'&&target.status==='Active'&&(membership.role!=='owner'||b.status!=='Active'))requireThat(row("SELECT COUNT(*) AS n FROM users u JOIN identity_accounts a ON a.user_id=u.id WHERE u.role='owner' AND a.status='Active'").n>1,409,'The last active owner cannot be disabled or demoted.');run('UPDATE users SET role=?,brand_id=?,creator_id=? WHERE id=?',membership.role,membership.brand_id,membership.creator_id,uid);run('UPDATE identity_accounts SET status=? WHERE user_id=?',b.status,uid);run('DELETE FROM identity_sessions WHERE user_id=?',uid);clerk.revokeUser(uid);audit(u.id,'update-member',uid,reason);});send(res,200,{ok:true,sessions_revoked:true});return true;
    }
    if(path==='/api/identity/members/revoke-sessions'){
      const uid=textField(b.id,'Member',100),reason=textField(b.reason,'Reason',1000);requireThat(row('SELECT user_id FROM identity_accounts WHERE user_id=?',uid),404,'Production member not found.');ownerTransaction(u,req,()=>{run('DELETE FROM identity_sessions WHERE user_id=?',uid);clerk.revokeUser(uid);audit(u.id,'revoke-sessions',uid,reason);});send(res,200,{ok:true});return true;
    }
    requireThat(false,404,'Identity endpoint not found.');
  }
  return {handlePublic,handleAuthed,prepare:clerk.prepare,session,publicConfig,logout,isDemoUser:uid=>demoIds.has(uid)&&!row('SELECT user_id FROM identity_accounts LIMIT 1')};
}
