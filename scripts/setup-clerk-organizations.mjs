import {DatabaseSync} from 'node:sqlite';
import {createClerkClient} from '@clerk/backend';
import {createOrganizations} from '../organizations.mjs';
import {clerkConfig} from '../clerk-identity.mjs';
const check=(v,message)=>{if(!v)throw Error(message);};
let db;
try {
 const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1],instanceId=value('--instance'),rootId=value('--root-organization'),apply=args.includes('--apply');
 check(args.includes('--instance')&&/^ins_[A-Za-z0-9]+$/.test(instanceId),'Supply the exact production --instance.');
 check(args.includes('--root-organization')&&/^org_[A-Za-z0-9]+$/.test(rootId),'Supply the existing agency --root-organization.');
 const cfg=clerkConfig();check(cfg.configured&&process.env.AUTH_PROVIDER==='clerk'&&cfg.secretKey.startsWith('sk_live_'),'Use the configured production Clerk backend.');
 const client=createClerkClient({secretKey:cfg.secretKey,telemetry:{disabled:true}});
 check((await client.instance.get()).id===instanceId,'The key belongs to another Clerk instance.');
 const settings=await client.instance.getOrganizationSettings();check(settings.enabled,'Enable Organizations in the selected Clerk instance first.');
 db=new DatabaseSync(process.env.DB_PATH);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
 const orgs=createOrganizations({db,api:()=>client,issuer:cfg.issuer});
 const members=orgs.members();check(members.length>0,'No linked active members.');
 const remote=await client.organizations.getOrganization({organizationId:rootId});
 let owner;
 for(const candidate of members.filter(u=>u.role==='owner')){
  const list=await client.organizations.getOrganizationMembershipList({organizationId:rootId,userId:[candidate.subject],limit:10});
  if(list.data.some(m=>m.publicUserData?.userId===candidate.subject&&m.role==='org:admin')){owner=candidate;break;}
 }
 check(owner,'An existing Voqro owner must administer the selected organization.');
 const brands=db.prepare('SELECT id FROM brands').all(),creators=db.prepare('SELECT id FROM creators').all();
 console.log(JSON.stringify({dryRun:!apply,instance:instanceId,rootOrganization:remote.id,activeMembers:members.length,brands:brands.length,creators:creators.length,membershipLimit:settings.maxAllowedMemberships}));
 if(apply){
  await orgs.provision({kind:'agency',actorId:owner.id,existingOrganizationId:rootId});
  for(const b of brands)await orgs.provision({kind:'brand',entityId:b.id,actorId:owner.id});
  for(const c of creators)await orgs.provision({kind:'creator',entityId:c.id,actorId:owner.id});
  for(const member of orgs.members())await orgs.authorize(member,member.subject,orgs.defaultOrganization(member));
  orgs.activate();console.log(JSON.stringify({enabled:orgs.enabled(),mappedOrganizations:db.prepare('SELECT COUNT(*) n FROM workspace_organizations').get().n,memberships:db.prepare('SELECT COUNT(*) n FROM workspace_org_members').get().n}));
 }
}catch(e){console.error(JSON.stringify({failed:true,message:e.errors?'Clerk rejected organization setup.':e.message,status:e.status||null,codes:e.errors?.map(x=>x.code)}));process.exitCode=1;}finally{db?.close();}
