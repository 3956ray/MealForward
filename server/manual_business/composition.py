"""Explicit 10143 production wiring. Never selected by an HTTP request or environment.

No call to this factory occurs in the preparation launcher. A later Runtime Gate
must configure the trusted authenticator and operator-owned files independently.
"""
import json
import time
from pathlib import Path
from web3 import Web3
from .identity import CHAIN_ID, GENESIS
from .rpc import HttpsTransport, TestnetRpc
from .store import ManualStore
from .runtime import RuntimeGate
from .backend import ManualBackend
from .signer import private_file, verify_signed, Signer
from .service import BusinessService
from server.backend import canonical, digest
from server.chain.client import ChainConflict


def web_application(config_file, plan_file, secret_file, *, verified_subject, ipc_directory, capability_file):
    """User-selected authenticator is mandatory; no default or credential fallback."""
    from .auth import TrustedAuthentication
    from .web import create_app
    from .signer import request_sign
    if not callable(verified_subject): raise ValueError('Select and configure the trusted identity adapter first')
    backend = load_backend(config_file, plan_file, secret_file)
    capability = private_file(capability_file).read_text().strip()
    if len(capability) < 43: raise ValueError('Operator-provisioned IPC capability required')
    auth = TrustedAuthentication(backend, backend.runtime.config['origin'], verified_subject)
    return create_app(backend.runtime.config, backend, authentication=auth,
                      dispatch=lambda op: request_sign(Path(ipc_directory)/'signer.sock', capability, op))


def load_backend(config_file, plan_file, secret_file):
    paths = [private_file(p) for p in (config_file, plan_file)]
    snapshots = [p.read_bytes() for p in paths]
    config, plan = [json.loads(raw) for raw in snapshots]
    if config.get('purpose') != 'cp28-new-business' or config.get('chainId') != CHAIN_ID or config.get('genesisHash') != GENESIS:
        raise ValueError('Explicit new10143 business configuration required')
    deployment = config['deployment']
    if (deployment['deploymentId'] != config['deploymentId'] or deployment['runId'] != config['runId'] or
            deployment['contractAddress'] != config['contractAddress'] or deployment['merchant'] != config['participants']['merchant'] or
            deployment['admin'] != config['participants']['admin']):
        raise ValueError('Verified deployment and participant configuration differ')
    identity = {k: v for k, v in deployment.items() if k != 'deploymentId'}
    if digest(canonical(identity)) != deployment['deploymentId']:
        raise ValueError('Verified new deployment identity required')
    def source_check():
        if any(private_file(p).read_bytes() != raw for p, raw in zip(paths, snapshots)):
            raise ValueError('Configuration changed; existing reviews and runtime disabled')
    store = ManualStore(config['databasePath'], config)
    runtime = RuntimeGate(store, config, plan, clock=time.time, source_check=source_check)
    # Fail before loading any application encryption material or opening a network connection.
    with store.transaction() as db: runtime.require(db)
    rpc = TestnetRpc(deployment, config['participants'], HttpsTransport(config['rpcUrl']))
    secret = private_file(secret_file).read_bytes()  # application encryption only; never a wallet key
    return ManualBackend(store, rpc, secret, runtime, time.time)


def operator_signer(backend, key_provider, capability):
    """Operator supplies a hardware/key-store callback. Web never receives that callback."""
    service = BusinessService(backend)
    def broadcast(raw, tx):
        expected_hash = verify_signed(raw, tx)
        with backend.store.transaction() as db: backend.runtime.require(db)
        with backend.rpc.observation():
            backend.rpc.guard()
            if backend.rpc.nonce(tx['from']) != tx['nonce']: raise ChainConflict('Original nonce changed before broadcast')
            # At most one call. The signer already persisted BROADCAST_STARTED.
            result = backend.rpc._call('eth_sendRawTransaction', [Web3.to_hex(raw)])
            if not isinstance(result, str) or result.lower() != expected_hash.lower(): raise ChainConflict('Original broadcast hash changed')
            return result
    return Signer(service, key_provider, broadcast, capability)
