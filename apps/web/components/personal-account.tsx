'use client';
import {useState} from 'react';
import {useAuth} from '@clerk/nextjs';
import Link from 'next/link';
import {clerkEnabled} from '@/lib/clerk-config';
import {exchangeClerkSession} from '@/lib/clerk-exchange';
import {ClerkHeaderControls} from './clerk-header-controls';
import {SignupOnboarding} from './signup-onboarding';
import {Button,ErrorNotice} from './ui';

export function PersonalAccount({name}:{name:string}){
 return clerkEnabled?<ClerkPersonalAccount name={name}/>:<PersonalAccountView name={name}/>;
}
function ClerkPersonalAccount({name}:{name:string}){
 const {getToken}=useAuth();const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function join(signup_type:'brand'|'creator',brand_name?:string){
  if(busy)return;setBusy(true);setError('');
  try{const token=await getToken({skipCache:true});if(!token)throw Error('Sign in again to continue.');
   await exchangeClerkSession(token,{signup_type,brand_name});window.location.replace('/workspace');
  }catch(e){setError(e instanceof Error?e.message:'Unable to save your profile choice.');setBusy(false);}
 }
 return <PersonalAccountView name={name} busy={busy} error={error} onJoin={join}/>;
}
export function PersonalAccountView({name,busy=false,error='',onJoin}:{name:string;busy?:boolean;error?:string;onJoin?:(type:'brand'|'creator',brandName?:string)=>void}){
 const [choosing,setChoosing]=useState(false);
 return <main id="main-content" className="max-w-2xl mx-auto p-6 my-12"><header className="flex flex-wrap items-center justify-between gap-4 mb-12"><Link href="/" className="eyebrow">Voqro</Link><ClerkHeaderControls/></header>
  <h1>Welcome, {name}.</h1><p className="muted my-5">Your account is ready. You can explore Voqro now and choose a Brand or Creator profile whenever you like.</p>
  <div className="flex flex-wrap gap-3 my-6"><Link className="btn btn-primary" href="/">Explore Voqro</Link>{onJoin&&!choosing&&<Button onClick={()=>setChoosing(true)}>Choose a profile (optional)</Button>}</div>
  {choosing&&onJoin&&<section className="card p-6">{error&&<ErrorNotice message={error}/>}<SignupOnboarding busy={busy} onJoin={onJoin}/><Button className="mt-4" disabled={busy} onClick={()=>setChoosing(false)}>Maybe later</Button></section>}
 </main>;
}
