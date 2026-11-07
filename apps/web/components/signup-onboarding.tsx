'use client';
import {useState} from 'react';
import {Button,Field} from './ui';

export function SignupOnboarding({busy,onJoin}:{busy:boolean;onJoin:(type:'brand'|'creator',brandName?:string)=>void}){
 const [type,setType]=useState<'brand'|'creator'>('creator');
 const [brandName,setBrandName]=useState('');
 return <form onSubmit={e=>{e.preventDefault();onJoin(type,type==='brand'?brandName.trim():undefined);}} className="grid gap-5 mt-5">
  <div><h1>Choose a profile (optional)</h1><p className="muted">Choose how you want to work with us. You can also leave this for later.</p></div>
  <Field label="I’m joining as"><select value={type} disabled={busy} onChange={e=>setType(e.target.value as 'brand'|'creator')}><option value="creator">Creator</option><option value="brand">Brand</option></select></Field>
  {type==='brand'&&<Field label="Brand name"><input value={brandName} onChange={e=>setBrandName(e.target.value)} required maxLength={160} disabled={busy}/></Field>}
  <p className="muted">{type==='creator'?'Your creator profile starts private. Campaigns will appear here when the agency assigns work to you.':'You’ll have a private client account for your brand’s proposals and campaigns.'}</p>
  <Button type="submit" disabled={busy||type==='brand'&&!brandName.trim()}>{busy?'Creating your account…':'Save profile choice'}</Button>
 </form>;
}
