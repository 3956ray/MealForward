"""One JSON/Python subprocess interoperability check; no keys/signing/network."""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from onboarding.codec import NodeRegistrationCodec
from onboarding.service import Rejected


class CodecInteropTest(unittest.TestCase):
    def test_one_shot_prepare_deployment_and_closed_smart_wallet_boundary(self):
        original = json.loads(Path(__file__).with_name('codec-fixture.json').read_text())['original']
        node = '/Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
        codec = NodeRegistrationCodec(node, lambda: 100, lambda original: 'EOA')
        prepared = codec.prepare(original)
        self.assertEqual(prepared['typedData']['message']['deadline'], '200')
        self.assertEqual(prepared['typedData']['domain']['chainId'], 31337)
        self.assertFalse(codec.verify_owner_signature(original, '0x1234'))
        deployment = codec.prepare_deployment(original, '0x1234')
        self.assertEqual(deployment['from'], original['registrar'])
        self.assertEqual(deployment['to'], original['factory'])
        self.assertGreater(len(deployment['data']), 100)
        smart = NodeRegistrationCodec(node, lambda: 100, lambda original: 'SMART_WALLET')
        with self.assertRaisesRegex(Rejected, 'OWNER_SIGNATURE_CHECKER_REQUIRED'):
            smart.verify_owner_signature(original, '0x1234')


if __name__ == '__main__': unittest.main()
