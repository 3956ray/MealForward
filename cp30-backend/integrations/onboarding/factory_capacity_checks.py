"""Normal offline fixture checks. No network, database, account or private keys."""
import json
from pathlib import Path
import subprocess
import time
from factory_capacity import FactoryCapacityObserver, FactoryCapacityError

NODE = '/opt/homebrew/bin/node'
ROOT = Path(__file__).resolve().parent


def main():
    fixture = json.loads(subprocess.run([NODE, str(ROOT / 'factory-capacity-checks.mjs')],
        env={}, cwd=str(ROOT), capture_output=True, timeout=3, check=True).stdout)
    profile = dict(fixture['addresses'], chainId=10143, genesisHash='0x' + 'a' * 64,
        escrowCreationCodeHash=fixture['creation'], runtimeTemplatePins=fixture['templatePins'],
        eip1898=True, finality='rpc-finalized', budget={'maxCalls': 48, 'maxTotalMs': 20000,
        'maxCallMs': 3000, 'maxResponseBytes': 1048576, 'maxTotalBytes': 1048576, 'maxCatalogEntries': 3})
    block_hash = '0x' + 'b' * 64
    sessions = []

    class FixtureTransport:
        def __init__(self): self.requests = []
        def request(self, method, params, *, deadline):
            assert time.monotonic() < deadline <= time.monotonic() + 3.01
            self.requests.append((method, params))
            if method == 'eth_chainId': return hex(profile['chainId'])
            if method == 'eth_getBlockByNumber':
                return {'number': '0x0' if params[0] == '0x0' else '0x7',
                        'hash': profile['genesisHash'] if params[0] == '0x0' else block_hash}
            assert params[1] == {'blockHash': block_hash, 'requireCanonical': True}
            if method == 'eth_getCode':
                assert params[0] == profile['factory']
                return fixture['code']
            assert method == 'eth_call' and params[0]['to'] == profile['factory']
            call = next(c for c in fixture['calls'] if c['data'] == params[0]['data'])
            return fixture['results'][call['functionName']]

    def factory():
        value = FixtureTransport(); sessions.append(value); return value

    observer = FactoryCapacityObserver(profile=profile, transport_factory=factory, node_executable=NODE)
    before = int(time.time()); result = observer.observe()
    assert set(result) == {'profile', 'count', 'observedAt', 'blockHash'}
    assert len(result['profile']) == 9 and result['profile']['chainId'] == '10143'
    assert result['count'] == 0 and result['blockHash'] == block_hash
    assert before <= result['observedAt'] <= int(time.time())
    assert len(sessions[0].requests) == 15
    assert observer.observe()['count'] == 0 and len(sessions) == 2 and sessions[0] is not sessions[1]
    fixture['results']['storeCount'] = '0x' + format(3, '064x')
    assert observer.observe()['count'] == 3
    fixture['results']['issuerAuthority'] = '0x' + format(99, '064x')
    try: observer.observe()
    except FactoryCapacityError as exc: assert str(exc) == 'FACTORY_CAPACITY_BINDING_MISMATCH'
    else: raise AssertionError('must reject getter/profile mismatch')
    print('PASS: 4 Python capacity checks + 4 Node ABI/template checks (offline fixtures only)')


if __name__ == '__main__': main()
