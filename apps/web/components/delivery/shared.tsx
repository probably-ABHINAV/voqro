'use client';

import {useCallback,useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {api} from '../../lib/api';

export const dateTime=(value:string)=>new Date(value).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'})+' IST';
export const localTime=(value:string)=>{const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
export const errorText=(error:unknown)=>error instanceof Error?error.message:'The request could not be completed. Please try again.';
export const Badge=({children}:{children:ReactNode})=><span className="inline-flex rounded-full border border-[#d8dfd2] bg-[#edf1e8] px-3 py-1 text-xs font-medium text-[#365144]">{children}</span>;
export function Field({label,name,value='',type='text',required=true,maxLength=2000,min,max,step}:{label:string;name:string;value?:string|number;type?:string;required?:boolean;maxLength?:number;min?:string|number;max?:string|number;step?:string|number}){
 return <label className="field"><span>{label}</span><input className="input" name={name} type={type} defaultValue={value} required={required} maxLength={maxLength} min={min} max={max} step={step}/></label>;
}
export function Area({label,name,value='',required=true,maxLength=5000}:{label:string;name:string;value?:string;required?:boolean;maxLength?:number}){
 return <label className="field"><span>{label}</span><textarea className="input min-h-24" name={name} defaultValue={value} required={required} maxLength={maxLength}/></label>;
}
export function SaveForm({title,children,label='Save',onSave,onCancel}:{title:string;children:ReactNode;label?:string;onSave:(values:Record<string,FormDataEntryValue>,form:HTMLFormElement)=>Promise<void>;onCancel:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return;const form=event.currentTarget;setBusy(true);setError('');try{await onSave(Object.fromEntries(new FormData(form)),form);}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <section className="card space-y-5 border-2 border-[#abc19e]"><h2 className="text-xl font-semibold">{title}</h2><form onSubmit={submit} className="space-y-5"><fieldset disabled={busy} className="min-w-0 space-y-5">{children}</fieldset>{error&&<p className="error" role="alert">{error}</p>}<div className="flex flex-wrap gap-3"><button className="btn btn-primary" type="submit" disabled={busy}>{busy?'Saving…':label}</button><button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button></div></form></section>;
}
export function useResource<T>(path:string,userId:string){
 const key=userId+':'+path,request=useRef(0);
 const [state,setState]=useState<{key:string;data:T|null;error:string;loading:boolean}>({key,data:null,error:'',loading:true});
 const reload=useCallback(async()=>{const generation=++request.current;setState(previous=>({key,data:previous.key===key?previous.data:null,error:'',loading:true}));try{const data=await api<T>(path);if(generation===request.current)setState({key,data,error:'',loading:false});}catch(error){if(generation===request.current)setState(previous=>({key,data:previous.key===key?previous.data:null,error:errorText(error),loading:false}));throw error;}},[key,path]);
 useEffect(()=>{void reload().catch(()=>{});return()=>{request.current++;};},[reload]);
 return {data:state.key===key?state.data:null,error:state.key===key?state.error:'',loading:state.key!==key||state.loading,reload};
}
export function ResourceStatus({error,loading,onRetry}:{error:string;loading:boolean;onRetry:()=>void}){
 return <div className="card space-y-3" role={error?'alert':'status'}><p>{error|| (loading?'Loading private campaign records…':'No record is available.')}</p>{error&&<button className="btn" onClick={onRetry}>Retry</button>}</div>;
}
