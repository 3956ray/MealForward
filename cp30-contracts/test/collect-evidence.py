"""Reject missing/failed/vacuous offline evidence and reconcile original-input action models."""
from pathlib import Path
import hashlib,json,re,subprocess
S=Path(__file__).resolve().parents[1];E=S/'evidence'/'s0b';P=S.parent
BASELINE='f1f7de9401e30153a19b255e12a39323c882b4c0'
def read(n):return json.loads((E/n).read_text())
def write(n,v):(E/n).write_text(json.dumps(v,indent=2)+'\n')
def results(n):
    a=[{'suite':suite,'test':test,**r} for suite,v in read(n).items() for test,r in v['test_results'].items()]
    assert a and all(r['status']=='Success' for r in a),n
    return a
def sha(b):return hashlib.sha256(b).hexdigest()
unit=results('unit.json');fuzzC0=results('fuzz-c0.json');fuzzS0b=results('fuzz-s0b.json');fuzz=fuzzC0+fuzzS0b;c0=results('invariant.json');life=results('lifecycle.json')
root=results('historical-root.json');testnet=results('historical-testnet.json');gasResults=results('gas-calls.json')
# Preserve each original directed name; historical static quote constants are still tested.
originalNames=[]
for file in ['Factory.t.sol','Financial.t.sol','Quotes.t.sol','Adversarial.t.sol','Vectors.t.sol','Invariant.t.sol','Gas.t.sol']:
    data=subprocess.run(['git','show',BASELINE+':cp30-contracts/test/'+file],cwd=P,env={'PATH':'/usr/bin:/bin'},capture_output=True,check=True,text=True).stdout
    originalNames+=re.findall(r'function (test\w+)\(',data)
assert len(originalNames)==46 and len(set(originalNames))==46
unitNames={r['test'].split('(')[0] for r in unit};assert set(originalNames)<=unitNames
assert len(fuzzC0)==4 and all(r['kind']['Fuzz']['runs']==2500 for r in fuzzC0)
assert len(fuzzS0b)==2 and all(r['kind']['Fuzz']['runs']==5000 for r in fuzzS0b)
assert sum(r['kind']['Fuzz']['runs'] for r in fuzz)==20000
write('fuzz.json',{**read('fuzz-c0.json'),**read('fuzz-s0b.json')})
assert len(root)==13 and len(testnet)==4

def inv(entries,hook):
    assert len(entries)==1;kind=entries[0]['kind']['Invariant'];assert kind['runs']==64 and kind['calls']==16384 and kind['reverts']==0
    rows=[json.loads(x) for x in (E/hook).read_text().splitlines() if x]
    assert len(rows)==65 and rows[-1]==rows[-2]
    assert all(m['reverts']==0 and m['discards']==0 for m in kind['metrics'].values())
    return kind,rows[:64]
kind,rows=inv(c0,'c0-invariant-actions.jsonl')
keys=['funds','refunds','donations','replays','rejectedTamper','rejectedForeign','rejectedCap','refundNoops']
totals={k:sum(r[k] for r in rows) for k in keys};bootstrap=3*64
c0Actions={
 'fundAction':{'success':totals['funds']-bootstrap,'expectedRejection':totals['rejectedCap'],'noop':0},
 'refundAction':{'success':totals['refunds']-bootstrap,'expectedRejection':0,'noop':totals['refundNoops']},
 'donateAction':{'success':totals['donations']-bootstrap,'expectedRejection':0,'noop':0},
 'replayAction':{'success':totals['replays'],'expectedRejection':0,'noop':0},
 'tamperAction':{'success':0,'expectedRejection':totals['rejectedTamper'],'noop':0},
 'foreignRefundAction':{'success':0,'expectedRejection':totals['rejectedForeign'],'noop':0}}
for name,m in kind['metrics'].items():
    a=c0Actions[name.rsplit('.',1)[1]];assert sum(a.values())==m['calls'];a['attempts']=m['calls']
for r in rows:
    assert r['funds']>3 and r['refunds']>3 and r['donations']>3
    assert r['mealAFunds']>0 and r['mealBFunds']>0 and r['rejectedCap']>0
    assert all(2<=n<=10 for n in r['storeFundedUnits'])
    assert all(0<x<=f for x,f in zip(r['storeRefundedUnits'],r['storeFundedUnits']))
lifeKind,lifeRows=inv(life,'lifecycle-actions.jsonl')
labels=['issue','lock','markHandover','report','settle','expire','refundWithIntent','advanceClock','donation','successfulLookup','wrongRole','pauseResume']
lifeActions={}
for i,label in enumerate(labels):
    v={key:sum(r[col][i] for r in lifeRows) for key,col in [('success','success'),('expectedRejection','rejected'),('noop','noop')]}
    v['attempts']=sum(v.values());v['minMaxSuccessPerRun']=[min(r['success'][i] for r in lifeRows),max(r['success'][i] for r in lifeRows)];lifeActions[label]=v
assert sum(a['attempts'] for a in lifeActions.values())==16384
assert all(lifeActions[label]['success']>0 for label in labels[:10]+labels[11:])
assert lifeActions['wrongRole']['expectedRejection']>0
for r in lifeRows:
    assert sum(r['success'])+sum(r['rejected'])+sum(r['noop'])==256 and r['success'][0]>3
lifeTransitionSuccess=sum(lifeActions[name]['success'] for name in labels[:7])
logs={}
for r in gasResults:
    for line in r['decoded_logs']:
        key,value=line.rsplit(': ',1);logs[key]=int(value)
assert logs['escrow deployed bytes']<=24576 and logs['factory deployed bytes']<=24576
assert logs['escrow init with fixture bytes']<=49152 and logs['factory init with fixture bytes']<=49152
contracts={}
for name in ['StoreEscrow','ThreeStoreFactory']:
    file=S/'out'/'s0b-final'/(name+'.sol')/(name+'.json');a=json.loads(file.read_text())
    deployed=bytes.fromhex(a['deployedBytecode']['object'][2:]);creation=bytes.fromhex(a['bytecode']['object'][2:])
    assert len(deployed)<=24576 and len(creation)<=49152
    contracts[name]={'abi':a['abi'],'methodIdentifiers':a['methodIdentifiers'],'abiSha256':sha(json.dumps(a['abi'],separators=(',',':')).encode()),'artifactSha256':sha(file.read_bytes()),'creationBytes':len(creation),'creationBytecodeSha256':sha(creation),'deployedTemplateBytes':len(deployed),'deployedTemplateSha256':sha(deployed),'limitsEnforced':True,'note':'Compiled runtime template includes zero immutable slots; hash is not a deployed-address attestation.'}
write('contracts.json',contracts)
assert len(read('c0-preservation.json')['unchangedFiles'])==15
write('summary.json',{
 'status':'DEVELOPER_COMPLETE_FOR_INDEPENDENT_REVIEW_NOT_ACCEPTED','baseline':BASELINE,'seed':'0xc030',
 'unit':{'tests':len(unit),'retainedC0Tests':46,'newS0bTests':len(unit)-46,'failures':0,'originalTestNames':originalNames},
 'fuzz':{'cases':20000,'newS0bCases':10000,'retainedC0Cases':10000,'methods':{r['test']:r['kind']['Fuzz']['runs'] for r in fuzz},'failures':0},
 'c0Invariant':{'runs':64,'depth':256,'calls':16384,'unexpectedReverts':0,'hookRows':65,'extraFinalVerificationRow':1,'bootstrapPerRun':{'funds':3,'refunds':3,'donations':3},'randomActions':c0Actions},
 'lifecycleInvariant':{'runs':64,'depth':256,'calls':16384,'unexpectedReverts':0,'hookRows':65,'extraFinalVerificationRow':1,'lifecycleBootstrap':0,'setup':'chosen original inputs: A-v1 price3 qty3; B-v1 price5 qty3; publish A-v2 price7 qty4, F52 and 10 lifetime units','actualRandomLifecycleTransitions':lifeTransitionSuccess,'randomActions':lifeActions,'model':'All original fields, five buckets/counts/amounts, original clocks/generations, exact payer/owner/token balances are checked against independently chosen original inputs and model transitions, never populated from escrow state getters.'},
 'historical':{'rootMethods':13,'rootFuzzCases':sum(r['kind'].get('Fuzz',{}).get('runs',0) for r in root),'testnetNamedOfflineMethods':4,'failures':0},
 'vectors':{'canonicalTermsBodyImageVoucherAnd11AbiPayloads':'independent installed viem plus typed Solidity assertions','C0FixedQuoteSchema':'preserved unchanged synthetic fixed constants'},
 'gas':{'measurement':'Local EVM call incl ABI/call overhead, excludes intrinsic fees; warmth varies within test, not live Monad fees','calls':logs},
 'preservation':'All15 accepted C0 evidence files byte-identical; historical tracked contracts/tests/configs/locks unchanged',
 'notRun':['private DB/API/global-email/login/recovery/QR120s','live canonical/finality/UNKNOWN/backend persistence','actual owner online intent/final-lock revalidation','real asset/network/wallet/deployment/grant/fees','providers/NFT/capacity/track eligibility']})
write('golden.json',{'provenance':'Expected original-input trajectory asserted after actual actions by testGoldenFiveBucketMixedPriceTrajectory in unit.json; no vm.store or arbitrary state injection','originalPrices':[3,3,5,5,7],'F':23,'fundedUnits':5,'donation':2,'columns':['A','R','H','S','X','liability','tokenBalance'],'verifiedExpectedSteps':[[3,8,5,7,0,16,18],[3,3,10,7,0,16,18],[3,3,5,12,0,11,13],[6,0,5,12,0,11,13],[3,0,5,12,3,8,10],[3,0,0,17,3,3,5],[0,0,0,17,6,0,2]]})
paths=[S/'AGENTS.md',S/'README.md',S/'foundry.toml']+[p for d in ('contracts','test') for p in (S/d).rglob('*') if p.is_file() and p.suffix in ('.sol','.py','.mjs')]
write('source-hashes.json',{str(p.relative_to(P)):sha(p.read_bytes()) for p in sorted(paths)})
# Include all final evidence; omit this self-referential manifest and rejected debug attempts.
write('evidence-hashes.json',{p.name:sha(p.read_bytes()) for p in sorted(E.glob('*')) if p.is_file() and p.name!='evidence-hashes.json' and 'debug' not in p.name})
print(json.dumps({'status':'DEVELOPER_COMPLETE_NOT_ACCEPTED','unitTests':len(unit),'retainedC0':46,'fuzzCases':20000,'invariantCalls':32768,'actualLifecycleTransitions':lifeTransitionSuccess,'lifecycleActions':lifeActions,'sizeBounds':{k:v for k,v in logs.items() if 'bytes' in k}},indent=2))
