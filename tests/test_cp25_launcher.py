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

    def test_resume_command_quotes_directory(self):
        root=Path("/tmp/rehearsal with spaces/'literal$")
        args=shlex.split(launcher.resume_command(root))
        self.assertEqual(args[-3:],['--directory',str(root),'--resume'])

if __name__=='__main__':unittest.main()
