"""Bounded subprocess adapter to the installed pure viem/wallet codec."""
import json
from pathlib import Path
import subprocess

from .service import Rejected


class NodeRegistrationCodec:
    def __init__(self, node_executable, clock,
                 owner_kind_resolver, smart_wallet_checker=None):
        # All constructor values come from trusted backend composition, never browser bodies.
        self.node = str(Path(node_executable))
        if not Path(self.node).is_absolute(): raise Rejected('ABSOLUTE_NODE_REQUIRED')
        self.helper = Path(__file__).with_name('registration-codec.mjs')
        self.clock = clock
        self.owner_kind_resolver = owner_kind_resolver
        self.smart_wallet_checker = smart_wallet_checker

    def _call(self, op, original, signature=None):
        request = {'op': op, 'original': original, 'now': str(self.clock())}
        if signature is not None: request['signature'] = signature
        raw = json.dumps(request, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()
        if len(raw) > 262144: raise Rejected('CODEC_INPUT_LIMIT')
        try:
            result = subprocess.run([self.node, str(self.helper)], input=raw, stdout=subprocess.PIPE,
                                    stderr=subprocess.DEVNULL, env={}, timeout=2, check=False)
            if result.returncode or len(result.stdout) > 1048576: raise Rejected('CODEC_UNAVAILABLE')
            value = json.loads(result.stdout)
            if type(value) is not dict or value.get('error'): raise Rejected('CODEC_UNAVAILABLE')
            return value
        except (OSError, subprocess.TimeoutExpired, ValueError) as exc:
            raise Rejected('CODEC_UNAVAILABLE') from exc

    def prepare(self, original):
        return self._call('prepare', original)

    def verify_owner_signature(self, original, signature):
        # Resolver must consume the verified owner binding, not the wallet type claimed by the browser.
        kind = self.owner_kind_resolver(original)
        if kind == 'EOA': return self._call('verifyEOA', original, signature).get('valid') is True
        if kind == 'SMART_WALLET' and self.smart_wallet_checker is not None:
            prepared = self.prepare(original)
            return self.smart_wallet_checker(original, prepared['parametersDigest'], signature) is True
        raise Rejected('OWNER_SIGNATURE_CHECKER_REQUIRED')

    def prepare_deployment(self, original, signature):
        return self._call('deployment', original, signature)
