import {copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {isIP} from 'node:net';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privateNames = /(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|home\.arpa|test|invalid|example|onion)$/i;
const previewFiles = ['entry.mjs', 'api.mjs', 'styles.css', 'fixtures.json'];

function isPreview(env) {
  if (env.VOQRO_PREVIEW !== undefined && !['', '0', '1'].includes(env.VOQRO_PREVIEW)) throw new Error('VOQRO_PREVIEW must be 1 for the isolated sample preview, or 0/unset for the connected application.');
  return env.VOQRO_PREVIEW === '1';
}

/** The rewrite target is deployment configuration, never a visitor-supplied URL. */
export function backendOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Set VOQRO_BACKEND_ORIGIN to the HTTPS origin of the persistent Voqro backend before building for Vercel.');
  }
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('VOQRO_BACKEND_ORIGIN must be a valid HTTPS origin.'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port) {
    throw new Error('VOQRO_BACKEND_ORIGIN must use HTTPS on port 443, without credentials, a path, query, or fragment.');
  }
  if (isIP(hostname) || privateNames.test(hostname) || !hostname.includes('.') || hostname.endsWith('.') || hostname.length > 253 || hostname.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    throw new Error('VOQRO_BACKEND_ORIGIN must use a public DNS hostname; IP literals and local/private hostnames are not allowed.');
  }
  return url.origin;
}

export function uploadOrigin(value) {
  if (!value) return '';
  const origin = backendOrigin(value);
  const url = new URL(origin);
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.s3\.ap-south-1\.amazonaws\.com$/.test(url.hostname)) {
    throw new Error('VOQRO_S3_UPLOAD_ORIGIN must name one exact Mumbai S3 bucket HTTPS origin.');
  }
  return origin;
}

export function outputConfiguration(env = process.env) {
  const preview = isPreview(env);
  const backend = preview ? null : backendOrigin(env.VOQRO_BACKEND_ORIGIN);
  const s3 = preview ? '' : uploadOrigin(env.VOQRO_S3_UPLOAD_ORIGIN);
  return {
    version: 3,
    routes: [
      {
        src: '^/.*$',
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'same-origin',
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'" + (s3 ? ` ${s3}` : '') + "; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        },
        continue: true
      },
      {
        src: '^/api(?:/(.*))?$',
        dest: preview ? '/preview/api-unavailable.json' : `${backend}/api/$1`,
        ...(preview ? {status: 503} : {}),
        headers: {
          ...(preview ? {'Content-Type': 'application/json; charset=utf-8'} : {}),
          'Cache-Control': 'no-store',
          'CDN-Cache-Control': 'no-store',
          'Vercel-CDN-Cache-Control': 'no-store',
          'x-vercel-enable-rewrite-caching': '0'
        }
      },
      {src: '^/$', dest: '/index.html'},
      {handle: 'filesystem'},
      {src: '^/.*$', status: 404}
    ]
  };
}

async function addPreviewFiles(root, staticDirectory) {
  const sourceDirectory = join(root, 'preview'), destination = join(staticDirectory, 'preview');
  const sourceStat = await lstat(sourceDirectory);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error('The preview source must be a real directory.');
  await mkdir(destination, {recursive: true});
  for (const name of previewFiles) {
    const source = join(sourceDirectory, name), stat = await lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Preview assets must be regular files without symbolic links.');
    await copyFile(source, join(destination, name));
  }
  const fixture = JSON.parse(await readFile(join(destination, 'fixtures.json'), 'utf8'));
  if (fixture.schema_version !== 1 || fixture.public?.demo !== true || !Array.isArray(fixture.users) || !fixture.users.length || fixture.users.some(user => !/^u_(owner|manager|reviewer|finance|brand|other|creator)$/.test(user.id) || fixture.workspaces?.[user.id]?.demo !== true)) {
    throw new Error('Preview fixtures must contain only explicitly marked demonstration workspaces.');
  }
  const indexPath = join(staticDirectory, 'index.html'), html = await readFile(indexPath, 'utf8');
  const appScript = /<script\b(?=[^>]*\btype\s*=\s*["']module["'])(?=[^>]*\bsrc\s*=\s*["']\/app\.js["'])[^>]*>\s*<\/script>/gi;
  if ((html.match(appScript) || []).length !== 1 || !/<\/head>/i.test(html)) throw new Error('The preview build requires exactly one application module script and an HTML head.');
  await writeFile(indexPath, html.replace(appScript, '<script type="module" src="/preview/entry.mjs"></script>').replace(/<\/head>/i, '<link rel="stylesheet" href="/preview/styles.css"></head>'));
  await writeFile(join(destination, 'api-unavailable.json'), JSON.stringify({error: 'This is a browser-only sample preview. A connected backend is required for direct API requests.', preview: true}) + '\n');
}

async function optionalStat(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function copyPublicDirectory(source, destination) {
  const stat = await lstat(source);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Public assets must be regular directories and files, without symbolic links.');
  await mkdir(destination, {recursive: true});
  for (const entry of await readdir(source, {withFileTypes: true})) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) throw new Error('Hidden files and symbolic links cannot be published from public/.');
    const from = join(source, entry.name), to = join(destination, entry.name);
    if (entry.isDirectory()) await copyPublicDirectory(from, to);
    else if (entry.isFile()) await copyFile(from, to);
    else throw new Error('Only regular files and directories can be published from public/.');
  }
}

export async function buildVercel({rootDirectory = projectRoot, env = process.env} = {}) {
  const config = outputConfiguration(env);
  const preview = isPreview(env);
  const root = resolve(rootDirectory), vercelDirectory = join(root, '.vercel'), output = join(vercelDirectory, 'output');
  for (const path of [vercelDirectory, output]) {
    const existing = await optionalStat(path);
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Vercel build directories must be real directories, not symbolic links or files.');
  }
  const index = await lstat(join(root, 'public', 'index.html'));
  if (!index.isFile() || index.isSymbolicLink()) throw new Error('public/index.html must be a regular file.');
  await mkdir(vercelDirectory, {recursive: true});
  const staging = await mkdtemp(join(vercelDirectory, 'output-build-'));
  try {
    await copyPublicDirectory(join(root, 'public'), join(staging, 'static'));
    if (preview) await addPreviewFiles(root, join(staging, 'static'));
    await writeFile(join(staging, 'config.json'), JSON.stringify(config, null, 2) + '\n');
    await rm(output, {recursive: true, force: true});
    await rename(staging, output);
  } catch (error) {
    await rm(staging, {recursive: true, force: true});
    throw error;
  }
  return {output, mode: preview ? 'preview' : 'connected', backendOrigin: preview ? null : backendOrigin(env.VOQRO_BACKEND_ORIGIN)};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await buildVercel();
    console.log(result.mode === 'preview' ? `Vercel sample preview prepared in ${result.output}. All interactive sample data stays in the visitor's browser; no backend is connected.` : `Vercel frontend prepared in ${result.output}. API requests use the configured persistent backend.`);
  } catch (error) {
    console.error(`Vercel build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
