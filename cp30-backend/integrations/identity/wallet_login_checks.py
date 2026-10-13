"""Small pure offline checks. Synthetic public test key only; no real identity/RPC.

Run: python -B wallet_login_checks.py /absolute/approved/node
The well-known scalar 1 below is an in-memory fiction used only by these checks.
No key/signature/challenge file, account, grant or session is created.
"""

import copy
import json
from pathlib import Path
import subprocess
import sys
import unittest

from wallet_login import WalletLoginError, build_wallet_login_challenge, verify_wallet_login_signature

NODE = sys.argv.pop(1) if len(sys.argv) > 1 else "/opt/homebrew/bin/node"
WALLET = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
ORIGIN = "https://127.0.0.1:18443"
ISSUED = 1791854400


class WalletLoginChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.challenge = build_wallet_login_challenge(
            wallet=WALLET, origin=ORIGIN, chain_id=10143, nonce="a" * 64,
            challenge_id="95b11417-f18f-457f-8804-68e361f9164f", issued_at=ISSUED,
            expires_at=ISSUED + 180, node_executable=NODE)
        # Pure viem account signMessage of the synthetic message. This is test
        # fixture generation only, never imported by the production leaf.
        script = """
import { privateKeyToAccount } from 'viem/accounts';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const challenge = JSON.parse(input);
const account = privateKeyToAccount('0x' + '0'.repeat(63) + '1');
process.stdout.write(await account.signMessage({message: challenge.message}));
"""
        result = subprocess.run([NODE, "--input-type=module", "-e", script],
                                cwd=str(Path(__file__).parent), env={},
                                input=json.dumps(cls.challenge).encode("ascii"),
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                timeout=3, check=False)
        if result.returncode != 0:
            raise AssertionError("Offline synthetic signature fixture unavailable")
        cls.signature = result.stdout.decode("ascii")

    def test_normal_siwe_fields_and_checksum_message(self):
        challenge = self.challenge
        self.assertEqual(set(challenge), {"challengeId", "address", "chainId", "nonce", "domain",
                                          "uri", "issuedAt", "expiresAt", "message"})
        self.assertEqual(challenge["address"], WALLET)
        self.assertEqual(challenge["domain"], "127.0.0.1:18443")
        self.assertEqual(challenge["uri"], ORIGIN)
        self.assertIn("Sign in to MealForward with your test wallet.\n", challenge["message"])
        self.assertIn("0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf", challenge["message"])
        self.assertIn("Request ID: " + challenge["challengeId"], challenge["message"])

    def test_synthetic_personal_sign_recovers_original_wallet(self):
        self.assertEqual(verify_wallet_login_signature(
            self.challenge, self.signature, now=ISSUED + 1, node_executable=NODE), WALLET)

    def test_original_message_and_domain_binding(self):
        for field, value in (("domain", "localhost:18443"),
                             ("message", self.challenge["message"] + "\n")):
            challenge = copy.deepcopy(self.challenge)
            challenge[field] = value
            with self.assertRaises(WalletLoginError) as caught:
                verify_wallet_login_signature(challenge, self.signature,
                                              now=ISSUED + 1, node_executable=NODE)
            self.assertEqual(caught.exception.code, "WALLET_LOGIN_REJECTED")

    def test_expiration_is_closed(self):
        with self.assertRaises(WalletLoginError) as caught:
            verify_wallet_login_signature(self.challenge, self.signature,
                                          now=ISSUED + 180, node_executable=NODE)
        self.assertEqual(caught.exception.code, "WALLET_LOGIN_REJECTED")


if __name__ == "__main__":
    unittest.main()
