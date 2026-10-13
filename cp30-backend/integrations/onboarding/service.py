"""Offline onboarding domain. All authority, persistence and chain evidence are injected.

No HTTP endpoint, SQL adapter, signer, provider, or production memory store is included.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import hashlib
import json
import re
from typing import ContextManager, Protocol


class Rejected(ValueError):
    """Stable error code for the application adapter."""


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False,
                      allow_nan=False)


def request_digest(value):
    # Audit/idempotency digest, deliberately NOT an Ethereum signing digest.
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def word(value):
    if type(value) is not str or not re.fullmatch(r'0x[0-9a-f]{64}', value) or int(value, 16) == 0:
        raise Rejected('INVALID_BYTES32')
    return value


def address(value):
    if type(value) is not str or not re.fullmatch(r'0x[0-9a-f]{40}', value) or int(value, 16) == 0:
        raise Rejected('INVALID_ADDRESS')
    return value


def uint(value):
    if type(value) is not str or not re.fullmatch(r'[1-9][0-9]{0,77}', value) or int(value) >= 2**256:
        raise Rejected('INVALID_UINT256')
    return value


def text(value, limit):
    if type(value) is not str or not value.strip() or len(value) > limit or '\x00' in value:
        raise Rejected('INVALID_TEXT')
    return value


def validate_request(value):
    if type(value) is not dict or set(value) != {'name', 'firstMeal', 'deadline'}:
        raise Rejected('INVALID_REQUEST')
    text(value['name'], 120)
    uint(value['deadline'])
    meal = value['firstMeal']
    if type(meal) is not dict or set(meal) != {'name', 'description', 'unitPrice', 'imageRef', 'windows'}:
        raise Rejected('FIRST_MEAL_REQUIRED')
    text(meal['name'], 120)
    text(meal['description'], 2000)
    text(meal['imageRef'], 256)
    uint(meal['unitPrice'])  # Already-denominated atomic units; never infer token decimals.
    windows = meal['windows']
    if type(windows) is not list or not 1 <= len(windows) <= 2:
        raise Rejected('INVALID_WINDOWS')
    previous = -1
    for pair in windows:
        if (type(pair) is not list or len(pair) != 2 or any(type(v) is not int for v in pair)
                or not 0 <= pair[0] < pair[1] <= 1440 or pair[0] < previous):
            raise Rejected('INVALID_WINDOWS')
        previous = pair[1]
    return deepcopy(value)


@dataclass(frozen=True)
class SessionContext:
    namespace: str
    session_hash: str
    csrf_hash: str | None = None


@dataclass(frozen=True)
class OwnerIdentity:
    # Returned exclusively by the existing session authority adapter, never the browser.
    subject: str
    owner: str
    binding_revision: int


@dataclass(frozen=True)
class FactoryConfig:
    chain_id: int
    factory: str
    registrar: str
    asset: str
    quote_authority: str
    catalog_authority: str
    issuer_authority: str
    operator_authority: str
    escrow_creation_code_hash: str

    def parameters(self):
        if type(self.chain_id) is not int or not 0 < self.chain_id < 2**53:
            raise Rejected('INVALID_CHAIN')
        return {'chainId': str(self.chain_id), 'factory': address(self.factory),
                'registrar': address(self.registrar),
                'asset': address(self.asset), 'quoteAuthority': address(self.quote_authority),
                'catalogAuthority': address(self.catalog_authority),
                'issuerAuthority': address(self.issuer_authority),
                'operatorAuthority': address(self.operator_authority),
                'escrowCreationCodeHash': word(self.escrow_creation_code_hash)}


class Transaction(Protocol):
    """Short durable transaction; methods return detached private records.

    Write transactions lock original rows for CAS and the logical by_key scope even
    when absent. Read-only preflight transactions neither mutate nor take write locks.
    Every method here is DB-only; reserve_slot reads already-verified capacity records.
    """
    def by_key(self, namespace: str, subject: str, key: str) -> dict | None: ...
    def by_id(self, namespace: str, registration_id: str) -> dict | None: ...
    def insert(self, record: dict) -> None: ...
    def save(self, record: dict) -> None: ...
    def reserve_slot(self, record: dict, maximum: int) -> None: ...
    def enqueue_once(self, record: dict) -> None: ...
    def publish_confirmed(self, record: dict) -> None: ...


class Storage(Protocol):
    def transaction(self, *, read_only: bool = False) -> ContextManager[Transaction]: ...


class IdentityAuthority(Protocol):
    def authorize(self, tx: Transaction, context: SessionContext, action: str) -> OwnerIdentity:
        """DB-only existing session/CSRF/guard, then verified owner-wallet binding."""
        ...
    def authorize_internal(self, tx: Transaction, record: dict) -> OwnerIdentity:
        """DB-only observer guard + current account/owner binding, not a public auth bypass."""
        ...


class CatalogBuilder(Protocol):
    def build(self, tx: Transaction, identity: OwnerIdentity, draft: dict) -> list[dict]:
        """DB-only read/recheck of owned, already-verified immutable content commitments.

        Return one stable real CatalogEntry, server-assigned mealId, version=1/current=true.
        No filesystem/hash subprocess/network IO here. Content must be hashed/verified
        before this adapter transaction; rereading it at commit must return the same entry.
        """
        ...


class RegistrationCodec(Protocol):
    def prepare(self, original: dict) -> dict:
        """Trusted offline wallet codec; returns configHash, parametersDigest, typedData.

        Exact ABI/EIP712 contract is documented in README. No local crypto fallback.
        """
        ...
    def verify_owner_signature(self, original: dict, signature: str) -> bool: ...
    def prepare_deployment(self, original: dict, signature: str) -> dict:
        """Exact chain/from/to/value/data/callDataDigest with fixed wallet creation code."""
        ...


class ReceiptVerifier(Protocol):
    def verify_original(self, original: dict, tx_hash: str | None, deployment: dict) -> dict | None:
        """Only return a finalized, independently verified event + contract configuration.

        None means pending/unknown. This consumes an original locator, not browser evidence.
        ERC1271/signature or finality policy, canonical chain, code and catalog checks belong
        to the trusted adapter. No assumed confirmation count or FINAL timeout.
        """
        ...


def validate_catalog(catalog, draft):
    fields = {'mealId', 'version', 'unitPrice', 'bodyDigest', 'imageDigest', 'windowCount',
              'startMinute0', 'endMinute0', 'startMinute1', 'endMinute1'}
    if type(catalog) is not list or len(catalog) != 1:
        raise Rejected('FIRST_MEAL_REQUIRED')
    entry = catalog[0]
    if type(entry) is not dict or set(entry) != {'terms', 'current'} or entry['current'] is not True:
        raise Rejected('INVALID_CATALOG')
    terms = entry['terms']
    if type(terms) is not dict or set(terms) != fields:
        raise Rejected('INVALID_CATALOG')
    for field in ('mealId', 'bodyDigest', 'imageDigest'):
        word(terms[field])
    if terms['version'] != '1' or terms['unitPrice'] != draft['unitPrice']:
        raise Rejected('DRAFT_CATALOG_MISMATCH')
    windows = draft['windows'] + [[0, 0]] * (2 - len(draft['windows']))
    expected = {'windowCount': len(draft['windows']), 'startMinute0': windows[0][0],
                'endMinute0': windows[0][1], 'startMinute1': windows[1][0], 'endMinute1': windows[1][1]}
    if any(type(terms[k]) is not int or terms[k] != v for k, v in expected.items()):
        raise Rejected('DRAFT_CATALOG_MISMATCH')
    return deepcopy(catalog)


class Onboarding:
    def __init__(self, storage: Storage, identity: IdentityAuthority, catalog: CatalogBuilder,
                 codec: RegistrationCodec, verifier: ReceiptVerifier, config: FactoryConfig,
                 new_id, clock):
        self.storage, self.identity, self.catalog = storage, identity, catalog
        self.codec, self.verifier = codec, verifier
        self.config = config.parameters()
        self.new_id, self.clock = new_id, clock

    def _owner(self, tx, context, action, record=None):
        identity = self.identity.authorize(tx, context, action)
        text(identity.subject, 256)
        address(identity.owner)
        if type(identity.binding_revision) is not int or identity.binding_revision < 1:
            raise Rejected('OWNER_BINDING_REQUIRED')
        if record and (record['subject'] != identity.subject or record['owner'] != identity.owner
                       or record['bindingRevision'] != identity.binding_revision):
            raise Rejected('NOT_FOUND')
        return identity

    @staticmethod
    def _dto(record):
        return {'registrationId': record['registrationId'], 'storeId': record['storeId'],
                'state': record['state'], 'ready': record['state'] == 'CONFIRMED',
                'escrow': record.get('escrow'), 'transactionHash': record.get('transactionHash'),
                'typedData': deepcopy(record['prepared']['typedData']),
                'configHash': record['prepared']['configHash']}

    @staticmethod
    def _same_original(current, snapshot):
        fields = ('namespace', 'subject', 'owner', 'bindingRevision', 'key', 'request',
                  'requestDigest', 'registrationId', 'storeId', 'original', 'prepared')
        if any(current.get(field) != snapshot.get(field) for field in fields):
            raise Rejected('SNAPSHOT_CHANGED')

    def _internal_owner(self, tx, record):
        identity = self.identity.authorize_internal(tx, deepcopy(record))
        if (identity.subject, identity.owner, identity.binding_revision) != (
                record['subject'], record['owner'], record['bindingRevision']):
            raise Rejected('OWNER_BINDING_CHANGED')

    def register(self, context: SessionContext, key: str, request: dict):
        if type(key) is not str or not re.fullmatch(r'[ -~]{16,128}', key):
            raise Rejected('INVALID_KEY')
        request = validate_request(request)
        digest = request_digest(request)
        # Preflight is short and read-only. Its adapters may only read verified DB material.
        with self.storage.transaction(read_only=True) as tx:
            identity = self._owner(tx, context, 'register')
            old = tx.by_key(context.namespace, identity.subject, key)
            if old:
                self._owner(tx, context, 'register', old)
                if old['requestDigest'] != digest:
                    raise Rejected('IDEMPOTENCY_CONFLICT')
                return self._dto(old)
            if int(request['deadline']) <= self.clock():
                raise Rejected('AUTHORIZATION_EXPIRED')
            catalog = validate_catalog(self.catalog.build(tx, identity, request['firstMeal']), request['firstMeal'])
        config = deepcopy(self.config)
        registration_id, store_id = word(self.new_id()), word(self.new_id())
        original = {**config, 'registrationId': registration_id, 'storeId': store_id,
                    'owner': identity.owner, 'deadline': request['deadline'], 'catalog': catalog}
        prepared = self.codec.prepare(deepcopy(original))
        if type(prepared) is not dict or set(prepared) != {'configHash', 'parametersDigest', 'typedData'}:
            raise Rejected('INVALID_CODEC_RESULT')
        word(prepared['configHash']); word(prepared['parametersDigest'])
        if type(prepared['typedData']) is not dict:
            raise Rejected('INVALID_CODEC_RESULT')
        record = {'namespace': context.namespace, 'subject': identity.subject, 'owner': identity.owner,
                  'bindingRevision': identity.binding_revision, 'key': key, 'request': request,
                  'requestDigest': digest, 'registrationId': registration_id, 'storeId': store_id,
                  'original': original, 'prepared': deepcopy(prepared), 'state': 'DRAFT'}
        with self.storage.transaction() as tx:
            current_identity = self._owner(tx, context, 'register')
            if current_identity != identity or self.config != config:
                raise Rejected('SNAPSHOT_CHANGED')
            old = tx.by_key(context.namespace, identity.subject, key)
            if old:
                self._owner(tx, context, 'register', old)
                if old['requestDigest'] != digest: raise Rejected('IDEMPOTENCY_CONFLICT')
                return self._dto(old)  # Concurrent same-key winner retains its ids/typed data.
            if int(request['deadline']) <= self.clock(): raise Rejected('AUTHORIZATION_EXPIRED')
            if validate_catalog(self.catalog.build(tx, current_identity, request['firstMeal']), request['firstMeal']) != catalog:
                raise Rejected('CONTENT_SNAPSHOT_CHANGED')
            tx.insert(deepcopy(record))
            return self._dto(record)

    def get(self, context: SessionContext, registration_id: str):
        with self.storage.transaction(read_only=True) as tx:
            record = tx.by_id(context.namespace, word(registration_id))
            if not record: raise Rejected('NOT_FOUND')
            self._owner(tx, context, 'read', record)
            return self._dto(record)

    def enable(self, context: SessionContext, registration_id: str, signature: str):
        if type(signature) is not str or not re.fullmatch(r'0x(?:[0-9a-fA-F]{2}){1,4096}', signature):
            raise Rejected('INVALID_SIGNATURE')
        with self.storage.transaction(read_only=True) as tx:
            record = tx.by_id(context.namespace, word(registration_id))
            if not record: raise Rejected('NOT_FOUND')
            self._owner(tx, context, 'enable', record)
            if record['state'] != 'DRAFT':
                if record.get('ownerSignature') != signature:
                    raise Rejected('IDEMPOTENCY_CONFLICT')
                return self._dto(record)
            if int(record['original']['deadline']) <= self.clock():
                raise Rejected('AUTHORIZATION_EXPIRED')
        snapshot = deepcopy(record)
        if not self.codec.verify_owner_signature(deepcopy(snapshot['original']), signature):
            raise Rejected('INVALID_OWNER_AUTHORIZATION')
        deployment = self.codec.prepare_deployment(deepcopy(snapshot['original']), signature)
        if (type(deployment) is not dict or set(deployment) != {'chainId', 'from', 'to', 'value', 'data', 'callDataDigest'}
                or type(deployment['chainId']) is not int or str(deployment['chainId']) != snapshot['original']['chainId']
                or deployment['from'] != snapshot['original']['registrar']
                or deployment['to'] != snapshot['original']['factory'] or deployment['value'] != '0'
                or type(deployment['data']) is not str or not re.fullmatch(r'0x(?:[0-9a-f]{2})+', deployment['data'])):
            raise Rejected('INVALID_DEPLOYMENT_PAYLOAD')
        word(deployment['callDataDigest'])
        with self.storage.transaction() as tx:
            record = tx.by_id(context.namespace, registration_id)
            if not record: raise Rejected('NOT_FOUND')
            self._owner(tx, context, 'enable', record)
            self._same_original(record, snapshot)
            if record['state'] != 'DRAFT':
                if record.get('ownerSignature') != signature: raise Rejected('IDEMPOTENCY_CONFLICT')
                if record.get('deployment') != deployment: raise Rejected('SNAPSHOT_CHANGED')
                return self._dto(record)
            if record != snapshot: raise Rejected('SNAPSHOT_CHANGED')
            if int(record['original']['deadline']) <= self.clock(): raise Rejected('AUTHORIZATION_EXPIRED')
            tx.reserve_slot(record, maximum=3)
            record.update(state='PENDING', ownerSignature=signature, deployment=deepcopy(deployment))
            tx.save(deepcopy(record))
            tx.enqueue_once(deepcopy(record))  # Same commit as PENDING, unique original registrationId.
            return self._dto(record)

    def begin_attempt(self, namespace: str, registration_id: str):
        """Internal worker only: mark UNKNOWN durably BEFORE any possibly submitted send."""
        with self.storage.transaction() as tx:
            record = tx.by_id(namespace, word(registration_id))
            if not record: raise Rejected('NOT_FOUND')
            self._internal_owner(tx, record)
            if record['state'] != 'PENDING': return None
            if int(record['original']['deadline']) <= self.clock():
                raise Rejected('AUTHORIZATION_EXPIRED')
            record['state'] = 'UNKNOWN'
            tx.save(deepcopy(record))
            return deepcopy(record)  # Never expose signature/private owner binding via public DTO.

    def observe_transaction(self, namespace: str, registration_id: str, transaction_hash: str):
        """Internal worker evidence locator, never a client-provided confirmation."""
        with self.storage.transaction() as tx:
            record = tx.by_id(namespace, word(registration_id))
            if not record or record['state'] not in {'UNKNOWN', 'CONFIRMED'}:
                raise Rejected('INVALID_STATE')
            self._internal_owner(tx, record)
            word(transaction_hash)
            old = record.get('transactionHash')
            if old and old != transaction_hash: raise Rejected('ORIGINAL_TRANSACTION_CONFLICT')
            if record['state'] == 'CONFIRMED' and old == transaction_hash: return
            record['transactionHash'] = transaction_hash
            tx.save(deepcopy(record))

    def original_attempt(self, namespace: str, registration_id: str):
        """Private dispatcher snapshot; never register an HTTP endpoint for this record."""
        with self.storage.transaction(read_only=True) as tx:
            record = tx.by_id(namespace, word(registration_id))
            if not record: raise Rejected('NOT_FOUND')
            self._internal_owner(tx, record)
            return deepcopy(record)

    def reconcile(self, namespace: str, registration_id: str):
        """Internal observer; no arbitrary receipt or success flag is accepted."""
        with self.storage.transaction(read_only=True) as tx:
            record = tx.by_id(namespace, word(registration_id))
            if not record: raise Rejected('NOT_FOUND')
            self._internal_owner(tx, record)
            if record['state'] == 'CONFIRMED': return self._dto(record)
            if record['state'] != 'UNKNOWN': raise Rejected('INVALID_STATE')
        snapshot = deepcopy(record)
        original = deepcopy(snapshot['original'])
        evidence = self.verifier.verify_original(original, snapshot.get('transactionHash'), deepcopy(snapshot['deployment']))
        if evidence is not None:
            expected = {**original, 'configHash': snapshot['prepared']['configHash'],
                        'parametersDigest': snapshot['prepared']['parametersDigest'], 'receiver': snapshot['owner'],
                        'deployment': snapshot['deployment']}
            if type(evidence) is not dict or any(evidence.get(k) != v for k, v in expected.items()):
                raise Rejected('ORIGINAL_RECEIPT_MISMATCH')
            escrow, transaction_hash = address(evidence.get('escrow')), word(evidence.get('transactionHash'))
            word(evidence.get('blockHash'))
            if (type(evidence.get('blockNumber')) is not int or evidence['blockNumber'] < 0
                    or type(evidence.get('logIndex')) is not int or evidence['logIndex'] < 0):
                raise Rejected('INVALID_RECEIPT_PROVENANCE')
            if snapshot.get('transactionHash') and snapshot['transactionHash'] != transaction_hash:
                raise Rejected('ORIGINAL_RECEIPT_MISMATCH')
        with self.storage.transaction() as tx:
            record = tx.by_id(namespace, registration_id)
            if not record: raise Rejected('NOT_FOUND')
            self._internal_owner(tx, record)
            self._same_original(record, snapshot)
            if record.get('deployment') != snapshot['deployment']:
                raise Rejected('SNAPSHOT_CHANGED')
            if record['state'] == 'CONFIRMED':
                if evidence is not None and (record.get('escrow'), record.get('transactionHash')) != (escrow, transaction_hash):
                    raise Rejected('ORIGINAL_RECEIPT_MISMATCH')
                return self._dto(record)  # Concurrent confirmation never republishes.
            if record != snapshot or record['state'] != 'UNKNOWN': raise Rejected('SNAPSHOT_CHANGED')
            if evidence is None: return self._dto(record)
            record.update(state='CONFIRMED', escrow=escrow, transactionHash=transaction_hash,
                          verifiedEvidence=deepcopy(evidence))
            tx.save(deepcopy(record))
            tx.publish_confirmed(deepcopy(record))  # Atomic public projection; supports need the same gate.
            return self._dto(record)
