"""Normal memory-only wallet login wiring checks; no real PG/HTTP/key/wallet."""
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from .wallet_identity import WalletIdentityAuthority
from .identity_runtime import IdentityServiceClient

ADDRESS='0x'+'1'*40
ORIGIN='https://localhost:16443'
class DB:
    def __init__(self):self.challenge=None
    def call(self,method,namespace,request):
        if method=='wallet_login_status':return {'enabled':True,'configDigest':'a'*64,'origin':ORIGIN,'chainId':10143}
        if method=='wallet_login_material':return {'challenge':self.challenge,'revision':1}
        raise AssertionError(method)
class Controller:
    def __init__(self,db):self.db=db;self.calls=[]
    def call(self,namespace,method,request):
        self.calls.append((method,request));command=request['command']
        if method=='wallet_login_challenge':self.db.challenge=command['challenge'];return {'challenge':command['challenge']}
        if method=='wallet_login':return {'authenticated':True,'authKind':'wallet','walletAddress':ADDRESS,'walletBound':True,'expiresAt':command['expires_at']}
        raise AssertionError(method)
class Checks(unittest.TestCase):
    def test_wallet_login_client_uses_bounded_ipc_and_forwards_original_request(self):
        original=SimpleNamespace(path='/synthetic/identity.sock',cap='INERT_TEST_CAPABILITY',
            call=lambda *args: self.fail('wallet login must use the bounded client'))
        client=IdentityServiceClient(original,lambda:'synthetic_namespace',{})
        body={'challengeId':'INERT_CHALLENGE','signature':'INERT_SIGNATURE'}
        context={'pre_hash':'b'*64,'csrf_hash':'c'*64}
        with patch('c1.ipc.Client') as bounded:
            bounded.return_value.call.return_value={'authenticated':True}
            self.assertEqual(client.call('wallet_login',body,context),{'authenticated':True})
            bounded.assert_called_once_with(original.path,original.cap,timeout=20)
            bounded.return_value.call.assert_called_once_with('synthetic_namespace','wallet_login',
                {'body':body,'context':context})
    def test_wallet_challenge_client_keeps_original_ipc(self):
        calls=[]
        original=SimpleNamespace(path='/synthetic/identity.sock',cap='INERT_TEST_CAPABILITY',
            call=lambda *args:calls.append(args) or {'challengeId':'INERT_CHALLENGE'})
        client=IdentityServiceClient(original,lambda:'synthetic_namespace',{})
        body={'address':ADDRESS};context={'pre_hash':'b'*64,'csrf_hash':'c'*64}
        with patch('c1.ipc.Client') as bounded:
            self.assertEqual(client.call('wallet_login_challenge',body,context),{'challengeId':'INERT_CHALLENGE'})
            bounded.assert_not_called()
        self.assertEqual(calls,[('synthetic_namespace','wallet_login_challenge',{'body':body,'context':context})])
    def service(self):
        db=DB();controller=Controller(db)
        def build(**q):return {'challengeId':q['challenge_id'],'address':q['wallet'],'chainId':q['chain_id'],'nonce':q['nonce'],'domain':'localhost:16443','uri':q['origin'],'issuedAt':q['issued_at'],'expiresAt':q['expires_at'],'message':'INERT_TEST_MESSAGE'}
        config={'namespace':'test','origin':ORIGIN,'chainId':10143,'principalHmacKey':'11'*32,
            'configSha256':'a'*64,'challengeTtlSeconds':180,'sessionTtlSeconds':3600,'activationExpiresAt':1000}
        leaf=SimpleNamespace(build_wallet_login_challenge=build,verify_wallet_login_signature=lambda *a,**q:ADDRESS)
        return WalletIdentityAuthority(config,db,controller,lambda:100,wallet_kind=lambda address:'EOA',leaf=leaf),controller
    def test_exact_challenge_dto_and_pre_session_binding(self):
        service,controller=self.service();context={'pre_hash':'b'*64,'csrf_hash':'c'*64}
        value=service.challenge('test',{'address':ADDRESS},context)
        self.assertEqual(set(value),{'challengeId','address','chainId','nonce','domain','uri','issuedAt','expiresAt','message'})
        self.assertEqual((value['issuedAt'],value['expiresAt']),(100,280))
        self.assertEqual(controller.calls[-1][1]['command']['pre_hash'],context['pre_hash'])
    def test_wallet_login_uses_typed_hmac_no_email_or_dynamic_issuer(self):
        service,controller=self.service();context={'pre_hash':'b'*64,'csrf_hash':'c'*64}
        challenge=service.challenge('test',{'address':ADDRESS},context)
        result=service.login('test',{'challengeId':challenge['challengeId'],'signature':'INERT_TEST_SIGNATURE'},context)
        command=controller.calls[-1][1]['command']
        self.assertEqual(result['authKind'],'wallet');self.assertTrue(result['walletBound'])
        self.assertEqual(command['expires_at'],1000)
        self.assertNotEqual(command['subject_hash'],command['recipient_key'])
        self.assertFalse(set(command)&{'email','email_key','issuer','environment_id','signature'})
    def test_unknown_wallet_kind_does_not_create_session(self):
        service,controller=self.service();context={'pre_hash':'b'*64,'csrf_hash':'c'*64}
        challenge=service.challenge('test',{'address':ADDRESS},context);service.wallet_kind=lambda a:'UNKNOWN'
        with self.assertRaises(Exception):service.login('test',{'challengeId':challenge['challengeId'],'signature':'INERT_TEST_SIGNATURE'},context)
        self.assertEqual(len(controller.calls),1)

if __name__=='__main__':unittest.main()
