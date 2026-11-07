import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const configURL = new URL('../next.config.ts', import.meta.url).href;
function loadConfig(overrides) {
  const env = {...process.env, NODE_ENV:'production'};
  delete env.VERCEL;
  delete env.VOQRO_BACKEND_ORIGIN;
  Object.assign(env, overrides);
  return spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(configURL)});`], {env, encoding:'utf8'});
}

test('a Vercel production build refuses an unconfigured backend', () => {
  const result=loadConfig({VERCEL:'1'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Set VOQRO_BACKEND_ORIGIN/);
});

test('local artifact builds remain possible without pretending a backend is connected', () => {
  assert.equal(loadConfig({}).status,0);
});

test('Vercel accepts a public HTTPS backend and rejects local or reserved origins', () => {
  assert.equal(loadConfig({VERCEL:'1',VOQRO_BACKEND_ORIGIN:'https://api.voqro.com'}).status,0);
  for(const origin of ['http://127.0.0.1:3001','https://localhost','https://api.internal','https://fixture.invalid','https://192.168.0.2']) {
    const result=loadConfig({VERCEL:'1',VOQRO_BACKEND_ORIGIN:origin});
    assert.notEqual(result.status,0,origin);
    assert.match(result.stderr,/public HTTPS hostname/);
  }
});
