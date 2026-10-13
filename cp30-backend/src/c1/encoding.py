"""Bounded pure viem subprocess, with no provider or inherited environment."""
import hashlib,json,os,stat,subprocess,secrets
from pathlib import Path
NODE='/Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
HELPER=Path(__file__).resolve().parents[2]/'tools/hash-helper.mjs'
def encode_hash(op, **kwargs):
    command={'op':op,**kwargs}
    raw=json.dumps(command,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
    if len(raw)>65536: raise ValueError('HASH_CONTROL_LIMIT')
    proc=subprocess.run([NODE,str(HELPER)],input=raw,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={},timeout=2)
    value=json.loads(proc.stdout)
    if proc.returncode or 'error' in value:raise ValueError('HASH_HELPER_REJECTED')
    return value

def _artifact_hash(data, run, command):
    run=Path(run); info=run.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o700 or len(data)>8388608:raise ValueError('UNSAFE_IMAGE_ARTIFACT')
    path=run/('normalized-'+secrets.token_hex(16)+'.png')
    writer=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(writer,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
        try:
            control=json.dumps({**command,'length':len(data)},ensure_ascii=False).encode()
            if len(control)>65536:raise ValueError('HASH_CONTROL_LIMIT')
            proc=subprocess.run([NODE,str(HELPER),str(fd)],input=control,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,pass_fds=(fd,),env={},timeout=2)
            result=json.loads(proc.stdout)
            if proc.returncode or 'error' in result:raise ValueError('IMAGE_HASH_REJECTED')
            return result
        finally:os.close(fd)
    finally:path.unlink(missing_ok=True)

def image_hash(data,run):return _artifact_hash(data,run,{'op':'image'})['imageDigest']

def content_hash(data,run,scope,meal,version,price,name,description,windows):
    w=windows+[[0,0]]*(2-len(windows))
    return _artifact_hash(data,run,{'op':'content','name':name,'description':description,
        'escrow':scope['escrow'],'storeId':scope['store_id'],'asset':scope['asset'],
        'mealId':object_hash(meal),'version':str(version),'unitPrice':str(price),
        'windowCount':len(windows),'startMinute0':w[0][0],'endMinute0':w[0][1],
        'startMinute1':w[1][0],'endMinute1':w[1][1]})

def object_hash(name):return '0x'+hashlib.sha256(name.encode()).hexdigest()
def hexword(value):
    if isinstance(value,int):return value.to_bytes(32,'big')
    return bytes.fromhex(value.removeprefix('0x')).rjust(32,b'\0')
def batch_hash(escrow,quote):return encode_hash('keccak',hex='0x'+(hexword(31337)+hexword(escrow)+hexword(quote)).hex())['digest']
def terms(scope,meal,version,price,body,image,windows):
    w=windows+[[0,0]]*(2-len(windows))
    return encode_hash('terms',escrow=scope['escrow'],storeId=scope['store_id'],asset=scope['asset'],mealId=object_hash(meal),version=str(version),unitPrice=str(price),bodyDigest=body,imageDigest=image,windowCount=len(windows),startMinute0=w[0][0],endMinute0=w[0][1],startMinute1=w[1][0],endMinute1=w[1][1])['termsHash']
