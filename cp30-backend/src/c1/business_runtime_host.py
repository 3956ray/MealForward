"""Concrete authority-only IPC host. No owner fund/settle key or general signer."""
from copy import deepcopy
from contextlib import ExitStack,contextmanager
import json,os,signal,threading,time,sys
from pathlib import Path
from .db import Database
from .ipc import Client,Server
from .registration_runtime_host import persistence_module
from .runtime_ledger_controller import RuntimeLedgerControllerClient
from .private_business_host import RuntimeCodec,business_modules
from .live_gateway import module
from .onboarding_adapter import IntegrationRejected,NODE

_diagnostic_times={}
@contextmanager
def diagnostic_stage(role,phase):
    started=time.monotonic()
    try:yield
    except Exception as error:
        now=time.monotonic();key=(role,phase)
        if now-_diagnostic_times.get(key,float('-inf'))>=60:
            _diagnostic_times[key]=now
            allowed={'BUSINESS_CODEC_UNAVAILABLE','DB_UNAVAILABLE','ORIGINAL_RUNTIME_ABORT_CONFLICT','ORIGINAL_RUNTIME_COMMIT_PROOF_REQUIRED','CURRENT_ORIGINAL_APPROVAL_REQUIRED','FINALIZED_FACTS_STALE','PRIVATE_BUSINESS_ROLE_REQUIRED','ORIGINAL_IDENTITY_CHANGED','UNAUTHENTICATED','CSRF','LEDGER_BOOTSTRAP_REQUIRED','PRIVATE_ROLE_PROFILE_MISMATCH'}
            candidate=getattr(error,'code',None) or str(error)
            print('C1_DIAGNOSTIC '+json.dumps({'component':'business_authority','role':role if role in {'quoteAuthority','issuerAuthority','operatorAuthority','catalogAuthority'} else 'unknown','phase':phase if phase in {'admission_material','prepare_quote','admit','execute','sign_quote'} else 'unknown','code':candidate if candidate in allowed else 'PRIVATE_STAGE_FAILED','elapsedMs':max(0,round((now-started)*1000))}),file=sys.stderr,flush=True)
        raise

class QuoteOnlyTransport:
    original_lookup_protocol='CP30_ORIGINAL_OPERATION_V1'
    def broadcast_original(self,*_):raise IntegrationRejected('QUOTE_TRANSACTION_FORBIDDEN',403)
    def lookup_original(self,*_):raise IntegrationRejected('QUOTE_TRANSACTION_FORBIDDEN',403)

class BusinessAdmission:
    def __init__(self,ledger,role,profile,grant_id,codec,broadcaster,clock):
        self.ledger,self.role,self.profile,self.grant_id,self.codec,self.broadcaster,self.clock=ledger,role,deepcopy(profile),grant_id,codec,broadcaster,clock
    def material(self,intent_id):
        with self.ledger.transaction(read_only=True) as tx:return deepcopy(tx.fixed.call('business_admission_material',{'ticket':tx.ticket,'id':intent_id,'grantId':self.grant_id}))
    def ensure(self,intent_id):
        with diagnostic_stage(self.role,'admission_material'):m=self.material(intent_id)
        i,t=m['intent'],m['store'];p=self.profile
        expected='quoteAuthority' if i['action']=='fund' else 'issuerAuthority' if i['action']=='issue' else 'operatorAuthority' if i['action'] in {'lock','markHandover','report'} else 'catalogAuthority' if i['action'] in {'publish','setListed'} else None
        if expected!=self.role or t['profile']['binding']!=p['binding']:raise IntegrationRejected('PRIVATE_ROLE_PROFILE_MISMATCH',403)
        if m['approval'] is not None:return m['approval']['original']
        record={key:deepcopy(p[key]) for key in ('namespace','binding','escrowCodeHash','chainProfileDigest')}
        record.update(intentId=i['id'],subject=i['subject'])
        if self.role=='quoteAuthority':
            quote={k:v for k,v in i['parameters'].items() if k!='opId'};quote['quoteId']=i['op_id']
            with diagnostic_stage(self.role,'prepare_quote'):
                prepared=self.codec.business.call('prepareFundingQuote',{'binding':p['binding'],'quote':quote,'now':str(self.clock())})
            record.update(quoteId=i['op_id'],quote=prepared['quote'],typedData=prepared['typedData'],digest=prepared['digest'])
            initial={'original':record,'prepared':prepared,'stage':'QUOTE_SIGNING','reservation':m['grant']};observed=None
        else:
            deployment=self.codec.business.call({'publish':'preparePublish','setListed':'prepareSetListed','issue':'prepareIssue','lock':'prepareLock','markHandover':'prepareMarkHandover','report':'prepareReport'}[i['action']],{'binding':p['binding'],'caller':p['binding'][self.role],'parameters':i['parameters'],'now':str(self.clock())})
            observed=self.broadcaster.pending_nonce()
            record.update(operation=i['action'],opId=i['op_id'],parameters=i['parameters'],deployment=deployment,transaction={'nonce':str(max(int(observed),int(m['nextNonce']))),'gas':p['maxGas'],'maxFeePerGas':p['maxFeePerGas'],'maxPriorityFeePerGas':p['maxPriorityFeePerGas']})
            # Actual envelope validation precedes granting/starting any signature.
            self.codec.crypto.prepare_original_envelope(deployment,{'type':'eip1559',**record['transaction'],'gasBudgetWei':m['grant']['gasUnits']})
            initial={'original':record,'stage':'TRANSACTION_SIGNING','reservation':m['grant']}
        approval={'original':record,'revision':1,'profile':{key:deepcopy(p[key]) for key in ('binding','escrowCodeHash','chainProfileDigest')},'grant':m['grant']}
        with diagnostic_stage(self.role,'admit'):
            with self.ledger.transaction() as tx:
                tx.fixed.call('business_admit',{'ticket':tx.ticket,'id':intent_id,'grantId':self.grant_id,'approval':approval,'initialRow':initial,'expectedRevision':i['revision'],'observedNonce':observed});tx.dirty=True
        return record
    def before_broadcast(self,record):
        with self.ledger.transaction(read_only=True) as tx:tx.fixed.call('business_fence',{'ticket':tx.ticket,'id':record['intentId'],'grantId':self.grant_id,'record':record})

class BusinessRuntimeHost:
    def __init__(self,namespace,role,domain,admission):self.namespace,self.role,self.domain,self.admission=namespace,role,domain,admission
    def handle(self,namespace,method,request,*,role=None):
        if namespace!=self.namespace or role!='business_client':return {'error':'IPC_FORBIDDEN','status':403}
        if method=='setup' and request=={}:return {'status':'CONFIGURED','role':self.role,'authority':'ORIGINAL_ONLY'}
        if method not in {'execute_original','lookup_original'} or set(request)!={'intentId'}:return {'error':'IPC_BAD_REQUEST','status':400}
        try:
            if method=='execute_original':
                with diagnostic_stage(self.role,'execute'):record=self.admission.ensure(request['intentId'])
            else:
                material=self.admission.material(request['intentId']);approval=material.get('approval')
                if approval is None:return {'signature':None} if self.role=='quoteAuthority' else {'transactionHash':None}
                record=approval['original']
            if self.role=='quoteAuthority':
                if method=='execute_original':
                    with diagnostic_stage(self.role,'sign_quote'):result=self.domain.sign_original_quote(record)
                else:
                    # Domain sign_original_quote can reserve/sign an absent record;
                    # use the already retained signer response only for lookup.
                    with self.domain.ledger.transaction(read_only=True) as tx:
                        current=self.domain._approval(tx,record,'quote_lookup');row=tx.get(self.domain._key(record,quote=True))
                    if row is None:result=None
                    elif row.get('signature'):result=self.domain._retained_quote(record,row)
                    else:
                        signature=self.domain.signer.lookup_original_quote(record)
                        if signature is None:result=None
                        else:
                            if self.domain.codec.verify_quote_signature(record,row['prepared'],signature) is not True:raise IntegrationRejected('ORIGINAL_SIGNATURE_CONFLICT',503)
                            retained,_=self.domain._commit_result(self.domain._key(record,quote=True),record,current,{'signature':signature},quote=True);result=retained['signature']
                return {'signature':result}
            result=(self.domain.send_original if method=='execute_original' else self.domain.lookup_original)(record)
            return {'transactionHash':result,'locatorOnly':True}
        except Exception:return {'error':'ORIGINAL_PRIVATE_UNKNOWN','status':503}

def compose(config):
    if config.get('mode')!='CP30_BUSINESS_RUNTIME' or config.get('enabled') is not True:raise IntegrationRejected('BUSINESS_RUNTIME_NOT_CONFIGURED',503)
    resources=[]
    try:
        role=config['role'];profile=config['profile'];namespace=profile['namespace'];db=Database(config,config['runtimeRole'],'runtime_internal',max_size=1);resources.append(db)
        controller=RuntimeLedgerControllerClient(Client(config['runtimeController']['path'],config['runtimeController']['cap'],timeout=5))
        leaf=persistence_module();ledger=leaf.PgRuntimeLedger(db,namespace,controller);codec=RuntimeCodec();holder={}
        if role=='quoteAuthority':broadcaster=QuoteOnlyTransport()
        else:broadcaster=module('original_broadcaster').DedicatedBusinessBroadcaster(role=role,profile={**profile,'genesisHash':config['genesisHash']},business_codec=codec.business,transaction_crypto=codec.crypto,rpc_config=config['rpc'],before_broadcast=lambda record:holder['admission'].before_broadcast(record),node_executable=NODE)
        admission=BusinessAdmission(ledger,role,profile,config['grantId'],codec,broadcaster,lambda:int(time.time()));holder['admission']=admission
        signer_leaf=module('original_signer');journal=signer_leaf.AuthorityOriginalJournal(config['runtimeDirectory'],role=role,profile=profile);resources.append(journal)
        worker=signer_leaf.DedicatedEOAWorker(journal=journal,key_handle=config['keyHandle'],node_executable=NODE)
        signer=signer_leaf.DedicatedBusinessSigner(role=role,profile=profile,journal=journal,business_codec=codec.business,transaction_crypto=codec.crypto,worker=worker,clock=lambda:int(time.time()))
        domain=business_modules()['private_runtime'].PrivateBusinessRuntime(policy=leaf.PgRuntimePolicy(),ledger=ledger,signer=signer,broadcaster=broadcaster,codec=codec,clock=lambda:int(time.time()),expected_role=role)
        return BusinessRuntimeHost(namespace,role,domain,admission),resources
    except BaseException:
        for resource in reversed(resources):resource.close()
        raise

def main():
    import argparse
    from .private_connection_config import load
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args()
    if os.environ:raise SystemExit('EMPTY_ENVIRONMENT_REQUIRED')
    config=load(args.config)
    with ExitStack() as stack:
        if config.get('mode')=='CP30_BUSINESS_SUITE' and config.get('enabled') is True:
            hosts={};capabilities={}
            for authority,value in config['services'].items():
                host,resources=compose(value);hosts['business_'+authority]=host
                for resource in resources:stack.callback(resource.close)
                capabilities['business_'+authority]={'cap':value['client_cap'],'methods':['setup','execute_original','lookup_original']}
            def handle(namespace,method,request,*,role=None):
                host=hosts.get(role)
                return host.handle(namespace,method,request,role='business_client') if host else {'error':'IPC_FORBIDDEN','status':403}
        else:
            host,resources=compose(config)
            for resource in resources:stack.callback(resource.close)
            capabilities={'business_client':{'cap':config['client_cap'],'methods':['setup','execute_original','lookup_original']}}
            handle=host.handle
        server=Server(config['socket_path'],capabilities,handle,max_handlers=2);stack.callback(server.server_close)
        event=threading.Event();signal.signal(signal.SIGTERM,lambda *_:event.set());signal.signal(signal.SIGINT,lambda *_:event.set())
        thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.1),daemon=True);thread.start()
        try:event.wait()
        finally:server.shutdown();thread.join(timeout=5)

if __name__=='__main__':main()
