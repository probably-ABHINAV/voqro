import http from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile, realpath, stat} from 'node:fs/promises';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(projectRoot, '.vercel', 'output');
const root = await realpath(join(output, 'static'));
await stat(join(root, 'preview', 'entry.mjs'));
const configuration = JSON.parse(await readFile(join(output, 'config.json'), 'utf8'));
const globalHeaders = Object.assign({}, ...configuration.routes.filter(route => route.continue && route.src === '^/.*$').map(route => route.headers || {}));
const apiRoute = configuration.routes.find(route => route.src === '^/api(?:/(.*))?$');
if (apiRoute?.status !== 503 || apiRoute.dest !== '/preview/api-unavailable.json') {
  throw new Error('Build with VOQRO_PREVIEW=1 before running the static preview server.');
}
const apiUnavailable = await readFile(join(root, 'preview', 'api-unavailable.json'));
const port = Number(process.env.PREVIEW_PORT || 3002);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PREVIEW_PORT must be a valid TCP port.');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm'
};
const inside = path => path === root || path.startsWith(root + sep);

const server = http.createServer(async (request, response) => {
  function reply(status, body, headers = {}) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    response.writeHead(status, {...globalHeaders, 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': bytes.length, ...headers});
    response.end(request.method === 'HEAD' ? undefined : bytes);
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (pathname.includes('\0') || pathname.includes('\\')) return reply(400, 'Invalid path.');
    if (/^\/api(?:\/|$)/.test(pathname)) {
      return reply(503, apiUnavailable, {...apiRoute.headers, 'Content-Type': 'application/json; charset=utf-8'});
    }
    if (!['GET', 'HEAD'].includes(request.method)) return reply(405, 'Static preview supports GET and HEAD only.', {Allow: 'GET, HEAD'});
    const path = resolve(root, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
    if (!inside(path)) return reply(403, 'Path is outside the static preview.');
    const actual = await realpath(path);
    if (!inside(actual)) return reply(403, 'Path is outside the static preview.');
    const file = await stat(actual);
    if (!file.isFile()) return reply(404, 'Not found.');
    response.writeHead(200, {...globalHeaders, 'Cache-Control': 'no-store', 'Content-Type': types[extname(actual).toLowerCase()] || 'application/octet-stream', 'Content-Length': file.size});
    if (request.method === 'HEAD') return response.end();
    const stream = createReadStream(actual);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  } catch (error) {
    if (error instanceof URIError) return reply(400, 'Invalid path encoding.');
    if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) return reply(404, 'Not found.');
    reply(500, 'Unable to serve the static preview.');
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Static preview test server listening on loopback port ${port}.`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
