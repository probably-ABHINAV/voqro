import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
function config(env){
 return spawnSync(process.execPath,['--input-type=module','-e',"const {default:c}=await import('./apps/web/next.config.ts');console.log(JSON.stringify({env:c.env,rewrites:await c.rewrites()}));"],{encoding:'utf8',env:{...process.env,VERCEL:'1',NODE_ENV:'production',VERCEL_ENV:'production',VOQRO_BACKEND_ORIGIN:'',...env}});
}
test('Vercel production still fails closed without a persistent backend',()=>{
 const result=config({});assert.notEqual(result.status,0);assert.match(result.stderr,/Set VOQRO_BACKEND_ORIGIN/);
});
test('unconnected branch previews build without forwarding to production or enabling login',()=>{
 const result=config({VERCEL_ENV:'preview'});assert.equal(result.status,0,result.stderr);
 const data=JSON.parse(result.stdout);assert.equal(data.env.NEXT_PUBLIC_DISCONNECTED_PREVIEW,'1');assert.deepEqual(data.rewrites,[]);
});
test('connected deployment retains validated API forwarding',()=>{
 const result=config({VOQRO_BACKEND_ORIGIN:'https://backend.example.com'});assert.equal(result.status,0,result.stderr);
 const data=JSON.parse(result.stdout);assert.equal(data.env.NEXT_PUBLIC_DISCONNECTED_PREVIEW,'0');assert.equal(data.rewrites[0].destination,'https://backend.example.com/api/:path*');
 for(const value of ['http://localhost:3001','https://user:password@backend.example.com','https://backend.example.com/path'])assert.notEqual(config({VOQRO_BACKEND_ORIGIN:value}).status,0);
});
