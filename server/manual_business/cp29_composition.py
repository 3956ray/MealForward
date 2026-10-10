"""Explicit CP29 business web/signer assembly helpers; NO auto-start or auto-sign.

The operator supplies an approved runtime file, a fresh persistent database,
exact 15287 Dynamic profile, two verified fingerprint mappings and a bounded
capability. A missing component fails before serving or decrypting any wallet.
These helpers are only called by a separately authorized launcher, never by
CP28's preparation CLI or on module import.
"""

import time
from .cp29_identity import DynamicWorkVerifier
from .cp29_mode import validate_identity_mode
from .composition import load_backend, operator_signer
from .cp29_auth import CP29Authentication
from .web import create_app
from .signer import request_sign, private_file
from pathlib import Path


def verify_business_mapping(config, *, now=None):
    if not isinstance(config, dict) or config.get('purpose') != 'cp28-new-business' or \
            config.get('origin') != 'http://127.0.0.1:15287':
        raise ValueError('CP29 business must use explicitly reviewed 15287 origin')
    spec = config.get('cp29WorkActors')
    if not isinstance(spec, dict) or set(spec) != {'partnerActorId', 'ownerActorId'}:
        raise ValueError('Operator-reviewed partner and owner actor IDs required')
    validate_identity_mode(config, time.time() if now is None else now)
    roles = config.get('participants', {})
    if not isinstance(roles, dict) or roles.get('admin', '').lower() != roles.get('merchant', '').lower():
        raise ValueError('Approved admin=merchant identity required')
    if roles.get('issuer', '').lower() != roles.get('operator', '').lower():
        raise ValueError('CP29 limited test uses one independent issuer/operator service wallet')
    if roles.get('issuer', '').lower() in (roles.get('admin','').lower(), roles.get('supporter','').lower()):
        raise ValueError('Service signer must be distinct from admin/merchant/supporter')
    return True


def business_web_app(*, config_file, plan_file, encryption_key_file, identity_profile_file,
                     fingerprint_key_file, ipc_directory, capability_file):
    """No default credentials, role mapping, Runtime or implicit grants."""
    backend = load_backend(config_file, plan_file, encryption_key_file)
    verify_business_mapping(backend.runtime.config)
    origin = backend.runtime.config['origin']
    verifier = DynamicWorkVerifier(profile_path=identity_profile_file,
           fingerprint_key_path=fingerprint_key_file, origin=origin)
    capability = private_file(capability_file).read_text().strip()
    if len(capability) < 43: raise ValueError('Explicit 256-bit IPC capability required')
    auth = CP29Authentication(backend, origin, verifier)
    return create_app(backend.runtime.config, backend, authentication=auth,
        dispatch=lambda operation: request_sign(Path(ipc_directory)/'signer.sock',capability,operation))


def business_signer(*, config_file, plan_file, encryption_key_file, keystore_file,
                    capability_file, password_prompt=None):
    """Call ONLY from separately approved local signer process (not web)."""
    backend = load_backend(config_file, plan_file, encryption_key_file)
    verify_business_mapping(backend.runtime.config)
    config=backend.runtime.config
    from .cp29_keystore import signer_from_encrypted_keystore
    sign=signer_from_encrypted_keystore(keystore_file,
             expected_service_address=config['participants']['issuer'],
             admin=config['participants']['admin'], merchant=config['participants']['merchant'],
             passphrase_prompt=password_prompt)
    capability=private_file(capability_file).read_text().strip()
    if len(capability)<43: raise ValueError('Explicit 256-bit IPC capability required')
    return operator_signer(backend,sign,capability)
