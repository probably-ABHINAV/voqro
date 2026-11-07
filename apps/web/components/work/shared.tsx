'use client';

import {useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode} from 'react';
import {api} from '../../lib/api';

export const today = () => new Date().toISOString().slice(0,10);
export const message = (error:unknown) => error instanceof Error ? error.message : 'The request could not be completed.';
export const values = (form:HTMLFormElement) => Object.fromEntries(new FormData(form)) as Record<string,string>;
export function cents(value:string) {const result=Math.round(Number(value)*100);if(!Number.isSafeInteger(result)||result<0)throw new Error('Enter a valid money amount.');return result;}
export function useRecords<T>(endpoint:string, principal:string) {
  const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const generation=useRef(0);
  const reload=useCallback(async()=>{const ticket=++generation.current;setLoading(true);setError('');try{const next=await api<T>(endpoint);if(ticket===generation.current)setData(next);return next;}catch(e){if(ticket===generation.current)setError(message(e));throw e;}finally{if(ticket===generation.current)setLoading(false);}},[endpoint,principal]);
  useEffect(()=>{setData(null);void reload().catch(()=>{});return()=>{generation.current++;};},[reload]);
  return {data,error,loading,reload};
}
export function LoadState({error,loading,retry}:{error:string;loading:boolean;retry:()=>unknown}) {return <div className="card p-6" role={error?'alert':'status'}>{error?<><p className="error">{error}</p><button className="btn mt-3" onClick={()=>void retry()}>Retry</button></>:loading?'Loading your records…':'No records yet.'}</div>;}
export function Heading({title,description,actions}:{title:string;description:string;actions?:ReactNode}) {return <header className="mb-7 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-medium tracking-tight sm:text-4xl">{title}</h1><p className="muted mt-2 max-w-2xl">{description}</p></div>{actions}</header>;}
export function Empty({title,children}:{title:string;children?:ReactNode}) {return <div className="rounded-2xl border border-dashed border-[#cdd6c7] p-8 text-center"><h3 className="font-semibold">{title}</h3><div className="muted mt-2">{children}</div></div>;}
export function Badge({children}:{children:ReactNode}) {return <span className="inline-flex rounded-full bg-[#e9eee2] px-3 py-1 text-xs font-medium text-[#355644]">{children}</span>;}
export function Field({label,children}:{label:string;children:ReactNode}) {return <label className="field flex flex-col gap-2 text-sm font-medium">{label}{children}</label>;}
export function Dialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const current=ref.current;const previous=document.activeElement as HTMLElement|null;current?.showModal();return()=>{current?.close();previous?.focus();};},[]);
  return <dialog ref={ref} onCancel={e=>{e.preventDefault();onClose();}} className="m-auto max-h-[90vh] w-[min(94vw,760px)] overflow-auto rounded-3xl border-0 bg-[#fafbf7] p-0 text-[#213b2d] shadow-2xl backdrop:bg-black/35" aria-labelledby="work-dialog-title"><header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#dfe5d8] bg-[#fafbf7] p-5"><h2 id="work-dialog-title" className="text-xl font-semibold">{title}</h2><button type="button" className="btn" aria-label="Close dialog" onClick={onClose}>Close</button></header><div className="p-5 sm:p-7">{children}</div></dialog>;
}
export function Form({children,onSave,label='Save',onCancel}:{children:ReactNode;onSave:(form:HTMLFormElement)=>Promise<unknown>;label?:string;onCancel?:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return;const form=event.currentTarget;setBusy(true);setError('');try{await onSave(form);}catch(e){setError(message(e));}finally{setBusy(false);}}
  return <form onSubmit={submit} className="space-y-5"><fieldset disabled={busy} className="space-y-5">{children}</fieldset>{error&&<p className="error" role="alert">{error}</p>}<div className="flex flex-wrap justify-end gap-3">{onCancel&&<button className="btn" type="button" disabled={busy} onClick={onCancel}>Cancel</button>}<button className="btn btn-primary" disabled={busy} type="submit">{busy?'Saving…':label}</button></div></form>;
}
