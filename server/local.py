"""Explicit CP15 local fixture/runner. Keys generated here are exclusively disposable Anvil keys."""
import argparse
import json
import secrets
import time
import requests
from pathlib import Path
from urllib.parse import urlsplit
from cryptography.fernet import Fernet
from eth_account import Account
from web3 import Web3, HTTPProvider
from server.backend import Backend
from server.chain.client import ABI, ChainRpc, RULE, PRICE, hx
from server.storage import Store

REPO=Path(__file__).resolve().parents[1]

def fixture(directory, rpc_url, origin='http://127.0.0.1:8875', *, owner_mode=False):
    from server.auth import hash_password
    root=Path(directory)
    if root.exists() and any(root.iterdir()): raise ValueError('Fixture directory must be empty; never reset an existing database')
    u=urlsplit(rpc_url)
    if u.scheme!='http' or u.hostname not in ('127.0.0.1','localhost','::1') or u.username or u.password or u.path not in ('','/') or u.query or u.fragment: raise ValueError('Loopback only')
    session=requests.Session();session.trust_env=False
    w3=Web3(HTTPProvider(rpc_url,session=session,request_kwargs={'timeout':3,'allow_redirects':False},exception_retry_configuration=None))
    if w3.eth.chain_id!=31337 or 'anvil' not in w3.client_version.lower(): raise ValueError('Anvil31337 only')
    artifact=json.loads((REPO/'out/MealForward.sol/MealForward.json').read_text())
    accounts=w3.eth.accounts
    tx=w3.eth.contract(abi=ABI,bytecode=artifact['bytecode']['object']).constructor(accounts[0],accounts[5]).transact({'from':accounts[0]})
    receipt=w3.eth.wait_for_transaction_receipt(tx)
    contract=w3.eth.contract(address=receipt['contractAddress'],abi=ABI)
    issuer=Account.create()
    operator=Account.create();settler=None if owner_mode else Account.create()
    backend_signers={'operator':operator,**({'settler':settler} if settler else {})}
    for signer in (issuer,*backend_signers.values()):
        w3.provider.make_request('anvil_setBalance',[signer.address,hex(10**18)])
    for role,account in [('SUPPORTER_ROLE',accounts[1]),('SUPPORTER_ROLE',accounts[6]),('ISSUER_ROLE',issuer.address),
                         ('OPERATOR_ROLE',operator.address),('SETTLER_ROLE',accounts[5] if owner_mode else settler.address)]:
        role_id=getattr(contract.functions,role)().call()
        w3.eth.wait_for_transaction_receipt(contract.functions.grantRole(role_id,account).transact({'from':accounts[0]}))
    root.mkdir(parents=True,exist_ok=True); root.chmod(0o700)
    keyfile=root/'issuer.key'; keyfile.write_bytes(issuer.key); keyfile.chmod(0o600)
    for name,signer in backend_signers.items():
        path=root/(name+'.key');path.write_bytes(signer.key);path.chmod(0o600)
    encryption=root/'encryption.key'; encryption.write_bytes(Fernet.generate_key()); encryption.chmod(0o600)
    deployment={'mode':'localchain','deploymentId':secrets.token_hex(16),'chainId':31337,'rpcUrl':rpc_url,
                'contractAddress':contract.address,'codeHash':hx(w3.keccak(w3.eth.get_code(contract.address))),
                'deploymentBlock':receipt['blockNumber'],'genesisHash':hx(w3.eth.get_block(0)['hash']),
                'abiVersion':'cp13-21d1953','ruleVersion':RULE,'priceWei':str(PRICE),'fundingCapWei':str(10**17),
                'issuer':issuer.address,'supporter':accounts[1],'merchant':accounts[5]}
    config={'deployment':deployment,'databasePath':str((root/'backend.sqlite3').resolve()),
            'issuerKeyFile':str(keyfile.resolve()),'secretKeyFile':str(encryption.resolve()),'origin':origin,
            **{role+'KeyFile':str((root/(role+'.key')).resolve()) for role in backend_signers},
            'workSigners':{role:signer.address for role,signer in backend_signers.items()},'ownerWalletMode':owner_mode}
    configfile=root/'config.json'; configfile.write_text(json.dumps(config,indent=2)+'\n'); configfile.chmod(0o600)
    backend=load_backend(config)
    for uid,partner in [('partner-a','partner-a'),('partner-b','partner-b')]:
        backend.store.create_user(uid,uid.strip().casefold(),hash_password('local-only-password'),'partner',partner,'shop-local')
        backend.store.execute('INSERT INTO qualifications VALUES(?,?,1,1,3,0,0)',(partner,'REF-A'))
    work_users=[('owner-a','owner','shop-local')] if owner_mode else [('staff-a','staff','shop-local'),('staff-b','staff','shop-local'),
                          ('staff-other','staff','shop-other'),('settler-a','settler','shop-local'),
                          ('settler-other','settler','shop-other')]
    for uid,role,shop in work_users:
        backend.store.create_user(uid,uid,hash_password('local-only-password'),role,None,shop)
    if owner_mode:
        backend.store.execute('INSERT INTO owner_wallet_bindings VALUES(?,?,?,?,1)',
                              ('owner-a','shop-local',deployment['deploymentId'],accounts[5]))
    return config

def load_backend(config):
    return Backend(Store(config['databasePath']),ChainRpc(config['deployment']),Path(config['secretKeyFile']).read_bytes(),
                   config['deployment']['issuer'],signers=config.get('workSigners'),owner_mode=config.get('ownerWalletMode',False))

def load_worker_keys(config):
    return {role:Path(config[role+'KeyFile']).read_bytes() for role in ('issuer','operator','settler')
            if role=='issuer' or role in config.get('workSigners',{})}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['setup','web','worker','backup','restore'])
    parser.add_argument('--directory',default='.localbackend')
    parser.add_argument('--destination')
    parser.add_argument('--backup')
    parser.add_argument('--rpc-url',default='http://127.0.0.1:18645')
    parser.add_argument('--origin',default='http://127.0.0.1:8875')
    parser.add_argument('--port',type=int,default=8875)
    parser.add_argument('--dynamic-auth',action='store_true',help='Use CP17 token authentication; no password fallback')
    parser.add_argument('--dynamic-authority-file',help='Explicit trusted mapping/profile JSON outside any backup bundle')
    args=parser.parse_args()
    root=Path(args.directory)
    if args.command=='restore':
        if not args.backup: parser.error('restore requires --backup and a new --directory')
        from server.recovery import restore_bundle
        restore_bundle(args.backup,root)
        print('Restored in QUARANTINED mode: original operations only; no new signatures or business writes')
        return
    if args.command=='setup':
        config=fixture(root,args.rpc_url,args.origin,owner_mode=True)
        print('CP16 owner fixture ready; owner wallet is external to backend; configuration:',root/'config.json')
        return
    config=json.loads((root/'config.json').read_text())
    if args.command=='backup':
        if not args.destination: parser.error('backup requires a new --destination directory')
        from server.recovery import backup_bundle
        backup_bundle(config,args.destination)
        print('Private quarantined backup created; restore only through the restore command')
        return
    backend=load_backend(config)
    if args.command=='web':
        from server.web import create_app
        dynamic_config=None
        if args.dynamic_auth:
            from server.dynamic_contracts import ClaimProfile, ENVIRONMENT_ID
            from server.dynamic_jwt import FixedJwksCache
            from server.dynamic_mapping import activate_mappings
            profile=ClaimProfile(ENVIRONMENT_ID,'')
            if args.dynamic_authority_file:
                authority=json.loads(Path(args.dynamic_authority_file).read_text())
                if set(authority)!={'sourceVersion','mappings','claimProfile'}: raise ValueError('Invalid trusted authority file')
                profile_data=dict(authority['claimProfile'])
                if 'audiences' in profile_data: profile_data['audiences']=tuple(profile_data['audiences'])
                profile=ClaimProfile(**profile_data)
                if profile.environment_id!=ENVIRONMENT_ID: raise ValueError('Sandbox environment required')
                if any(entry.get('environment_id')!=profile.environment_id or entry.get('issuer')!=profile.issuer for entry in authority['mappings']):
                    raise ValueError('Mapping/profile environment or issuer mismatch')
                activate_mappings(backend.store,authority['mappings'],source_version=authority['sourceVersion'])
            dynamic_config={'profile':profile,'jwks':FixedJwksCache(clock=backend.clock),
                            'capture_directory':root/'profile-captures'}
        elif args.dynamic_authority_file:
            raise ValueError('Explicit --dynamic-auth required')
        create_app(backend,origin=config['origin'],dynamic_auth_config=dynamic_config).run(host='127.0.0.1',port=args.port,debug=False,use_reloader=False)
    else:
        from server.outbox import Worker
        worker=Worker(backend,load_worker_keys(config))
        while True:
            try: worker.tick()
            except Exception: print('Worker state unavailable; preserving original operations')
            time.sleep(1)
if __name__=='__main__': main()
