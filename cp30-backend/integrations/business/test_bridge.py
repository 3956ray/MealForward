"""One pure subprocess JSON check. No identity, balances, RPC or signing."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from business.codec import BusinessCodec


def w(n): return '0x' + f'{n:064x}'
def a(n): return '0x' + f'{n:040x}'


class BusinessBridgeTest(unittest.TestCase):
    def test_empty_environment_json_operation_and_pinned_read(self):
        codec = BusinessCodec('/Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node')
        binding = {'chainId':31337, 'escrow':a(20), 'storeId':w(2), 'asset':a(21), 'owner':a(10),
                   'receiver':a(10), 'quoteAuthority':a(22), 'catalogAuthority':a(23),
                   'issuerAuthority':a(24), 'operatorAuthority':a(25)}
        descriptor = codec.call('prepareIssue', {'binding':binding, 'caller':a(24), 'now':'100',
            'parameters':{'opId':w(40), 'mealId':w(32), 'expectedUnitSeq':'0',
                          'expectedNextGeneration':'1', 'expectedTermsHash':w(33), 'deadline':'200'}})
        self.assertEqual(descriptor['opId'], w(40))
        self.assertEqual(descriptor['value'], '0')
        self.assertEqual(descriptor['expectedRole'], 'issuerAuthority')
        self.assertEqual(descriptor['args'][2], '0')
        read = codec.call('prepareRead', {'binding':binding, 'functionName':'getOperation',
            'args':[w(40)], 'block':{'number':'1', 'hash':w(60)}})
        self.assertEqual(read['blockTag'], {'blockHash':w(60), 'requireCanonical':True})
        with self.assertRaisesRegex(ValueError, 'UNSUPPORTED_BUSINESS_METHOD'):
            codec.call('send', {})


if __name__ == '__main__': unittest.main()
