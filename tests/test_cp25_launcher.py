"""CLI safety boundaries; temporary files and loopback sockets only."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shlex
import socket
import signal
import subprocess
import tempfile
import os
import sys
import time
import requests
import unittest
from unittest.mock import patch

SPEC=importlib.util.spec_from_file_location('rehearsal_launcher',Path(__file__).resolve().parents[1]/'scripts/cp24-local.py')
launcher=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(launcher)

class LauncherTests(unittest.TestCase):
    def test_new_mode_requires_no_directory_or_ports(self):
        self.assertTrue(launcher.arguments(['--new']).new)
        for args in ([],['--new','--resume'],['--new','--directory','x'],['--new','--ui-port','45001'],['--directory','x','--resume','--api-port','45001']):
            with self.subTest(args=args),contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit): launcher.arguments(args)

    def test_invalid_port_range(self):
        for port in ('0','-1','65536','not-a-port'):
            with self.subTest(port=port),contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit): launcher.arguments(['--directory','x','--ui-port',port])

    def test_four_distinct_ports_remain_reserved(self):
        held=launcher.reserve_ports([0]*4)
        try:
            ports=[s.getsockname()[1] for s in held]
            self.assertEqual(len(set(ports)),4)
            for port in ports:
                with socket.socket() as rival,self.assertRaises(OSError): rival.bind(('127.0.0.1',port))
        finally:
            for s in held:s.close()

    def test_recently_closed_listener_port_can_be_reserved(self):
        with socket.socket() as owner:
            owner.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            owner.bind(('127.0.0.1',0));owner.listen(1);port=owner.getsockname()[1]
            client=socket.create_connection(('127.0.0.1',port),timeout=1)
            connection,_=owner.accept();connection.close();client.close()
        held=launcher.reserve_ports([port])
        for sock in held:sock.close()

    def test_occupied_port_fails_without_closing_owner(self):
        with socket.socket() as owner:
            owner.bind(('127.0.0.1',0));owner.listen(1);port=owner.getsockname()[1]
            with self.assertRaisesRegex(SystemExit,'no existing process was stopped'):launcher.reserve_ports([0,port,0,0])
            with socket.create_connection(('127.0.0.1',port),timeout=1):pass

    def test_existing_directory_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker=Path(tmp)/'keep';marker.write_text('original')
            with patch('sys.argv',['launcher','--directory',tmp]),self.assertRaisesRegex(SystemExit,'original records were not changed'):launcher.main()
            self.assertEqual(marker.read_text(),'original');self.assertEqual(list(Path(tmp).iterdir()),[marker])

    def test_duplicate_ports_fail_before_directory_creation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'new'
            with patch('sys.argv',['launcher','--directory',str(root),'--ui-port','45111','--api-port','45111']),self.assertRaisesRegex(SystemExit,'distinct'):launcher.main()
            self.assertFalse(root.exists())

    def test_resume_evidence_strict_and_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            with self.assertRaisesRegex(SystemExit,'QUARANTINE'):launcher.resume_record(root)
            for name in launcher.SAVED_FILES:
                p=root/name;p.parent.mkdir(exist_ok=True);p.write_text('original')
            saved={'ports':[45111,45112,45113,45114],'files':{name:launcher.fingerprint(root/name) for name in launcher.SAVED_FILES}}
            marker=root/'clean-stop.json';marker.write_text(json.dumps(saved))
            self.assertEqual(launcher.resume_record(root),saved)
            (root/'anvil.json').write_text('changed')
            with self.assertRaisesRegex(SystemExit,'QUARANTINE'):launcher.resume_record(root)
            self.assertTrue(marker.exists());self.assertEqual((root/'anvil.json').read_text(),'changed')
            for invalid in ({}, {'ports':[1,2,3,4],'files':{}}, {'ports':[True,2,3,4],'files':saved['files']}, {'ports':[1,1,3,4],'files':saved['files']}):
                marker.write_text(json.dumps(invalid))
                with self.assertRaisesRegex(SystemExit,'QUARANTINE'):launcher.resume_record(root)

    def test_startup_bind_race_preserves_competing_listener(self):
        held=launcher.reserve_ports([0]*4)
        ports=[s.getsockname()[1] for s in held]
        for s in held:s.close()
        real_popen=subprocess.Popen
        rival=socket.socket()
        old_handlers={sig:signal.getsignal(sig) for sig in (signal.SIGINT,signal.SIGTERM)}
        def launch(args,**kwargs):
            if str(args[0]).endswith('/vite'):
                rival.bind(('127.0.0.1',ports[0]));rival.listen(5)
            return real_popen(args,**kwargs)
        try:
            with tempfile.TemporaryDirectory(prefix='cp25-bind-race-') as tmp:
                root=Path(tmp)/'fresh'
                argv=['launcher','--directory',str(root)]
                for flag,port in zip(launcher.PORT_FLAGS,ports):argv+=['--'+flag+'-port',str(port)]
                with patch('sys.argv',argv),patch.object(launcher.subprocess,'Popen',side_effect=launch),self.assertRaisesRegex(RuntimeError,'port competition'):
                    launcher.main()
                self.assertTrue((root/'business/config.json').is_file())
                self.assertFalse((root/'clean-stop.json').exists())
                self.assertFalse((root/'runtime.json').exists())
                with socket.create_connection(('127.0.0.1',ports[0]),timeout=1):pass
        finally:
            rival.close()
            for sig,handler in old_handlers.items():signal.signal(sig,handler)

    def test_new_node_bind_race_never_initializes_foreign_chain(self):
        real_popen=subprocess.Popen
        rival=None;root=None;rpc=None
        session=requests.Session();session.trust_env=False
        old_handlers={sig:signal.getsignal(sig) for sig in (signal.SIGINT,signal.SIGTERM)}
        def call(method,params):
            return session.post(rpc,json={'jsonrpc':'2.0','id':1,'method':method,'params':params},timeout=1).json()['result']
        def launch(args,**kwargs):
            nonlocal rival,root,rpc
            if Path(str(args[0])).name=='anvil':
                port=args[args.index('--port')+1];rpc='http://127.0.0.1:'+port
                root=Path(args[args.index('--dump-state')+1]).parent
                rival=real_popen([args[0],'--host','127.0.0.1','--port',port,'--chain-id','31337','--silent'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
                for _ in range(100):
                    try:
                        if call('eth_chainId',[])=='0x7a69':break
                    except requests.RequestException:pass
                    time.sleep(.05)
                else:raise RuntimeError('Competing test node failed to start')
                return real_popen([sys.executable,'-c','import os,sys,time;time.sleep(4);os.execv(sys.argv[1],sys.argv[1:])',*args],**kwargs)
            return real_popen(args,**kwargs)
        output=io.StringIO()
        try:
            with patch('sys.argv',['launcher','--new']),patch.object(launcher.subprocess,'Popen',side_effect=launch),contextlib.redirect_stdout(output),self.assertRaisesRegex(RuntimeError,'Owned Anvil failed'):
                launcher.main()
            self.assertIsNone(rival.poll())
            self.assertEqual(call('eth_blockNumber',[]),'0x0')
            self.assertTrue(all(call('eth_getTransactionCount',[a,'latest'])=='0x0' for a in call('eth_accounts',[])))
            self.assertFalse((root/'business').exists())
            self.assertFalse((root/'runtime.json').exists())
            self.assertFalse((root/'clean-stop.json').exists())
            self.assertNotIn('Local rehearsal READY',output.getvalue())
        finally:
            if rival and rival.poll() is None:
                os.killpg(rival.pid,signal.SIGTERM);rival.wait(timeout=10)
            session.close()
            for sig,handler in old_handlers.items():signal.signal(sig,handler)

    def test_missing_ownership_tool_fails_before_start(self):
        with patch('sys.argv',['launcher','--new']),patch.object(launcher.shutil,'which',return_value=None),self.assertRaisesRegex(SystemExit,'no instance started'):
            launcher.main()

    def test_resume_command_quotes_directory(self):
        root=Path("/tmp/rehearsal with spaces/'literal$")
        args=shlex.split(launcher.resume_command(root))
        self.assertEqual(args[-3:],['--directory',str(root),'--resume'])

if __name__=='__main__':unittest.main()
