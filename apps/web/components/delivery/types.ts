import type {Assignment, Deliverable} from '../../lib/types';

export interface BriefPayload {goals:string;requirements:string;tone:string;claims:string;prohibited:string;disclosure:string}
export interface Brief {id:string;campaign_id:string;version:number;payload:BriefPayload;author:string;created:string}
export interface Rights {channels:string;territory:string;start:string;end:string;paid_usage:boolean;exclusivity:string;agreement:string}
export interface Shipment {id:string;assignment_id:string;product:string;quantity:number;carrier:string;tracking:string;status:string;updated:string}
export interface CampaignDelivery {brief:Brief|null;brief_history:Pick<Brief,'id'|'version'|'author'|'created'>[];rights:{payload:Rights;updated:string}|null;shipments:Shipment[];deliverables:Deliverable[];assignments:Assignment[]}
export interface PostPackage {video_id:string;video_sha256:string;cover_id:string;cover_sha256:string;caption:string;hashtags:string;mentions:string;disclosure:string;account:string;window_start:string;window_end:string;brief_version_id:string}
export interface Finding {layer:string;field:string;timestamp:number|null;observation:string;requirement?:string;correction:string;severity:string;confidence:number|string;blocking:boolean}
export interface Analysis {id:string;mode:string;state:string;error?:string;prepared?:{coverage:string};result?:{outcome:string;findings:Finding[]}}
export interface ContentVersion {id:string;deliverable_id:string;version:number;package:PostPackage;status:string;created:string;approvals:{id:string;stage:string;reviewer_name:string;created:string}[];events:{id:string;kind:string;visibility:string;seconds:number|null;message:string;author_name:string;created:string}[];analysis:Analysis[]}
export interface Studio {deliverable:Deliverable & {campaign_id:string;creator_id:string;brand_id:string};brief:Brief|null;versions:ContentVersion[];handoff:{ready:boolean;version_id:string|null;reasons:string[];mode:string}}
export interface ProcessingJob {id:string;version_id:string;state:string;attempts:number;error:string|null;result:{outcome:string;coverage:string;media:{duration_seconds:number|null;width:number|null;height:number|null;audio:boolean};findings:Finding[]}|null}
export interface HandoffPackage {id:string;version:number;deliverable_id:string;title:string;account:string;window_start:string;window_end:string;reasons:string[]}
export interface OperationsData {jobs:ProcessingJob[];schedules:{id:string;deliverable_id:string;version_id:string;due_at:string;state:string;reason:string}[];posts:{id:string;deliverable_id:string;version_id:string;permalink:string;source:string;published_at:string;verification?:{verified:boolean}}[]}
