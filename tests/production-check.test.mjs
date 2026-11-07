import test from 'node:test';
import assert from 'node:assert/strict';
import {checkProduction} from '../scripts/check-production.mjs';

function response(url, override = {}) {
  const path = new URL(url).pathname;
  let status = 200, body, type = 'application/json';
  if (path === '/' || path === '/login') { body = '<html><title>Voqro</title></html>'; type = 'text/html'; }
  else if (path === '/api/health') body = {ok: true, demo: false, database: 'sqlite'};
  else if (path === '/api/identity/config') body = {provider: 'Clerk', configured: true, available: true, demo: false, signup_mode: 'open_verified_email', signup_type_optional: true, workspace_model: 'single_agency', workspace_switching: false};
  else { status = 401; body = {error: 'Sign in.'}; }
  body = override.body ?? body;
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {status: override.status ?? status, headers: {'content-type': type, 'cache-control': 'no-store', ...override.headers}});
}

test('production probes are unauthenticated GETs and verify both origins and the optional signup contract', async () => {
  const calls = [];
  const result = await checkProduction({fetcher: async (url, options) => {
    calls.push(url); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual');
    assert.equal(options.body, undefined); assert.equal(options.headers.Cookie, undefined); assert.equal(options.headers.Authorization, undefined);
    return response(url);
  }});
  assert.equal(result.ok, true); assert.equal(result.checks.length, 6);
  assert.equal(new Set(calls.map(url => new URL(url).origin)).size, 2);
});

test('monitor fails for redirects, previews, cached APIs, missing Clerk, required account type and exposed workspaces', async () => {
  for (const [path, override] of [
    ['/login', {status: 307}],
    ['/api/health', {body: {ok: true, demo: true, database: 'sqlite'}}],
    ['/api/health', {headers: {'cache-control': 'public, max-age=60'}}],
    ['/api/identity/config', {body: {provider: 'Password', configured: true}}],
    ['/api/identity/config', {body: {provider: 'Clerk', configured: true, available: true, demo: false, signup_mode: 'open_verified_email', signup_type_optional: false, workspace_model: 'single_agency', workspace_switching: false}}],
    ['/api/workspace', {status: 200, body: {user: {}, brands: [{name: 'Private brand'}]}}],
    ['/api/workspace', {body: {error: 'Sign in', brands: [{name: 'Private brand'}]}}],
  ]) {
    const result = await checkProduction({fetcher: async url => response(url, new URL(url).pathname === path ? override : {})});
    assert.equal(result.ok, false, path); assert.equal(result.checks.length, 6);
    assert.equal(JSON.stringify(result).includes('Private brand'), false);
  }
});

test('monitor bounds bodies, continues after transport failures and does not print response or exception contents', async () => {
  for (const kind of ['oversized', 'invalid-json', 'transport']) {
    const result = await checkProduction({fetcher: async url => {
      if (new URL(url).pathname !== '/api/health') return response(url);
      if (kind === 'transport') throw new TypeError('Private connection details');
      return response(url, {body: kind === 'oversized' ? 'x'.repeat(2 * 1024 * 1024 + 1) : 'Private invalid JSON'});
    }});
    assert.equal(result.ok, false); assert.equal(result.checks.length, 6);
    assert.equal(JSON.stringify(result).includes('Private connection details'), false);
    assert.equal(JSON.stringify(result).includes('Private invalid JSON'), false);
  }
});
