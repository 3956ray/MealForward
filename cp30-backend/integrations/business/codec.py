"""Empty-environment Node JSON adapter; invoke outside any database transaction."""
import json
from pathlib import Path
import subprocess

METHODS = frozenset(('prepareFundingQuote', 'attachFundingSignature', 'prepareIssue',
                     'prepareLock', 'prepareMarkHandover', 'prepareReport', 'prepareRead', 'decodeRead'))


class BusinessCodec:
    def __init__(self, node_executable):
        self.node = str(Path(node_executable))
        if not Path(self.node).is_absolute(): raise ValueError('ABSOLUTE_NODE_REQUIRED')
        self.helper = Path(__file__).with_name('bridge.mjs')

    def call(self, method, parameters):
        if method not in METHODS: raise ValueError('UNSUPPORTED_BUSINESS_METHOD')
        raw = json.dumps({'method': method, 'parameters': parameters}, ensure_ascii=False,
                         separators=(',', ':'), allow_nan=False).encode()
        if len(raw) > 131072: raise ValueError('BUSINESS_INPUT_LIMIT')
        try:
            result = subprocess.run([self.node, str(self.helper)], input=raw, stdout=subprocess.PIPE,
                                    stderr=subprocess.DEVNULL, env={}, timeout=2, check=False)
            if result.returncode or len(result.stdout) > 1048576: raise ValueError('BUSINESS_CODEC_UNAVAILABLE')
            value = json.loads(result.stdout)
            if type(value) is not dict or value.get('error'): raise ValueError('BUSINESS_CODEC_UNAVAILABLE')
            return value
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ValueError('BUSINESS_CODEC_UNAVAILABLE') from exc
