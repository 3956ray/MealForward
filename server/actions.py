"""Frozen CP13 action encodings. Pure functions: never RPC or signing."""
from dataclasses import dataclass
from eth_abi import encode
from hexbytes import HexBytes
from web3 import Web3

@dataclass(frozen=True)
class Action:
    number: int
    signer_role: str
    actor_role: str
    event: str
    types: tuple[str,...]
    fields: tuple[str,...]

ACTIONS={
    'issue':Action(1,'issuer','partner','Issued',('bytes32','bytes32[]'),('batchId','voucherIds')),
    'lock':Action(2,'operator','staff','Locked',('bytes32','bytes32'),('voucherId','lockId')),
    'report':Action(3,'operator','staff','Reported',('bytes32','bytes32'),('voucherId','lockId')),
    'settle':Action(4,'settler','settler','Settled',('bytes32',),('voucherId',)),
}

def action_values(kind, payload):
    spec=ACTIONS[kind]
    return [[bytes(HexBytes(v)) for v in payload[f]] if t=='bytes32[]' else bytes(HexBytes(payload[f]))
            for t,f in zip(spec.types,spec.fields)]

def action_fingerprint(kind, payload):
    spec=ACTIONS[kind];values=action_values(kind,payload)
    return Web3.to_hex(Web3.keccak(encode(spec.types,values))),Web3.to_hex(values[0])

def action_transaction(contract, kind, operation_id, payload):
    return {'to':contract.address,'data':contract.encode_abi(kind,args=[operation_id,*action_values(kind,payload)]),
            'value':0,'chainId':31337}
