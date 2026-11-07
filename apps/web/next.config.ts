import type {NextConfig} from 'next';
import {isIP} from 'node:net';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const webRoot = dirname(fileURLToPath(import.meta.url));

const configured = process.env.VOQRO_BACKEND_ORIGIN;
if (process.env.VERCEL === '1' && process.env.NODE_ENV === 'production' && !configured) {
  throw new Error('Set VOQRO_BACKEND_ORIGIN to the public HTTPS origin of the persistent Voqro backend before deploying this application to Vercel. A frontend build cannot provide accounts, saved records or workers without that backend.');
}
let backend: string | null = null;
if (configured) {
  let url:URL;
  try {url = new URL(configured);} catch {throw new Error('VOQRO_BACKEND_ORIGIN must be a valid HTTP(S) origin.');}
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['http:', 'https:'].includes(url.protocol)) throw new Error('VOQRO_BACKEND_ORIGIN must be an origin without credentials or a path.');
  if (process.env.NODE_ENV === 'production' && (url.protocol !== 'https:' || local || isIP(url.hostname) || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(url.hostname) || (url.port && url.port !== '443'))) throw new Error('Production VOQRO_BACKEND_ORIGIN must use a public HTTPS hostname.');
  backend = url.origin;
} else if (process.env.NODE_ENV === 'development') backend = 'http://127.0.0.1:3001';

const config: NextConfig = {
  poweredByHeader: false,
  turbopack: {root: webRoot},
  outputFileTracingRoot: webRoot,
  output: 'standalone',
  async rewrites() {return backend ? [{source: '/api/:path*', destination: `${backend}/api/:path*`}] : [];},
  async headers() {return [{source: '/:path*', headers: [
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'X-Frame-Options',value:'DENY'},
    {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
    {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'}
  ]}, {source:'/api/:path*',headers:[{key:'Cache-Control',value:'no-store'},{key:'CDN-Cache-Control',value:'no-store'},{key:'Vercel-CDN-Cache-Control',value:'no-store'}]}];},
};
export default config;
