'use client';

import type {ScreenProps} from '../lib/types';
import {CampaignDeliveryScreen} from './delivery/campaign';
import {ReviewStudio} from './delivery/studio';

export function DeliveryScreen({view,...props}:ScreenProps & {view:string}){
 if(view.startsWith('delivery-campaign:'))return <CampaignDeliveryScreen key={props.workspace.user.id+':'+view} {...props} id={view.slice('delivery-campaign:'.length)}/>;
 if(view.startsWith('delivery:'))return <ReviewStudio key={props.workspace.user.id+':'+view} {...props} id={view.slice('delivery:'.length)}/>;
 return <div className="card"><h1 className="page-title">Campaign delivery</h1><p className="muted">Choose a campaign to prepare its brief, manage products and rights, or open a content review.</p><button className="btn mt-4" onClick={()=>props.navigate('campaigns')}>Open campaigns</button></div>;
}
