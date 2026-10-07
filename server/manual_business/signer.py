"""Single-writer Unix IPC for original issue/lock/report intents only.

The operator owns key-provider composition. Importing this module never loads a key.
"""
import fcntl
import hmac
import json
import os
import socket
import stat
import struct
import ctypes
import sys
from pathlib import Path
from eth_account import Account
from eth_account.typed_transactions import TypedTransaction
from eth_account._utils.legacy_transactions import Transaction
from hexbytes import HexBytes
from web3 import Web3
from server.backend import canonical
from server.chain.client import ChainConflict
from server.contracts import ApiError


def verify_signed(raw, tx):
    raw = HexBytes(raw)
    sender = Account.recover_transaction(raw)
    if raw[0] <= 0x7f:
        decoded = TypedTransaction.from_bytes(raw).as_dict()
    else:
        decoded = Transaction.from_bytes(raw).as_dict()
        decoded['chainId'] = (decoded['v']-35)//2
    # CP28 only accepts EIP1559; no legacy fee ambiguity.
    if decoded.get('type') != 2: raise ChainConflict('Only reviewed EIP1559 transaction accepted')
    normalized = {'from': sender.lower(), 'to': Web3.to_hex(decoded['to']).lower(),
                  'data': Web3.to_hex(decoded['data']), **{k: decoded[k] for k in
                  ('chainId', 'nonce', 'value', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas')}}
    expected = {**tx, 'from': tx['from'].lower(), 'to': tx['to'].lower()}
    if normalized != expected or decoded.get('accessList'):
        raise ChainConflict('Signed transaction differs from independently reviewed intent')
    return Web3.to_hex(Web3.keccak(raw))


class Signer:
    def __init__(self, service, sign, broadcast, capability):
        if not isinstance(capability, str) or len(capability) < 43: raise ValueError('256-bit capability required')
        self.service, self.sign, self.broadcast, self.capability = service, sign, broadcast, capability

    def handle(self, request):
        if (not isinstance(request, dict) or set(request) != {'version', 'operationId', 'capability'} or
                request['version'] != 1 or not isinstance(request['capability'], str) or
                not hmac.compare_digest(request['capability'], self.capability) or
                not isinstance(request['operationId'], str) or len(request['operationId']) > 128):
            raise ApiError(403, 'IPC_DENIED', 'Authenticated fixed intent required')
        s = self.service; op_id = request['operationId']
        # Repeated IPC is a read of the original reservation, including restart after key invocation.
        with s.store.transaction() as db:
            existing = db.execute('SELECT state,tx_hash FROM cp28_signing WHERE operation_id=?', (op_id,)).fetchone()
            if existing:
                state = existing['state']
                if state in ('SIGNING_STARTED', 'SIGNED', 'BROADCAST_STARTED'):
                    state = 'UNKNOWN'
                    db.execute("UPDATE cp28_signing SET state='UNKNOWN' WHERE operation_id=?", (op_id,))
                return {'state': state, 'txHash': existing['tx_hash'], 'maySign': False}
            s.gate.require(db)
            _, kind, _ = s.intent(db, op_id)
            if kind not in ('issue', 'lock', 'report'): raise ApiError(403, 'IPC_DENIED', 'Service action denied')
        review = s.review(op_id)
        if not review.get('maySign') or not s.start(review, service=True): return {'state': 'UNKNOWN', 'maySign': False}
        try:
            # At this point atomic SIGNING_STARTED+nonce+budget is already durable.
            raw = HexBytes(self.sign({**review['transaction'], 'type': 2}))
            tx_hash = verify_signed(raw, review['transaction'])
            with s.store.transaction() as db:
                s.gate.require(db, kind)
                s.intent(db, op_id)
                db.execute("UPDATE cp28_signing SET state='SIGNED',tx_hash=?,raw_cipher=? WHERE operation_id=? AND state='SIGNING_STARTED'",
                           (tx_hash, s.b.encrypt(raw.hex()), op_id))
            with s.store.transaction() as db:
                s.gate.require(db, kind)
                s.intent(db, op_id)
                changed = db.execute("UPDATE cp28_signing SET state='BROADCAST_STARTED' WHERE operation_id=? AND state='SIGNED'", (op_id,)).rowcount
                if changed != 1: raise ChainConflict('Original broadcast already started')
            result = self.broadcast(raw, review['transaction'])
            if result.lower() != tx_hash.lower(): raise ChainConflict('Broadcast hash conflict')
            s.gate.record_hash(op_id, tx_hash)
            return {'state': 'UNKNOWN', 'txHash': tx_hash, 'maySign': False}
        except Exception:
            s.gate.unknown(op_id)
            return {'state': 'UNKNOWN', 'maySign': False}


def peer_uid(connection):
    if hasattr(connection, 'getpeereid'): return connection.getpeereid()[0]
    if hasattr(socket, 'SO_PEERCRED'):
        return struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1]
    if sys.platform == 'darwin':
        # CPython on macOS exposes LOCAL_PEERCRED but not socket.getpeereid.
        libc = ctypes.CDLL(None, use_errno=True)
        function = libc.getpeereid
        function.argtypes = [ctypes.c_int, ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint)]
        function.restype = ctypes.c_int
        uid, gid = ctypes.c_uint(), ctypes.c_uint()
        if function(connection.fileno(), ctypes.byref(uid), ctypes.byref(gid)) != 0:
            raise PermissionError('Unable to authenticate Unix peer')
        return uid.value
    raise PermissionError('Peer credential API unavailable')


def private_file(path):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600:
        raise PermissionError('Operator-owned mode-0600 file required')
    return path


def serve(signer, directory, stop):
    directory = Path(directory).resolve()
    info = directory.stat()
    if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise PermissionError('Operator-owned mode-0700 IPC directory required')
    path = directory/'signer.sock'
    with open(directory/'signer.lock', 'a+b') as lock:
        os.chmod(directory/'signer.lock', 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if path.exists(): path.unlink()  # only while owning the lifetime writer lock
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            server.bind(str(path)); os.chmod(path, 0o600); server.listen(1); server.settimeout(.5)
            try:
                while not stop.is_set():
                    try: conn, _ = server.accept()
                    except socket.timeout: continue
                    with conn:
                        conn.settimeout(3)
                        try:
                            if peer_uid(conn) != os.geteuid(): raise PermissionError('Wrong IPC peer')
                            data = bytearray()
                            while b'\n' not in data:
                                part = conn.recv(4097-len(data))
                                if not part: raise ValueError('Incomplete IPC request')
                                data.extend(part)
                                if len(data) > 4096: raise ValueError('Oversized IPC request')
                            if data.count(b'\n') != 1 or not data.endswith(b'\n'): raise ValueError('Exactly one request required')
                            result = signer.handle(json.loads(data))
                        except Exception: result = {'state': 'DENIED_OR_UNKNOWN', 'maySign': False}
                        try: conn.sendall((canonical(result)+'\n').encode())
                        except OSError: pass  # durable original state already retained
            finally: path.unlink(missing_ok=True)


def request_sign(socket_path, capability, operation_id):
    payload = canonical({'version': 1, 'operationId': operation_id, 'capability': capability})+'\n'
    if len(payload.encode()) > 4096: raise ValueError('IPC size limit')
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(3); client.connect(str(socket_path))
        if peer_uid(client) != os.geteuid(): raise PermissionError('Wrong signer peer')
        client.sendall(payload.encode()); data = bytearray()
        while b'\n' not in data:
            part = client.recv(4097-len(data))
            if not part: raise ConnectionError('Original signer result unknown')
            data.extend(part)
            if len(data) > 4096: raise ValueError('IPC response size limit')
        return json.loads(data)
