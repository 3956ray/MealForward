"""Explicit local authority. No email lookup, remote role assignment or bundle trust."""
import hashlib
import json

from server.contracts import ApiError, AUTH_IDLE_TTL, LOCAL_SHOP_ID


def subject_hash(subject):
    return hashlib.sha256(subject.encode()).hexdigest()


def activate_mappings(store, entries, *, source_version):
    """Apply a complete trusted config supplied explicitly outside a backup bundle."""
    if not isinstance(source_version, str) or not 1 <= len(source_version) <= 128:
        raise ValueError('Explicit authority version required')
    if not isinstance(entries, list) or len(entries) > 1000:
        raise ValueError('Invalid trusted mappings')
    checked = {}
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {'environment_id', 'issuer', 'subject', 'actor_id'}:
            raise ValueError('Invalid trusted mapping fields')
        if any(not isinstance(value, str) or not 1 <= len(value) <= 1024 for value in entry.values()):
            raise ValueError('Invalid trusted mapping value')
        key = hashlib.sha256(json.dumps([entry[k] for k in ('environment_id', 'issuer', 'subject')],
                                        separators=(',', ':')).encode()).hexdigest()
        if key in checked: raise ValueError('Duplicate trusted identity')
        checked[key] = entry
    with store.transaction() as db:
        for key, entry in checked.items():
            user = db.execute('SELECT * FROM users WHERE id=?', (entry['actor_id'],)).fetchone()
            if not user or not user['enabled'] or not scope_allowed(user):
                raise ValueError('Trusted mapping requires an enabled scoped partner or owner')
            old = db.execute('SELECT * FROM dynamic_identity_mappings WHERE id=?', (key,)).fetchone()
            if not old:
                db.execute('INSERT INTO dynamic_identity_mappings VALUES(?,?,?,?,?,1,1,?)',
                           (key, entry['environment_id'], entry['issuer'], entry['subject'], entry['actor_id'], source_version))
            elif not old['enabled'] or old['actor_id'] != entry['actor_id'] or old['authority_source_version'] != source_version:
                db.execute('UPDATE dynamic_identity_mappings SET actor_id=?,enabled=1,revision=revision+1,authority_source_version=? WHERE id=?',
                           (entry['actor_id'], source_version, key))
        for row in db.execute('SELECT id FROM dynamic_identity_mappings WHERE enabled=1').fetchall():
            if row['id'] not in checked:
                db.execute('UPDATE dynamic_identity_mappings SET enabled=0,revision=revision+1 WHERE id=?', (row['id'],))


def scope_allowed(user):
    return (user['role'] == 'partner' and bool(user['partner_id'])
            or user['role'] == 'owner' and user['shop_id'] == LOCAL_SHOP_ID)


def mapping_current(db, *, mapping_id, revision, environment_id, subject_digest, actor_id, role, partner_id, shop_id):
    mapping = db.execute('SELECT * FROM dynamic_identity_mappings WHERE id=?', (mapping_id,)).fetchone()
    user = db.execute('SELECT * FROM users WHERE id=?', (actor_id,)).fetchone()
    return bool(mapping and mapping['enabled'] and mapping['authority_source_version']
                and mapping['revision'] == revision and mapping['environment_id'] == environment_id
                and subject_hash(mapping['subject']) == subject_digest and mapping['actor_id'] == actor_id
                and user and user['enabled'] and scope_allowed(user) and user['role'] == role
                and user['partner_id'] == partner_id and user['shop_id'] == shop_id)


def require_current_actor(db, actor, now):
    """Recheck after any intervening RPC and within the business acceptance transaction."""
    auth = actor.dynamic
    if auth is None: return
    binding = db.execute('SELECT * FROM dynamic_session_bindings WHERE session_id=?', (actor.session_id,)).fetchone()
    session = db.execute('SELECT * FROM work_sessions WHERE token_hash=?', (actor.session_id,)).fetchone()
    if (not binding or not session or session['revoked'] or session['user_id'] != actor.actor_id
            or session['expires_at'] <= now or session['last_seen_at'] + AUTH_IDLE_TTL <= now
            or auth.access_expires_at <= now or binding['access_expires_at'] <= now
            or binding['mapping_id'] != auth.mapping_id or binding['mapping_revision'] != auth.mapping_revision
            or binding['issuer'] != auth.issuer or binding['environment_id'] != auth.environment_id
            or binding['subject_hash'] != auth.subject_hash
            or not mapping_current(db, mapping_id=auth.mapping_id, revision=auth.mapping_revision,
                                   environment_id=auth.environment_id, subject_digest=auth.subject_hash,
                                   actor_id=actor.actor_id, role=actor.role, partner_id=actor.partner_id, shop_id=actor.shop_id)):
        raise ApiError(401, 'DYNAMIC_SESSION_REJECTED', 'Current mapped identity required')


def bind_operation(db, actor, operation_id, now):
    if actor.dynamic is None: return
    require_current_actor(db, actor, now)
    auth = actor.dynamic
    db.execute('INSERT INTO operation_auth_bindings VALUES(?,?,?,?,?,?,?,?,?,?)',
               (operation_id, 'dynamic', auth.mapping_id, auth.mapping_revision, auth.environment_id,
                auth.subject_hash, actor.actor_id, actor.role, actor.partner_id, actor.shop_id))


def operation_authorized(db, operation_id):
    binding = db.execute('SELECT * FROM operation_auth_bindings WHERE operation_id=?', (operation_id,)).fetchone()
    if not binding: return True  # Legacy accepted operation retains its legacy policy.
    return mapping_current(db, mapping_id=binding['mapping_id'], revision=binding['mapping_revision'],
                           environment_id=binding['environment_id'], subject_digest=binding['subject_hash'],
                           actor_id=binding['actor_id'], role=binding['role'], partner_id=binding['partner_id'],
                           shop_id=binding['shop_id'])
