"""Real synthetic RS256 JWTs, temporary DB and production HTTP/auth/work guards.
No real configuration, network, wallets or signer runtime are used.
"""
import copy
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from server.backend import canonical, digest
from server.contracts import ApiError, AuthContext
from server.dynamic_contracts import ClaimProfile
from server.dynamic_jwt import FixedJwksCache
from server.manual_business.cp29_identity import DynamicWorkVerifier, fingerprint
from server.manual_business.cp29_mode import (ACTORS, MODE, ORIGIN, ENVIRONMENT, CONTRACT, DEPLOYMENT, RUN, validate_identity_mode)
from server.manual_business.cp29_auth import CP29Authentication
from server.manual_business.cp29_composition import verify_business_mapping
from server.manual_business.backend import ManualWork
from server.manual_business.store import ManualStore
from server.manual_business.runtime import RuntimeGate
from server.manual_business.policy import MANUAL_POLICY
from server.manual_business.web import create_app

KEY = bytes(range(32))
P = fingerprint(KEY, ENVIRONMENT, 'synthetic-person')
O = fingerprint(KEY, ENVIRONMENT, 'synthetic-other-person')


def config(now=1000, single=True):
    c = dict(purpose='cp28-new-business', origin=ORIGIN, environmentId=ENVIRONMENT, chainId=10143,
             contractAddress=CONTRACT, deploymentId=DEPLOYMENT, runId=RUN,
             cp29WorkActors=dict(partnerActorId=ACTORS['partner'], ownerActorId=ACTORS['owner']),
             participants={'admin':'0x'+'a'*40, 'merchant':'0x'+'a'*40, 'supporter':'0x'+'a'*40,
                           'issuer':'0x'+'b'*40, 'operator':'0x'+'b'*40})
    entries = {role:dict(actorId=actor, revision=1) for role, actor in ACTORS.items()}
    if single:
        c.update(cp29IdentityMode=MODE, cp29IdentityWindow=dict(issuedAt=now, expiresAt=now+3600),
                 trustedSubjects={P:entries})
    else: c['trustedSubjects'] = {P:entries['partner'], O:entries['owner']}
    return c


class ModeTests(unittest.TestCase):
    def test_fixed_contract_and_default(self):
        self.assertTrue(verify_business_mapping(config(), now=1000))
        lower = config(); lower['contractAddress'] = CONTRACT.lower()
        self.assertTrue(verify_business_mapping(lower, now=1000))
        self.assertTrue(verify_business_mapping(config(single=False), now=1000))
        self.assertIsNone(validate_identity_mode(config(single=False), 1000))

    def test_scope_window_and_mapping_negative_matrix(self):
        for key in ('cp29IdentityMode', 'origin', 'environmentId', 'chainId', 'contractAddress', 'deploymentId', 'runId'):
            c=config(); c[key]='wrong'
            with self.subTest(key=key), self.assertRaises(ValueError): validate_identity_mode(c,1000)
        for window in ({}, {'issuedAt':True,'expiresAt':2000}, {'issuedAt':1001,'expiresAt':2000},
                       {'issuedAt':0,'expiresAt':1000}, {'issuedAt':1000,'expiresAt':29801},
                       {'issuedAt':1000,'expiresAt':2000,'extra':0}):
            c=config(); c['cp29IdentityWindow']=window
            with self.subTest(window=window), self.assertRaises(ValueError):validate_identity_mode(c,1000)
        changes=[lambda c:c['cp29WorkActors'].update(ownerActorId=ACTORS['partner']),
                 lambda c:c['trustedSubjects'][P]['owner'].update(actorId=ACTORS['partner']),
                 lambda c:c['trustedSubjects'][P]['owner'].update(revision=True),
                 lambda c:c['trustedSubjects'][P].update(admin={'actorId':'admin','revision':1}),
                 lambda c:c['trustedSubjects'].update({O:copy.deepcopy(c['trustedSubjects'][P])}),
                 lambda c:c.pop('cp29IdentityMode')]
        for change in changes:
            c=config(); change(c)
            with self.assertRaises(ValueError):validate_identity_mode(c,1000)
        c=config(); c['cp29IdentityWindow']['expiresAt']=29800
        self.assertEqual(validate_identity_mode(c,1000),29800)


class IdentityHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        cls.jwk=json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.key.public_key()))
        cls.jwk.update(kid='synthetic',alg='RS256',use='sig')

    def setUp(self): self.setup_mode(True)

    def setup_mode(self, single, now=1000):
        self.temp=tempfile.TemporaryDirectory(prefix='cp29-auth-synthetic-');self.addCleanup(self.temp.cleanup)
        self.now=now; self.config=config(now=now,single=single)
        root=Path(self.temp.name)
        self.store=ManualStore(root/'state'/'business.db',self.config,create=True)
        self.runtime=RuntimeGate(self.store,self.config,clock=lambda:self.now)
        # Auth-only backend fixture; real work/store authorities; runtime denied.
        self.b=SimpleNamespace(store=self.store,runtime=self.runtime,clock=lambda:self.now,now=lambda:self.now,
            deployment={'deploymentId':DEPLOYMENT,'contractAddress':CONTRACT},rpc=None,policy=MANUAL_POLICY)
        def unavailable(*args):raise ApiError(503,'TEST_RUNTIME_DISABLED','Synthetic identity test only')
        self.b._writable_in_transaction=unavailable
        self.b._healthy_in_transaction=unavailable
        self.b.work=ManualWork(self.b,KEY)
        with self.store.transaction() as db:
            for role,actor in ACTORS.items():
                partner='partner-a' if role=='partner' else None
                self.store.create_user(actor,actor,'NO_PASSWORD',role,partner,'shop-local')
                scope=canonical(dict(role=role,partnerId=partner,shopId='shop-local',deploymentId=DEPLOYMENT))
                db.execute('INSERT INTO cp28_mapping VALUES(?,1,1,?)',(actor,scope))
            db.execute('INSERT INTO owner_wallet_bindings VALUES(?,?,?,?,1)',(ACTORS['owner'],'shop-local',DEPLOYMENT,'0x'+'a'*40))
        profile=ClaimProfile(ENVIRONMENT,'app.dynamicauth.com/'+ENVIRONMENT,(ORIGIN,),verified=True)
        self.profilefile=root/'profile.json'; self.profilefile.write_text(json.dumps({'sourceVersion':'synthetic-reviewed','claimProfile':asdict(profile)}));self.profilefile.chmod(0o600)
        self.keyfile=root/'key'; self.keyfile.write_bytes(KEY); self.keyfile.chmod(0o600)
        jwks=FixedJwksCache(clock=lambda:self.now,transport=lambda:json.dumps({'keys':[self.jwk]}).encode())
        self.verifier=DynamicWorkVerifier(profile_path=self.profilefile,fingerprint_key_path=self.keyfile,
                                        origin=ORIGIN,clock=lambda:self.now,jwks=jwks)
        self.auth=CP29Authentication(self.b,ORIGIN,self.verifier)
        self.app=create_app(self.config,self.b,authentication=self.auth)
        self.client=self.app.test_client()

    def token(self, **override):
        claims=dict(iss='app.dynamicauth.com/'+ENVIRONMENT,aud=ORIGIN,environment_id=ENVIRONMENT,
                    sub='synthetic-person',sid='synthetic-session',iat=self.now,exp=self.now+300,scope='user:basic')
        claims.update(override)
        return jwt.encode(claims,self.key,algorithm='RS256',headers={'kid':'synthetic'})

    def login(self, role, client=None, body=None, token=None):
        return (client or self.client).post('/api/cp28/'+role+'/login',base_url=ORIGIN,
            json={} if body is None else body,headers={'Origin':ORIGIN,'Authorization':'Bearer '+(token or self.token())})

    def session(self,role,client=None):
        return (client or self.client).get('/api/cp28/'+role+'/session',base_url=ORIGIN)

    def test_same_subject_switch_revokes_old_cookie_csrf_proofs_and_challenges(self):
        old=self.app.test_client()
        self.assertEqual(self.login('owner',old).status_code,200)
        cookie=old.get_cookie('cp28_owner',domain='127.0.0.1',path='/api/cp28').value
        sid=digest(cookie)
        actor=AuthContext(ACTORS['owner'],'owner',None,'shop-local',sid)
        with self.store.transaction() as db:
            db.execute('INSERT INTO owner_wallet_sessions VALUES(?,?,?,?,?,0)',(sid,ACTORS['owner'],'0x'+'a'*40,1000,1300))
            db.execute('INSERT INTO owner_wallet_challenges VALUES(?,?,?,?,?,0)',('test-proof',sid,ACTORS['owner'],'synthetic',1300))
            db.execute("INSERT INTO cp28_signing(operation_id,kind,sender,review,state,fee_reserved,value_reserved,started_at) VALUES('unknown','issue','synthetic','{}','UNKNOWN','50','0',1000)")
        current=self.login('partner')
        self.assertEqual(current.status_code,200)
        self.assertEqual(self.session('owner',old).status_code,401)
        self.assertEqual(self.store.one('SELECT revoked FROM owner_wallet_sessions')['revoked'],1)
        self.assertEqual(self.store.one('SELECT consumed FROM owner_wallet_challenges')['consumed'],1)
        self.assertEqual(self.store.one('SELECT state,fee_reserved FROM cp28_signing'),{'state':'UNKNOWN','fee_reserved':'50'})
        with self.store.transaction() as db, self.assertRaises(ApiError):self.b.work.require_actor(db,actor,'owner')
        # Late cookie replay still cannot restore an old grant.
        self.client.set_cookie('cp28_owner',cookie,domain='127.0.0.1',path='/api/cp28')
        self.assertEqual(self.session('owner').status_code,401)
        self.assertEqual(self.session('partner').status_code,200)
        audit=json.dumps([{'role':r['actor'], **json.loads(r['event'])} for r in self.store.all('SELECT actor,event FROM cp24_audit')],ensure_ascii=False)
        self.assertIn('不等于两个独立自然人交接',audit)
        for value in (P,'synthetic-person',cookie,current.json['csrfToken']):self.assertNotIn(value,audit)

    def test_jwt_mode_expiry_and_logout_without_runtime(self):
        r=self.login('partner',token=self.token(exp=1050));self.assertEqual(r.json['expiresAt'],1050)
        self.assertIn('Max-Age=50',r.headers['Set-Cookie'])
        self.now=1050;self.assertEqual(self.session('partner').status_code,401)
        r=self.login('owner',token=self.token(exp=9000));self.assertEqual(r.json['expiresAt'],4600)
        response=self.client.post('/api/cp28/owner/logout',json={},base_url=ORIGIN,
                  headers={'Origin':ORIGIN,'X-CSRF-Token':r.json['csrfToken']})
        self.assertEqual(response.status_code,200);self.assertEqual(self.session('owner').status_code,401)
        self.now=4600;self.assertEqual(self.login('partner').status_code,403)
        self.assertFalse(self.client.get('/api/cp28/status',base_url=ORIGIN).json['identityConfigured'])

    def test_input_unknown_identity_strict_jwt_and_origin_denied(self):
        for body in ({'role':'owner'},{'actorId':ACTORS['partner']},{'subject':'synthetic-person'},{'fingerprint':P}):
            self.assertEqual(self.login('partner',body=body).status_code,422)
        self.assertEqual(self.login('partner',token=self.token(sub='unknown')).status_code,403)
        for fields in (dict(aud='wrong'),dict(aud=[ORIGIN]),dict(iss='wrong'),dict(environment_id='wrong'),
                       dict(scope='user:basic admin'),dict(exp=1000),dict(iat=1001),dict(sid=None)):
            with self.subTest(fields=fields):self.assertEqual(self.login('partner',token=self.token(**fields)).status_code,401)
        self.assertEqual(self.login('admin').status_code,503)
        self.assertEqual(self.client.post('/api/cp28/partner/login',base_url=ORIGIN,json={},headers={'Origin':'https://evil.invalid'}).status_code,403)
        self.assertEqual(self.client.get('/api/cp28/partner/session',base_url='http://127.0.0.1:9').status_code,403)

    def test_mapping_user_scope_mutations_and_failed_login_atomicity(self):
        self.assertEqual(self.login('partner').status_code,200)
        for sql in ("UPDATE cp28_mapping SET enabled=0 WHERE actor_id='cp29-owner'",
                    "UPDATE cp28_mapping SET revision=2 WHERE actor_id='cp29-owner'",
                    "UPDATE cp28_mapping SET scope='{}' WHERE actor_id='cp29-owner'",
                    "UPDATE users SET enabled=0 WHERE id='cp29-owner'",
                    "UPDATE users SET role='partner' WHERE id='cp29-owner'",
                    "UPDATE users SET shop_id='wrong' WHERE id='cp29-owner'"):
            with self.store.transaction() as db:
                db.execute('SAVEPOINT bad')
                db.execute(sql)
                # Test actual login in nested same transaction and roll back this variant.
                self.assertIn(self.login('owner').status_code,(401,403))
                db.execute('ROLLBACK TO bad');db.execute('RELEASE bad')
            self.assertEqual(self.session('partner').status_code,200)
        with self.store.transaction() as db:db.execute("UPDATE cp28_mapping SET revision=2 WHERE actor_id='cp29-partner'")
        self.assertEqual(self.session('partner').status_code,403)

    def test_config_profile_key_changes_invalidate_existing_session(self):
        self.assertEqual(self.login('partner').status_code,200)
        self.config['trustedSubjects'][P]['partner']['revision']=2
        self.assertEqual(self.session('partner').status_code,403)
        self.config['trustedSubjects'][P]['partner']['revision']=1
        self.keyfile.write_bytes(b'x'*32)
        self.assertEqual(self.session('partner').status_code,503)
        self.keyfile.write_bytes(KEY)
        self.profilefile.write_text('{}')
        self.assertEqual(self.session('partner').status_code,503)

    def test_cross_role_csrf_and_cookie_rejected(self):
        p=self.login('partner').json
        cookie=self.client.get_cookie('cp28_partner',domain='127.0.0.1',path='/api/cp28').value
        self.client.set_cookie('cp28_owner',cookie,domain='127.0.0.1',path='/api/cp28')
        self.assertEqual(self.session('owner').status_code,403)
        self.login('owner')
        r=self.client.post('/api/cp28/owner/logout',json={},base_url=ORIGIN,headers={'Origin':ORIGIN,'X-CSRF-Token':p['csrfToken']})
        self.assertEqual(r.status_code,403)

    def test_concurrent_login_only_one_active_session(self):
        def enter(role):return self.login(role,self.app.test_client()).status_code
        with ThreadPoolExecutor(2) as pool:self.assertEqual(list(pool.map(enter,['owner','partner'])),[200,200])
        self.assertEqual(self.store.one('SELECT count(*) AS n FROM work_sessions WHERE revoked=0')['n'],1)

    def test_default_distinct_subjects_preserved(self):
        self.setup_mode(False)
        self.assertEqual(self.login('partner').status_code,200)
        self.assertEqual(self.login('owner').status_code,403)
        self.assertEqual(self.login('owner',token=self.token(sub='synthetic-other-person')).status_code,200)
        self.assertEqual(self.session('partner').status_code,200)
        self.assertEqual(self.session('owner').status_code,200)
        info=self.client.get('/api/cp28/status',base_url=ORIGIN).json
        self.assertEqual(info['identityMode'],'two-subject')
        self.assertFalse(info['runtimeAuthorized'])

if __name__=='__main__':unittest.main()
