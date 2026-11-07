'use client';

import {useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode} from 'react';
import {api} from '@/lib/api';
import type {ScreenProps} from '@/lib/types';

export type Row = Record<string, any>;
export type Option = {value:string;label:string};
export type FieldSpec = {name:string;label:string;type?:string;value?:string|number;required?:boolean;options?:Option[];min?:number;max?:number;step?:number|string;hint?:string;disabled?:boolean};
export const opts=(rows:Row[],label='name',value='id'):Option[]=>rows.map(row=>({value:String(row[value]),label:String(row[label]??row.title??row.id)}));
export const today=()=>new Date().toISOString().slice(0,10);
export const localTime=(value?:string)=>{const date=value?new Date(value):new Date();return Number.isNaN(date.getTime())?'':new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);};
export const dateTime=(value?:string|null)=>value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST':'Not recorded';
export const sentence=(error:unknown)=>error instanceof Error?error.message:'The request could not be completed.';
export const usd=(value:number=0)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
export function useResource(path:string,principal:string){
  const [loaded,setLoaded]=useState<{key:string;value:Row}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const key=path+':'+principal;
  const generation=useRef(0);
  const reload=useCallback(async()=>{const request=++generation.current;setBusy(true);setError('');try{const value=await api(path);if(request===generation.current)setLoaded({key,value});}catch(e){if(request===generation.current)setError(sentence(e));}finally{if(request===generation.current)setBusy(false);}},[path,key]);
  useEffect(()=>{setLoaded(null);void reload();return()=>{generation.current++;};},[reload]);
  return {data:loaded?.key===key?loaded.value:null,error,busy,reload};
}
export function Resource({resource,children}:{resource:ReturnType<typeof useResource>;children:ReactNode}){return <>{resource.error&&<div className="error" role="alert">{resource.error} <button className="btn" onClick={()=>void resource.reload()}>Retry loading</button></div>}{resource.data?children:!resource.error&&<p role="status">Loading workspace records…</p>}</>;}
export function Header({title,description,reload}:{title:string;description:string;reload?:()=>Promise<void>}){return <header className="page-title"><div><h1>{title}</h1><p className="muted">{description}</p></div>{reload&&<button className="btn" onClick={()=>void reload()}>Refresh records</button>}</header>;}
export function Card({title,children}:{title?:string;children:ReactNode}){return <section className="card" style={{marginBlock:'1rem',padding:'1.25rem'}}>{title&&<h2>{title}</h2>}{children}</section>;}
export function Empty({children}:{children:ReactNode}){return <p className="muted">{children}</p>;}
export function Badge({children}:{children:ReactNode}){return <span className="badge">{children}</span>;}
export function Facts({values}:{values:Row}){return <dl className="form-grid" style={{marginBlock:'1rem'}}>{Object.entries(values).map(([key,value])=><div key={key} style={{minWidth:0,marginBottom:'0.75rem'}}><dt className="muted">{key.replaceAll('_',' ')}</dt><dd style={{margin:0,overflowWrap:'anywhere'}}>{value===null||value===undefined?'Unknown':String(value)}</dd></div>)}</dl>;}
export function ExternalLink({href,children}:{href?:string;children:ReactNode}){let safe=false;try{safe=!!href&&['https:','http:'].includes(new URL(href).protocol);}catch{}return safe?<a className="btn" href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span className="muted">Link unavailable</span>;}
export function Field({field}:{field:FieldSpec}){const common={name:field.name,required:field.required!==false,disabled:field.disabled,defaultValue:field.value??'',className:'input'};return <label className="field"><span>{field.label}</span>{field.type==='textarea'?<textarea {...common} rows={3} maxLength={12000}/>:field.options?<select {...common}><option value="">Choose…</option>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:field.type==='checkbox'?<input name={field.name} type="checkbox" defaultChecked={field.value==='on'} required={field.required===true} disabled={field.disabled} style={{width:20,minHeight:20,alignSelf:'flex-start'}}/>:<input {...common} type={field.type||'text'} min={field.min} max={field.max} step={field.step} maxLength={4000}/ >}{field.hint&&<small className="muted">{field.hint}</small>}</label>;}
export function NativeForm({title,fields,submit,label='Save record',description,disabled=false}:{title:string;fields:FieldSpec[];submit:(input:Row)=>Promise<void>;label?:string;description?:string;disabled?:boolean}){
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();setPending(true);setError('');const form=event.currentTarget;try{await submit(Object.fromEntries(new FormData(form)));}catch(e){setError(sentence(e));}finally{setPending(false);}}
  return <Card title={title}>{description&&<p className="muted">{description}</p>}<form onSubmit={save}><fieldset disabled={pending||disabled} style={{border:0,padding:0,margin:0}}><div className="form-grid">{fields.map(field=><Field key={field.name} field={field}/>)}</div>{error&&<p className="error" role="alert">{error}</p>}<button type="submit" className="btn btn-primary" style={{marginTop:'1rem'}} disabled={pending||disabled}>{pending?'Saving…':label}</button></fieldset></form></Card>;
}
export function Action({children,run,disabled=false}:{children:ReactNode;run:()=>Promise<void>;disabled?:boolean}){const [pending,setPending]=useState(false),[error,setError]=useState('');return <span style={{display:'inline-block',margin:'0.25rem'}}><button className="btn" disabled={disabled||pending} onClick={async()=>{setPending(true);setError('');try{await run();}catch(e){setError(sentence(e));}finally{setPending(false);}}}>{pending?'Working…':children}</button>{error&&<span role="alert" className="error" style={{display:'block'}}>{error}</span>}</span>;}
export function useSave(props:ScreenProps,reload:()=>Promise<void>){return async(path:string,body:Row,message='Record saved.')=>{const result=await api(path,body);await reload();props.notify(message);try{await props.refresh();}catch{props.notify('Saved. Workspace summary could not refresh; reload when your connection returns.');}return result;};}
export const campaignField=(props:ScreenProps):FieldSpec=>({name:'campaign_id',label:'Campaign',options:opts(props.workspace.campaigns)});
export const creatorField=(props:ScreenProps,required=false):FieldSpec=>({name:'creator_id',label:'Creator',required,options:opts(props.workspace.creators)});
export function Disclosure({title,children}:{title:string;children:ReactNode}){return <details style={{marginBlock:'1rem'}}><summary className="btn">{title}</summary>{children}</details>;}
