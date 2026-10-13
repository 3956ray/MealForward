"""Fresh owned true-PG / seven-process HTTPS integration, not acceptance shorthand."""
import argparse,stat,base64,hashlib,http.client,importlib.util,json,os,secrets,signal,ssl,subprocess,sys,time,uuid
from pathlib import Path
from owned import scope,seal,private_file,pg_identity,write_marker,app_identity
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
from c1.db import Database
from c1.fixtures import build
from c1.journal import Journal
from c1.ipc import Client
from c1.content import verify_original
class IntegrationFailure(Exception):pass
class Consumer:
 def __init__(self,origin,cert):self.origin=origin;self.port=int(origin.rsplit(':',1)[1]);self.context=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT);self.context.load_verify_locations(cafile=cert);self.cookie={};self.csrf=''
 def request(self,method,path,data=None,key=None,*,mime=None,revision=None,before_send=None):
  c=http.client.HTTPSConnection('127.0.0.1',self.port,context=self.context,timeout=10);body=data if mime else json.dumps(data or {},separators=(',',':')).encode() if method!='GET' else None;headers={'Origin':self.origin,'Host':'127.0.0.1:'+str(self.port),'Content-Type':mime or 'application/json','X-C1-CSRF':self.csrf,'Idempotency-Key':key or uuid.uuid4().hex,'X-C1-Bootstrap':'1','Cookie':'; '.join(k+'='+v for k,v in self.cookie.items())};headers.update({'X-C1-Draft-Revision':str(revision)} if revision is not None else {});
  if before_send is not None:c.connect();before_send()
  c.request(method,path,body=body,headers=headers);r=c.getresponse();raw=r.read();status=r.status
  if r.getheader('Set-Cookie'):
   pair=r.getheader('Set-Cookie').split(';')[0];name,value=pair.split('=',1);self.cookie[name]=value
  value=json.loads(raw);c.close()
  if value.get('csrf'):self.csrf=value['csrf']
  return status,value
 def ok(self,method,path,data=None,**kwargs):
  status,value=self.request(method,path,data,**kwargs)
  if status!=200:raise IntegrationFailure(path+':'+value.get('error','INVALID')+':'+str(status))
  return value
class Harness:
 def __init__(self,run):
  os.umask(0o077);self.run,marker=scope(run,phases=('INITIALIZED',));self.marker=marker;self.settings=json.loads(private_file(self.run/'runtime-private.json').read_text());self.processes=[];self.namespace='smoke-'+secrets.token_hex(4);self.configs={};self.records=[];self.started=time.time();self.resource_checked=0;self.peak_disk=0;self.source_manifest={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for base in ['src','migrations','tools','consumer'] for p in (ROOT/base).rglob('*') if p.is_file() and '__pycache__' not in p.parts}
  self.b=Database({'db':{'business':self.settings['roles']['c1_controller']}},'business','business',max_size=1);self.a=Database({'db':{'authority':self.settings['roles']['c1_controller_authority']}},'authority','authority',max_size=1)
 def expect(self,value,label):
  if value.get('error'):raise IntegrationFailure(label+':'+value['error'])
  return value
 def start(self):
  run=self.run;seal(run,self.settings['cluster_id']);(run/'scope').write_text(self.namespace);os.chmod(run/'scope',0o600)
  key=secrets.token_bytes(32);(run/'email-key').write_bytes(key);os.chmod(run/'email-key',0o600)
  j=Journal(run/'security.journal',run.name,self.settings['cluster_id'],initialize=True,empty_cluster=True);j.close()
  business,authority=build(self.namespace,run,key)
  self.fixture=business;self.expect(self.b.call('fixture_init',self.namespace,business),'BUSINESS_INIT');self.expect(self.a.call('fixture_init',self.namespace,authority),'AUTHORITY_INIT')
  self.verify_fixture_content(self.namespace,business)
  caps={name:secrets.token_hex(32) for name in ['api','worker','source','fixture','source-controller','source-fixture']};self.caps=caps
  (run/'tls.cnf').write_text('[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=127.0.0.1\n[ext]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n')
  subprocess.run(['/usr/bin/openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-config',str(run/'tls.cnf'),'-keyout',str(run/'tls-key.pem'),'-out',str(run/'tls-cert.pem')],env={},check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  for file in ['tls-key.pem','tls-cert.pem']:os.chmod(run/file,0o600)
  source_capabilities={'controller':{'cap':caps['source-controller'],'methods':['dispatch','query','close']},'fixture':{'cap':caps['source-fixture'],'methods':['actor']}}
  common={'fault_file':str(run/'fault-control.json'),'mode':'C1_SYNTHETIC_LOOPBACK','run':str(run),'namespace':self.namespace,'scope_file':str(run/'scope'),'controller_path':str(run/'controller.sock')}
  roles=self.settings['roles']
  configs={
   'controller':{**common,'run_id':run.name,'cluster_id':self.settings['cluster_id'],'journal_path':str(run/'security.journal'),'socket_path':str(run/'controller.sock'),'namespaces':[],'source':{'path':str(run/'source.sock'),'cap':caps['source-controller']},'capabilities':{name:{'cap':caps[name]} for name in ['api','worker','source','fixture']},'db':{'business':roles['c1_controller'],'authority':roles['c1_controller_authority']}},
   'source':{**common,'source_path':str(run/'source.sock'),'controller_cap':caps['source'],'capabilities':source_capabilities,'db':{'source_ingest':roles['c1_source_ingest'],'source_authority':roles['c1_source_service']}},
   'reconciler':{**common,'manifest':business['manifest']['stores']['S1'],'manifests':business['manifest']['stores'],'db':{'reconciler':roles['c1_reconciler'],'reconciler_authority':roles['c1_reconciler_authority']}},
  }
  cursor=secrets.token_hex(32)
  for i in ['a','b']:
   configs['api_'+i]={**common,'controller_cap':caps['api'],'db':{'api':roles['c1_api_'+i]},'cursor_key':cursor,'certfile':str(run/'tls-cert.pem'),'keyfile':str(run/'tls-key.pem'),'bound_file':str(run/('api_'+i+'-bound.json'))}
   configs['worker_'+i]={**common,'controller_cap':caps['worker'],'worker_id':i,'db':{'worker':roles['c1_worker_'+i]}}
  for name,cfg in configs.items():
   file=run/(name+'.json');file.write_text(json.dumps(cfg));os.chmod(file,0o600);self.configs[name]=file
  for name,module in [('controller','controller'),('source','source'),('reconciler','reconciler'),('api_a','application'),('api_b','application'),('worker_a','worker'),('worker_b','worker')]:self.launch(name,module)
  self.private=Client(str(run/'controller.sock'),caps['fixture']);self.wait(lambda:(run/'api_a-bound.json').exists() and (run/'api_b-bound.json').exists(),'API_BOUND')
  self.origins={i:json.loads((run/('api_'+i+'-bound.json')).read_text())['origin'] for i in ['a','b']}
 def fault(self,point=None):
  command={} if point is None else {'point':point,'namespace':self.namespace,'nonce':secrets.token_hex(16)}
  temporary=self.run/'fault-next.json';temporary.write_text(json.dumps(command,sort_keys=True));temporary.chmod(0o600);os.replace(temporary,self.run/'fault-control.json')
  return command
 def fault_ack(self,command):
  matches=list(self.run.glob('fault-'+command['nonce']+'-*.json'))
  return json.loads(private_file(matches[0]).read_text()) if matches else None
 def stop_app(self,name,*,crash=False):
  process=next(process for candidate,process in reversed(self.processes) if candidate==name and process.poll() is None)
  owner=json.loads(private_file(self.run/'owned-pids.json').read_text());entry=next(x for x in owner['apps'] if x['pid']==process.pid)
  app_identity(self.run,process.pid,config=self.configs[name],python=self.run/'venv/bin/python',registry=entry)
  socket_path=self.run/({'controller':'controller.sock','source':'source.sock'}.get(name,'no-socket'))
  socket_inode=socket_path.lstat().st_ino if socket_path.exists() else None
  process.send_signal(signal.SIGKILL if crash else signal.SIGTERM);process.wait(timeout=10)
  if socket_inode is not None and socket_path.exists():
   info=socket_path.lstat()
   if not stat.S_ISSOCK(info.st_mode) or info.st_uid!=os.getuid() or info.st_ino!=socket_inode:raise IntegrationFailure('SOCKET_OWNERSHIP')
   socket_path.unlink()
  owner['apps']=[x for x in owner['apps'] if x['pid']!=process.pid];owner.setdefault('retired',[]).append({**entry,'exit':process.returncode});(self.run/'owned-pids.json').write_text(json.dumps(owner))
  return process.pid
 def restart_app(self,name,*,crash=False,disarm_fault=False):
  old=self.stop_app(name,crash=crash)
  if disarm_fault:self.fault()
  if name.startswith('api_'):(self.run/(name+'-bound.json')).unlink(missing_ok=True)
  module='application' if name.startswith('api_') else 'worker' if name.startswith('worker_') else name
  self.launch(name,module)
  if name.startswith('api_'):
   self.wait(lambda:(self.run/(name+'-bound.json')).exists(),'RESTART_API')
   self.origins[name[-1]]=json.loads((self.run/(name+'-bound.json')).read_text())['origin']
  self.records.append({'scenario':'owned-app-restart','name':name,'oldPid':old,'newPid':self.processes[-1][1].pid,'crash':crash})
 def rebind(self,client,api):
  client.origin=self.origins[api];client.port=int(client.origin.rsplit(':',1)[1])
 def clock(self,now):
  self.expect(self.b.call('fixture_clock',self.namespace,{'now':now}),'BUSINESS_CLOCK');self.expect(self.a.call('fixture_clock',self.namespace,{'now':now}),'AUTHORITY_CLOCK')
 def crash_pg_and_restart(self):
  names=[name for name,process in self.processes if process.poll() is None]
  for name in reversed(names):self.stop_app(name,crash=True)
  self.b.close();self.a.close()
  owner=json.loads(private_file(self.run/'owned-pids.json').read_text());identity=pg_identity(self.run,owner['pg'])
  subprocess.run(['/opt/homebrew/bin/pg_ctl','-D',str(self.run/'pg'),'stop','-m','immediate','-w','-t','10'],env={},check=True,capture_output=True)
  subprocess.run(['/opt/homebrew/bin/pg_ctl','-D',str(self.run/'pg'),'-l',str(self.run/'pg.log'),'start','-w','-t','10'],env={'LC_ALL':'C'},check=True,capture_output=True)
  owner['pg']=pg_identity(self.run);(self.run/'owned-pids.json').write_text(json.dumps(owner))
  self.b=Database({'db':{'business':self.settings['roles']['c1_controller']}},'business','business',max_size=1);self.a=Database({'db':{'authority':self.settings['roles']['c1_controller_authority']}},'authority','authority',max_size=1)
  for name in names:
   if name.startswith('api_'):(self.run/(name+'-bound.json')).unlink(missing_ok=True)
   self.launch(name,'application' if name.startswith('api_') else 'worker' if name.startswith('worker_') else name)
  self.wait(lambda:all((self.run/('api_'+i+'-bound.json')).exists() for i in ['a','b']),'PG_RESTART_APIS')
  self.origins={i:json.loads((self.run/('api_'+i+'-bound.json')).read_text())['origin'] for i in ['a','b']}
  self.records.append({'scenario':'owned-pg-crash-restart','oldPid':identity['pid'],'newPid':owner['pg']['pid'],'sameDataDirectory':True})
 def resource_check(self):
  elapsed=time.time()-self.started
  if elapsed>=2700:raise IntegrationFailure('RUN_TIME_LIMIT')
  if time.monotonic()-self.resource_checked<3:return
  total=0
  for directory,_,files in os.walk(self.run,followlinks=False):
   for name in files:
    try:info=(Path(directory)/name).lstat()
    except FileNotFoundError:continue
    if stat.S_ISREG(info.st_mode):total+=info.st_size
  self.peak_disk=max(self.peak_disk,total);self.resource_checked=time.monotonic()
  if total>512*1024*1024:raise IntegrationFailure('RUN_DISK_LIMIT')
 def new_case(self,label):
  self.resource_check()
  namespace=label+'-'+secrets.token_hex(4)
  key=private_file(self.run/'email-key').read_bytes()
  business,authority=build(namespace,self.run,key)
  self.expect(self.b.call('fixture_init',namespace,business),'CASE_BUSINESS_INIT')
  self.expect(self.a.call('fixture_init',namespace,authority),'CASE_AUTHORITY_INIT')
  self.verify_fixture_content(namespace,business)
  temporary=self.run/'scope-next';temporary.write_text(namespace);temporary.chmod(0o600);os.replace(temporary,self.run/'scope')
  self.namespace=namespace;self.fixture=business
 def verify_fixture_content(self,namespace,business):
  for item in business['terms']:
   self.expect(verify_original(self.b,namespace,{'purpose':'audit',**{key:item[key] for key in ['store','meal','version']}},self.run),'PERSISTED_FIXTURE_CONTENT')
 def workers_signal(self,value):
  owner=json.loads(private_file(self.run/'owned-pids.json').read_text())
  for name,process in self.processes:
   if name.startswith('worker_') and process.poll() is None:
    entry=next(x for x in owner['apps'] if x['pid']==process.pid)
    app_identity(self.run,process.pid,config=self.configs[name],python=self.run/'venv/bin/python',registry=entry)
    process.send_signal(value)
 def signal_app(self,name,value):
  process=next(p for candidate,p in reversed(self.processes) if candidate==name and p.poll() is None)
  owner=json.loads(private_file(self.run/'owned-pids.json').read_text())
  entry=next(x for x in owner['apps'] if x['pid']==process.pid)
  app_identity(self.run,process.pid,config=self.configs[name],python=self.run/'venv/bin/python',registry=entry)
  process.send_signal(value)
 def launch(self,name,module):
  if sum(process.poll() is None for _,process in self.processes)>=7:raise IntegrationFailure('APP_LIMIT')
  code="import os,sys,runpy; assert set(os.environ)<=set(['LC_CTYPE','__CF_USER_TEXT_ENCODING']); os.environ.clear(); sys.path.insert(0,"+repr(str(ROOT/'src'))+"); runpy.run_module("+repr('c1.'+module)+",run_name='__main__')"
  log=(self.run/(name+'-diagnostic.log')).open('ab');os.chmod(log.name,0o600)
  process=subprocess.Popen([str(self.run/'venv/bin/python'),'-c',code,'--config',str(self.configs[name])],env={},cwd=ROOT,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=log);log.close();self.processes.append((name,process))
  # Actual OS start identity is stored, never credentials or complete argv.
  entry=app_identity(self.run,process.pid,config=self.configs[name],python=self.run/'venv/bin/python')
  owner=json.loads((self.run/'owned-pids.json').read_text());owner['apps'].append({'name':name,**entry});(self.run/'owned-pids.json').write_text(json.dumps(owner));os.chmod(self.run/'owned-pids.json',0o600)

 def wait(self,condition,label,timeout=10):
  deadline=time.monotonic()+timeout
  while time.monotonic()<deadline:
   self.resource_check()
   if condition():return
   dead=[name for name,p in dict(self.processes).items() if p.poll() is not None]
   if dead:raise IntegrationFailure('APP_EXIT:'+','.join(dead))
   time.sleep(.05)
  raise IntegrationFailure('TIMEOUT:'+label)
 def login(self,subject,api='a'):
  client=Consumer(self.origins[api],str(self.run/'tls-cert.pem'));client.ok('POST','/v1/auth/pre-session',{})
  raw=secrets.token_urlsafe(32);self.expect(self.b.call('fixture_assertion',self.namespace,{'subject':subject,'assertion_hash':hashlib.sha256(raw.encode()).hexdigest()}),'ASSERTION')
  client.ok('POST','/v1/auth/login',{'assertion':raw});return client
 def terminal(self,client,id):
  result={}
  def done():
   nonlocal result
   status,result=client.request('GET','/v1/intents/'+id)
   return status==200 and result.get('stage')=='FINAL_SUCCEEDED'
  self.wait(done,'FINAL',timeout=10);self.records.append({'scenario':'original-final','stage':result['stage'],'result':result.get('result'),'snapshot':self.b.call('fixture_snapshot',self.namespace,{})});return result
 def actor(self,id,actor):
  for attempt in range(5):
   result=self.private.call(self.namespace,'fixture',{'operation':'actor','intent_id':id,'actor':actor})
   if result.get('error') not in {'IPC_BUSY','CONTROLLER_BUSY'}:return self.expect(result,'ACTOR')
   time.sleep(.025*(attempt+1))
  return self.expect(result,'ACTOR')
 def flow(self):
  anonymous=Consumer(self.origins['a'],str(self.run/'tls-cert.pem'));stores=anonymous.ok('GET','/v1/stores');assert len(stores['items'])==3
  alice=self.login('alice');owner=self.login('owner1','b');bob=self.login('bob')
  saved=owner.ok('PUT','/v1/stores/S1/drafts/fresh',{'name':'Fresh meal','description':'Private review\nOriginal content','price':'3','windows':[[0,1440]],'expectedRevision':0})
  image=base64.b64decode(self.fixture['terms'][0]['image']);uploaded=owner.ok('PUT','/v1/stores/S1/drafts/fresh/image',image,mime='image/png',revision=saved['revision'])
  reviewed=owner.ok('POST','/v1/stores/S1/drafts/fresh/review',{'expectedRevision':uploaded['revision']})
  self.workers_signal(signal.SIGSTOP)
  try:
   published=owner.ok('POST','/v1/stores/S1/drafts/fresh/publish',{'reviewId':reviewed['reviewId']})
   assert anonymous.request('GET','/v1/stores/S1/meals/fresh')[0]==404
  finally:self.workers_signal(signal.SIGCONT)
  self.terminal(owner,published['id']);current=anonymous.ok('GET','/v1/stores/S1/meals/fresh');assert current['listed'] is False
  listed=owner.ok('POST','/v1/stores/S1/list',{'expectedRevision':1,'meal':'fresh','listed':True});self.terminal(owner,listed['id'])
  review=alice.ok('POST','/v1/support/reviews',{'store':'S1','meal':'fresh','quantity':2});fund=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']});assert fund['stage']=='WAIT_ACTOR';self.actor(fund['id'],'0x'+format(0x71,'040x'));self.terminal(alice,fund['id'])
  claim=bob.ok('POST','/v1/claims/reviews',{'store':'S1','meal':'fresh'});issue=bob.ok('POST','/v1/claims/intents',{'reviewId':claim['reviewId']});self.terminal(bob,issue['id']);vouchers=bob.ok('GET','/v1/my/vouchers');vid=vouchers['items'][0]['id'];access=bob.ok('POST','/v1/vouchers/'+vid+'/recover',{});display=bob.ok('POST','/v1/vouchers/'+vid+'/display',{'access':access['access']});checked=owner.ok('POST','/v1/stores/S1/checks',{'display':display['display']});assert checked['valid'];lock=owner.ok('POST','/v1/stores/S1/locks',{'display':display['display']});locked=self.terminal(owner,lock['id']);lockid=locked['result']['result'];marker=owner.ok('POST','/v1/stores/S1/cases/'+lockid+'/handover-intents',{});self.terminal(owner,marker['id'])
  self.wait(lambda:owner.ok('GET','/v1/stores/S1/cases/'+lockid)['state']=='H','REPORT')
  review=owner.ok('POST','/v1/stores/S1/payouts/'+vid+'/settle-reviews',{});settle=owner.ok('POST','/v1/stores/S1/settle-intents',{'reviewId':review['reviewId']});assert settle['stage']=='WAIT_ACTOR';self.actor(settle['id'],self.fixture['manifest']['stores']['S1']['owner']);self.terminal(owner,settle['id'])
  review=alice.ok('POST','/v1/orders/'+fund['id']+'/refund-reviews',{});refund=alice.ok('POST','/v1/refund-intents',{'reviewId':review['reviewId']});assert refund['stage']=='WAIT_ACTOR';self.actor(refund['id'],'0x'+format(0x71,'040x'));self.terminal(alice,refund['id'])
  totals=anonymous.ok('GET','/v1/stores')['items'][0]['financial'];assert totals['F']=='6' and totals['S']=='3' and totals['X']=='3' and totals['liability']=='0'
  for offset,store in enumerate(['S1','S2','S3','S1'],1):
   now=self.fixture['now']+offset*60;self.expect(self.b.call('fixture_clock',self.namespace,{'now':now}),'BUSINESS_CLOCK');self.expect(self.a.call('fixture_clock',self.namespace,{'now':now}),'AUTHORITY_CLOCK')
   review=alice.ok('POST','/v1/support/reviews',{'store':store,'meal':'meal','quantity':1});intent=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']});self.actor(intent['id'],'0x'+format(0x71,'040x'));final=self.terminal(alice,intent['id']);self.records.append({'scenario':'three-store-continuous-watermark','store':store,'provenance':final['provenance']})
  self.records.append({'scenario':'fund-issue-recover-check-lock-marker-report-settle-refund','status':'PASS','snapshot':self.b.call('fixture_snapshot',self.namespace,{})})
 def close(self):
  self.b.close();self.a.close();owner=json.loads(private_file(self.run/'owned-pids.json').read_text())
  for name,process in reversed(self.processes):
   if process.poll() is None:
    entry=next(x for x in owner['apps'] if x['pid']==process.pid)
    app_identity(self.run,process.pid,config=self.configs[name],python=self.run/'venv/bin/python',registry=entry)
    process.terminate()
    try:process.wait(timeout=10)
    except subprocess.TimeoutExpired:raise IntegrationFailure('APP_STOP_TIMEOUT')
  owner['apps']=[];(self.run/'owned-pids.json').write_text(json.dumps(owner));os.chmod(self.run/'owned-pids.json',0o600)
  local=Path(__file__).with_name('local-run.py');subprocess.run([str(self.run/'venv/bin/python'),str(local),'stop',str(self.run)],env={},check=True,capture_output=True)
  self.records.append({'scenario':'owned-teardown','status':'PASS','appsStopped':len(self.processes)})
 def evidence(self,status,reason=None):
  diagnostics=[]
  for name in sorted(set(name for name,_ in self.processes)):
   for line in (self.run/(name+'-diagnostic.log')).read_text().splitlines():
    if line.startswith('C1_DIAGNOSTIC '):diagnostics.append(json.loads(line[14:]))
  value={'sourceManifest':self.source_manifest,'peakDiskBytes':self.peak_disk,'diagnostics':diagnostics,'status':status,'reason':reason,'namespaceDigest':hashlib.sha256(self.namespace.encode()).hexdigest(),'elapsed':round(time.time()-self.started,3),'records':self.records,'pids':[{ 'name':name,'pid':p.pid} for name,p in self.processes],'seed':'0xc13001'};destination=ROOT/'evidence'/('smoke-'+self.run.name+'.json');destination.write_text(json.dumps(value,indent=2));print(json.dumps({'status':status,'reason':reason,'evidence':str(destination)}))
def main():
 p=argparse.ArgumentParser();p.add_argument('run');a=p.parse_args();h=Harness(a.run);status='FAIL';reason=None
 try:h.start();h.flow();status='PASS'
 except IntegrationFailure as e:reason=str(e)
 except Exception as e:reason='INTEGRATION_EXCEPTION:'+type(e).__name__
 finally:
  try:h.close()
  except Exception as e:status='FAIL';reason='TEARDOWN:'+type(e).__name__
  h.evidence(status,reason)
 return 0 if status=='PASS' else 1
if __name__=='__main__':sys.exit(main())
