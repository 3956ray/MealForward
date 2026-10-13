import importlib.util,json,os,secrets,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
SPEC=importlib.util.spec_from_file_location('owned',Path(__file__).resolve().parents[1]/'tools/owned.py');owned=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(owned)
class OwnedTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir='/Users/mili/Library/Caches/mcpay-c1');self.base=Path(self.tmp.name);os.chmod(self.base,0o700);self.run=self.base/secrets.token_hex(6);self.run.mkdir(mode=0o700)
        self.marker=dict(run_id=self.run.name,owner=os.getuid(),baseline=owned.BASELINE,freeze=owned.FREEZE,phase='INITIALIZED',cluster_id='synthetic')
        self.save();self.patcher=patch.object(owned,'BASE',self.base);self.patcher.start()
    def save(self):
        (self.run/'OWNED.json').write_text(json.dumps(self.marker));os.chmod(self.run/'OWNED.json',0o600)
    def tearDown(self):self.patcher.stop();self.tmp.cleanup()
    def test_actual_scope(self):self.assertEqual(owned.scope(self.run,phases=('INITIALIZED',))[0],self.run)
    def test_marker_poison(self):
        for field,value in [('run_id','wrong'),('owner',-1),('baseline','wrong'),('freeze','wrong'),('phase','SEALED')]:
            original=self.marker[field];self.marker[field]=value;self.save()
            with self.assertRaises(owned.OwnershipError):owned.scope(self.run,phases=('INITIALIZED',))
            self.marker[field]=original
    def test_symlink_and_permissions(self):
        (self.base/'link').symlink_to(self.run)
        with self.assertRaises(owned.OwnershipError):owned.scope(self.base/'link')
        os.chmod(self.run,0o755)
        with self.assertRaises(owned.OwnershipError):owned.scope(self.run)
    def test_secret_read_follows_scope(self):
        (self.run/'bootstrap-password').write_text('SYNTHETIC_SENTINEL');os.chmod(self.run/'bootstrap-password',0o600)
        self.marker['phase']='SEALED';self.save()
        original=owned.private_file
        reads=[]
        def checked(path):
            reads.append(Path(path))
            if Path(path).name=='bootstrap-password':raise AssertionError('SECRET_EARLY_READ')
            return original(path)
        with patch.object(owned,'private_file',side_effect=checked):
            with self.assertRaises(owned.OwnershipError):owned.initialization_connections(self.run,None)
        self.assertEqual(reads,[self.run/'OWNED.json'])
    def test_live_app_identity_rejects_stale_pid_binding(self):
        self.marker['phase']='SEALED';self.save()
        binary=self.run/'venv/bin';binary.mkdir(parents=True)
        python=binary/'python';python.symlink_to(sys.executable)
        config=self.run/'synthetic.json';config.write_text('{}');config.chmod(0o600)
        process=subprocess.Popen([str(python),'-c','import time;time.sleep(10)','--config',str(config)],env={})
        try:
            entry=owned.app_identity(self.run,process.pid,config=config,python=python)
            self.assertEqual(owned.app_identity(self.run,process.pid,config=config,python=python,registry=entry),entry)
            for field,value in [('start','old-start'),('uid',-1),('command_digest','0'*64),('config',str(self.run/'wrong.json'))]:
                with self.assertRaises(owned.OwnershipError):owned.app_identity(self.run,process.pid,config=config,python=python,registry={**entry,field:value})
            self.assertIsNone(process.poll())
        finally:
            owned.app_identity(self.run,process.pid,config=config,python=python,registry=entry)
            process.terminate();process.wait(timeout=2)
    def test_seal_blocks_even_when_secondary_marker_removed(self):
        owned.seal(self.run,'synthetic');(self.run/'FIXTURE_STARTED').unlink()
        with self.assertRaises(owned.OwnershipError):owned.scope(self.run,phases=('INITIALIZED',))
if __name__=='__main__':unittest.main()
