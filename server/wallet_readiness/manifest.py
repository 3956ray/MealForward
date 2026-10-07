"""Reviewed public historical target, never a new business deployment."""
import hashlib
import json
from pathlib import Path
from eth_utils import keccak
from .check import CheckError

ROOT=Path(__file__).parent
PINNED_DIGEST="9778ea2d23648aad464fb7a575b25ead7f8e4a365c3c682b9722cd783c29252f"
ROLE_NAMES=('DEFAULT_ADMIN_ROLE','SUPPORTER_ROLE','ISSUER_ROLE','OPERATOR_ROLE','SETTLER_ROLE')

def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def load_manifest(path=None):
    path=path or ROOT/'historical-manifest.json'
    try:
        manifest=json.loads(path.read_text())
        if digest(manifest)!=PINNED_DIGEST:raise CheckError('MANIFEST_UNTRUSTED')
        artifact_path=ROOT/manifest['artifactFile']
        raw=artifact_path.read_bytes();artifact=json.loads(raw)
        if hashlib.sha256(raw).hexdigest()!=manifest['artifactFileSha256'] or digest(artifact)!=manifest['artifactDigest']:raise CheckError('ARTIFACT_UNTRUSTED')
        code=bytearray.fromhex(artifact['deployedBytecode']['object'].removeprefix('0x'))
        refs=artifact['deployedBytecode']['immutableReferences']
        if len(refs)!=1:raise CheckError('ARTIFACT_UNTRUSTED')
        for positions in refs.values():
            for pos in positions:
                if pos['length']!=32 or not 0<=pos['start']<=len(code)-32:raise CheckError('ARTIFACT_UNTRUSTED')
                code[pos['start']:pos['start']+32]=bytes.fromhex(manifest['expectedMerchant'][2:]).rjust(32,b'\0')
        if '0x'+keccak(bytes(code)).hex()!=manifest['expectedRuntimeKeccak']:raise CheckError('ARTIFACT_UNTRUSTED')
        return manifest
    except CheckError:raise
    except FileNotFoundError:raise CheckError('MANIFEST_NOT_CONFIGURED') from None
    except Exception:raise CheckError('MANIFEST_UNTRUSTED') from None

def context(manifest):
    return {'manifestId':manifest['manifestId'],'schemaVersion':manifest['schemaVersion'],'manifestDigest':PINNED_DIGEST,'purpose':manifest['purpose'],'contractAddress':manifest['contractAddress'],'sourceCommit':manifest['sourceCommit'],'deploymentBlock':manifest['deployment']['blockNumber'],'deploymentTransaction':manifest['deployment']['transactionHash'],'expectedRuntimeKeccak':manifest['expectedRuntimeKeccak'],'expectedMerchant':manifest['expectedMerchant'],'expectedRuleVersion':manifest['expectedRuleVersion']}
