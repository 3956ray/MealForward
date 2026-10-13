"""Pure tests: independent expected original-price counts/deltas and refusal vectors."""
import copy
import unittest
from c1.model import (ModelError,TTL,accounting,initial_snapshot,integer,keccak256,
    terms_hash,transition,window_end,next_candidate,batch_hash)
from c1.reconciler import ReceiptValidator
from c1.source import Source
from c1.worker import Worker


def address(i):return '0x'+format(i,'040x')
def identity(i):return '0x'+format(i,'064x')
MANIFEST={'namespace':'unit-test','chain_id':31337,'store_id':identity(1),'escrow':address(10),
    'asset':address(11),'owner':address(12),'receiver':address(12),'catalog':address(13),
    'issuer':address(14),'operator':address(15),'quote':address(16),'rule_version':'S0b',
    'config_digest':'test-only','deployment_generation':1,'baseline':'test-only'}
MEAL=identity(100)

def terms(price,version=1,windows=None,meal=MEAL):
    t={'price':str(price),'terms_hash':'pending','body_digest':identity(200+version),
       'image_digest':identity(300+version),'windows':windows or [[0,1440]],
       'body_available':True,'image_available':True}
    t['terms_hash']=terms_hash(MANIFEST,meal,version,t)
    return t

def fixture(price=7,now=100):
    return initial_snapshot(MANIFEST,{MEAL:{'1':terms(price)}},{address(20):'1000',address(10):'0',address(12):'0'},now)

def operation(i,kind,payload,caller=None):
    caller=caller or {'fund':address(20),'refund':address(20),'publish':address(13),
        'listed':address(13),'paused':address(13),'close':address(13),'issue':address(14),
        'expire':address(14),'settle':address(12)}.get(kind,address(15))
    return {'op_id':identity(i),'kind':kind,'caller':caller,'payload':payload}

def fund(i,snapshot,quantity=1,batch=None):
    v=snapshot['heads'][MEAL]['version'];t=snapshot['catalog'][MEAL][str(v)]
    return operation(i,'fund',{'meal_id':MEAL,'version':v,'terms_hash':t['terms_hash'],
       'quantity':quantity,'unit_price':t['price'],'amount':str(int(t['price'])*quantity),'deadline':snapshot['now']+100,
       'batch_id':batch or batch_hash(MANIFEST,identity(i+2000)),'quote_id':identity(i+2000)})

def issue(i,snapshot):
    u=next_candidate(snapshot,MEAL)
    return operation(i,'issue',{'meal_id':MEAL,'expected_unit_seq':u['seq'],
        'expected_next_generation':u['generation']+1,'expected_terms_hash':u['terms_hash'],'deadline':snapshot['now']+100})

def voucher_op(i,kind,u,now):
    p={'voucher_id':u['voucher_id'],'generation':u['generation']}
    if kind in ('lock','handover'):p['deadline']=now+30
    if kind in ('handover','report'):p['lock_id']=u['lock']['id']
    if kind=='report':p['marker_id']=u['marker']['id']
    return operation(i,kind,p)

def execute(s,op):return transition(s,op)['after']
def receipt(value):
    before,after=value['before'],value['after']
    return {'receipt_id':value['operation']['op_id'],'scope':MANIFEST,'source_epoch':before['source_epoch'],
        'height':after['height'],'block_hash':after['parent'],'parent':before['parent'],'now':value['t0'],
        'complete_to':after['height'],'tx_index':0,'logs':[{'log_index':i,'event':event} for i,event in enumerate(value['events'])],
        'operation':value['operation'],'transition':value,'final':True}

class ModelTests(unittest.TestCase):
    def test_keccak_independent_known_answers(self):
        self.assertEqual(keccak256(b'').hex(),'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
        self.assertEqual(keccak256(b'abc').hex(),'4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45')

    def test_canonical_money_rejects_rounding_and_boolean(self):
        for value in ['01','+1','-0','1.0','1e2',' 1',True,1,'',str(1<<256)]:
            with self.subTest(value=value),self.assertRaises(ModelError):integer(value)
        self.assertEqual(integer('0'),0)

    def test_independent_original_price_golden_trajectory(self):
        s=fixture();s=execute(s,fund(1,s,2))
        s=execute(s,operation(2,'publish',{'expected_control_revision':0,'meal_id':MEAL,'version':2,'terms':terms(3,2)}))
        s=execute(s,fund(3,s,3))
        s=execute(s,issue(4,s))
        for i,k in [(5,'lock'),(6,'handover'),(7,'report'),(8,'settle')]:s=execute(s,voucher_op(i,k,s['units'][0],s['now']))
        s=execute(s,issue(9,s));s['now']+=TTL
        s=execute(s,voucher_op(10,'expire',s['units'][1],s['now']))
        s=execute(s,operation(11,'refund',{'batch_id':s['units'][1]['batch_id'],'mask':2}))
        s=execute(s,issue(12,s))
        for i,k in [(13,'lock'),(14,'handover'),(15,'report')]:s=execute(s,voucher_op(i,k,s['units'][2],s['now']))
        s=execute(s,issue(16,s))
        self.assertEqual(accounting(s),{'amounts':{'F':'23','A':'3','R':'3','H':'3','S':'7','X':'7'},
            'counts':{'F':5,'A':1,'R':1,'H':1,'S':1,'X':1},'liability':'9'})
        self.assertEqual(s['balances'][address(10)],'9')
        self.assertEqual(s['balances'][address(12)],'7')
        self.assertEqual(s['balances'][address(20)],'984')

    def test_safe_expiry_entire_store_and_reject_rollback(self):
        s=fixture();s=execute(s,fund(1,s,3));s=execute(s,issue(2,s));s=execute(s,issue(3,s))
        # Different meal unit remains part of the whole-store normalization scan.
        other=identity(101);s['catalog'][other]={'1':terms(7,meal=other)};s['heads'][other]={'version':1,'listed':True}
        s['units'][1]['meal_id']=other;s['units'][1]['terms_hash']=s['catalog'][other]['1']['terms_hash']
        s['now']+=TTL
        before=copy.deepcopy(s);bad=issue(4,s);bad['payload']['expected_unit_seq']=2
        with self.assertRaisesRegex(ModelError,'STALE_CANDIDATE'):transition(s,bad)
        self.assertEqual(s,before)
        good=transition(s,issue(5,s))
        self.assertEqual([e['seq'] for e in good['events'] if e['event']=='Expired'],[0,1])
        self.assertEqual([u['state'] for u in good['after']['units']],['R','A','A'])
        self.assertEqual(good['after']['units'][0]['generation'],2)

    def test_lowest_original_missing_content_cannot_skip(self):
        s=fixture();s=execute(s,fund(1,s,2));s['catalog'][MEAL]['1']['image_available']=False
        with self.assertRaisesRegex(ModelError,'CONTENT_UNAVAILABLE'):transition(s,issue(2,s))
        self.assertEqual(next_candidate(s,MEAL)['seq'],0)
        self.assertEqual(accounting(s)['amounts']['A'],'14')

    def test_same_key_history_no_guard_no_effect_but_exact_caller(self):
        s=fixture();op=fund(1,s);value=transition(s,op);s=value['after'];s['now']+=TTL
        s['controls']['paused']=True;s['controls']['closed']=True
        historical=transition(s,op)
        self.assertTrue(historical['noop']);self.assertEqual(historical['events'],[])
        self.assertEqual(historical['t0'],100);self.assertEqual(historical['after'],s)
        bad=copy.deepcopy(op);bad['payload']['quantity']=2
        with self.assertRaisesRegex(ModelError,'IDEMPOTENCY_CONFLICT'):transition(s,bad)
        s=fixture();s=execute(s,fund(1,s));op=issue(2,s);s=execute(s,op);bad=copy.deepcopy(op);bad['caller']=MANIFEST['owner']
        with self.assertRaisesRegex(ModelError,'WRONG_CALLER'):transition(s,bad)

    def test_cap_lifetime_survives_refund(self):
        s=fixture();s=execute(s,fund(1,s,10));s=execute(s,operation(2,'refund',{'batch_id':s['units'][0]['batch_id'],'mask':1023}))
        with self.assertRaisesRegex(ModelError,'LIFETIME_CAP'):transition(s,fund(3,s))
        self.assertEqual(accounting(s)['counts']['F'],10)

    def test_locked_marker_never_expire_and_late_report_after_close_pause(self):
        s=fixture();s=execute(s,fund(1,s));s=execute(s,issue(2,s));s=execute(s,voucher_op(3,'lock',s['units'][0],s['now']))
        original=s['units'][0]['expires_at'];s['now']=original
        with self.assertRaisesRegex(ModelError,'UNSAFE_EXPIRY'):transition(s,voucher_op(4,'expire',s['units'][0],s['now']))
        s['now']=100;s=execute(s,voucher_op(5,'handover',s['units'][0],s['now']))
        s['now']=original+1;s['controls'].update(paused=True,closed=True);s['heads'][MEAL]['listed']=False
        s=execute(s,voucher_op(6,'report',s['units'][0],s['now']));s=execute(s,voucher_op(7,'settle',s['units'][0],s['now']))
        self.assertEqual(s['units'][0]['state'],'S');self.assertEqual(s['units'][0]['expires_at'],original)

    def test_original_window_seconds_and_boundaries(self):
        t=terms(7,windows=[[600,660],[660,720]])
        # UTC+8 local 10:00 starts at UTC02:00.
        self.assertIsNone(window_end(t,7199));self.assertEqual(window_end(t,7200),10800)
        self.assertEqual(window_end(t,10799),10800);self.assertEqual(window_end(t,10800),14400)
        self.assertIsNone(window_end(t,14400))
        self.assertEqual(window_end(terms(7),57599),57600)
        s=fixture(now=7200);s['catalog'][MEAL]['1']=t;s=execute(s,fund(1,s));s=execute(s,issue(2,s))
        u=s['units'][0];s['now']=14400
        with self.assertRaisesRegex(ModelError,'OUTSIDE_WINDOW'):transition(s,voucher_op(3,'lock',u,s['now']))
        s['now']=u['expires_at']
        with self.assertRaisesRegex(ModelError,'EXPIRED'):transition(s,voucher_op(4,'lock',u,s['now']))

    def test_control_cas_irreversible_close_old_rights(self):
        s=fixture();s=execute(s,fund(1,s));s=execute(s,issue(2,s))
        s=execute(s,operation(3,'close',{'expected_control_revision':0}))
        with self.assertRaisesRegex(ModelError,'NOT_OPERATING'):transition(s,fund(4,s))
        s=execute(s,voucher_op(5,'lock',s['units'][0],s['now']))
        self.assertTrue(s['controls']['closed'])
        with self.assertRaisesRegex(ModelError,'STALE_CONTROL'):transition(s,operation(6,'paused',{'expected_control_revision':0,'paused':True}))
        with self.assertRaisesRegex(ModelError,'ALREADY_CLOSED'):transition(s,operation(7,'close',{'expected_control_revision':1}))

    def test_refund_all_bits_atomic_and_exact_payer(self):
        s=fixture();s=execute(s,fund(1,s,2));s=execute(s,issue(2,s));before=copy.deepcopy(s)
        for mask in (3,4,0):
            with self.assertRaises(ModelError):transition(s,operation(3+mask,'refund',{'batch_id':s['units'][0]['batch_id'],'mask':mask}))
        self.assertEqual(s,before)
        with self.assertRaisesRegex(ModelError,'WRONG_PAYER'):transition(s,operation(9,'refund',{'batch_id':s['units'][0]['batch_id'],'mask':2},MANIFEST['owner']))

    def test_transfer_failure_and_uint_bound_no_partial(self):
        s=fixture();s['balances'][address(20)]='6';before=copy.deepcopy(s)
        with self.assertRaisesRegex(ModelError,'TRANSFER_FAILED'):transition(s,fund(1,s))
        self.assertEqual(s,before)
        s=fixture();s['now']=(1<<256)-1
        with self.assertRaises(ModelError):transition(s,fund(2,s))

class ObserverTests(unittest.TestCase):
    def chain(self):
        s=fixture();a=transition(s,fund(1,s));b=transition(a['after'],issue(2,a['after']))
        return receipt(a),receipt(b)

    def test_order_gap_then_apply_and_100_exact_replays(self):
        a,b=self.chain();v=ReceiptValidator(MANIFEST)
        self.assertEqual(v.validate(b,now=100),'GAP');self.assertEqual(v.height,0)
        self.assertEqual(v.validate(a,now=100),'VALID');v.advance(a)
        self.assertEqual(v.validate(b,now=100),'VALID');v.advance(b)
        for _ in range(100):self.assertEqual(v.validate(b,now=100),'NOOP')
        self.assertEqual(v.height,2)

    def test_replayed_old_original_after_new_clock_and_restart(self):
        a,b=self.chain();v=ReceiptValidator(MANIFEST)
        v.advance(a);v.advance(b);v.clock_floor=200
        self.assertEqual(v.validate(a,now=200),'NOOP')
        restarted=ReceiptValidator(MANIFEST,height=v.height,parent=v.parent,clock_floor=v.clock_floor,accepted=v.accepted)
        self.assertEqual(restarted.validate(a,now=200),'NOOP')
        poison=copy.deepcopy(a);poison['receipt_id']='contradiction'
        with self.assertRaisesRegex(ModelError,'FINAL_CONFLICT'):restarted.validate(poison,now=200)

    def test_poison_fields_halt_without_watermark(self):
        a,b=self.chain()
        changes=[('scope',{**MANIFEST,'chain_id':1}),('source_epoch',2),('parent','wrong'),
            ('block_hash','wrong'),('complete_to',0),('tx_index',1),('final',False),('now',103)]
        for field,value in changes:
            with self.subTest(field=field):
                poison=copy.deepcopy(a);poison[field]=value;v=ReceiptValidator(MANIFEST)
                with self.assertRaises((ModelError,ValueError)):v.validate(poison,now=100)
                self.assertTrue(v.halted);self.assertEqual(v.height,0)
        poison=copy.deepcopy(a);poison['transition']['after']['units'][0]['price']='8'
        with self.assertRaisesRegex(ModelError,'TRANSITION_MISMATCH'):ReceiptValidator(MANIFEST).validate(poison,now=100)

    def test_restart_accepts_unapplied_original_after_72h_without_changing_t0(self):
        a,b=self.chain();prior=ReceiptValidator(MANIFEST)
        self.assertEqual(prior.validate(a,now=100),'VALID');prior.advance(a)
        restarted=ReceiptValidator(MANIFEST,height=prior.height,parent=prior.parent,
            clock_floor=prior.clock_floor,service_floor=259301,accepted=prior.accepted)
        self.assertEqual(restarted.validate(b,now=259301),'VALID')
        restarted.advance(b)
        self.assertEqual(b['transition']['t0'],100)
        self.assertEqual(b['transition']['after']['units'][0]['expires_at'],259300)
        self.assertEqual(restarted.validate(b,now=259301),'NOOP')
        with self.assertRaisesRegex(ModelError,'CLOCK_ROLLBACK'):restarted.validate(b,now=259300)

    def test_clock_skew_2_allowed_3_denied_rollback_denied(self):
        s=fixture(now=102);a=receipt(transition(s,fund(1,s)))
        self.assertEqual(ReceiptValidator(MANIFEST).validate(a,now=100),'VALID')
        with self.assertRaisesRegex(ModelError,'SOURCE_CLOCK'):ReceiptValidator(MANIFEST).validate(a,now=99)
        with self.assertRaisesRegex(ModelError,'CLOCK_ROLLBACK'):ReceiptValidator(MANIFEST,clock_floor=100).validate(a,now=99)

class ServiceBoundaryTests(unittest.TestCase):
    def test_unknown_source_query_never_dispatches(self):
        class Authority:
            def __init__(self):self.calls=[]
            def call(self,method,namespace,request):self.calls.append(method);return {'status':'UNKNOWN'}
        class Denied:
            def call(self,*args):raise AssertionError('must not call')
        authority=Authority();source=Source(authority,Denied(),Denied())
        self.assertEqual(source.query('ns','original')['status'],'UNKNOWN')
        self.assertEqual(authority.calls,['ticket_query'])
        self.assertEqual(source.handle('ns','actor',{'ticket_id':'id','actor':address(20)},role='worker')['status'],403)

    def test_source_journal_before_commit_and_final_before_ingest(self):
        s=fixture();op=fund(1,s);calls=[]
        ticket={'ticket_id':'ticket',**op,'payload_hash':None,'source_epoch':1,'fencing_epoch':1,'authorization_digest':'fixed'}
        class Business:
            def call(self,method,namespace,request):
                calls.append(method)
                if method=='source_ticket':return {'ticket':copy.deepcopy(ticket),'manifest':MANIFEST}
                if method=='receipt_ingest':return {'receipt_id':request['receipt']['receipt_id']}
                raise AssertionError(method)
        class Authority:
            def __init__(self):self.registered=None;self.value=None;self.finished=False
            def call(self,method,namespace,request):
                calls.append(method)
                if method=='ticket_register':self.registered=request['ticket'];return {'status':'REGISTERED'}
                if method=='execution_view':return {'snapshot':s,'ticket':self.registered,'revision':0,'requires_actor':True,'actor_confirmed':True}
                if method=='execution_commit':
                    assert 'journal_prepared' in calls
                    self.value=request['transition'];return {'status':'COMMITTED'}
                if method=='execution_proof':return {'committed':True,'sequence':1,'digest':'prepared-digest'}
                if method=='ticket_query':
                    assert self.finished
                    return {'status':'FINAL_SUCCEEDED','receipt':receipt(self.value)}
                raise AssertionError(method)
        a=Authority()
        class Controller:
            def call(self,namespace,method,request):
                if method=='execution_prepare':calls.append('journal_prepared');return {'expected_revision':0,'sequence':1,'digest':'prepared-digest'}
                if method=='execution_finish':
                    assert a.value is not None
                    calls.append('journal_finished');a.finished=True;return {'finished':True}
                raise AssertionError(method)
        outcome=Source(a,Business(),Controller()).dispatch('ns','ticket')
        self.assertEqual(outcome['status'],'FINAL_SUCCEEDED')
        self.assertLess(calls.index('journal_prepared'),calls.index('execution_commit'))
        self.assertLess(calls.index('journal_finished'),calls.index('receipt_ingest'))

    def test_worker_queries_unknown_never_restages(self):
        class Business:
            def __init__(self):self.calls=[]
            def call(self,method,namespace,request):
                self.calls.append((method,request))
                if method=='claim_job':return {'job':{'job_id':'job','ticket_id':'original','status':'UNKNOWN','fencing_epoch':9}}
                if method=='stage_job':raise AssertionError('must not restage unknown')
                return {'status':request.get('status')}
        class Controller:
            def __init__(self):self.calls=[]
            def call(self,namespace,method,request):self.calls.append(method);return {'status':'UNKNOWN'}
        b,c=Business(),Controller();self.assertEqual(Worker(b,c,'w').step('ns')['status'],'UNKNOWN')
        self.assertEqual(c.calls,['source_query']);self.assertEqual(b.calls[-1][1]['fencing_epoch'],9)

    def test_completed_socket_timeout_records_unknown_without_renewing_lease(self):
        import socket
        class Business:
            def __init__(self):self.calls=[]
            def call(self,method,namespace,request):
                self.calls.append((method,request))
                if method=='claim_job':
                    return {'job':{'job_id':'job','ticket_id':'original','status':'UNKNOWN','fencing_epoch':9}}
                if request.get('heartbeat'):raise AssertionError('failed IPC must not renew its lease')
                if method!='job_query':raise AssertionError(method)
                return {'status':request['status']}
        class Controller:
            def call(self,namespace,method,request):raise socket.timeout('synthetic timeout')
        business=Business()
        self.assertEqual(Worker(business,Controller(),'w').step('ns')['status'],'UNKNOWN')
        self.assertEqual([method for method,_ in business.calls],['claim_job','job_query'])
        self.assertEqual(business.calls[-1][1]['ticket_id'],'original')

if __name__=='__main__':unittest.main()
