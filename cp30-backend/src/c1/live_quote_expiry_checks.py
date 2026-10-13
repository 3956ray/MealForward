"""Stored quote expiry is explicit before preparation or durable wallet attempts."""
from unittest.mock import patch
import unittest
from . import live_checks
from .onboarding_adapter import IntegrationRejected,wallet_bridge

class Checks(unittest.TestCase):
    def setUp(self):
        live_checks.LiveChecks.setUp(self)
        self.value=live_checks.LiveChecks.wallet(self)

    def test_expired_bridge_failure_becomes_explicit_before_any_attempt(self):
        value=self.value;quote=value['intent']['signed_quote']
        material={'kind':'fund','binding':value['store']['profile']['binding'],'expectedAccount':quote['quote']['payer'],'signedQuote':quote}
        # The actual bridge currently hides an expired quote behind this error.
        with self.assertRaisesRegex(IntegrationRejected,'CODEC_UNAVAILABLE'):
            wallet_bridge({'op':'prepareWallet','material':material,'now':'1000'})
        for now in (1000,1001):
            value['now']=now
            with patch('c1.live_gateway.wallet_bridge') as bridge:
                with self.assertRaisesRegex(IntegrationRejected,'QUOTE_EXPIRED') as result:
                    self.gateway.wallet_attempt({},value['intent']['id'],{'kind':'approve'})
                self.assertEqual(result.exception.status,409)
                bridge.assert_not_called()
        self.assertTrue(all(q['op']=='wallet_material' for _,q,_ in self.api.calls))

    def test_fresh_original_uses_real_bridge(self):
        prepared=self.gateway.wallet_preparation({},self.value['intent']['id'])
        self.assertEqual(prepared['allowedKinds'],['approve'])
        self.assertEqual([tx['functionName'] for tx in prepared['transactions']],['approve','fund'])
        self.assertEqual(prepared['material']['signedQuote']['quote']['deadline'],'1000')

    def test_unrelated_codec_error_is_not_reported_as_expiry(self):
        with patch('c1.live_gateway.wallet_bridge',side_effect=IntegrationRejected('CODEC_UNAVAILABLE',503)):
            with self.assertRaisesRegex(IntegrationRejected,'CODEC_UNAVAILABLE') as result:
                self.gateway.wallet_preparation({},self.value['intent']['id'])
        self.assertEqual(result.exception.status,503)

if __name__=='__main__':unittest.main()
