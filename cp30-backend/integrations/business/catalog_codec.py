"""Separately pinned catalog extension; old business compiler pins stay intact."""
import hashlib,json,subprocess
from pathlib import Path

PINS={'catalog.mjs': '0ee6589d03225fcc3201f6cc10c4c88953c69b25527d2480e6daaea23bb38a2d', 'catalog-abi.mjs': '9d17050fbd1c656088539e3f1feddcce69654d60b77a620eefe0f416d6b7dd1e', 'catalog-bridge.mjs': '67371204b5bf2f3a047bcd8f05fd034c30187c2f3d2c3947547bbd4dfd2db229'}
def verify_pins():
    root=Path(__file__).resolve().parent
    if not PINS or any(hashlib.sha256((root/name).read_bytes()).hexdigest()!=digest for name,digest in PINS.items()):raise ValueError('CATALOG_SOURCE_PIN_REQUIRED')

class CatalogCodec:
    def __init__(self,node_executable):
        self.node=str(Path(node_executable));self.root=Path(__file__).resolve().parent
        if not Path(self.node).is_absolute():raise ValueError('ABSOLUTE_NODE_REQUIRED')
    def call(self,method,parameters):
        if method not in {'preparePublish','prepareSetListed','catalogTermsHash'}:raise ValueError('UNSUPPORTED_CATALOG_METHOD')
        verify_pins()
        raw=json.dumps({'method':method,'parameters':parameters},ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()
        if len(raw)>131072:raise ValueError('CATALOG_INPUT_LIMIT')
        try:
            result=subprocess.run([self.node,str(self.root/'catalog-bridge.mjs')],input=raw,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={},timeout=2,check=False)
            if result.returncode or len(result.stdout)>1048576:raise ValueError('CATALOG_CODEC_UNAVAILABLE')
            value=json.loads(result.stdout)
            if type(value) is not dict or value.get('error'):raise ValueError('CATALOG_CODEC_UNAVAILABLE')
            return value
        except (OSError,subprocess.TimeoutExpired) as e:raise ValueError('CATALOG_CODEC_UNAVAILABLE') from e

from .codec import BusinessCodec
class ExtendedBusinessCodec(BusinessCodec):
    def call(self,method,parameters):
        if method in {'preparePublish','prepareSetListed','catalogTermsHash'}:return CatalogCodec(self.node).call(method,parameters)
        return super().call(method,parameters)
