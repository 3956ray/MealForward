"""Explicit operator-only encrypted keystore adapter for the existing IPC signer.

This module contains no CLI, broadcast, wallet transfer or default key path.
Only an independently authorized signer process may construct this callback.
Never load it into web_application or the CP28 preparation launcher.
"""
from __future__ import annotations

import getpass
import os
import re
import stat
from pathlib import Path

from .cp29_identity import read_private_bytes

_ADDRESS = re.compile(r'^0x[0-9a-fA-F]{40}$')


def signer_from_encrypted_keystore(path, *, expected_service_address, admin, merchant,
                                    passphrase_prompt=None, account_api=None):
    """Build a signing-only callback after explicit operator interaction.

    Existing Signer.handle(), RuntimeGate and original-operation persistence
    remain the only permitted transaction entry points. This callback has no
    networking or independent broadcasting capabilities.
    """
    if any(not isinstance(a, str) or not _ADDRESS.fullmatch(a) for a in
           (expected_service_address, admin, merchant)):
        raise ValueError('Explicit expected public wallet addresses required')
    service = expected_service_address.lower()
    if service in (admin.lower(), merchant.lower()):
        raise ValueError('Service signer must be distinct from owner and admin')
    path = Path(path).absolute()  # do not resolve away a disallowed symlink
    if path.is_symlink():
        raise PermissionError('Keystore symlinks are not allowed')
    # require private container: the operator created the keystore under 0700.
    parent = path.parent
    info = parent.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise PermissionError('Service wallet parent must be owner-only mode-0700')
    raw = read_private_bytes(path, min_length=50, max_length=65536)
    if passphrase_prompt is None:
        passphrase_prompt = lambda: getpass.getpass('CP29 service keystore password (local terminal only): ')
    if account_api is None:
        from eth_account import Account
        account_api = Account
    # Keep password out of arguments, files, logs, environment and stdout.
    password = passphrase_prompt()
    if not isinstance(password, str) or not password:
        raise ValueError('Local operator password required')
    try:
        private_key = account_api.decrypt(raw.decode('utf-8'), password)
    finally:
        del password
    account = account_api.from_key(private_key)
    if account.address.lower() != service:
        raise ValueError('Decrypted signer does not match approved service wallet')
    def sign(tx):
        if not isinstance(tx, dict) or tx.get('from', '').lower() != service or tx.get('type') != 2:
            raise PermissionError('Only the approved service wallet may sign an EIP1559 transaction')
        # No direct call from HTTP; Signer.handle verifies persisted, bounded tx.
        signed = account.sign_transaction(tx)
        return signed.raw_transaction
    return sign
