"""CP29 read-only binding of *existing* finalized deployment to a fresh run ID.

No private keys, operator profiles, database writes, role grants or RPC sends.
Runs only when the operator supplies a new, fixed run ID.
"""
from __future__ import annotations

import argparse
import json
import re
from eth_utils import keccak
from server.backend import canonical
from .identity import CHAIN_ID, deployment_plan, PRICE
from .deployment import register_deployment
from .rpc import HttpsTransport, TestnetRpc

OWNER = '0xC4F8a468f10d5f98DCfF3282516125E97F26433b'
SERVICE = '0x98A5721Dd77e79c0Ee0ef7548CA8278C73f49D54'
CONTRACT = '0xD60ceD42A67e6B7bE2A3d17464181875b75531a9'
DEPLOY_TX = '0x7078c39ec39891054196e5c617387c560a034172ba1395228710a16426672c9b'
DEPLOY_NONCE = 6
RPC = 'https://testnet-rpc.monad.xyz'


def observe(run_id, *, transport=None):
    if not isinstance(run_id, str) or not re.fullmatch(r'cp29-[a-z0-9-]{8,64}', run_id):
        raise ValueError('Explicit fresh CP29 run ID required')
    transport = transport or HttpsTransport(RPC)
    plan = deployment_plan(run_id, OWNER, OWNER, DEPLOY_NONCE)
    if plan['predictedAddress'].lower() != CONTRACT.lower():
        raise ValueError('Expected deployment prediction mismatch')
    deployed = register_deployment(plan, DEPLOY_TX, transport)
    if (deployed['contractAddress'].lower() != CONTRACT.lower() or
            deployed['deploymentTransaction'].lower() != DEPLOY_TX.lower()):
        raise ValueError('Finalized deployment identity mismatch')
    participants = {'admin': OWNER.lower(), 'supporter': OWNER.lower(), 'merchant': OWNER.lower(),
                    'issuer': SERVICE.lower(), 'operator': SERVICE.lower()}
    rpc = TestnetRpc(deployed, participants, transport)
    with rpc.observation():
        final = rpc.guard()
        if rpc.read('paused', [], final['number']):
            raise ValueError('Contract paused')
        if rpc.read('totalFunded', [], final['number']) != 0:
            raise ValueError('One-meal test contract already funded')
        role_specs = [('DEFAULT_ADMIN', bytes(32), OWNER),
                      ('SUPPORTER', keccak(text='SUPPORTER_ROLE'), OWNER),
                      ('SETTLER', keccak(text='SETTLER_ROLE'), OWNER),
                      ('ISSUER', keccak(text='ISSUER_ROLE'), SERVICE),
                      ('OPERATOR', keccak(text='OPERATOR_ROLE'), SERVICE)]
        if any(not rpc.read('hasRole', [r, address], final['number']) for _, r, address in role_specs):
            raise ValueError('Required roles not granted at finalized block')
        # A service key must never be able to settle, support or administer.
        if any(rpc.read('hasRole', [r, SERVICE], final['number']) for r in
               (bytes(32), keccak(text='SUPPORTER_ROLE'), keccak(text='SETTLER_ROLE'))):
            raise ValueError('Service wallet has excessive chain roles')
        owner_nonce = rpc.nonce(OWNER)
        service_nonce = rpc.nonce(SERVICE)
    return {'status':'DEPLOYMENT_AND_ROLES_READ_ONLY_VERIFIED','runId':run_id,
            'deploymentId':deployed['deploymentId'],'deployment':deployed,
            'participants':participants,'observedFinalizedBlock':final['number'],
            'ownerPendingNonce':owner_nonce,'servicePendingNonce':service_nonce,
            'principalWei':str(PRICE),'identityMappingsConfigured':False,
            'runtimePlanAuthorized':False,'signerArmed':False,'transactionsSent':0}


def main():
    parser=argparse.ArgumentParser(description='Read-only Monad CP29 business identity and role verification')
    parser.add_argument('--run-id',required=True,help='Explicit fresh, unique run ID. Never reuse a prior business run')
    args=parser.parse_args()
    result=observe(args.run_id)
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__': main()
