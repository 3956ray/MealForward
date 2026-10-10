"""Reuse the accepted domain state machine through explicit composition-only policy."""
import json
from eth_utils import keccak
from server.backend import Backend, canonical, digest
from server.contracts import ApiError, AUTH_IDLE_TTL
from server.local_e2e.credentials import LocalWork
from server.owner_wallet import OwnerWalletService
from .policy import MANUAL_POLICY
from .runtime import plan_digest


class ManualWork(LocalWork):
    presentation_prefix = 'mealforward:manual:v1:'

    def require_actor(self, db, actor, role=None):
        if self.b.runtime.source_check is not None: self.b.runtime.source_check()
        user = super().require_actor(db, actor, role)
        mapping = db.execute('SELECT * FROM cp28_mapping WHERE actor_id=?', (actor.actor_id,)).fetchone()
        session = db.execute('SELECT * FROM cp28_sessions WHERE session_id=?', (actor.session_id,)).fetchone()
        if 'cp29WorkActors' in self.b.runtime.config:
            from .cp29_mode import validate_identity_mode
            try: validate_identity_mode(self.b.runtime.config, self.b.now())
            except ValueError:
                raise ApiError(403, 'IDENTITY_MODE_INVALID', 'Current identity mode required') from None
            live = db.execute('SELECT * FROM work_sessions WHERE token_hash=?', (actor.session_id,)).fetchone()
            if (digest(canonical(self.b.runtime.config)) != self.b.runtime.config_digest or
                    not live or live['revoked'] or live['user_id'] != actor.actor_id or
                    live['expires_at'] <= self.b.now() or live['last_seen_at'] + AUTH_IDLE_TTL <= self.b.now()):
                raise ApiError(401, 'AUTH_REQUIRED', 'Current work session required')
        scope = canonical({'role': actor.role, 'partnerId': actor.partner_id, 'shopId': actor.shop_id,
                           'deploymentId': self.b.deployment['deploymentId']})
        if (not mapping or not mapping['enabled'] or mapping['scope'] != scope or not session or
                session['actor_id'] != actor.actor_id or session['mapping_revision'] != mapping['revision'] or
                session['config_digest'] != self.b.runtime.config_digest):
            raise ApiError(403, 'TRUSTED_MAPPING_REQUIRED', 'Current trusted identity mapping required')
        return user

    def dispatch_authorized(self, db, op):
        if not super().dispatch_authorized(db, op): return False
        review = db.execute('SELECT * FROM cp28_reviews WHERE operation_id=?', (op['id'],)).fetchone()
        mapping = db.execute('SELECT * FROM cp28_mapping WHERE actor_id=?', (op['actor_id'],)).fetchone()
        session = db.execute('SELECT * FROM work_sessions WHERE token_hash=?', (review['session_id'],)).fetchone() if review else None
        return bool(review and mapping and mapping['enabled'] and review['mapping_revision'] == mapping['revision'] and
                    review['expires'] > self.b.now() and session and not session['revoked'] and
                    session['user_id'] == op['actor_id'] and session['expires_at'] > self.b.now())


class ManualOwner(OwnerWalletService):
    def chain_permission(self):
        with self.rpc.observation():
            final = self.rpc.guard()
            if not self.rpc.read('hasRole', [keccak(text='SETTLER_ROLE'), self.b.deployment['merchant']], final['number']):
                raise ApiError(403, 'WALLET_ROLE_REQUIRED', 'Bound owner lacks settlement role')

    def challenge(self, actor, body, origin):
        with self.store.transaction() as db:
            result = super().challenge(actor, body, origin)
            prefix, message = result['message'].split('\n', 1)
            mapping = db.execute('SELECT revision FROM cp28_mapping WHERE actor_id=?', (actor.actor_id,)).fetchone()
            result['message'] = prefix+'\n'+canonical({**json.loads(message),
                'configDigest': self.b.runtime.config_digest, 'authorizationDigest': plan_digest(self.b.runtime.plan), 'mappingRevision': mapping['revision']})
            db.execute('UPDATE owner_wallet_challenges SET message=? WHERE id=?', (result['message'], result['challengeId']))
            return result

    def verify(self, actor, body, origin):
        with self.store.transaction() as db:
            row = db.execute('SELECT * FROM owner_wallet_challenges WHERE id=?', (body.get('challengeId'),)).fetchone()
            started = db.execute("SELECT * FROM cp28_signing WHERE operation_id=? AND kind='proof'", (body.get('challengeId'),)).fetchone()
            mapping = db.execute('SELECT * FROM cp28_mapping WHERE actor_id=?', (actor.actor_id,)).fetchone()
            context = json.loads(row['message'].split('\n', 1)[1]) if row else {}
            if (not started or not mapping or context.get('mappingRevision') != mapping['revision'] or
                    context.get('configDigest') != self.b.runtime.config_digest or context.get('authorizationDigest') != plan_digest(self.b.runtime.plan)):
                raise ApiError(403, 'WALLET_PROOF_INVALID', 'Original proof context required')
            result = super().verify(actor, body, origin)
            db.execute("UPDATE cp28_signing SET state='PROOF_VERIFIED' WHERE operation_id=?", (body['challengeId'],))
            return result


class ManualBackend(Backend):
    def __init__(self, store, rpc, secret_key, runtime, clock, *, policy=MANUAL_POLICY):
        self.runtime = runtime
        participants = runtime.config['participants']
        super().__init__(store, rpc, secret_key, participants['issuer'], clock,
                         signers={'operator': participants['operator']}, owner_mode=True, policy=policy)
        self.work = ManualWork(self, secret_key)
        self.owner_wallet = ManualOwner(self)

    def _writable_in_transaction(self, db):
        super()._writable_in_transaction(db)
        self.runtime.require(db)

    def bind_review(self, db, actor, operation_id):
        self.work.require_actor(db, actor)
        revision = db.execute('SELECT revision FROM cp28_mapping WHERE actor_id=?', (actor.actor_id,)).fetchone()['revision']
        context = canonical({'configDigest': self.runtime.config_digest, 'deploymentId': self.deployment['deploymentId']})
        db.execute('INSERT OR IGNORE INTO cp28_reviews VALUES(?,?,?,?,?,?)',
                   (operation_id, actor.actor_id, actor.session_id, revision, self.now()+300, context))

    def issue(self, actor, body):
        with self.store.transaction() as db:
            result = super().issue(actor, body)
            self.bind_review(db, actor, result['operation']['id'])
            return result
