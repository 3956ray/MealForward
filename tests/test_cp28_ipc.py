import json
import os
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from server.manual_business.signer import serve, request_sign, peer_uid, private_file


class IPCBoundaryTests(unittest.TestCase):
    def test_real_unix_peer_permissions_single_writer_and_bounded_request(self):
        # Short path because macOS sockaddr_un is limited to 104 bytes.
        with tempfile.TemporaryDirectory(prefix='c28-', dir='/tmp') as directory:
            root = Path(directory); root.chmod(0o700)
            calls = []; stop = threading.Event(); errors = []
            class FixedSigner:
                def handle(self, value):
                    calls.append(value); return {'state': 'UNKNOWN', 'maySign': False}
            def run():
                try: serve(FixedSigner(), root, stop)
                except Exception as e: errors.append(e)
            thread = threading.Thread(target=run); thread.start()
            try:
                for _ in range(100):
                    if (root/'signer.sock').exists() or errors: break
                    time.sleep(.01)
                self.assertFalse(errors)
                self.assertEqual((root/'signer.sock').stat().st_mode & 0o777, 0o600)
                result = request_sign(root/'signer.sock', 's'*43, 'fixed-original')
                self.assertEqual(result['state'], 'UNKNOWN')
                self.assertEqual(len(calls), 1)
                with self.assertRaises(BlockingIOError): serve(FixedSigner(), root, threading.Event())
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                    client.settimeout(1); client.connect(str(root/'signer.sock'))
                    self.assertEqual(peer_uid(client), os.geteuid())
                    client.sendall(b'x'*4097)
                    self.assertIn(b'DENIED_OR_UNKNOWN', client.recv(4096))
                self.assertEqual(len(calls), 1)
            finally:
                stop.set(); thread.join(timeout=3)
            self.assertFalse(thread.is_alive())
            self.assertFalse(errors)
            self.assertFalse((root/'signer.sock').exists())

    def test_wrong_peer_is_denied_before_dispatch(self):
        with tempfile.TemporaryDirectory(prefix='c28-', dir='/tmp') as directory:
            root = Path(directory); root.chmod(0o700); stop = threading.Event(); calls = []
            class FixedSigner:
                def handle(self, value): calls.append(value); return {}
            with patch('server.manual_business.signer.peer_uid', return_value=os.geteuid()+1):
                thread = threading.Thread(target=serve, args=(FixedSigner(), root, stop)); thread.start()
                try:
                    for _ in range(100):
                        if (root/'signer.sock').exists(): break
                        time.sleep(.01)
                    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                        client.settimeout(1); client.connect(str(root/'signer.sock'))
                        self.assertIn(b'DENIED_OR_UNKNOWN', client.recv(4096))
                    self.assertEqual(calls, [])
                finally: stop.set(); thread.join(timeout=3)

    def test_public_or_symlink_capability_files_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)/'capability'; p.write_text('s'*43); p.chmod(0o644)
            with self.assertRaises(PermissionError): private_file(p)
            p.chmod(0o600); self.assertEqual(private_file(p), p)
            link = Path(directory)/'alias'; link.symlink_to(p)
            with self.assertRaises(PermissionError): private_file(link)


if __name__ == '__main__': unittest.main()
