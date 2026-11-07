'use client';

import type {ScreenProps} from '../lib/types';
import {formatDate,money} from '../lib/types';
import {useState} from 'react';
import {Badge,Empty,Heading} from './work/shared';
import {WorkflowScreen} from './work/workflow';
import {FinanceScreen} from './work/finance';
import {AccessScreen} from './work/access';

type Props=ScreenProps&{view:string};
export function WorkScreen(props:Props) {
  const {view}=props;
  if(['workflow','knowledge','inbox','exceptions'].includes(view)||view.startsWith('task:'))return <WorkflowScreen {...props}/>;
  if(view==='finance')return <FinanceScreen {...props}/>;
  if(view==='access')return <AccessScreen {...props}/>;
  if(view==='calendar')return <Calendar {...props}/>;
  if(view.startsWith('campaign:'))return <CampaignDetail {...props} id={view.slice(9)}/>;
  return <Campaigns {...props}/>;
}
function Campaigns({workspace,navigate}:ScreenProps) {
  const [query,setQuery]=useState('');
  const campaigns=workspace.campaigns.filter(c=>`${c.name} ${c.description}`.toLowerCase().includes(query.toLowerCase()));
  return <><Heading title="Good stories, in the making." description="Every campaign, its creators, and the work ahead." actions={['owner','manager'].includes(workspace.user.role)?<button className="btn btn-primary" onClick={()=>navigate('proposals')}>Create from a proposal</button>:null}/><input className="input mb-5 max-w-md" aria-label="Search campaigns" placeholder="Find a campaign…" value={query} onChange={e=>setQuery(e.target.value)}/><div className="grid gap-5 lg:grid-cols-2">{campaigns.map(c=>{const assignments=workspace.assignments.filter(a=>a.campaign_id===c.id);const deliveries=workspace.deliverables.filter(d=>assignments.some(a=>a.id===d.assignment_id));return <article className="card flex flex-col gap-4 p-6" key={c.id}><div className="flex flex-wrap items-center justify-between gap-3"><Badge>{c.status}</Badge><span className="muted text-sm">{workspace.brands.find(b=>b.id===c.brand_id)?.name}</span></div><div><h2 className="text-2xl font-medium">{c.name}</h2><p className="muted mt-2">{c.description||'Your campaign workspace is ready for a brief.'}</p></div><div className="grid grid-cols-2 gap-3 text-sm"><p>{assignments.length} creators · {deliveries.length} deliverables</p><p className="text-right">{formatDate(c.end_date)}</p></div><button className="btn mt-auto self-start" onClick={()=>navigate('campaign:'+c.id)}>Open campaign</button></article>;})}</div>{!campaigns.length&&<Empty title={query?'No matching campaigns.':'Your first campaign starts with an accepted proposal.'}>{!query&&'Create a proposal, invite its brand, and let the brand accept the agreed version.'}</Empty>}</>;
}
function CampaignDetail({workspace,navigate,id}:ScreenProps&{id:string}) {
  const campaign=workspace.campaigns.find(c=>c.id===id);
  if(!campaign)return <Empty title="Campaign not available.">It may be outside your current workspace.<button className="btn mt-4" onClick={()=>navigate('campaigns')}>Back to campaigns</button></Empty>;
  const assignments=workspace.assignments.filter(a=>a.campaign_id===id),deliverables=workspace.deliverables.filter(d=>assignments.some(a=>a.id===d.assignment_id));
  return <><button className="btn mb-5" onClick={()=>navigate('campaigns')}>← All campaigns</button><Heading title={campaign.name} description={campaign.description||'Prepare the brief and assign the work to start this campaign.'} actions={workspace.user.role!=='finance'?<button className="btn btn-primary" onClick={()=>navigate('delivery-campaign:'+id)}>Manage delivery</button>:null}/><div className="mb-6 grid gap-4 sm:grid-cols-3"><div className="card p-5"><p className="muted">Campaign status</p><p className="mt-2 text-xl">{campaign.status}</p></div><div className="card p-5"><p className="muted">Schedule</p><p className="mt-2">{formatDate(campaign.start_date)} — {formatDate(campaign.end_date)}</p></div>{campaign.budget!==undefined&&<div className="card p-5"><p className="muted">Agreed campaign budget</p><p className="mt-2 text-xl">{money(campaign.budget)}</p></div>}</div><section className="card p-6"><h2 className="mb-4 text-xl font-semibold">Deliverables</h2><div className="divide-y divide-[#e0e6db]">{deliverables.map(d=><article key={d.id} className="flex flex-wrap items-start justify-between gap-4 py-5"><div><h3 className="font-semibold">{d.title}</h3><p className="muted mt-1 text-sm">{d.owner} · Due {formatDate(d.due_date)}</p><div className="mt-2"><Badge>{d.status}</Badge></div></div>{workspace.user.role!=='finance'&&<button className="btn" onClick={()=>navigate('delivery:'+d.id)}>Open review studio</button>}</article>)}</div>{!deliverables.length&&<Empty title="No deliverables assigned yet.">The account team can add creator assignments and deliverables in Manage delivery.</Empty>}</section><div className="mt-6 flex flex-wrap gap-3"><button className="btn" onClick={()=>navigate('workflow')}>Tasks & discussions</button>{workspace.user.role!=='finance'&&<button className="btn" onClick={()=>navigate('knowledge')}>Brand knowledge</button>}{['owner','finance','brand','creator'].includes(workspace.user.role)&&<button className="btn" onClick={()=>navigate('finance')}>Financial records</button>}</div></>;
}
function Calendar({workspace,navigate}:ScreenProps) {
  const [month,setMonth]=useState(new Date().toISOString().slice(0,7));
  const matching=workspace.deliverables.filter(d=>d.due_date?.startsWith(month)).sort((a,b)=>(a.due_date||'').localeCompare(b.due_date||''));
  const undated=workspace.deliverables.filter(d=>!d.due_date);
  return <><Heading title="Make space for good work." description="Deliverable due dates from your campaign records. Publishing windows are managed in the review studio."/><label className="field mb-6 block max-w-xs">Month<input className="input mt-2" type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><section className="card p-6"><h2 className="mb-5 text-xl">Delivery calendar</h2>{matching.map(d=><div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e0e6db] py-4" key={d.id}><div><p className="text-sm font-semibold">{formatDate(d.due_date)}</p><h3 className="mt-1">{d.title}</h3><p className="muted text-sm">{d.owner} · {d.status}</p></div>{workspace.user.role!=='finance'&&<button className="btn" onClick={()=>navigate('delivery:'+d.id)}>Review deliverable</button>}</div>)}{!matching.length&&<Empty title="No deadlines in this month."/>}</section>{undated.length>0&&<section className="card mt-5 p-6"><h2 className="text-xl">Dates still to assign</h2>{undated.map(d=><p key={d.id} className="muted mt-3">{d.title} · {d.owner}</p>)}</section>}</>;
}
