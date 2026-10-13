"""Bounded memory-store checks and public synthetic EOA codec roundtrip; no HTTP/PG/network."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import json
from pathlib import Path
import subprocess
import threading
import unittest

from identity.adapter import IdentityBinding
from identity.wallet_proof import (
    NodeEoaRecoverer, WalletProofDomain, WalletProofError, WalletProofService, WalletProofSession,
)

WALLET = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
SYNTHETIC_SIGNATURE = "0x" + "11" * 65


class MemoryStore:
    def __init__(self, clock, sessions):
        self.clock, self.sessions = clock, sessions
        self.records, self.consumed, self.nonces = {}, set(), set()
        self.lock = threading.Lock()
        self.in_transaction = False
        self.before_consume = lambda: None

    def reserve(self, challenge):
        with self.lock:
            if challenge.challenge_id in self.records or challenge.nonce in self.nonces:
                return False
            self.records[challenge.challenge_id] = challenge
            self.nonces.add(challenge.nonce)
            return True

    def read(self, challenge_id):
        with self.lock:
            return self.records.get(challenge_id)

    def consume_once(self, expected, session, now):
        self.before_consume()
        with self.lock:
            self.in_transaction = True
            try:
                transaction_now = self.clock()
                if (self.records.get(expected.challenge_id) != expected or expected.challenge_id in self.consumed
                        or session != expected.session or self.sessions.get(session.session_hash) != session
                        or transaction_now >= min(expected.deadline, session.expires_at, session.identity.expires_at)):
                    return False
                self.consumed.add(expected.challenge_id)
                return True
            finally:
                self.in_transaction = False


class TestOnlyRecovery:
    def __init__(self, store, effect=lambda: None):
        self.store, self.effect, self.calls = store, effect, 0

    def recover(self, typed_data, signature):
        if self.store.in_transaction:
            raise AssertionError("Recovery must be outside a store transaction")
        self.calls += 1
        self.effect()
        return typed_data["message"]["wallet"]


class WalletProofTest(unittest.TestCase):
    def setUp(self):
        self.time = [100]
        self.clock = lambda: self.time[0]
        self.identity = IdentityBinding("public-synthetic-env", "public-synthetic-issuer", "1" * 64, "2" * 64, 300)
        self.session = WalletProofSession("3" * 64, self.identity, 250)
        self.sessions = {self.session.session_hash: self.session}
        self.store = MemoryStore(self.clock, self.sessions)
        self.domain = WalletProofDomain("Public synthetic wallet proof", "1", 31337, "0x" + "4" * 40,
                                        "5" * 64, "6" * 64, 60)
        self.counter = 0
        self.recovery = TestOnlyRecovery(self.store)

    def nonce(self):
        self.counter += 1
        return "0x" + f"{self.counter:064x}"

    def service(self, recoverer=None, kind=lambda _: "EOA"):
        return WalletProofService(domain=self.domain, store=self.store, clock=self.clock,
            current_session=self.sessions.get, wallet_kind=kind, nonce=self.nonce,
            recoverer=recoverer if recoverer is not None else self.recovery)

    def testMemorySuccessExactBindingAndSingleConsumption(self):
        service = self.service()
        challenge = service.issue(WALLET.upper().replace("0X", "0x"), session=self.session)
        data = challenge.public_projection()["typed_data"]
        self.assertEqual(data["domain"]["chainId"], 31337)
        self.assertEqual(data["message"]["backendOriginHash"], "0x" + "5" * 64)
        self.assertEqual(data["message"]["namespaceHash"], "0x" + "6" * 64)
        self.assertEqual(data["message"]["sessionHash"], self.session.session_hash)
        self.assertEqual(data["message"]["subjectHash"], "0x" + self.identity.subject_hash)
        self.assertEqual(set(data["message"]), {"challengeId", "nonce", "wallet", "backendOriginHash",
                                               "namespaceHash", "sessionHash", "subjectHash", "deadline"})
        result = service.verify(challenge.challenge_id, SYNTHETIC_SIGNATURE, session=self.session)
        self.assertEqual(result.wallet, WALLET)
        self.assertEqual(result.identity, self.identity)
        self.assertEqual(set(result.to_json()), {"identity", "wallet"})
        with self.assertRaises(WalletProofError):
            service.verify(challenge.challenge_id, SYNTHETIC_SIGNATURE, session=self.session)
        self.assertEqual(self.store.consumed, {challenge.challenge_id})

    def testPostRecoveryAndTransactionClockSessionOrChallengeChangesReject(self):
        for kind in ("expiry", "session", "challenge", "transaction-revocation", "transaction-expiry"):
            with self.subTest(kind=kind):
                self.setUp()
                service = self.service()
                challenge = service.issue(WALLET, session=self.session)
                if kind == "expiry":
                    self.recovery.effect = lambda: self.time.__setitem__(0, challenge.deadline)
                elif kind == "session":
                    self.recovery.effect = lambda: self.sessions.clear()
                elif kind == "challenge":
                    self.recovery.effect = lambda: self.store.records.__setitem__(
                        challenge.challenge_id, replace(challenge, nonce="0x" + "f" * 64))
                elif kind == "transaction-revocation":
                    self.store.before_consume = lambda: self.sessions.clear()
                else:
                    self.store.before_consume = lambda: self.time.__setitem__(0, challenge.deadline)
                with self.assertRaises(WalletProofError):
                    service.verify(challenge.challenge_id, SYNTHETIC_SIGNATURE, session=self.session)
                self.assertFalse(self.store.consumed)

    def testEoaClassificationSessionMismatchAndConcurrentCas(self):
        for kind, code in ((None, "WALLET_TYPE_NOT_CONFIGURED"), ("UNKNOWN", "WALLET_TYPE_NOT_CONFIGURED"),
                           ("SMART", "WALLET_KIND_NOT_SUPPORTED"), ("MULTISIG", "WALLET_KIND_NOT_SUPPORTED")):
            with self.subTest(kind=kind), self.assertRaises(WalletProofError) as failed:
                self.service(kind=None if kind is None else lambda _: kind).issue(WALLET, session=self.session)
            self.assertEqual(failed.exception.code, code)
        service = self.service()
        challenge = service.issue(WALLET, session=self.session)
        other = WalletProofSession("7" * 64, replace(self.identity, subject_hash="8" * 64), 250)
        self.sessions[other.session_hash] = other
        with self.assertRaises(WalletProofError):
            service.verify(challenge.challenge_id, SYNTHETIC_SIGNATURE, session=other)
        self.assertEqual(self.recovery.calls, 0)
        barrier = threading.Barrier(2)
        self.recovery.effect = lambda: barrier.wait(timeout=2)
        def verify():
            try:
                service.verify(challenge.challenge_id, SYNTHETIC_SIGNATURE, session=self.session)
                return True
            except WalletProofError:
                return False
        with ThreadPoolExecutor(max_workers=2) as threads:
            results = list(threads.map(lambda _: verify(), range(2)))
        self.assertEqual(sorted(results), [False, True])
        self.assertEqual(self.store.consumed, {challenge.challenge_id})

    def testRealInstalledViemRecoveryOfPublicSyntheticFixture(self):
        service = self.service(recoverer=NodeEoaRecoverer())
        challenge = service.issue(WALLET, session=self.session)
        fixture = Path(__file__).with_name("wallet-proof-codec.test.mjs")
        signed = subprocess.run(["/opt/homebrew/bin/node", str(fixture), "--public-fixture-sign"],
            input=json.dumps(challenge.typed_data()), env={}, capture_output=True, text=True, timeout=5)
        self.assertEqual(signed.returncode, 0, "public synthetic fixture could not sign")
        # Do not print/persist/assert the signature's raw value. Pipe it only to the production recoverer.
        result = service.verify(challenge.challenge_id, signed.stdout, session=self.session)
        self.assertEqual(result.wallet, WALLET)
        self.assertEqual(result.identity, self.identity)
        wrong_wallet = service.issue("0x" + "1" * 40, session=self.session)
        other_signed = subprocess.run(["/opt/homebrew/bin/node", str(fixture), "--public-fixture-sign"],
            input=json.dumps(wrong_wallet.typed_data()), env={}, capture_output=True, text=True, timeout=5)
        self.assertEqual(other_signed.returncode, 0, "public synthetic fixture could not sign")
        with self.assertRaises(WalletProofError):
            service.verify(wrong_wallet.challenge_id, other_signed.stdout, session=self.session)
        self.assertNotIn(wrong_wallet.challenge_id, self.store.consumed)


if __name__ == "__main__":
    unittest.main()
