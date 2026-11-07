import {DatabaseSync} from 'node:sqlite';
import {createOrganizations} from '../organizations.mjs';
let db;
try{
 const args=process.argv.slice(2),owner=args[args.indexOf('--owner')+1];
 if(!args.includes('--owner')||process.env.AUTH_PROVIDER!=='clerk'||process.env.DEMO_MODE!=='0'||!process.env.CLERK_ISSUER)throw Error('Use the production backend with an explicit --owner.');
 db=new DatabaseSync(process.env.DB_PATH);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
 const orgs=createOrganizations({db,issuer:process.env.CLERK_ISSUER});
 if(!orgs.members().some(u=>u.id===owner&&u.role==='owner'))throw Error('An active owner is required.');
 const brands=db.prepare('SELECT id FROM brands').all(),creators=db.prepare('SELECT id FROM creators').all();
 console.log(JSON.stringify({dryRun:!args.includes('--apply'),agency:'Voqro',brands:brands.length,creators:creators.length,provider:'Voqro'}));
 if(args.includes('--apply')){
  await orgs.provision({kind:'agency',actorId:owner});
  for(const b of brands)await orgs.provision({kind:'brand',entityId:b.id,actorId:owner});
  for(const c of creators)await orgs.provision({kind:'creator',entityId:c.id,actorId:owner});
  orgs.activate();console.log(JSON.stringify({enabled:orgs.enabled(),workspaces:db.prepare('SELECT COUNT(*) n FROM workspace_organizations').get().n}));
 }
}catch(e){console.error(JSON.stringify({failed:true,message:e.message}));process.exitCode=1;}finally{db?.close();}
