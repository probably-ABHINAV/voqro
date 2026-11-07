import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const temp=mkdtempSync(resolve(tmpdir(),'voqro-modern-browser-'));
const backend=spawn(process.execPath,['--use-env-proxy','--disable-warning=ExperimentalWarning',resolve(root,'server.mjs')],{cwd:root,stdio:'inherit',env:{...process.env,NODE_ENV:'development',AUTH_PROVIDER:'password',AUTH_ALLOW_INSECURE_LOCAL:'1',DEMO_MODE:'0',COOKIE_SECURE:'0',APP_BASE_URL:'http://127.0.0.1:3210',PORT:'3211',HOST:'127.0.0.1',DB_PATH:resolve(temp,'production.sqlite'),UPLOAD_PATH:resolve(temp,'uploads'),IDENTITY_BOOTSTRAP_EMAIL:'owner@browser-test.example',IDENTITY_BOOTSTRAP_SECRET:'browser-test-only-bootstrap-key-0123456789',COGNITO_ISSUER:'',COGNITO_CLIENT_ID:'',COGNITO_DOMAIN:'',AWS_MEDIA_ENABLED:'0',AWS_AI_ENABLED:'0',INSTAGRAM_PUBLISH_ENABLED:'0',NOTIFICATION_EMAIL_ENABLED:'0'}});
const web=spawn(process.execPath,[resolve(root,'apps/web/node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3210'],{cwd:resolve(root,'apps/web'),stdio:'inherit',env:{...process.env,VOQRO_BACKEND_ORIGIN:'http://127.0.0.1:3211',NEXT_TELEMETRY_DISABLED:'1'}});
let stopped=false;
function stop(code=0){if(stopped)return;stopped=true;process.exitCode=code;for(const child of [web,backend])if(child.exitCode===null)child.kill('SIGTERM');const timer=setTimeout(()=>{for(const child of [web,backend])if(child.exitCode===null)child.kill('SIGKILL');},5000);timer.unref();}
for(const child of [web,backend]){child.on('error',e=>{console.error(e.message);stop(1);});child.on('exit',(code,signal)=>{if(!stopped)stop(code||(signal?1:0));});}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>stop());
process.on('exit',()=>rmSync(temp,{recursive:true,force:true}));
