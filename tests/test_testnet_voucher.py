import json
import os
from pathlib import Path
import tempfile
import unittest
from server.testnet_voucher.core import VoucherError, VoucherService, VoucherStore, canonical

A='0x'+'a'*64;B='0x'+'b'*64;C='0x'+'c'*64
def evidence(**change):
    value={'planHash':'e'*64,'operationId':A,'voucherId':B,'batchId':C,'partnerLabel':'partner-a','recipientRef':'ref-a'}
    value.update(change);return value
class Clock:
    def __init__(self):self.value=1_800_000_000
    def __call__(self):return self.value
    def add(self,n):self.value+=n

class VoucherTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.clock=Clock();self.current=evidence()
        self.service=VoucherService(VoucherStore(self.root/'voucher'),self.root/'issuance',clock=self.clock,issuance_reader=lambda _:dict(self.current));self.service.initialize()
    def tearDown(self):self.temp.cleanup()
    @staticmethod
    def secret(result):return result['url'].rsplit('/',1)[1]
    def test_hash_only_link_rotation_and_first_open_gate(self):
        first=self.service.create_invite('partner-a','http://127.0.0.1:15207');old=self.secret(first)
        self.assertNotIn(old.encode(),(self.root/'voucher'/'voucher.sqlite3').read_bytes())
        with self.assertRaisesRegex(VoucherError,'INVITE_EXISTS'):self.service.create_invite('partner-a','http://127.0.0.1:15207')
        second=self.service.create_invite('partner-a','http://127.0.0.1:15207',rotate=True)
        with self.assertRaisesRegex(VoucherError,'INVITE_REJECTED'):self.service.exchange(old)
        token,_=self.service.exchange(self.secret(second));self.assertEqual(self.service.partner_view('partner-a')['status'],'OPENED')
        with self.assertRaisesRegex(VoucherError,'INVITE_ALREADY_OPENED'):self.service.create_invite('partner-a','http://127.0.0.1:15207',rotate=True)
        self.assertTrue(token)
    def test_reopen_transfers_single_session_and_refresh_recovers_csrf(self):
        link=self.service.create_invite('partner-a','http://127.0.0.1:15207');secret=self.secret(link)
        first_token,first=self.service.exchange(secret);self.assertEqual(self.service.session(first_token),first)
        first_display=self.service.create_display(first_token,first['csrfToken'])['display'];second_token,second=self.service.exchange(secret)
        with self.assertRaisesRegex(VoucherError,'VOUCHER_SESSION_REQUIRED'):self.service.session(first_token)
        self.assertFalse(self.service.store.display_matches(first_display['code'],self.clock.value));self.assertEqual(self.service.session(second_token),second)
    def test_display_is_short_opaque_and_replaced(self):
        link=self.service.create_invite('partner-a','http://127.0.0.1:15207');secret=self.secret(link);token,session=self.service.exchange(secret)
        first=self.service.create_display(token,session['csrfToken'])['display'];self.assertNotIn(secret,first['qrPayload']);self.assertNotIn(B,first['qrPayload']);self.assertRegex(first['code'],r'^\d{6}$')
        self.assertTrue(self.service.store.display_matches(first['qrPayload'],self.clock.value));second=self.service.create_display(token,session['csrfToken'])['display']
        self.assertFalse(self.service.store.display_matches(first['qrPayload'],self.clock.value));self.assertTrue(self.service.store.display_matches(second['code'],self.clock.value))
        self.clock.add(121);self.assertFalse(self.service.store.display_matches(second['code'],self.clock.value))
    def test_recipient_payload_hides_recipient_ref_and_logout_revokes(self):
        link=self.service.create_invite('partner-a','http://127.0.0.1:15207');token,session=self.service.exchange(self.secret(link))
        self.assertNotIn('recipientRef',json.dumps(session));display=self.service.create_display(token,session['csrfToken'])['display']
        with self.assertRaisesRegex(VoucherError,'CSRF_DENIED'):self.service.logout(token,'bad-csrf')
        self.service.logout(token,session['csrfToken'])
        with self.assertRaisesRegex(VoucherError,'VOUCHER_SESSION_REQUIRED'):self.service.session(token)
        self.assertFalse(self.service.store.display_matches(display['qrPayload'],self.clock.value))
    def test_wrong_partner_and_immutable_binding_change_fail_closed(self):
        with self.assertRaisesRegex(VoucherError,'TESTNET_SCOPE_DENIED'):self.service.partner_view('partner-b')
        self.current=evidence(voucherId='0x'+'f'*64)
        with self.assertRaisesRegex(VoucherError,'ISSUANCE_BINDING_CONFLICT'):self.service.partner_view('partner-a')
    def test_anchor_rollback_quarantines(self):
        self.service.create_invite('partner-a','http://127.0.0.1:15207');anchor=self.root/'voucher.anchor.json';value=json.loads(anchor.read_text());value['generation']-=1;anchor.write_text(canonical(value));os.chmod(anchor,0o600)
        with self.assertRaisesRegex(VoucherError,'RESTORE_QUARANTINE'):self.service.partner_view('partner-a')
if __name__=='__main__':unittest.main()
