"""Private synthetic-run fault barriers, fixed points, bounded wait, no DB locks."""
import hashlib,json,os,re,stat,time
from pathlib import Path

POINTS=frozenset({'domain_committed','security_applied','lease_claimed','ticket_staged',
                  'authority_committed','receipt_ingested','before_apply','apply_committed','authority_closed'})

class FaultBoundary(RuntimeError):pass

def hit(config,point,namespace,object_id=None):
    if point not in POINTS:raise FaultBoundary('INVALID_FAULT_POINT')
    if not config or not config.get('fault_file'):return
    path=Path(config['fault_file']);run=Path(config['run'])
    if path.parent!=run or path.name!='fault-control.json':raise FaultBoundary('FAULT_PATH')
    try:info=path.lstat()
    except FileNotFoundError:return
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600 or info.st_size>4096:raise FaultBoundary('FAULT_FILE')
    command=json.loads(path.read_text())
    if command.get('point')!=point or command.get('namespace')!=namespace:return
    if set(command)!={'point','namespace','nonce'} or not isinstance(command['nonce'],str) or re.fullmatch('[0-9a-f]{32}',command['nonce']) is None:raise FaultBoundary('FAULT_COMMAND')
    ack=run/('fault-'+command['nonce']+'-'+str(os.getpid())+'.json')
    value={'point':point,'pid':os.getpid(),'namespaceDigest':hashlib.sha256(namespace.encode()).hexdigest(),'object':object_id}
    fd=os.open(ack,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as stream:json.dump(value,stream);stream.flush();os.fsync(stream.fileno())
    end=time.monotonic()+5
    while time.monotonic()<end:
        if path.read_text()!=json.dumps(command,sort_keys=True):return
        time.sleep(.01)
    raise FaultBoundary('FAULT_WAIT_EXPIRED')
