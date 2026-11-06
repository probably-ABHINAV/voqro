import {copyFile, lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {isIP} from 'node:net';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privateNames = /(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|home\.arpa|test|invalid|example|onion)$/i;

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
  const backend = backendOrigin(env.VOQRO_BACKEND_ORIGIN);
  const s3 = uploadOrigin(env.VOQRO_S3_UPLOAD_ORIGIN);
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
        dest: `${backend}/api/$1`,
        headers: {
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
    await writeFile(join(staging, 'config.json'), JSON.stringify(config, null, 2) + '\n');
    await rm(output, {recursive: true, force: true});
    await rename(staging, output);
  } catch (error) {
    await rm(staging, {recursive: true, force: true});
    throw error;
  }
  return {output, backendOrigin: backendOrigin(env.VOQRO_BACKEND_ORIGIN)};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await buildVercel();
    console.log(`Vercel frontend prepared in ${result.output}. API requests use the configured persistent backend.`);
  } catch (error) {
    console.error(`Vercel build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
