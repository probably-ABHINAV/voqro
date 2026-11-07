'use client';
import type {ScreenProps} from '@/lib/types';
import {ReportingScreen} from './extensions/reporting';
import {OperationsScreen} from './extensions/operations';
import {OptimizationScreen} from './extensions/optimization';
import {CloudScreen} from './extensions/cloud';
import {InstagramScreen} from './extensions/instagram';
import {EmailScreen} from './extensions/email';
import {WorkScreen} from './work';
import {Card,Header} from './extensions/shared';

export function ExtensionsScreen(props:ScreenProps&{view:string}){
 const principal=props.workspace.user.id;
 if(props.view==='reporting')return <ReportingScreen key={principal} {...props}/>;
 if(['operations','trends','results'].includes(props.view))return <OperationsScreen key={principal} {...props}/>;
 if(props.view==='optimization')return <OptimizationScreen key={principal} {...props}/>;
 if(props.view==='cloud')return <CloudScreen key={principal} {...props}/>;
 if(props.view==='instagram')return <InstagramScreen key={principal} {...props}/>;
 if(props.view==='email-delivery')return <EmailScreen key={principal} {...props}/>;
 if(props.view==='exceptions')return <WorkScreen key={principal} {...props}/>;
 return <ConnectionsScreen {...props}/>;
}
function ConnectionsScreen(props:ScreenProps){
 const connections=props.workspace.connections||{},role=props.workspace.user.role;
 const cards=[
  {title:'Identity & sign-in',description:connections.identity?.status||'Not configured',status:connections.identity?.available?'Configured; live verification required':props.workspace.demo?'Demo only':'Not configured',target:role==='owner'?'access':null},
  {title:'Instagram',description:connections.instagram?.message||'Meta authorisation is not configured.',status:connections.instagram?.connected_accounts?connections.instagram.connected_accounts+' authorised accounts':'No authorised accounts',target:role!=='finance'?'instagram':null},
  {title:'Media & AI',description:(connections.cloud?.local_evidence||'Local technical checks available')+'. '+(connections.cloud?.ai||'AI not configured'),status:connections.cloud?.ai||'Not configured',target:role!=='finance'?'cloud':null},
  {title:'Storage & recovery',description:'Local database and completed media can be exported, verified and restored. '+(connections.cloud?.storage||'Cloud storage not configured'),status:connections.cloud?.verified_at?'Provider verification recorded '+connections.cloud.verified_at:'Local storage; cloud unverified',target:role!=='finance'?'cloud':null},
  {title:'Payments & agreements',description:'Invoices, milestones, settlement records and agreement acknowledgements are available. '+(connections.signing||''),status:connections.payments||'No payment provider connected',target:'reporting'},
  {title:'Notifications',description:'In-app reminders are available. Email: '+(connections.notifications?.email||'Not configured')+'. External reminders require explicit owner queuing and verified recipients.',status:connections.notifications?.in_app||'Available',target:role==='owner'?'email-delivery':'inbox'}
 ];
 return <><Header title="Connections" description="Configuration, recorded authorisation and live verification are shown separately."/>{cards.map(card=><Card key={card.title} title={card.title}><p>{card.description}</p><p className="muted">{card.status}</p>{card.target&&<button className="btn" onClick={()=>props.navigate(card.target!)}>Open {card.title.toLowerCase()}</button>}</Card>)}</>;
}
