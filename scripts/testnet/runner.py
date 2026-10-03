"""Explicit one-step runner. No daemon, automatic broadcast retry, or owner key loading."""
import argparse
import json
import sys
from eth_account import Account
from eth_account.typed_transactions import TypedTransaction
from hexbytes import HexBytes
from web3 import Web3
from .rpc import Rpc, Stop, ROOT, GENESIS, number, hexbytes
from .journal import Journal, DIRECTORY, atomic, digest, read_private
from .plan import make_plan, validate_plan, MAX_FEE, FEE_CAP, TIP, hx
from .verify import identity, confirmed, final_accounting


class Runner:
    def __init__(self,rpc,journal=None):
        self.rpc=rpc;self.journal=journal or Journal()

    def prepare(self,addresses,genesis=GENESIS):
        with self.journal.locked():
            if self.journal.path.exists():
                data=self.journal.load();self.validate(data);return self.public(data)
            marker=self.journal.directory/'run-created.json'
            if marker.exists() or (self.journal.directory/'plan-public.json').exists(): raise Stop('JOURNAL_MISSING')
            plan=make_plan(self.rpc,addresses,genesis=genesis)
            data={'version':1,'plan':plan,'planHash':digest(plan),'records':{},'fundingSeen':{},'halted':False}
            atomic(marker,{'planHash':data['planHash']})
            self.journal.save(data)
            atomic(self.journal.directory/'plan-public.json',{'planHash':data['planHash'],'plan':plan})
            return self.public(data)

    def validate_record(self,step,record):
        if record.get('state') not in ('SIGNING_STARTED','SIGNED','UNKNOWN','FINALIZED','FAILED'): raise Stop('JOURNAL_CONFLICT')
        if record.get('state')=='SIGNING_STARTED':
            raise Stop('SIGNING_UNKNOWN')
        try:
            raw=hexbytes(record['raw'])
            if hx(Web3.keccak(raw))!=record['hash']: raise Stop('JOURNAL_CONFLICT')
            if Account.recover_transaction(raw).lower()!=step['sender'].lower(): raise Stop('JOURNAL_CONFLICT')
            signed=TypedTransaction.from_bytes(HexBytes(raw)).as_dict()
            tx=record['tx']
            for key in ('nonce','value','gas','chainId','maxFeePerGas','maxPriorityFeePerGas'):
                if signed[key]!=tx[key]: raise Stop('JOURNAL_CONFLICT')
            if (hx(signed['data']).lower()!=step['data'].lower() or hx(signed['to']).lower()!=(step['to'] or '0x').lower()
                or tx['nonce']!=step['nonce'] or tx['value']!=int(step['value']) or tx['chainId']!=10143
                or tx['gas']>step['gasCap'] or tx['maxFeePerGas']>MAX_FEE or tx['maxPriorityFeePerGas']!=TIP):
                raise Stop('JOURNAL_CONFLICT')
        except Stop: raise
        except Exception: raise Stop('JOURNAL_CONFLICT') from None

    def validate(self,data):
        validate_plan(data['plan'])
        if data.get('halted'): raise Stop('RUN_HALTED')
        expected_ids={s['id'] for s in data['plan']['steps']}
        if not set(data['records']).issubset(expected_ids): raise Stop('JOURNAL_CONFLICT')
        for step in data['plan']['steps']:
            record=data['records'].get(step['id'])
            if record: self.validate_record(step,record)
        self.budget(data)
        self.rpc.guard(data['plan']['genesisHash'])

    def budget(self,data,current=None):
        total=0
        for step in data['plan']['steps']:
            record=data['records'].get(step['id'])
            if record and record.get('state') in ('FINALIZED','FAILED'):
                total+=int(record['receipt']['feeWei'])
            elif record and 'tx' in record:
                total+=record['tx']['gas']*record['tx']['maxFeePerGas']
            elif current and current[0]==step['id']:
                total+=current[1]['gas']*current[1]['maxFeePerGas']
            else: total+=step['gasCap']*int(step['maxFeeCap'])
        if total>FEE_CAP: raise Stop('BUDGET_EXCEEDED')
        return total

    def reconcile_locked(self,data):
        try:
            self._reconcile_locked(data)
        except Stop as error:
            if str(error) in ('FINALITY_CONFLICT','TRANSACTION_CONFLICT','RECEIPT_CONFLICT','EVENT_CONFLICT',
                              'DEPLOYMENT_CONFLICT','CODE_CHANGED','CONTRACT_IDENTITY_CHANGED','ROLE_CHANGED','FEE_CONFLICT'):
                data['halted']=True;data['haltReason']=str(error);self.journal.save(data)
            raise

    def _reconcile_locked(self,data):
        for step in data['plan']['steps']:
            record=data['records'].get(step['id'])
            if not record: continue
            receipt=confirmed(self.rpc,data['plan'],step,record)
            if receipt is None: continue
            record.update(receipt=receipt,state='FINALIZED' if receipt['status']==1 else 'FAILED')
            self.journal.save(data)
            if receipt['status']==0: raise Stop('TRANSACTION_FAILED')
        self.budget(data)
        if data['records'].get('deploy',{}).get('state')=='FINALIZED':
            identity(self.rpc,data['plan'],data['records'])

    def public(self,data):
        return {'planHash':data['planHash'],'chainId':10143,'contractAddress':data['plan']['contractAddress'],
                'maximumPlannedFeeWei':data['plan']['maximumPlannedFeeWei'],
                'records':{key:{k:value[k] for k in ('state','hash','receipt') if k in value}
                           for key,value in data['records'].items()}}

    def reconcile(self):
        with self.journal.locked():
            data=self.journal.load();self.validate(data)
            self.reconcile_locked(data)
            return self.public(data)

    def available(self,data,step):
        plan=data['plan'];sender=step['sender'];latest=self.rpc.call('eth_getBlockByNumber',['latest',False])
        height=number(latest['number']);wait_from=[]
        for previous in plan['steps']:
            record=data['records'].get(previous['id'])
            if record and record.get('state')=='FINALIZED' and (previous['sender']==sender or previous['to']==sender):
                wait_from.append(record['receipt']['blockNumber'])
        if not wait_from:
            observation=data['fundingSeen'].get(sender)
            balance=number(self.rpc.call('eth_getBalance',[sender,'latest']))
            if not observation or balance!=observation['balance']:
                data['fundingSeen'][sender]={'block':height,'balance':balance}
                self.journal.save(data)
                raise Stop('WAIT_EXECUTION_DELAY')
            finalized=self.rpc.call('eth_getBlockByNumber',['finalized',False])
            if number(finalized['number'])<observation['block']: raise Stop('WAIT_EXECUTION_DELAY')
            wait_from.append(observation['block'])
        if height<max(wait_from)+plan['executionDelayBlocks']: raise Stop('WAIT_EXECUTION_DELAY')
        if self.rpc.call('eth_getCode',[sender,'latest'])!='0x': raise Stop('DELEGATED_IDENTITY_DENIED')
        if number(self.rpc.call('eth_getTransactionCount',[sender,'latest']))!=step['nonce']:
            raise Stop('NONCE_CONFLICT')
        return latest

    def execute(self,plan_hash,load_account,*,owner=False):
        with self.journal.locked():
            data=self.journal.load();self.validate(data)
            if data['planHash']!=plan_hash: raise Stop('REVIEWED_PLAN_REQUIRED')
            self.reconcile_locked(data)
            for step in data['plan']['steps']:
                record=data['records'].get(step['id'])
                if record:
                    if record['state']!='FINALIZED': raise Stop('UNKNOWN_ONLY_RECONCILE')
                    continue
                break
            else: return self.public(data)
            if (step['role']=='owner')!=owner: raise Stop('OWNER_CLIENT_REQUIRED' if step['role']=='owner' else 'OWNER_STEP_NOT_READY')
            latest=self.available(data,step)
            base=number(latest['baseFeePerGas']);max_fee=(base*125+99)//100+TIP
            if max_fee>MAX_FEE: raise Stop('FEE_CAP_EXCEEDED')
            tx={'chainId':10143,'nonce':step['nonce'],'value':int(step['value']),'data':step['data'],
                'type':2,'maxFeePerGas':max_fee,'maxPriorityFeePerGas':TIP}
            if step['to']: tx['to']=step['to']
            request={key:hex(value) if type(value) is int else value for key,value in tx.items()}
            request['from']=step['sender']
            estimate=number(self.rpc.call('eth_estimateGas',[request]))
            gas=21000 if step['id'].startswith('gas-') else (estimate*10750+9999)//10000
            if gas<estimate or gas>step['gasCap']: raise Stop('GAS_CAP_EXCEEDED')
            tx['gas']=gas;request['gas']=hex(gas)
            self.rpc.call('eth_call',[request,'latest'])
            self.budget(data,(step['id'],tx))
            balance=number(self.rpc.call('eth_getBalance',[step['sender'],'latest']))
            if balance<tx['value']+gas*max_fee: raise Stop('INSUFFICIENT_FUNDS')
            # First step also reserves deployer funds for all its later transfers and fees.
            if step['id']=='gas-supporter':
                need=sum(int(s['value'])+s['gasCap']*MAX_FEE for s in data['plan']['steps'] if s['role']=='deployer')
                if balance<need: raise Stop('INSUFFICIENT_PLAN_FUNDS')
            account=load_account(step['role'])
            if account.address.lower()!=step['sender'].lower(): raise Stop('SIGNER_MISMATCH')
            # Persist a signing boundary too: a crash here cannot cause a new signature on restart.
            record={'state':'SIGNING_STARTED','tx':tx,'estimatedGas':estimate,'balanceBeforeWei':str(balance)}
            if step['id']=='gas-supporter':
                record['balancesBefore']={role:str(number(self.rpc.call('eth_getBalance',[address,'latest'])))
                                          for role,address in data['plan']['addresses'].items()}
            data['records'][step['id']]=record;self.journal.save(data)
            signed=account.sign_transaction(tx)
            record.update(raw=hx(signed.raw_transaction),hash=hx(signed.hash),state='SIGNED')
            self.journal.save(data)
            self.validate_record(step,record)
            self.rpc.guard(data['plan']['genesisHash'])
            if data['records'].get('deploy',{}).get('state')=='FINALIZED':
                identity(self.rpc,data['plan'],data['records'])
            if number(self.rpc.call('eth_getTransactionCount',[step['sender'],'latest']))!=step['nonce']:
                raise Stop('NONCE_CONFLICT')
            if number(self.rpc.call('eth_getBalance',[step['sender'],'latest']))<tx['value']+gas*max_fee:
                raise Stop('INSUFFICIENT_FUNDS')
            record['state']='UNKNOWN';record['broadcastAttempts']=1;self.journal.save(data)
            try:
                returned=self.rpc.call('eth_sendRawTransaction',[record['raw']])
                if returned.lower()!=record['hash'].lower(): raise Stop('RPC_HASH_CONFLICT')
            except Exception:
                # Send errors never imply not sent. Persisted hash/raw are the only recovery target.
                return self.public(data)
            return self.public(data)

    def verify(self):
        with self.journal.locked():
            data=self.journal.load();self.validate(data);self.reconcile_locked(data)
            result=final_accounting(self.rpc,data['plan'],data['records'])
            result['planHash']=data['planHash'];result['transactions']=self.public(data)['records']
            atomic(self.journal.directory/'result-public.json',result)
            return result


def load_main_account(role):
    if role not in ('deployer','supporter','operator'): raise Stop('OWNER_KEY_DENIED')
    data=read_private(DIRECTORY/'keys'/f'{role}.json')
    if data['role']!=role or data['chainId']!=10143: raise Stop('KEY_IDENTITY_INVALID')
    account=Account.from_key(data['privateKey'])
    if account.address!=data['address']: raise Stop('KEY_IDENTITY_INVALID')
    return account


def cli(argv=None,*,owner=False,account_loader=load_main_account):
    parser=argparse.ArgumentParser(description='CP19 isolated testnet tooling; broadcasting requires reviewed plan')
    parser.add_argument('command',choices=('plan','execute','reconcile','verify'))
    parser.add_argument('--plan-hash')
    args=parser.parse_args(argv)
    try:
        runner=Runner(Rpc())
        if args.command=='plan': result=runner.prepare(read_private(DIRECTORY/'addresses.json')['addresses'])
        elif args.command=='execute':
            if not args.plan_hash: raise Stop('REVIEWED_PLAN_REQUIRED')
            result=runner.execute(args.plan_hash,account_loader,owner=owner)
        elif args.command=='reconcile': result=runner.reconcile()
        else: result=runner.verify()
        print(json.dumps(result,indent=2))
    except Stop as error:
        print(json.dumps({'status':'STOPPED','code':str(error)}));return 2
    except Exception:
        print(json.dumps({'status':'STOPPED','code':'INTERNAL_REDACTED'}));return 2
    return 0

if __name__=='__main__': sys.exit(cli())
