import https from 'node:https';
import {resolve4} from 'node:dns/promises';
import {isIP} from 'node:net';

const failure = message => Object.assign(new Error(message), {status: 400});
export function publicWebsite(value) {
  let url;
  try { url = new URL(value); } catch { throw failure('Enter a public HTTPS website address.'); }
  if (typeof value !== 'string' || value.length > 1000 || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || isIP(url.hostname) || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname) || /(?:^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(url.hostname)) throw failure('Use a public HTTPS website without credentials, query parameters or a custom port.');
  url.hash = '';
  return url.href;
}
export function publicIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a,b,c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2 || b === 88 && c === 99) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113 || address === '168.63.129.16');
}
export function extractWebsiteText(html) {
  return html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|template|svg|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/gi, entity => ({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"})[entity.toLowerCase()])
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 10000);
}
function requestPage(url, address) {
  return new Promise((resolve, reject) => {
    // Pin the validated IPv4 address while preserving Host and TLS certificate verification.
    const request = https.get(url, {agent:false, family:4, autoSelectFamily:false, servername:url.hostname,
      lookup:(_host, options, callback) => options?.all ? callback(null, [{address, family:4}]) : callback(null, address, 4),
      headers:{'User-Agent':'Voqro-Research/1.0',Accept:'text/html,text/plain','Accept-Encoding':'identity'}, signal:AbortSignal.timeout(12000)}, response => {
      const status = response.statusCode || 0;
      if ([301,302,303,307,308].includes(status)) { const location=response.headers.location; response.destroy(); resolve({status,location}); return; }
      const type = String(response.headers['content-type'] || '').split(';')[0].toLowerCase();
      if (status !== 200 || !['text/html','text/plain'].includes(type) || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); reject(failure('The website did not provide a readable public HTML or text page. Paste an excerpt instead.')); return; }
      let size=0; const chunks=[];
      response.on('data', chunk => { size+=chunk.length; if (size>512000) response.destroy(failure('This page is too large. Paste a relevant public excerpt instead.')); else chunks.push(chunk); });
      response.on('error',reject);
      response.on('end',()=>resolve({status,html:Buffer.concat(chunks).toString('utf8'),type}));
    });
    request.on('error',reject);
  });
}
export async function researchWebsite(value, {lookup=resolve4, transport=requestPage, environment=process.env} = {}) {
  // A proxy can resolve a hostname independently of the validated address. Do not bypass
  // managed proxy policy or claim DNS pinning on that route; use pasted evidence instead.
  if (['HTTPS_PROXY','HTTP_PROXY','https_proxy','http_proxy'].some(key => environment[key])) throw failure('Automatic website reading is unavailable on this network. Paste a public excerpt instead.');
  let url = new URL(publicWebsite(value));
  for (let hop=0; hop<3; hop++) {
    let timer, addresses;
    try { addresses=await Promise.race([lookup(url.hostname),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('Website lookup timed out.')),3000);})]); }
    finally { clearTimeout(timer); }
    if (!addresses?.length || addresses.some(address => !publicIPv4(address))) throw failure('This website does not resolve exclusively to permitted public IPv4 addresses.');
    const page = await transport(url,addresses[0]);
    if ([301,302,303,307,308].includes(page.status)) {
      if (!page.location) throw failure('The website returned an incomplete redirect.');
      url=new URL(publicWebsite(new URL(page.location,url).href)); continue;
    }
    if(page.status!==200)throw failure('The website is unavailable.');
    const text=page.type==='text/plain'?String(page.html).replace(/\s+/g,' ').trim().slice(0,10000):extractWebsiteText(page.html);
    if(text.length<80)throw failure('There is not enough readable text. Paste a public excerpt instead.');
    return {url:url.href,text,source:'Public HTML/text fetched; not a browser-rendered or performance audit',captured_at:new Date().toISOString()};
  }
  throw failure('The website redirected too many times. Use its final public URL.');
}
