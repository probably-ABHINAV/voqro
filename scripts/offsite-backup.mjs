import {createAzureBackupStore} from '../azure-backup-store.mjs';
import {runOffsiteBackup,recoverOffsiteBackup} from '../offsite-backups.mjs';
try{
 if(process.env.DEMO_MODE!=='0')throw Error('Off-site backups require the production backend; sample databases must stay local.');
 const store=createAzureBackupStore({account:process.env.AZURE_BACKUP_ACCOUNT,container:process.env.AZURE_BACKUP_CONTAINER});
 const [command,prefix,destination]=process.argv.slice(2);let result;
 if(command==='run')result=await runOffsiteBackup({store,database:process.env.DB_PATH,uploads:process.env.UPLOAD_PATH,stateDirectory:process.env.BACKUP_STATE_PATH||'/var/lib/voqro/offsite-backup-state',force:process.argv.includes('--force')});
 else if(command==='recover'&&prefix&&destination)result=await recoverOffsiteBackup({store,prefix,destination});
 else throw Error('Use run [--force] or recover <daily/prefix> <new-directory>.');
 console.log(JSON.stringify(result));
}catch(error){console.error(error.code?'Backup operation failed ('+error.code+').':error.message);process.exitCode=1;}
