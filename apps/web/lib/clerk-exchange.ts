export async function exchangeClerkSession(token:string) : Promise<{organization_id:string|null}> {
  const response=await fetch('/api/identity/clerk/exchange',{
    method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000),
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:'{}',
  });
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error('The workspace service is unavailable. Please retry.');
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Your workspace could not be opened.');
  return result;
}
