"""CP16 scoped work acceptance. No RPC/signing; all business writes share one transaction."""
import threading
from server.backend import canonical, digest, random_id, require_id
from server.contracts import ApiError

_CODE_GUARD = threading.RLock()  # All instances/three entry points in this API process.


def _body(body, required, optional=()):
    if not isinstance(body, dict) or set(body) - set(required) - set(optional) or set(required) - set(body):
        raise ApiError(422, 'INVALID_INPUT', 'Invalid request fields')
    if 'intentKey' in required:
        require_id(body['intentKey'], 'intentKey')
    return body


def _denied():
    raise ApiError(403, 'FORBIDDEN', 'Current resource scope required')


class RedemptionService:
    def __init__(self, backend):
        self.b, self.w = backend, backend.work

    def _write_actor(self, db, actor):
        self.w.require_actor(db, actor, self.w.actor_role('lock'))
        if self.b.owner_mode:
            self.w.require_owner(db, actor)

    def _code_request(self, body, group_id=None):
        code = body['code']
        if not isinstance(code, str) or len(code) != 8 or not code.isascii() or not code.isdigit():
            raise ApiError(404, 'CODE_UNAVAILABLE', 'Code unavailable')
        return {'intentKey': body['intentKey'], 'codeHash': self.w.code_hash(code), 'groupId': group_id}

    def _coded(self, actor, ip, action):
        with _CODE_GUARD:
            now = self.b.now()
            keys = [('cp16:code:actor:' + digest(actor.actor_id), 5),
                    ('cp16:code:ip:' + digest(str(ip)), 30)]
            with self.b.store.transaction() as db:
                self.w.require_actor(db, actor, self.w.actor_role('lock'))
            if any(self.b.store.auth_failure_count(k, now, 60) >= limit for k, limit in keys):
                raise ApiError(429, 'CODE_RATE_LIMITED', 'Code lookup temporarily unavailable')
            try:
                with self.b.store.transaction() as db:
                    self._write_actor(db, actor)
                    self.w.writable(db)
                    self.w.expire_codes(db, now)
                    return action(db)
            except ApiError as error:
                if error.code == 'CODE_UNAVAILABLE':
                    # Separate committed failure transaction, after business rollback.
                    with self.b.store.transaction() as db:
                        db.executemany('INSERT INTO auth_failures(key,occurred_at) VALUES(?,?)',
                                       [(k, now) for k, _ in keys])
                raise

    def _group(self, db, actor, group_id):
        self.w.require_actor(db, actor, self.w.actor_role('lock'))
        row = db.execute('SELECT * FROM processing_groups WHERE id=?', (require_id(group_id),)).fetchone()
        if not row:
            raise ApiError(404, 'NOT_FOUND', 'Group unavailable')
        if row['actor_id'] != actor.actor_id or row['shop_id'] != actor.shop_id:
            _denied()
        return dict(row)

    def _redemption(self, db, actor, redemption_id, role='staff'):
        role = self.w.actor_role('settle' if role == 'settler' else 'lock')
        self.w.require_actor(db, actor, role)
        row = db.execute('SELECT * FROM redemptions WHERE id=?', (require_id(redemption_id),)).fetchone()
        if not row:
            raise ApiError(404, 'NOT_FOUND', 'Redemption unavailable')
        if row['shop_id'] != actor.shop_id or (role in ('staff', 'owner') and row['actor_id'] != actor.actor_id):
            _denied()
        return dict(row)

    def _op_result(self, op):
        return {'operation': self.b.operation_view(dict(op)), 'redemptionId': op['redemption_id']}

    def _ops(self, db, redemption_id, kind):
        return list(db.execute('SELECT * FROM operations WHERE redemption_id=? AND kind=? ORDER BY created_at,rowid',
                               (redemption_id, kind)))

    def _lock_finalized(self, db, redemption, statuses=(2,)):
        op = db.execute('SELECT * FROM operations WHERE id=?', (redemption['lock_operation_id'],)).fetchone()
        voucher = self.w.voucher(db, redemption['voucher_id'])
        claim = db.execute('SELECT redemption_id FROM voucher_claims WHERE voucher_id=?', (redemption['voucher_id'],)).fetchone()
        if (not op or op['kind'] != 'lock' or op['status'] != 'FINALIZED_SUCCESS' or op['finalized_block'] is None
                or op['target'] != redemption['voucher_id'] or op['redemption_id'] != redemption['id']
                or op['actor_id'] != redemption['actor_id'] or op['shop_id'] != redemption['shop_id']
                or not voucher['confirmed'] or voucher['issue_status'] != 'FINALIZED_SUCCESS'
                or voucher['chain_status'] not in statuses or voucher['lock_id'] != redemption['lock_id']
                or not claim or claim['redemption_id'] != redemption['id']):
            raise ApiError(409, 'LOCK_NOT_FINALIZED', 'Original finalized lock required')
        return voucher

    def _retryable(self, db, kind, voucher_id):
        for op in db.execute('SELECT * FROM operations WHERE kind=? AND target=?', (kind, voucher_id)):
            if op['status'] == 'FINALIZED_REVERT' and op['finalized_block'] is not None:
                continue
            if op['status'] == 'NOT_SUBMITTED':
                job = db.execute('SELECT * FROM outbox WHERE operation_id=?', (op['id'],)).fetchone()
                audit = db.execute("SELECT 1 FROM work_audit WHERE operation_id=? AND event='ACCEPTED_NEVER_SIGNED'", (op['id'],)).fetchone()
                signed = db.execute("SELECT 1 FROM work_audit WHERE operation_id=? AND event='SIGNING_STARTED'", (op['id'],)).fetchone()
                rejected = db.execute("SELECT 1 FROM work_audit WHERE operation_id=? AND event='REJECTED_BEFORE_SIGNING'", (op['id'],)).fetchone()
                if (job and audit and rejected and not signed and job['signing_stage'] == 'NEVER_SIGNED' and job['raw_cipher'] is None
                        and job['tx_hash'] is None and not job['broadcast_count'] and op['tx_hash'] is None):
                    continue
            raise ApiError(409, 'ORIGINAL_OPERATION_REQUIRED', 'Query original action; new attempt unavailable')

    def _handoff(self, db, redemption):
        row = db.execute('SELECT * FROM handoff_statements WHERE redemption_id=?', (redemption['id'],)).fetchone()
        if not row or row['actor_id'] != redemption['actor_id'] or row['shop_id'] != redemption['shop_id']:
            raise ApiError(409, 'HANDOFF_REQUIRED', 'Original actor statement required')
        return dict(row)

    def _handoff_view(self, row):
        return {'id': row['id'], 'redemptionId': row['redemption_id'], 'actorId': row['actor_id'],
                'createdAt': row['created_at'], 'statement': 'OWNER_DECLARED_HANDOFF' if self.b.owner_mode else 'EMPLOYEE_DECLARED_HANDOFF'}

    def _view(self, db, redemption, payable=False):
        result = {'id': redemption['id'], 'voucherId': redemption['voucher_id'], 'shopId': redemption['shop_id'],
                  'status': redemption['state']}
        kinds = ('report', 'settle') if payable else ('lock', 'report')
        for kind in kinds:
            result[kind + 'Operations'] = [self.b.operation_view(dict(op)) for op in self._ops(db, redemption['id'], kind)]
        if not payable:
            statement = db.execute('SELECT * FROM handoff_statements WHERE redemption_id=?', (redemption['id'],)).fetchone()
            result['handoff'] = self._handoff_view(statement) if statement else None
        return result

    def _group_view(self, db, group):
        items = []
        for item in db.execute('SELECT * FROM processing_items WHERE group_id=? ORDER BY created_at,rowid', (group['id'],)):
            # Never expose another actor's claim/processing group.
            redemption = db.execute('SELECT * FROM redemptions WHERE group_id=? AND voucher_id=? ORDER BY rowid DESC LIMIT 1',
                                    (group['id'], item['voucher_id'])).fetchone()
            items.append({'voucherId': item['voucher_id'], 'status': redemption['state'] if redemption else 'needs_code',
                          'redemptionId': redemption['id'] if redemption else None})
        return {'id': group['id'], 'shopId': group['shop_id'], 'createdAt': group['created_at'], 'items': items}

    def precheck(self, actor, body, ip):
        _body(body, ('code',))
        def accept(db):
            value = self.w.validate_code(db, actor, body['code'])
            return {'voucherId': value['voucherId'], 'shopId': value['shopId'], 'status': 'available'}
        return self._coded(actor, ip, accept)

    def create_group(self, actor, body):
        _body(body, ('intentKey',))
        with self.b.store.transaction() as db:
            self._write_actor(db, actor); self.w.writable(db)
            row = db.execute('SELECT * FROM processing_groups WHERE actor_id=? AND intent_key=?', (actor.actor_id, body['intentKey'])).fetchone()
            if row:
                self._group(db, actor, row['id'])
            else:
                gid = random_id()
                db.execute('INSERT INTO processing_groups(id,actor_id,shop_id,intent_key,created_at) VALUES(?,?,?,?,?)',
                           (gid, actor.actor_id, actor.shop_id, body['intentKey'], self.b.now()))
                row = self._group(db, actor, gid)
            return {'group': self._group_view(db, row)}

    def group(self, actor, group_id):
        with self.b.store.transaction() as db:
            return {'group': self._group_view(db, self._group(db, actor, group_id))}

    def add(self, actor, group_id, body, ip):
        _body(body, ('intentKey', 'code'))
        def accept(db):
            group = self._group(db, actor, group_id)
            request = canonical(self._code_request(body, group_id))
            original = db.execute('SELECT * FROM processing_item_requests WHERE actor_id=? AND intent_key=?', (actor.actor_id, body['intentKey'])).fetchone()
            if original:
                if original['shop_id'] != actor.shop_id:
                    _denied()
                if original['request_json'] != request:
                    raise ApiError(409, 'INTENT_CONFLICT', 'Original parameters changed')
                return {'group': self._group_view(db, group)}
            value = self.w.validate_code(db, actor, body['code'])
            other = db.execute('SELECT group_id FROM processing_items WHERE actor_id=? AND voucher_id=? AND active=1', (actor.actor_id, value['voucherId'])).fetchone()
            if other and other['group_id'] != group_id:
                raise ApiError(409, 'VOUCHER_IN_GROUP', 'Voucher already in an active group')
            db.execute('INSERT OR IGNORE INTO processing_items(group_id,voucher_id,actor_id,shop_id,created_at) VALUES(?,?,?,?,?)',
                       (group_id, value['voucherId'], actor.actor_id, actor.shop_id, self.b.now()))
            db.execute('INSERT INTO processing_item_requests(id,actor_id,shop_id,group_id,voucher_id,intent_key,request_json,created_at) VALUES(?,?,?,?,?,?,?,?)',
                       (random_id(), actor.actor_id, actor.shop_id, group_id, value['voucherId'], body['intentKey'], request, self.b.now()))
            return {'group': self._group_view(db, group)}
        return self._coded(actor, ip, accept)

    def lock(self, actor, body, ip):
        _body(body, ('intentKey', 'code'), ('groupId',))
        group_id = body.get('groupId')
        if group_id is not None:
            require_id(group_id, 'groupId')
        def accept(db):
            request = self._code_request(body, group_id)
            if group_id is not None:
                self._group(db, actor, group_id)
            original = self.w.original(db, actor, 'lock', body['intentKey'], request)
            if original:
                self._redemption(db, actor, original['redemption_id'])
                return self._op_result(original)
            op_id, redemption_id, lock_id = random_id(), random_id(), random_id()
            value = self.w.validate_and_consume_code(db, actor, body['code'], op_id)
            item = db.execute('SELECT group_id FROM processing_items WHERE actor_id=? AND voucher_id=? AND active=1', (actor.actor_id, value['voucherId'])).fetchone()
            if (group_id is not None and (not item or item['group_id'] != group_id)) or (item and item['group_id'] != group_id):
                raise ApiError(409, 'GROUP_MISMATCH', 'Use the original presented group')
            self._retryable(db, 'lock', value['voucherId'])
            op = self.w.enqueue(db, actor, 'lock', body['intentKey'], value['voucherId'], request,
                                {'voucherId': value['voucherId'], 'lockId': lock_id}, redemption_id=redemption_id, operation_id=op_id)
            db.execute('INSERT INTO redemptions(id,voucher_id,actor_id,shop_id,group_id,lock_id,lock_operation_id,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
                       (redemption_id, value['voucherId'], actor.actor_id, actor.shop_id, group_id, lock_id, op_id, 'LOCK_PENDING', self.b.now()))
            db.execute('INSERT INTO voucher_claims(voucher_id,redemption_id) VALUES(?,?)', (value['voucherId'], redemption_id))
            return self._op_result(op)
        return self._coded(actor, ip, accept)

    def get(self, actor, redemption_id):
        with self.b.store.transaction() as db:
            return {'redemption': self._view(db, self._redemption(db, actor, redemption_id))}

    def handoff(self, actor, redemption_id, body):
        _body(body, ('intentKey',))
        with self.b.store.transaction() as db:
            redemption = self._redemption(db, actor, redemption_id)
            self._write_actor(db, actor)
            self.w.writable(db, allow_paused=True)
            self._lock_finalized(db, redemption, (2, 3, 4))
            same_key = db.execute('SELECT redemption_id FROM handoff_statements WHERE actor_id=? AND intent_key=?', (actor.actor_id, body['intentKey'])).fetchone()
            if same_key and same_key['redemption_id'] != redemption_id:
                raise ApiError(409, 'INTENT_CONFLICT', 'Original parameters changed')
            row = db.execute('SELECT * FROM handoff_statements WHERE redemption_id=?', (redemption_id,)).fetchone()
            if not row:
                self._lock_finalized(db, redemption)
                if redemption['state'] != 'LOCKED':
                    raise ApiError(409, 'LOCK_NOT_FINALIZED', 'Original finalized lock required')
                sid = random_id()
                db.execute('INSERT INTO handoff_statements(id,redemption_id,actor_id,shop_id,intent_key,created_at) VALUES(?,?,?,?,?,?)',
                           (sid, redemption_id, actor.actor_id, actor.shop_id, body['intentKey'], self.b.now()))
                db.execute("UPDATE redemptions SET state='HANDED_OFF' WHERE id=?", (redemption_id,))
                row = self._handoff(db, redemption)
            return {'handoff': self._handoff_view(row)}

    def report(self, actor, redemption_id, body):
        _body(body, ('intentKey',))
        with self.b.store.transaction() as db:
            redemption = self._redemption(db, actor, redemption_id)
            self._write_actor(db, actor)
            self.w.writable(db, allow_paused=True)
            self._lock_finalized(db, redemption, (2, 3, 4)); self._handoff(db, redemption)
            request = {'intentKey': body['intentKey'], 'redemptionId': redemption_id}
            original = self.w.original(db, actor, 'report', body['intentKey'], request)
            if original:
                return self._op_result(original)
            self._lock_finalized(db, redemption)
            if redemption['state'] != 'HANDED_OFF':
                raise ApiError(409, 'REPORT_UNAVAILABLE', 'Original report state required')
            self._retryable(db, 'report', redemption['voucher_id'])
            op = self.w.enqueue(db, actor, 'report', body['intentKey'], redemption['voucher_id'], request,
                                {'voucherId': redemption['voucher_id'], 'lockId': redemption['lock_id']}, redemption_id=redemption_id)
            db.execute("UPDATE redemptions SET state='REPORT_PENDING' WHERE id=?", (redemption_id,))
            return self._op_result(op)

    def _report_finalized(self, db, redemption):
        self._lock_finalized(db, redemption, (3, 4))
        self._handoff(db, redemption)
        reports = self._ops(db, redemption['id'], 'report')
        if not any(op['status'] == 'FINALIZED_SUCCESS' and op['finalized_block'] is not None
                   and op['actor_id'] == redemption['actor_id'] and op['shop_id'] == redemption['shop_id']
                   and op['target'] == redemption['voucher_id'] for op in reports):
            raise ApiError(409, 'REPORT_NOT_FINALIZED', 'Original finalized report required')

    def payables(self, actor):
        with self.b.store.transaction() as db:
            self.w.require_actor(db, actor, self.w.actor_role('settle'))
            values = []
            for row in db.execute("SELECT * FROM redemptions WHERE shop_id=? AND state IN ('REPORTED','SETTLE_PENDING','SETTLED') ORDER BY created_at,rowid", (actor.shop_id,)):
                if self.b.owner_mode and row['actor_id'] != actor.actor_id:
                    continue
                self._report_finalized(db, row)
                values.append(self._view(db, row, payable=True))
            return {'payables': values}

    def payable(self, actor, redemption_id):
        with self.b.store.transaction() as db:
            redemption = self._redemption(db, actor, redemption_id, 'settler')
            self._report_finalized(db, redemption)
            return {'payable': self._view(db, redemption, payable=True)}

    def settle(self, actor, redemption_id, body):
        _body(body, ('intentKey',))
        if self.b.owner_mode:
            # Main HTTP routes also call this single external-wallet authority directly.
            return self.b.owner_wallet.prepare(actor, redemption_id, body)
        with self.b.store.transaction() as db:
            redemption = self._redemption(db, actor, redemption_id, 'settler')
            self.w.writable(db)
            self._report_finalized(db, redemption)
            if self._handoff(db, redemption)['actor_id'] == actor.actor_id:
                _denied()
            request = {'intentKey': body['intentKey'], 'redemptionId': redemption_id}
            original = self.w.original(db, actor, 'settle', body['intentKey'], request)
            if original:
                return self._op_result(original)
            if redemption['state'] != 'REPORTED' or self.w.voucher(db, redemption['voucher_id'])['chain_status'] != 3:
                raise ApiError(409, 'SETTLE_UNAVAILABLE', 'Finalized payable without pending settlement required')
            self._retryable(db, 'settle', redemption['voucher_id'])
            op = self.w.enqueue(db, actor, 'settle', body['intentKey'], redemption['voucher_id'], request,
                                {'voucherId': redemption['voucher_id']}, redemption_id=redemption_id)
            db.execute("UPDATE redemptions SET state='SETTLE_PENDING' WHERE id=?", (redemption_id,))
            return self._op_result(op)

    def operation(self, actor, op_id=None, kind=None, key=None):
        if self.b.owner_mode:
            existing = self.b.store.one('SELECT kind FROM operations WHERE id=?', (op_id,)) if op_id is not None else None
            if (existing and existing['kind'] == 'settle') or (op_id is None and kind == 'settle'):
                return self.b.owner_wallet.operation(actor, op_id=op_id, key=key if op_id is None else None)
        with self.b.store.transaction() as db:
            if op_id is not None:
                op = db.execute('SELECT * FROM operations WHERE id=?', (require_id(op_id),)).fetchone()
            else:
                if kind not in ('lock', 'report', 'settle'):
                    raise ApiError(422, 'INVALID_INPUT', 'Invalid work action')
                op = db.execute('SELECT * FROM operations WHERE actor_id=? AND kind=? AND intent_key=?', (actor.actor_id, kind, require_id(key))).fetchone()
            if not op or op['kind'] not in ('lock', 'report', 'settle'):
                raise ApiError(404, 'NOT_FOUND', 'Work operation unavailable')
            self._redemption(db, actor, op['redemption_id'], 'settler' if op['kind'] == 'settle' else 'staff')
            if op['actor_id'] != actor.actor_id or op['shop_id'] != actor.shop_id or op['partner_id'] != actor.partner_id:
                _denied()
            return self._op_result(op)
