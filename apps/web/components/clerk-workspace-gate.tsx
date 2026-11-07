'use client';
import {useAuth,useClerk} from '@clerk/nextjs';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import Link from 'next/link';
import {clerkEnabled} from '@/lib/clerk-config';
import {api,setApiOrganization} from '@/lib/api';
import {exchangeClerkSession} from '@/lib/clerk-exchange';
import {Button,ErrorNotice,Loading} from './ui';

export function ClerkWorkspaceGate({children}:{children:ReactNode}) {
  return clerkEnabled?<ActiveGate>{children}</ActiveGate>:children;
}
function ActiveGate({children}:{children:ReactNode}) {
  const {isLoaded,isSignedIn,sessionId,getToken}=useAuth();
  const {signOut}=useClerk();
  const key=sessionId||'';
  const pending=useRef<{key:string;promise:Promise<string|null>}|null>(null);
  const [ready,setReady]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    if(!isLoaded)return;
    if(!isSignedIn){window.location.replace('/login');return;}
    let live=true;setError('');
    if(pending.current?.key!==key){
      pending.current={key,promise:(async()=>{
        const config=await api('identity/config');
        if(!config.organizations_enabled)return null;
        const token=await getToken({skipCache:true});if(!token)throw Error('Sign in again to select a workspace.');
        return (await exchangeClerkSession(token)).organization_id;
      })()};
    }
    void pending.current.promise.then(async organizationId=>{
      if(!live)return;
      setApiOrganization(organizationId);setReady(key);
    }).catch(e=>{if(live)setError(e.message||'Your workspace could not be opened.');});
    return()=>{live=false;};
  },[isLoaded,isSignedIn,key,getToken,attempt]);
  if(isLoaded&&isSignedIn&&ready===key&&!error)return <div key={key}>{children}</div>;
  if(!error)return <Loading label="Opening your workspace…"/>;
  return <main className="max-w-xl mx-auto p-6 my-16"><h1>Choose your workspace</h1><ErrorNotice message={error}/><div className="flex gap-3 mt-6"><Button onClick={()=>{pending.current=null;setAttempt(v=>v+1);}}>Retry</Button><Link className="btn" href="/">Agency website</Link><Button onClick={()=>void signOut({redirectUrl:'/login'})}>Log out</Button></div></main>;
}
