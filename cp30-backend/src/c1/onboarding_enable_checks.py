"""Real Gateway error-boundary checks in memory; no PG/HTTP/signature/chain IO."""
from types import SimpleNamespace
import unittest
from .onboarding_adapter import OnboardingGateway,IntegrationRejected,domain_modules


class Checks(unittest.TestCase):
    def gateway(self,*,error=None,result=None):
        service,_=domain_modules();calls=[]
        gateway=OnboardingGateway(SimpleNamespace(),lambda:'synthetic_namespace',
            operation_gate=SimpleNamespace(allowed=lambda *args:True))
        context=SimpleNamespace(session_hash='INERT_SESSION',csrf_hash='INERT_CSRF')
        def enable(actual_context,registration_id,signature):
            calls.append((actual_context,registration_id,signature))
            if error is not None:raise error
            return result
        gateway.domain=lambda *args:(SimpleNamespace(enable=enable),context)
        return gateway,service,calls,context

    def test_domain_codes_survive_with_fixed_status(self):
        _,service,_,_=self.gateway()
        for code,status in [('INVALID_OWNER_AUTHORIZATION',422),('INVALID_SIGNATURE',422),
            ('INVALID_DEPLOYMENT_PAYLOAD',422),('CODEC_UNAVAILABLE',503),
            ('AUTHORIZATION_EXPIRED',409),('NOT_FOUND',404),('SNAPSHOT_CHANGED',409)]:
            with self.subTest(code=code):
                gateway,_,calls,context=self.gateway(error=service.Rejected(code))
                with self.assertRaises(IntegrationRejected) as caught:
                    gateway.enable({'session_hash':'INERT_SESSION','csrf_hash':'INERT_CSRF'},
                        'INERT_ORIGINAL_ID',{'ownerSignature':'INERT_ORIGINAL_SIGNATURE'})
                self.assertEqual((caught.exception.code,caught.exception.status),(code,status))
                self.assertEqual(calls,[(context,'INERT_ORIGINAL_ID','INERT_ORIGINAL_SIGNATURE')])

    def test_unknown_messages_and_unknown_uppercase_codes_are_redacted(self):
        _,service,_,_=self.gateway()
        for message in ['inert private diagnostic detail','UNREVIEWED_ERROR']:
            gateway,_,_,_=self.gateway(error=service.Rejected(message))
            with self.assertRaises(IntegrationRejected) as caught:
                gateway.enable({},'INERT_ORIGINAL_ID',{'ownerSignature':'INERT_ORIGINAL_SIGNATURE'})
            self.assertEqual((caught.exception.code,caught.exception.status),('ONBOARDING_REQUEST_REJECTED',409))
            self.assertNotIn(message,str(caught.exception))

    def test_non_domain_failures_are_not_reclassified(self):
        original=RuntimeError('INERT_FAILURE');gateway,_,_,_=self.gateway(error=original)
        with self.assertRaises(RuntimeError) as caught:
            gateway.enable({},'INERT_ORIGINAL_ID',{'ownerSignature':'INERT_ORIGINAL_SIGNATURE'})
        self.assertIs(caught.exception,original)

    def test_success_preserves_original_result_and_signature(self):
        result={'registrationId':'INERT_ORIGINAL_ID','state':'PENDING','ready':False}
        gateway,_,calls,context=self.gateway(result=result)
        self.assertEqual(gateway.enable({},result['registrationId'],{'ownerSignature':'INERT_ORIGINAL_SIGNATURE'}),
            {**result,'businessReady':False,'walletActionsEnabled':True})
        self.assertEqual(calls,[(context,result['registrationId'],'INERT_ORIGINAL_SIGNATURE')])


if __name__=='__main__':unittest.main()
