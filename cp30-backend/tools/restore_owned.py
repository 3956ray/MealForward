"""Owned synthetic backup/restore only, reachable from the bounded test harness.

Never initializes a database, restores a journal, resets a run, or accepts an
external archive/path. Every restore binds a new durable controller fence first.
"""
import hashlib,json,os,secrets,subprocess,uuid
from pathlib import Path
from owned import scope,private_file,pg_identity
from c1.db import Database
from c1.content import verify_original

class OwnedRestore:
    def __init__(self,harness):self.h=harness

    def check(self):
        run,marker=scope(self.h.run,phases=('SEALED',))
        if marker['cluster_id']!=self.h.settings['cluster_id']:raise RuntimeError('RESTORE_CLUSTER_BINDING')
        pg_identity(run,json.loads(private_file(run/'owned-pids.json').read_text())['pg'])
        return run

    def driver_close(self):self.h.b.close();self.h.a.close()
    def driver_open(self):
        roles=self.h.settings['roles']
        self.h.b=Database({'db':{'business':roles['c1_controller']}},'business','business',max_size=1)
        self.h.a=Database({'db':{'authority':roles['c1_controller_authority']}},'authority','authority',max_size=1)

    def command(self,program,database,arguments):
        run=self.check();config=self.h.settings['bootstrap'];passfile=run/('backup-pass-'+secrets.token_hex(8))
        # All values are from this run's generated bootstrap, never ambient PG.
        value=':'.join([config['host'],str(config['port']),database,config['user'],config['password']])+'\n'
        fd=os.open(passfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            with os.fdopen(fd,'w') as stream:stream.write(value);stream.flush();os.fsync(stream.fileno())
            command=['/opt/homebrew/bin/'+program,'--no-password','--host',config['host'],'--port',str(config['port']),'--username',config['user']]
            command.extend([*arguments,database] if program=='pg_dump' else ['--dbname',database,*arguments])
            result=subprocess.run(command,env={'PGPASSFILE':str(passfile),'PGCONNECT_TIMEOUT':'2','PGAPPNAME':'c1-owned-backup-'+run.name,'HOME':str(run/'home'),'LC_ALL':'C'},capture_output=True,timeout=20)
            if result.returncode:raise RuntimeError('OWNED_'+program.upper()+'_FAILED')
        finally:passfile.unlink(missing_ok=True)

    def backup(self,*,authority=False):
        run=self.check();folder=run/('backup-'+secrets.token_hex(12));folder.mkdir(mode=0o700)
        files={};self.driver_close()
        try:
            for name in ['business']+(['authority'] if authority else []):
                target=folder/(name+'.dump')
                self.command('pg_dump','c1_'+name,['--format=custom','--file',str(target)])
                target.chmod(0o600);files[name]=hashlib.sha256(private_file(target).read_bytes()).hexdigest()
        finally:self.driver_open()
        manifest={'run_id':run.name,'cluster_id':self.h.settings['cluster_id'],'namespace_digest':hashlib.sha256(self.h.namespace.encode()).hexdigest(),'files':files}
        path=folder/'manifest.json';path.write_text(json.dumps(manifest,sort_keys=True));path.chmod(0o600)
        self.h.records.append({'scenario':'owned-backup','databases':list(files),'archiveDigests':files})
        return folder

    def restore(self,folder):
        run=self.check();folder=Path(folder)
        if folder.parent!=run or not folder.name.startswith('backup-') or folder.is_symlink() or folder.stat().st_mode&0o777!=0o700:raise RuntimeError('RESTORE_ARCHIVE_SCOPE')
        manifest=json.loads(private_file(folder/'manifest.json').read_text())
        if manifest['run_id']!=run.name or manifest['cluster_id']!=self.h.settings['cluster_id'] or manifest['namespace_digest']!=hashlib.sha256(self.h.namespace.encode()).hexdigest():raise RuntimeError('RESTORE_ARCHIVE_BINDING')
        if (folder/'restore-preparation.json').exists():raise RuntimeError('RESTORE_ALREADY_ATTEMPTED')
        if not {'business'}<=set(manifest['files'])<={'business','authority'}:raise RuntimeError('RESTORE_ARCHIVE_SET')
        for name,digest in manifest['files'].items():
            if hashlib.sha256(private_file(folder/(name+'.dump')).read_bytes()).hexdigest()!=digest:raise RuntimeError('RESTORE_ARCHIVE_DIGEST')
        prepared=self.h.expect(self.h.private.call(self.h.namespace,'fixture',{'operation':'restore_prepare','mutation_id':str(uuid.uuid4()),'backups':manifest['files']}),'RESTORE_PREPARE')
        path=folder/'restore-preparation.json';path.write_text(json.dumps(prepared,sort_keys=True));path.chmod(0o600)
        journal=private_file(run/'security.journal');before=(journal.stat().st_ino,hashlib.sha256(journal.read_bytes()).hexdigest())
        names=list(self.h.configs)
        for name in reversed(names):
            if any(candidate==name and process.poll() is None for candidate,process in self.h.processes):self.h.stop_app(name,crash=True)
        self.driver_close()
        try:
            for name in manifest['files']:
                self.command('pg_restore','c1_'+name,['--clean','--if-exists','--single-transaction','--exit-on-error',str(folder/(name+'.dump'))])
        finally:self.driver_open()
        after=(journal.stat().st_ino,hashlib.sha256(private_file(journal).read_bytes()).hexdigest())
        if before!=after:raise RuntimeError('RESTORE_JOURNAL_CHANGED')
        install={'sequence':prepared['sequence'],'digest':prepared['digest'],'binding':prepared['binding']}
        for database in [self.h.b,self.h.a]:self.h.expect(database.call('restore_install',self.h.namespace,install),'RESTORE_INSTALL')
        cursor='';content_valid=True
        while True:
            items=self.h.expect(self.h.b.call('restore_material_list',self.h.namespace,{'after':cursor}),'RESTORE_MATERIAL_LIST')['items']
            for item in items:
                checked=verify_original(self.h.b,self.h.namespace,{'purpose':'audit',**{key:item[key] for key in ['store','meal','version']}},run)
                content_valid=content_valid and not bool(checked.get('error'))
            if len(items)<50:break
            cursor=items[-1]['id'];self.h.resource_check()
        for name in names:
            if name.startswith('api_'):(run/(name+'-bound.json')).unlink(missing_ok=True)
            self.h.launch(name,'application' if name.startswith('api_') else 'worker' if name.startswith('worker_') else name)
        self.h.wait(lambda:all((run/('api_'+suffix+'-bound.json')).exists() for suffix in ['a','b']),'RESTORE_APIS')
        self.h.origins={suffix:json.loads((run/('api_'+suffix+'-bound.json')).read_text())['origin'] for suffix in ['a','b']}
        self.h.records.append({'scenario':'controlled-owned-restore','databases':list(manifest['files']),
            'journalUnchangedDuringLoad':True,'restoreGeneration':prepared['binding']['restore_generation'],
            'credentialEpoch':prepared['binding']['credential_epoch'],'retainedPending':prepared['binding']['expected_revision']['pending_digest']!='0'*64})
        self.h.records.append({'scenario':'restore-original-content-audit','valid':content_valid})
        return {key:prepared[key] for key in ('mutation_id','sequence','digest')}

    def finish(self,reference):
        return self.h.private.call(self.h.namespace,'fixture',{'operation':'restore_finish',**reference})
