import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const frontend = 'https://voqro.vercel.app';
const backend = 'https://voqro-api-14829c4d.centralindia.cloudapp.azure.com';
const maximumBytes = 2 * 1024 * 1024;
class CheckFailure extends Error {}
function requireCheck(condition, message) { if (!condition) throw new CheckFailure(message); }

async function readBounded(response) {
  const reader = response.body?.getReader();
  requireCheck(reader, 'Response body is missing.');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      requireCheck(length <= maximumBytes, 'Response exceeds the monitoring size limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}

// Read-only, unauthenticated probes. Never submit forms, mint sessions or print bodies.
export async function checkProduction({fetcher = fetch, timeoutMs = 15000} = {}) {
  const checks = [
    {name: 'Website', url: frontend + '/', status: 200, html: true},
    {name: 'Sign-in page', url: frontend + '/login', status: 200, html: true},
    {name: 'Frontend API', url: frontend + '/api/health', status: 200, health: true},
    {name: 'Azure backend', url: backend + '/api/health', status: 200, health: true},
    {name: 'Clerk signup configuration', url: frontend + '/api/identity/config', status: 200, identity: true},
    {name: 'Private workspace protection', url: frontend + '/api/workspace', status: 401, private: true},
  ];
  const results = [];
  for (const check of checks) {
    const start = Date.now();
    try {
      const response = await fetcher(check.url, {
        method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
        headers: {Accept: check.html ? 'text/html' : 'application/json', 'User-Agent': 'Voqro-Availability-Check/1.0'},
      });
      if (response.status !== check.status) {
        await response.body?.cancel();
        throw new CheckFailure('Expected HTTP ' + check.status + ', received ' + response.status + '.');
      }
      const contentType = response.headers.get('content-type') || '';
      const body = await readBounded(response);
      if (check.html) {
        requireCheck(contentType.includes('text/html') && /voqro/i.test(body), 'Expected the Voqro HTML page.');
      } else {
        requireCheck(contentType.includes('application/json'), 'Expected JSON from the API.');
        requireCheck(/\bno-store\b/i.test(response.headers.get('cache-control') || ''), 'API response must not be cached.');
        let data;
        try { data = JSON.parse(body); } catch { throw new CheckFailure('API returned invalid JSON.'); }
        requireCheck(data && typeof data === 'object' && !Array.isArray(data), 'Expected a JSON object.');
        if (check.health) requireCheck(data.ok === true && data.demo === false && data.database === 'sqlite', 'Production backend health is not confirmed.');
        if (check.identity) requireCheck(data.provider === 'Clerk' && data.configured === true && data.available === true && data.demo === false && data.signup_mode === 'open_verified_email' && data.signup_type_optional === true && data.workspace_model === 'single_agency' && data.workspace_switching === false, 'Expected Clerk-only open signup with an optional account type in one agency.');
        if (check.private) requireCheck(typeof data.error === 'string' && Object.keys(data).length === 1, 'Expected only an authentication error for the private workspace.');
      }
      results.push({name: check.name, ok: true, duration_ms: Date.now() - start});
    } catch (error) {
      // Transport exceptions can contain URLs/headers. Only controlled validation messages are exposed.
      const message = error instanceof CheckFailure ? error.message : 'Request failed or timed out.';
      results.push({name: check.name, ok: false, duration_ms: Date.now() - start, error: message});
    }
  }
  return {ok: results.every(result => result.ok), checked_at: new Date().toISOString(), checks: results};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkProduction();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
