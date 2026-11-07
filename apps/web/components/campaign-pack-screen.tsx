'use client';
import {useEffect,useState} from 'react';
import {api} from '@/lib/api';
import type {ScreenProps} from '@/lib/types';
import {Button,Card,ErrorNotice,Loading,PageTitle} from './ui';
type CreatorBrief={creator_id:string;name:string;handle:string;concept:string;caption:string;script:string;priority:boolean;allocation:number[];duration_seconds:number};
type Pack={title:string;source_date:string;update_note:string;products:string[];stock?:number[];spare?:number[];creators:CreatorBrief[];shop_url:string;collaboration_partner:string;rollout:{day:string;action:string}[];can_export:boolean};
export function CampaignPackScreen({id,navigate,notify}:ScreenProps&{id:string}){
 const [data,setData]=useState<Pack|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;setData(null);setError('');void api<Pack>('campaign-packs/'+encodeURIComponent(id)).then(d=>{if(live)setData(d);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[id]);
 return <><Button className="mb-5" onClick={()=>navigate('campaign:'+id)}>← Campaign</Button>{error?<ErrorNotice message={error}/>:!data?<Loading/>:<>
  <PageTitle eyebrow={`Source updated ${data.source_date}`} title={data.title} description="Planning pack · creator acceptance, fees, dates, dispatch and publishing remain unconfirmed."/>
  <Card><h2>Latest brand update</h2><p className="my-3">{data.update_note}</p><a className="btn" href={data.shop_url} target="_blank" rel="noreferrer">Brand-supplied shopping link ↗</a>{data.can_export&&<a className="btn ml-3" href={`/api/campaign-packs/${encodeURIComponent(id)}/document`}>Download complete HTML pack</a>}</Card>
  <Card className="mt-6"><h2>Product allocation</h2><p className="muted my-3">Three boxes per creator. Allocation does not confirm dispatch.</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="text-left p-3">Creator</th>{data.products.map(p=><th className="p-3 text-left" key={p}>{p}</th>)}</tr></thead><tbody>{data.creators.map(c=><tr key={c.creator_id}><td className="p-3">{c.name}{c.priority?' · Priority':''}</td>{c.allocation.map((n,i)=><td className="p-3" key={i}>{n}</td>)}</tr>)}{data.spare&&<tr><td className="p-3">Replacement spare</td>{data.spare.map((n,i)=><td className="p-3" key={i}>{n}</td>)}</tr>}{data.stock&&<tr><td className="p-3">Supplied stock</td>{data.stock.map((n,i)=><td className="p-3" key={i}>{n}</td>)}</tr>}</tbody></table></div></Card>
  {data.creators.map(c=><Card className="mt-6" key={c.creator_id}><p className="eyebrow">{c.name} · @{c.handle} · approximately {c.duration_seconds}s</p><h2 className="my-3">{c.concept}</h2><details><summary className="cursor-pointer font-medium py-3">Full script and shooting directions</summary><div className="whitespace-pre-wrap break-words text-sm leading-7 pb-5">{c.script}</div></details><h3 className="mt-4">Current caption draft</h3><p className="whitespace-pre-wrap break-words my-4">{c.caption}</p><Button onClick={()=>void navigator.clipboard.writeText(c.caption).then(()=>notify('Caption copied. Review before publishing.')).catch(()=>notify('Select and copy the caption text.'))}>Copy caption</Button></Card>)}
  <Card className="mt-6"><h2>Proposed rollout</h2><p className="muted my-3">Relative days after all products arrive. These are planning windows, not booked publishing dates.</p>{data.rollout.map(r=><div className="list-row" key={r.day}><strong className="min-w-28">{r.day}</strong><p>{r.action}</p></div>)}</Card>
 </>}</>;
}
