# Public request limits

`request-guards.mjs` adds SQLite-backed, fixed-window rate limits before anonymous enquiries and sign-in starts. Counters survive application restarts. Both the directly connected source and a global route budget must have capacity; updating them happens in one SQLite transaction. Rejected attempts increment neither counter, so a blocked source cannot consume capacity belonging to other sources.

Default pilot limits:

| Route class | Per connected source | Across all sources |
| --- | --- | --- |
| Enquiry submission | 20 per hour | 200 per day |
| Demo login and OIDC sign-in start, combined | 60 per hour | 1,000 per day |

Windows align to Unix time boundaries; daily windows therefore reset at midnight UTC. Fixed windows can admit a burst on each side of a boundary. These limits are conservative pilot settings and can be changed through the factory's `limits` option. Every configured limit must remain positive. Body-size validation remains the responsibility of the existing request parser.

The source identifier is an HMAC of `req.socket.remoteAddress`, using a random key persisted in the database. Raw network addresses, forwarded headers, emails, enquiry contents and authentication credentials are not stored in rate-limit records. IPv4-mapped IPv6 peers are normalised to the corresponding IPv4 source. Missing socket addresses share a single unknown-peer bucket. `X-Forwarded-For`, `Forwarded` and `X-Real-IP` are deliberately ignored.

Behind a reverse proxy, many users may share the same connected source and therefore the same limit. The guard does not infer a trusted client address from arbitrary headers. A future trusted-ingress configuration must authenticate the proxy before accepting any forwarded identity. This is a local application abuse guard, not a complete bot defence, distributed WAF, DDoS shield or proof of a human visitor. Global limits bound accepted public-route work but cannot guarantee an AWS spending ceiling.

## Integration

```js
import {createRequestGuards} from './request-guards.mjs';
const requestGuards = createRequestGuards({db});

// Before parsing/creating an anonymous enquiry:
if (path === '/api/enquiries' && req.method === 'POST') {
  requestGuards.check(req, 'enquiry');
}
// Before demo login or calling the OIDC public start handler:
if ((path === '/api/login' && req.method === 'POST') ||
    (path === '/api/identity/start' && req.method === 'GET')) {
  requestGuards.check(req, 'auth');
}
```

Call the guard outside any existing database transaction. `check` returns `{allowed:true}` when admitted. On exhaustion it throws `RequestRateLimitError` with `status:429`, `retryAfterSeconds`, and `headers:{'Retry-After':'…'}`. Forward those headers in the server error handler:

```js
send(res, error.status || 500,
  {error: error.status ? error.message : 'Please retry.'}, error.headers || {});
```

When several buckets are exhausted, `Retry-After` covers the longest remaining window. It is a positive integer number of seconds. There is no wait/sleep in the request path. Checking before a mutation means invalid public submissions also count once admitted, which limits repeated malformed requests. Denied new peers do not create source rows.

Cleanup removes at most 250 expired rows per automatic run, normally once per minute during traffic. A bounded manual `cleanup()` is also exposed. Active windows are retained. The source-hash key must remain present across restarts; malformed settings fail startup rather than silently resetting peer identities. Treat the database and its backups as private operational data.

The standalone tests use a fake clock and cover exact thresholds, retry headers, independent/global limits, forwarded-header spoofing, address hashing, persistence across restart, bounded cleanup, missing peers and invalid configuration. No external service or notification is involved.
