"""Actual ABI-shaped memory values only; no observer/RPC/Node/PG execution."""
from copy import deepcopy
import unittest
from projection import (observer_record,projection_rows,finalized_snapshot_rows,
                        ProjectionRejected,ZERO_WORD,ZERO_ADDRESS)

def word(n):return '0x'+format(n,'064x')
def address(n):return '0x'+format(n,'040x')
INTENT='00000000-0000-0000-0000-000000000001'
MEAL=word(1);BATCH=word(2);VOUCHER=word(3);OP=word(4);TERMS=word(5);PAYLOAD=word(6)
ALIASES={MEAL:'meal-1'}


def snapshot(bucket='1'):
    funded=bucket is not None;generation='0' if bucket in ('0',None) else '1'
    counts=['0']*5;amounts=['0']*5
    if funded:counts[int(bucket)]='1';amounts[int(bucket)]='100'
    v={'unitSeq':'0','generation':'1','termsHash':TERMS,'issuedAt':'100','expiresAt':'259300',
       'issuer':address(7),'lockId':word(10) if bucket=='3' else ZERO_WORD,'lockedAt':'100' if bucket=='3' else '0',
       'operator':address(8) if bucket=='3' else ZERO_ADDRESS,'processor':address(9) if bucket=='3' else ZERO_ADDRESS,
       'markerId':word(11) if bucket=='3' else ZERO_WORD,'handoverRecordedAt':'100' if bucket=='3' else '0',
       'handoverBlock':'10' if bucket=='3' else '0','reportId':word(12) if bucket=='3' else ZERO_WORD,
       'settleId':word(13) if bucket=='3' else ZERO_WORD,'expired':False}
    b={'payer':address(2),'mealId':MEAL,'version':'1','termsHash':TERMS,'unitPrice':'100',
       'quantity':'1','firstUnit':'0','refundedMask':'0'}
    u={'seq':'0','batchId':BATCH,'localIndex':'0','payer':address(2),'mealId':MEAL,'version':'1',
       'termsHash':TERMS,'unitPrice':'100','bucket':bucket,'generation':generation,
       'voucherId':VOUCHER if generation=='1' else ZERO_WORD}
    terms={'unitPrice':'100','termsHash':TERMS,'bodyDigest':word(31),'imageDigest':word(32),
           'windowCount':'1','startMinute0':'0','endMinute0':'1440','startMinute1':'0','endMinute1':'0'}
    return {'chainId':10143,'escrow':address(1),'blockNumber':'10','blockHash':word(20),'timestamp':'100',
        'accounting':{'fundedUnits':'1' if funded else '0','fundedAmount':'100' if funded else '0','counts':counts,
                      'amounts':amounts,'liability':'100' if bucket in ('0','1','2') else '0'},
        'units':[u] if funded else [],'batches':{BATCH:b} if funded else {},
        'vouchers':{VOUCHER:v} if generation=='1' else {},'operations':{},
        'menu':{MEAL:{'currentVersion':'1','listed':True,'candidate':{'available':bucket=='0','unitSeq':'0',
                    'nextGeneration':'1' if bucket=='0' else '0','termsHash':TERMS if bucket=='0' else ZERO_WORD,
                    'needsExpiry':False},'terms':deepcopy(terms)}},
        'controls':{'paused':False,'closed':False,'revision':'0'},
        'terms':[{'mealId':MEAL,'version':'1',**terms}] if funded else [],
        'authority':'CANONICAL_FINALIZED_CHAIN_FACTS'}


def issue_proof(bucket='1'):
    facts=snapshot(bucket)
    operation={'kind':'5','caller':address(7),'payloadHash':PAYLOAD,'result':VOUCHER,'executedAt':'100'}
    facts['operations']={OP:deepcopy(operation)}
    params={'opId':OP,'mealId':MEAL,'expectedUnitSeq':'0','expectedNextGeneration':'1',
            'expectedTermsHash':TERMS,'deadline':'200'}
    record=observer_record('issue',params,{'chainId':10143,'from':address(7),'to':address(1),
                           'value':'0','data':'0x11223344','callDataDigest':word(21)},PAYLOAD)
    return {'original':record,'transactionHash':word(22),'chainId':10143,'escrow':address(1),
        'blockHash':word(20),'blockNumber':'10','logIndex':'0',
        'event':{'eventName':'Issued','logIndex':'0','args':{'voucherId':VOUCHER,'unitSeq':'0',
            'generation':'1','termsHash':TERMS,'issuedAt':'100','expiresAt':'259300'}},
        'operation':operation,'snapshot':facts,'authority':'VERIFIED_ORIGINAL_CHAIN_OPERATION'}


class ProjectionTests(unittest.TestCase):
    def test_receipt_and_full_same_block_rows_preserve_originals(self):
        proof=issue_proof('3');original=deepcopy(proof)
        result=projection_rows(proof,INTENT,'store-1',ALIASES)
        self.assertEqual(result['units'][0]['bucket'],'S')
        self.assertEqual(result['units'][0]['price'],'100')
        self.assertEqual(result['units'][0]['report_id'],word(12))
        self.assertEqual(result['vouchers'][0]['marker_at'],'100')
        self.assertEqual(result['vouchers'][0]['handover_block'],'10')
        self.assertEqual(result['vouchers'][0]['settle_id'],word(13))
        self.assertEqual(result['batches'][0]['id'],BATCH)
        self.assertEqual(result['receipt']['original'],proof['original'])
        for field in ('transactionHash','blockHash','blockNumber','logIndex'):
            self.assertEqual(result['receipt'][field],proof[field])
        self.assertEqual(result['receipt']['opId'],OP)
        self.assertEqual(result['receipt']['payloadHash'],PAYLOAD)
        self.assertEqual(result['receipt']['proof'],proof)
        self.assertEqual(result['accounting']['totals']['S'],'100')
        self.assertNotIn('balance',result['accounting']['totals'])
        self.assertNotIn('order_id',result['units'][0])
        result['receipt']['original']['parameters']['deadline']='999'
        self.assertEqual(proof,original)

    def test_unverified_incomplete_or_wrong_binding_rejected(self):
        for change in ('authority','block','payload','log','alias','incomplete'):
            proof=issue_proof();aliases=ALIASES
            if change=='authority':proof['authority']='OBSERVATION_ONLY'
            if change=='block':proof['snapshot']['blockHash']=word(99)
            if change=='payload':proof['operation']['payloadHash']=word(99)
            if change=='log':proof['event']['logIndex']='1'
            if change=='alias':aliases={word(99):'meal-1'}
            if change=='incomplete':proof['snapshot']['units']=[]
            with self.subTest(change=change),self.assertRaises(ProjectionRejected):
                projection_rows(proof,INTENT,'store-1',aliases)
        record=issue_proof()['original']
        with self.assertRaisesRegex(ProjectionRejected,'ORIGINAL_DEPLOYMENT_REQUIRED'):
            observer_record(record['functionName'],record['parameters'],
                            {**record['deployment'],'success':True},record['payloadHash'])

    def test_fund_and_initial_empty_facts_never_fabricate_operations(self):
        proof=issue_proof();facts=snapshot('0')
        q={'quoteId':word(30),'payer':address(2),'mealId':MEAL,'currentVersion':'1','termsHash':TERMS,
           'quantity':'1','unitPrice':'100','amount':'100','deadline':'200'}
        proof['original']=observer_record('fund',{'quote':q,'signature':'0x'+'11'*65},
            {**proof['original']['deployment'],'from':q['payer']},PAYLOAD)
        proof['operation']=None;proof['snapshot']=facts
        proof['event']={'eventName':'Funded','logIndex':'0','args':{'quoteId':q['quoteId'],'batchId':BATCH,
            'payer':q['payer'],'mealId':MEAL,'version':'1','termsHash':TERMS,'unitPrice':'100','quantity':'1',
            'firstUnit':'0','amount':'100'}}
        result=projection_rows(proof,INTENT,'store-1',ALIASES)
        self.assertIsNone(result['receipt']['opId']);self.assertEqual(result['receipt']['quoteId'],q['quoteId'])
        empty=snapshot(None)
        empty['operations']={OP:{'kind':'0','caller':ZERO_ADDRESS,'payloadHash':ZERO_WORD,'result':ZERO_WORD,'executedAt':'0'}}
        initial=finalized_snapshot_rows(empty,'store-1',ALIASES)
        self.assertNotIn('receipt',initial);self.assertEqual(initial['units'],[])
        self.assertEqual(initial['accounting']['totals']['F'],'0')
        self.assertFalse(initial['operations'][0]['present'])
        expired=snapshot('1');expired['timestamp']='259300';expired['units'][0]['bucket']='0'
        expired['vouchers'][VOUCHER]['expired']=True
        expired['accounting']['counts']=['1','0','0','0','0'];expired['accounting']['amounts']=['100','0','0','0','0']
        expired['menu'][MEAL]['candidate'].update(available=True,nextGeneration='2',termsHash=TERMS)
        expired['operations']={OP:{'kind':'10','caller':address(7),'payloadHash':PAYLOAD,'result':ZERO_WORD,'executedAt':'259300'}}
        present=finalized_snapshot_rows(expired,'store-1',ALIASES)
        self.assertTrue(present['operations'][0]['present'])
        self.assertEqual(present['operations'][0]['result'],ZERO_WORD)


if __name__=='__main__':unittest.main()
