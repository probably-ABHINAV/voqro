let activeOrganization:string|null=null;
export function setApiOrganization(id:string|null){activeOrganization=id;}
export function organizationHeaders():Record<string,string>{return activeOrganization?{'X-Voqro-Organization':activeOrganization}:{};}
export class ApiError extends Error {
  constructor(message:string,public status:number,public details?:unknown) {super(message);this.name='ApiError';}
}
export async function api<T=any>(path:string, body?:unknown):Promise<T> {
  const endpoint='/api/'+path.replace(/^\/?api\//,'').replace(/^\//,'');
  let response:Response;
  try {response=await fetch(endpoint,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000),headers:{Accept:'application/json',...organizationHeaders(),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
  catch {throw new ApiError('We could not reach the workspace. Check your connection and try again.',0);}
  const type=response.headers.get('content-type')||'';
  if(!type.includes('application/json'))throw new ApiError('The workspace service is unavailable. Its connection must be configured before records can load.',response.status||503);
  let result:any;
  try {result=await response.json();} catch {throw new ApiError('The workspace returned an unreadable response. Please try again.',502);}
  if(!response.ok)throw new ApiError(typeof result.error==='string'?result.error:'The request could not be completed.',response.status,result);
  return result as T;
}
