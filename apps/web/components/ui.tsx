'use client';
import {cloneElement,isValidElement,useEffect,useId,useRef} from 'react';
import type {ButtonHTMLAttributes,HTMLAttributes,ReactNode} from 'react';

export function Button({className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>){return <button {...props} className={`btn ${className}`}/>;}
export function Card({className='',...props}:HTMLAttributes<HTMLElement>){return <section {...props} className={`card ${className}`}/>;}
export function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}){
 const generatedId=useId(),hintId=generatedId+'-hint';
 const control=isValidElement<{id?:string;'aria-describedby'?:string}>(children)?children:null;
 const controlId=control?.props.id||generatedId;
 const describedBy=[control?.props['aria-describedby'],hint?hintId:undefined].filter(Boolean).join(' ')||undefined;
 return <div className="field"><label htmlFor={controlId}>{label}</label>{control?cloneElement(control,{id:controlId,'aria-describedby':describedBy}):children}{hint&&<small id={hintId} className="muted">{hint}</small>}</div>;
}
export function Empty({title,children}:{title:string;children?:ReactNode}){return <div className="empty"><span className="empty-mark" aria-hidden>✳</span><h3>{title}</h3>{children&&<div className="muted">{children}</div>}</div>;}
export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
 const ref=useRef<HTMLDialogElement>(null),id=useId();
 useEffect(()=>{const dialog=ref.current;dialog?.showModal();return ()=>dialog?.close();},[]);
 return <dialog ref={ref} className={`modal ${wide?'modal-wide':''}`} aria-labelledby={id} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}><header className="modal-head"><h2 id={id}>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>×</button></header><div className="modal-body">{children}</div></dialog>;
}
export function PageTitle({eyebrow,title,description,children}:{eyebrow?:string;title:string;description?:string;children?:ReactNode}){return <div className="page-title"><div>{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description&&<p className="muted">{description}</p>}</div>{children}</div>;}
export function Loading({label='Loading your workspace…'}:{label?:string}){return <div className="loading" role="status"><span className="spinner" aria-hidden/>{label}</div>;}
export function ErrorNotice({message,onRetry}:{message:string;onRetry?:()=>void}){return <div className="error" role="alert"><p>{message}</p>{onRetry&&<Button onClick={onRetry}>Try again</Button>}</div>;}
