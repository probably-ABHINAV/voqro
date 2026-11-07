export type Role = 'member' | 'owner' | 'manager' | 'reviewer' | 'finance' | 'brand' | 'creator';
export interface User {id:string;name:string;role:Role;brand_id:string|null;creator_id:string|null;email?:string;organization?:{id:string;name:string;kind:'agency'|'brand'|'creator';parent_id:string|null}}
export interface Brand {id:string;name:string;industry:string;color:string;[key:string]:any}
export interface Creator {id:string;name:string;handle:string;niche:string;location:string;language:string;followers:number|null;engagement:number|null;fee?:number;color:string;initials:string;bio:string;available:number|boolean;visibility?:string;portfolio?:string[];metric_source?:string;observed_on?:string|null;sample_size?:number|null;sample_kind?:string;[key:string]:any}
export interface Campaign {id:string;brand_id:string;name:string;budget?:number;status:string;start_date:string|null;end_date:string|null;description:string;proposal_id?:string|null;accepted_version_id?:string|null;[key:string]:any}
export interface Assignment {id:string;campaign_id:string;creator_id:string;[key:string]:any}
export interface Deliverable {id:string;assignment_id:string;title:string;due_date:string|null;status:string;owner:string;publishing_account:string;[key:string]:any}
export interface ProposalLine {label:string;quantity:number;unit_price:number;creator_id:string|null}
export interface ProposalVersion {id:string;proposal_id:string;version:number;total:number;created:string;payload:{title?:string;items:ProposalLine[];terms:string;rights:string;expires:string}}
export interface Proposal {id:string;brand_id:string;lead_id:string|null;title:string;status:string;created:string;versions:ProposalVersion[]}
export interface Lead {id:string;brand_id:string|null;name:string;email:string;company:string;brief:string;budget:number;stage:string;owner:string;follow_up:string|null;source:string;created:string;[key:string]:any}
export interface Activity {id:string;brand_id:string|null;actor:string;message:string;created:string}
export interface IdentityConfig {provider:string;configured:boolean;available:boolean;demo:boolean;sign_in_path:string|null;status:string;missing?:string[];[key:string]:any}
export interface Workspace {user:User;demo:boolean;connections:Record<string,any>;brands:Brand[];creators:Creator[];campaigns:Campaign[];assignments:Assignment[];deliverables:Deliverable[];proposals:Proposal[];activities:Activity[];leads:Lead[];shortlists:{brand_id:string;creator_id:string}[];finance:{campaign_budgets:number;committed_creator_fees:number;currency:string;invoices_connected:boolean}|null;[key:string]:any}
export interface PublicContent {id:string;kind:string;title:string;summary:string;details:string;state:string;evidence_url?:string}
export interface PublicData {creators:Creator[];content:PublicContent[];identity:IdentityConfig;demo:boolean}
export interface ScreenProps {workspace:Workspace;refresh:()=>Promise<void>;notify:(message:string)=>void;navigate:(view:string)=>void}
export const money=(cents:number=0)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(cents/100);
export const formatDate=(value:string|null|undefined)=>value?new Date(value.length===10?`${value}T12:00:00Z`:value).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}):'Not set';
export const compact=(value:number|null|undefined)=>value==null?'Not supplied':new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(value);
