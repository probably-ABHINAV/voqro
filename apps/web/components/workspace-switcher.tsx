'use client';
import {useEffect,useState} from 'react';
import {api,setApiOrganization} from '@/lib/api';
export function WorkspaceSwitcher(){
 const [data,setData]=useState<{active:{id:string};organizations:{id:string;name:string;kind:string}[]}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;void api('organizations').then(d=>{if(live)setData(d);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
 async function switchTo(id:string){setBusy(true);setError('');try{await api('organizations/switch',{organization_id:id});setApiOrganization(id);window.location.assign('/workspace');}catch(e){setError((e as Error).message);setBusy(false);}}
 return <div className="max-w-56"><label className="sr-only" htmlFor="workspace-selector">Current workspace</label>{data&&<select id="workspace-selector" aria-label="Current workspace" className="w-full text-sm" value={data.active.id} disabled={busy} onChange={e=>void switchTo(e.target.value)}>{data.organizations.map(o=><option value={o.id} key={o.id}>{o.name}{o.kind==='agency'?' · Agency':''}</option>)}</select>}{error&&<span role="alert" className="text-sm">{error}</span>}</div>;
}
