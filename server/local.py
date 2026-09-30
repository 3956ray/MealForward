"""Explicit CP15 local fixture/runner. Keys generated here are exclusively disposable Anvil keys."""
import argparse
import json
import secrets
import time
from pathlib import Path
from urllib.parse import urlsplit
from cryptography.fernet import Fernet
from eth_account import Account
from web3 import Web3, HTTPProvider
from server.backend import Backend
from server.chain.client import ABI, ChainRpc, RULE, PRICE, hx
from server.storage import Store

REPO=Path(__file__).resolve().parents[1]

def fixture(directory, rpc_url, origin='http://127.0.0.1:8875'):
    from server.auth import hash_password
    root=Path(directory)
    if root.exists() and any(root.iterdir()): raise ValueError('Fixture directory must be empty; never reset an existing database')
    u=urlsplit(rpc_url)
    if u.scheme!='http' or u.hostname not in ('127.0.0.1','localhost','::1') or u.username or u.password or u.path not in ('','/') or u.query or u.fragment: raise ValueError('Loopback only')
    w3=Web3(HTTPProvider(rpc_url,request_kwargs={'timeout':3,'allow_redirects':False},exception_retry_configuration=None))
    if w3.eth.chain_id!=31337 or 'anvil' not in w3.client_version.lower(): raise ValueError('Anvil31337 only')
    artifact=json.loads((REPO/'out/MealForward.sol/MealForward.json').read_text())
    accounts=w3.eth.accounts
    tx=w3.eth.contract(abi=ABI,bytecode=artifact['bytecode']['object']).constructor(accounts[0],accounts[5]).transact({'from':accounts[0]})
    receipt=w3.eth.wait_for_transaction_receipt(tx)
    contract=w3.eth.contract(address=receipt['contractAddress'],abi=ABI)
    issuer=Account.create()
    w3.provider.make_request('anvil_setBalance',[issuer.address,hex(10**18)])
    for role,account in [('SUPPORTER_ROLE',accounts[1]),('SUPPORTER_ROLE',accounts[6]),('ISSUER_ROLE',issuer.address)]:
        role_id=getattr(contract.functions,role)().call()
        w3.eth.wait_for_transaction_receipt(contract.functions.grantRole(role_id,account).transact({'from':accounts[0]}))
    root.mkdir(parents=True,exist_ok=True); root.chmod(0o700)
    keyfile=root/'issuer.key'; keyfile.write_bytes(issuer.key); keyfile.chmod(0o600)
    encryption=root/'encryption.key'; encryption.write_bytes(Fernet.generate_key()); encryption.chmod(0o600)
    deployment={'mode':'localchain','deploymentId':secrets.token_hex(16),'chainId':31337,'rpcUrl':rpc_url,
                'contractAddress':contract.address,'codeHash':hx(w3.keccak(w3.eth.get_code(contract.address))),
                'deploymentBlock':receipt['blockNumber'],'genesisHash':hx(w3.eth.get_block(0)['hash']),
                'abiVersion':'cp13-21d1953','ruleVersion':RULE,'priceWei':str(PRICE),'fundingCapWei':str(10**17),
                'issuer':issuer.address,'supporter':accounts[1],'merchant':accounts[5]}
    config={'deployment':deployment,'databasePath':str((root/'backend.sqlite3').resolve()),
            'issuerKeyFile':str(keyfile.resolve()),'secretKeyFile':str(encryption.resolve()),'origin':origin}
    configfile=root/'config.json'; configfile.write_text(json.dumps(config,indent=2)+'\n'); configfile.chmod(0o600)
    backend=load_backend(config)
    for uid,partner in [('partner-a','partner-a'),('partner-b','partner-b')]:
        backend.store.create_user(uid,uid.strip().casefold(),hash_password('local-only-password'),'partner',partner,'shop-local')
        backend.store.execute('INSERT INTO qualifications VALUES(?,?,1,1,3,0,0)',(partner,'REF-A'))
    return config

def load_backend(config):
    return Backend(Store(config['databasePath']),ChainRpc(config['deployment']),Path(config['secretKeyFile']).read_bytes(),config['deployment']['issuer'])

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['setup','web','worker','backup','restore'])
    parser.add_argument('--directory',default='.localbackend')
    parser.add_argument('--destination')
    parser.add_argument('--backup')
    args=parser.parse_args()
    root=Path(args.directory)
    if args.command=='restore':
        if not args.backup: parser.error('restore requires --backup and a new --directory')
        from server.recovery import restore_bundle
        restore_bundle(args.backup,root)
        print('Restored in QUARANTINED mode: original operations only; no new signatures or business writes')
        return
    if args.command=='setup':
        config=fixture(root,'http://127.0.0.1:18645')
        print('CP15 local fixture ready; configuration:',root/'config.json')
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
        create_app(backend,origin=config['origin']).run(host='127.0.0.1',port=8875,debug=False,use_reloader=False)
    else:
        from server.outbox import Worker
        worker=Worker(backend,Path(config['issuerKeyFile']).read_bytes())
        while True:
            try: worker.tick()
            except Exception: print('Worker state unavailable; preserving original operations')
            time.sleep(1)
if __name__=='__main__': main()
