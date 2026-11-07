import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const webPort = Number(process.env.WEB_PORT || 3100);
const backendPort = Number(process.env.BACKEND_PORT || 3101);
for (const port of [webPort, backendPort]) if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use valid local WEB_PORT and BACKEND_PORT values.');
if (webPort === backendPort) throw new Error('The frontend and backend need separate ports.');
const origin = `http://127.0.0.1:${webPort}`;
const env = {...process.env, NODE_ENV:'development', DEMO_MODE:'0', AUTH_PROVIDER:process.env.AUTH_PROVIDER || 'password', AUTH_ALLOW_INSECURE_LOCAL:'1', APP_BASE_URL:origin, DB_PATH:resolve(root,process.env.DB_PATH || '.data/fullstack/voqro.sqlite'), UPLOAD_PATH:resolve(root,process.env.UPLOAD_PATH || '.data/fullstack/uploads')};
if (!env.IDENTITY_BOOTSTRAP_EMAIL || !env.IDENTITY_BOOTSTRAP_SECRET) console.error('First owner setup requires IDENTITY_BOOTSTRAP_EMAIL and IDENTITY_BOOTSTRAP_SECRET in your private .env.fullstack file. Existing accounts can keep signing in.');
const children = [
  spawn(process.execPath,['--use-env-proxy','--disable-warning=ExperimentalWarning',resolve(root,'server.mjs')],{cwd:root,env:{...env,HOST:'127.0.0.1',PORT:String(backendPort)},stdio:'inherit'}),
  spawn(process.execPath,[resolve(root,'apps/web/node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(webPort)],{cwd:resolve(root,'apps/web'),env:{...process.env,VOQRO_BACKEND_ORIGIN:`http://127.0.0.1:${backendPort}`},stdio:'inherit'})
];
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;process.exitCode=code;for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');const timer=setTimeout(()=>{for(const child of children)if(child.exitCode===null)child.kill('SIGKILL');},5000);timer.unref();}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());
for(const child of children){child.on('error',error=>{console.error(error.message);stop(1);});child.on('exit',(code,signal)=>{if(!stopping)stop(code|| (signal?1:0));});}
console.log(`Voqro Next.js workspace: ${origin}. The Express API uses a separate persistent local database.`);
