import {createHmac,randomBytes} from 'node:crypto';

const HOUR=60*60*1000,DAY=24*HOUR;
export const DEFAULT_PUBLIC_LIMITS=Object.freeze({
  enquiry:Object.freeze({source:Object.freeze({limit:20,windowMs:HOUR}),global:Object.freeze({limit:200,windowMs:DAY})}),
  auth:Object.freeze({source:Object.freeze({limit:60,windowMs:HOUR}),global:Object.freeze({limit:1000,windowMs:DAY})})
});

export class RequestRateLimitError extends Error {
  constructor(retryAfterSeconds){
    super('Too many requests. Please wait before trying again.');
    this.name='RequestRateLimitError';
    this.status=429;
    this.retryAfterSeconds=retryAfterSeconds;
    this.headers={'Retry-After':String(retryAfterSeconds)};
  }
}

/** Durable, atomic public-route limits. Call before an anonymous mutation, outside another transaction. */
export function createRequestGuards({db,now=()=>Date.now(),limits={},cleanupBatchSize=250}={}) {
  if(!db||typeof db.prepare!=='function')throw new TypeError('A SQLite database is required.');
  if(typeof now!=='function')throw new TypeError('The clock must be a function.');
  if(!Number.isSafeInteger(cleanupBatchSize)||cleanupBatchSize<1||cleanupBatchSize>1000)throw new TypeError('Cleanup batch size must be 1–1000.');
  const configured={};
  for(const route of ['enquiry','auth']){
    configured[route]={};
    for(const scope of ['source','global']){
      const rule={...DEFAULT_PUBLIC_LIMITS[route][scope],...(limits[route]?.[scope]||{})};
      if(!Number.isSafeInteger(rule.limit)||rule.limit<1||rule.limit>1000000)throw new TypeError('Each request limit must be an integer from 1 to 1000000.');
      if(!Number.isSafeInteger(rule.windowMs)||rule.windowMs<1000||rule.windowMs>7*DAY)throw new TypeError('Each request window must be an integer from 1000 milliseconds to seven days.');
      configured[route][scope]=Object.freeze(rule);
    }
    Object.freeze(configured[route]);
  }
  Object.freeze(configured);
  db.exec(`
    CREATE TABLE IF NOT EXISTS public_guard_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS public_request_buckets(route TEXT NOT NULL,scope TEXT NOT NULL,source_key TEXT NOT NULL,window_start INTEGER NOT NULL,request_count INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(route,scope,source_key,window_start));
    CREATE INDEX IF NOT EXISTS public_request_expiry ON public_request_buckets(expires_at);
  `);
  db.prepare('INSERT OR IGNORE INTO public_guard_settings(key,value) VALUES(?,?)').run('source_hash_key',randomBytes(32).toString('hex'));
  const secret=db.prepare('SELECT value FROM public_guard_settings WHERE key=?').get('source_hash_key')?.value;
  if(typeof secret!=='string'||!/^[a-f0-9]{64}$/.test(secret))throw new Error('The public guard source-hash key is invalid. Restore its settings before serving public requests.');
  const key=Buffer.from(secret,'hex');
  const read=db.prepare('SELECT request_count FROM public_request_buckets WHERE route=? AND scope=? AND source_key=? AND window_start=?');
  const increment=db.prepare('INSERT INTO public_request_buckets(route,scope,source_key,window_start,request_count,expires_at) VALUES(?,?,?,?,1,?) ON CONFLICT(route,scope,source_key,window_start) DO UPDATE SET request_count=request_count+1');
  const prune=db.prepare('DELETE FROM public_request_buckets WHERE rowid IN (SELECT rowid FROM public_request_buckets WHERE expires_at<=? ORDER BY expires_at LIMIT ?)');
  let nextCleanupAt=0;
  function clock(){const timestamp=now();if(!Number.isSafeInteger(timestamp)||timestamp<0)throw new Error('The request guard clock must return a non-negative integer timestamp.');return timestamp;}
  function cleanup(){const timestamp=clock();const result=prune.run(timestamp,cleanupBatchSize);nextCleanupAt=timestamp+60000;return {deleted:result.changes};}
  function sourceKey(req){
    // Proxy headers are caller-controlled unless a separate trusted ingress validates them.
    // This guard deliberately uses only the directly connected network peer.
    let source=typeof req?.socket?.remoteAddress==='string'?req.socket.remoteAddress.toLowerCase():'unknown-peer';
    if(source.startsWith('::ffff:')&&/^\d+\.\d+\.\d+\.\d+$/.test(source.slice(7)))source=source.slice(7);
    return createHmac('sha256',key).update(source).digest('hex');
  }
  function check(req,route){
    if(!Object.hasOwn(configured,route))throw new TypeError('Unknown public request guard.');
    const timestamp=clock();
    if(timestamp>=nextCleanupAt)cleanup();
    const source=sourceKey(req),buckets=['source','global'].map(scope=>{
      const rule=configured[route][scope],windowStart=Math.floor(timestamp/rule.windowMs)*rule.windowMs;
      return {route,scope,source:scope==='source'?source:'global',windowStart,expiresAt:windowStart+rule.windowMs,limit:rule.limit};
    });
    db.exec('BEGIN IMMEDIATE');
    try{
      const exhausted=buckets.filter(b=>(read.get(b.route,b.scope,b.source,b.windowStart)?.request_count||0)>=b.limit);
      if(exhausted.length){const retryAfter=Math.max(1,Math.ceil((Math.max(...exhausted.map(b=>b.expiresAt))-timestamp)/1000));throw new RequestRateLimitError(retryAfter);}
      for(const b of buckets)increment.run(b.route,b.scope,b.source,b.windowStart,b.expiresAt);
      db.exec('COMMIT');
      return {allowed:true};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  return {check,cleanup,limits:configured};
}
