"""Disposable local wallet simulator. No business backend receives its signing key."""
import hmac
import json
import threading
from flask import Flask, request, jsonify
from cryptography.fernet import Fernet
from eth_account import Account
from eth_account.messages import encode_defunct
from pathlib import Path
from server.backend import digest, canonical
from server.chain.client import ChainRpc, hx, PRICE
from server.local_e2e.store import LocalStore


def create_bridge(config, fault=lambda phase:None):
    app=Flask(__name__);app.logger.disabled=True;app.config['MAX_CONTENT_LENGTH']=2048
    store=LocalStore(config['databasePath']);rpc=ChainRpc(config['deployment']);box=Fernet(Path(config['secretKeyFile']).read_bytes())
    # Public, disposable Anvil development mnemonic, never a user's wallet.
    Account.enable_unaudited_hdwallet_features()
    wallets={kind:Account.from_mnemonic('test test test test test test test test test test test junk',account_path=f"m/44'/60'/0'/0/{index}")
             for kind,index in [('support',1),('settle',5),('proof',5)]}
    lock=threading.RLock()
    with store.connect() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS cp24_bridge(hash TEXT PRIMARY KEY, state TEXT NOT NULL, nonce INTEGER,
                      raw_cipher TEXT, tx_hash TEXT, signature TEXT, signs INTEGER NOT NULL DEFAULT 0)''')
    @app.post('/confirm')
    def confirm():
        if not hmac.compare_digest(request.headers.get('X-CP24-Bridge',''),config['bridgeToken']): return jsonify(status='DENIED'),403
        data=request.get_json(silent=True)
        if not isinstance(data,dict) or set(data)!={'ticket'} or not isinstance(data['ticket'],str): return jsonify(status='DENIED'),400
        key=digest(data['ticket'])
        with lock:
            rpc.guard()
            with store.transaction() as db:
                t=db.execute('SELECT * FROM cp24_tickets WHERE hash=?',(key,)).fetchone()
                old=db.execute('SELECT * FROM cp24_bridge WHERE hash=?',(key,)).fetchone()
                if old:
                    return jsonify(status=old['state'],txHash=old['tx_hash'],**({'signature':old['signature']} if old['signature'] else {}))
                if not t or t['state']!='AUTHORIZED': return jsonify(status='QUERY_ONLY')
                p=json.loads(t['payload']);kind=t['kind'];wallet=wallets[kind]
                if p['chainId']!=31337 or p['from'].lower()!=wallet.address.lower() or p['to'].lower()!=rpc.contract.address.lower():
                    return jsonify(status='DENIED'),403
                if kind=='proof':
                    c=db.execute('SELECT * FROM owner_wallet_challenges WHERE id=?',(t['operation_id'],)).fetchone()
                    if not c or c['message']!=p['message'] or c['consumed'] or c['session_id']!=t['session_id']:
                        return jsonify(status='DENIED'),403
                else:
                    table='support_intents' if kind=='support' else 'owner_settlements'
                    original=db.execute(f'SELECT * FROM {table} WHERE operation_id=?',(t['operation_id'],)).fetchone()
                    expected=PRICE if kind=='support' else 0
                    if not original or original['data']!=p['data'] or int(p['value'])!=expected:
                        return jsonify(status='DENIED'),403
                db.execute("INSERT INTO cp24_bridge(hash,state) VALUES(?,'SIGNING_STARTED')",(key,))
                db.execute("UPDATE cp24_tickets SET state='SIGNING_STARTED' WHERE hash=?",(key,))
            fault('signing_started')
            if kind=='proof':
                signature=hx(wallet.sign_message(encode_defunct(text=p['message'])).signature)
                with store.transaction() as db:
                    db.execute("UPDATE cp24_bridge SET signature=?,signs=1,state='SIGNED' WHERE hash=?",(signature,key))
                    db.execute("UPDATE cp24_tickets SET state='SIGNED' WHERE hash=?",(key,))
                return jsonify(status='SIGNED',signature=signature)
            tx={'chainId':31337,'from':wallet.address,'to':rpc.contract.address,'data':p['data'],'value':int(p['value']),
                'nonce':rpc.w3.eth.get_transaction_count(wallet.address,'pending'),'gasPrice':rpc.w3.eth.gas_price}
            tx['gas']=(rpc.w3.eth.estimate_gas(tx)*110+99)//100
            signed=wallet.sign_transaction(tx);tx_hash=hx(signed.hash);raw=hx(signed.raw_transaction)
            with store.transaction() as db:
                db.execute("UPDATE cp24_bridge SET nonce=?,raw_cipher=?,tx_hash=?,signs=1,state='RAW_SAVED' WHERE hash=?",
                           (tx['nonce'],box.encrypt(raw.encode()).decode(),tx_hash,key))
                db.execute("UPDATE cp24_tickets SET state='RAW_SAVED',result=? WHERE hash=?",(canonical({'txHash':tx_hash}),key))
                db.execute('UPDATE operations SET tx_hash=? WHERE id=?',(tx_hash,t['operation_id']))
            fault('raw_saved')
            # Exactly one send attempt. On error the persisted original remains query-only.
            try:
                rpc.w3.eth.send_raw_transaction(signed.raw_transaction)
                state='SUBMITTED'
            except Exception: state='UNKNOWN'
            with store.transaction() as db:
                db.execute('UPDATE cp24_bridge SET state=? WHERE hash=?',(state,key))
                db.execute('UPDATE cp24_tickets SET state=? WHERE hash=?',(state,key))
            fault('after_send')
            return jsonify(status=state,txHash=tx_hash)
    @app.errorhandler(Exception)
    def error(e): return jsonify(status='UNKNOWN'),503
    return app
