"""CP29 integration adapters: synthetic identities/keys only, no network or signing RPC."""
import os
import tempfile
import types
import unittest
from pathlib import Path

from server.contracts import ApiError
from server.manual_business.cp29_identity import (fingerprint, read_private_bytes,
                                                    validate_mappings, DynamicWorkVerifier)
from server.manual_business.cp29_keystore import signer_from_encrypted_keystore

ENV='7fe95f70-e5cc-4c3c-beed-a133e81268dc'
ORIGIN='http://127.0.0.1:15287'
OWNER='0x'+'a'*40
SERVICE='0x'+'b'*40


class FakeRequest:
    method='POST'
    host_url=ORIGIN+'/'
    def __init__(self, token='valid', origin=ORIGIN, body=None):
        self.headers={'Origin':origin, 'Authorization':'Bearer '+token}
        self.body={} if body is None else body
    def get_json(self, silent=True): return self.body


class FakeAccount:
    address=SERVICE
    @staticmethod
    def decrypt(content, password):
        if password != 'test-correct-password': raise ValueError('Password rejected')
        return b'fake-private-key'
    @staticmethod
    def from_key(key):
        assert key == b'fake-private-key'
        return FakeAccount()
    @staticmethod
    def sign_transaction(tx):
        return types.SimpleNamespace(raw_transaction=b'fake-signed-data')


class CP29IdentityTests(unittest.TestCase):
    def setUp(self): self.key = bytes(range(32))
    def test_two_distinct_pseudonyms_and_manual_mapping(self):
        p=fingerprint(self.key,ENV,'partner-private-subject')
        o=fingerprint(self.key,ENV,'owner-private-subject')
        self.assertNotEqual(p,o)
        self.assertEqual(p,fingerprint(self.key,ENV,'partner-private-subject'))
        self.assertTrue(validate_mappings({p:{'actorId':'cp29-partner','revision':1},
                   o:{'actorId':'cp29-owner','revision':1}},partner_actor='cp29-partner',owner_actor='cp29-owner'))
    def test_fingerprint_does_not_expose_subject_and_changes_key(self):
        fp=fingerprint(self.key,ENV,'hello@example.invalid')
        self.assertTrue(fp.startswith('cp29:'))
        self.assertNotIn('hello',fp)
        self.assertNotEqual(fp,fingerprint(bytes(reversed(self.key)),ENV,'hello@example.invalid'))
        with self.assertRaises(ValueError): fingerprint(b'weak',ENV,'x')
        with self.assertRaises(ValueError): fingerprint(self.key,ENV,'')
    def test_mapping_cannot_share_actor_or_be_user_supplied(self):
        k=fingerprint(self.key,ENV,'partner')
        with self.assertRaises(ValueError): validate_mappings({k:{'actorId':'partner','revision':1}},partner_actor='partner',owner_actor='owner')
        with self.assertRaises(ValueError): validate_mappings({k:{'actorId':'partner','revision':1},
                 'raw-subject':{'actorId':'owner','revision':1}},partner_actor='partner',owner_actor='owner')
        with self.assertRaises(ValueError): validate_mappings({k:{'actorId':'partner','revision':1},
                 fingerprint(self.key,ENV,'owner'):{'actorId':'partner','revision':1}},partner_actor='partner',owner_actor='owner')
    def test_private_permissions_and_symlink_fail(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'key';p.write_bytes(self.key);p.chmod(0o600)
            self.assertEqual(read_private_bytes(p,min_length=32,max_length=32),self.key)
            p.chmod(0o644)
            with self.assertRaises(PermissionError): read_private_bytes(p)
            p.chmod(0o600)
            q=Path(d)/'alias';q.symlink_to(p)
            with self.assertRaises(PermissionError): read_private_bytes(q)
    def test_verified_subject_adapter_rejects_input_and_changes(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'key';p.write_bytes(self.key);p.chmod(0o600)
            v=object.__new__(DynamicWorkVerifier)
            v._key_path=p;v._key=self.key;v.origin=ORIGIN;v.clock=lambda:100
            v.profile=object();v.source_check=lambda:None;v.jwks=object()
            v.verifier=lambda raw,**kw:types.SimpleNamespace(subject='real-id',environment_id=ENV,
                                      sid_hash='sid-hash',expires_at=200,scopes=frozenset({'user:basic'}))
            self.assertEqual(v(FakeRequest()),fingerprint(self.key,ENV,'real-id'))
            for bad in (FakeRequest(origin='http://evil.test'),FakeRequest(body={'role':'owner'})):
                with self.assertRaises(ApiError):v(bad)
            p.write_bytes(b'x'*32)
            with self.assertRaises(ApiError):v(FakeRequest())
            p.write_bytes(self.key)
            v.verifier=lambda raw,**kw:types.SimpleNamespace(subject='real-id',environment_id=ENV,
                                      sid_hash=None,expires_at=200,scopes=frozenset({'user:basic'}))
            with self.assertRaises(ApiError):v(FakeRequest())
            v.verifier=lambda raw,**kw:types.SimpleNamespace(subject='real-id',environment_id=ENV,
                                      sid_hash='sid-hash',expires_at=200,scopes=frozenset({'user:basic','admin'}))
            with self.assertRaises(ApiError):v(FakeRequest())
            v.verifier=lambda raw,**kw:types.SimpleNamespace(subject='real-id',environment_id=ENV,
                                      sid_hash='sid-hash',expires_at=99,scopes=frozenset({'user:basic'}))
            with self.assertRaises(ApiError):v(FakeRequest())


class CP29SignerTests(unittest.TestCase):
    def test_encrypted_keystore_only_expected_service_signs(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'service';root.mkdir(mode=0o700)
            p=root/'service-wallet.json';p.write_text('{"version":3,"address":"'+SERVICE[2:]+'","crypto":"synthetic-only-no-real-key"}');p.chmod(0o600)
            sign=signer_from_encrypted_keystore(p,expected_service_address=SERVICE,admin=OWNER,
                  merchant=OWNER,passphrase_prompt=lambda:'test-correct-password',account_api=FakeAccount)
            self.assertEqual(sign({'from':SERVICE,'type':2}),b'fake-signed-data')
            for tx in ({'from':OWNER,'type':2},{'from':SERVICE,'type':0}):
                with self.assertRaises(PermissionError):sign(tx)
    def test_no_owner_key_or_invalid_parent_file_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'service';root.mkdir(mode=0o700)
            p=root/'service-wallet.json';p.write_text('{"version":3,"address":"'+SERVICE[2:]+'","crypto":"synthetic-only-no-real-key"}');p.chmod(0o600)
            options=dict(expected_service_address=OWNER,admin=OWNER,merchant=OWNER,
                        passphrase_prompt=lambda:'test-correct-password',account_api=FakeAccount)
            with self.assertRaises(ValueError):signer_from_encrypted_keystore(p,**options)
            options['expected_service_address']=SERVICE
            root.chmod(0o755)
            with self.assertRaises(PermissionError):signer_from_encrypted_keystore(p,**options)
            root.chmod(0o700)
            p.chmod(0o644)
            with self.assertRaises(PermissionError):signer_from_encrypted_keystore(p,**options)
            p.chmod(0o600)
            alias=root/'alias';alias.symlink_to(p)
            with self.assertRaises(PermissionError):signer_from_encrypted_keystore(alias,**options)


if __name__=='__main__': unittest.main()
