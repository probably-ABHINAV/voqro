import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequestGuards,RequestRateLimitError} from '../request-guards.mjs';

const request=(address,headers={})=>({socket:{remoteAddress:address},headers});
const small={enquiry:{source:{limit:2,windowMs:10000},global:{limit:4,windowMs:60000}},auth:{source:{limit:3,windowMs:10000},global:{limit:5,windowMs:60000}}};

test('source threshold is inclusive, denied requests preserve counts and Retry-After reaches the next window',()=>{
  const db=new DatabaseSync(':memory:');let time=1200;const guard=createRequestGuards({db,now:()=>time,limits:small});const req=request('203.0.113.10');
  try{
    assert.equal(guard.check(req,'enquiry').allowed,true);guard.check(req,'enquiry');
    assert.throws(()=>guard.check(req,'enquiry'),error=>error instanceof RequestRateLimitError&&error.status===429&&error.retryAfterSeconds===9&&error.headers['Retry-After']==='9');
    assert.deepEqual(db.prepare('SELECT request_count FROM public_request_buckets ORDER BY scope').all().map(x=>x.request_count),[2,2]);
    time=10000;assert.equal(guard.check(req,'enquiry').allowed,true);guard.check(req,'enquiry');assert.throws(()=>guard.check(req,'enquiry'),error=>error.retryAfterSeconds===50);
    time=60000;assert.equal(guard.check(req,'enquiry').allowed,true);
  }finally{db.close();}
});

test('global quota protects across peers without creating buckets for denied new sources',()=>{
  const db=new DatabaseSync(':memory:');const guard=createRequestGuards({db,now:()=>2000,limits:small});
  try{
    for(let i=0;i<4;i++)guard.check(request('198.51.100.'+i),'enquiry');
    assert.throws(()=>guard.check(request('198.51.100.99'),'enquiry'),error=>error.status===429&&error.retryAfterSeconds===58);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM public_request_buckets WHERE scope='source'").get().n,4);
    // Authentication uses its own bounded counters rather than spending enquiry capacity.
    assert.equal(guard.check(request('198.51.100.99'),'auth').allowed,true);
  }finally{db.close();}
});

test('untrusted forwarded headers cannot change the peer bucket and raw addresses are not persisted',()=>{
  const db=new DatabaseSync(':memory:');const guard=createRequestGuards({db,now:()=>2000,limits:small});
  try{
    guard.check(request('192.0.2.9',{'x-forwarded-for':'1.1.1.1','forwarded':'for=1.1.1.1'}),'enquiry');
    guard.check(request('::ffff:192.0.2.9',{'x-forwarded-for':'8.8.8.8','x-real-ip':'8.8.8.8'}),'enquiry');
    assert.throws(()=>guard.check(request('192.0.2.9',{'x-forwarded-for':'9.9.9.9'}),'enquiry'),error=>error.status===429);
    const persisted=db.prepare('SELECT * FROM public_request_buckets').all();assert.equal(persisted.length,2);const source=persisted.find(b=>b.scope==='source');assert.match(source.source_key,/^[a-f0-9]{64}$/);const json=JSON.stringify(persisted);assert.ok(!json.includes('192.0.2.9'));assert.ok(!json.includes('1.1.1.1'));assert.ok(!json.includes('8.8.8.8'));
  }finally{db.close();}
});

test('limits and keyed peer identities survive a database restart',()=>{
  const directory=mkdtempSync(resolve(tmpdir(),'voqro-guards-')),path=resolve(directory,'db.sqlite');let db=new DatabaseSync(path);
  try{
    const first=createRequestGuards({db,now:()=>3000,limits:small});first.check(request('203.0.113.2'),'enquiry');first.check(request('203.0.113.2'),'enquiry');db.close();db=new DatabaseSync(path);
    const restarted=createRequestGuards({db,now:()=>3001,limits:small});assert.throws(()=>restarted.check(request('203.0.113.2'),'enquiry'),error=>error.status===429);assert.equal(db.prepare("SELECT COUNT(*) n FROM public_request_buckets WHERE scope='source'").get().n,1);
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

test('cleanup is bounded and leaves active counters untouched',()=>{
  const db=new DatabaseSync(':memory:');let time=1000;const guard=createRequestGuards({db,now:()=>time,limits:small,cleanupBatchSize:2});
  try{
    const put=db.prepare('INSERT INTO public_request_buckets VALUES(?,?,?,?,?,?)');for(let i=0;i<5;i++)put.run('enquiry','source','old-'+i,0,1,999);
    put.run('enquiry','source','active',0,1,10000);
    assert.equal(guard.cleanup().deleted,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM public_request_buckets').get().n,4);assert.equal(guard.cleanup().deleted,2);assert.equal(guard.cleanup().deleted,1);assert.equal(guard.cleanup().deleted,0);assert.equal(db.prepare('SELECT source_key FROM public_request_buckets').get().source_key,'active');
    time=10000;assert.equal(guard.cleanup().deleted,1);
  }finally{db.close();}
});

test('missing peers aggregate, invalid configuration and unknown route kinds fail closed',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    assert.throws(()=>createRequestGuards({db,limits:{auth:{source:{limit:0}}}}),/request limit/);
    assert.throws(()=>createRequestGuards({db,cleanupBatchSize:1001}),/Cleanup/);
    const guard=createRequestGuards({db,now:()=>2000,limits:small});guard.check({},'enquiry');guard.check({headers:{'x-forwarded-for':'203.0.113.1'}},'enquiry');assert.throws(()=>guard.check({},'enquiry'),error=>error.status===429);assert.throws(()=>guard.check({},'admin'),/Unknown/);
  }finally{db.close();}
});
