"""Reviewed source-bootstrap config pins; private hosts never adopt edited config."""
import hashlib,json,os,stat
from pathlib import Path
from .registrar_signer_journal import owned_directory

def read_private(path):
    path=Path(path);info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600 or info.st_size>262144:raise ValueError('PRIVATE_CONFIG_REQUIRED')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as source:raw=source.read(262145)
    if len(raw)>262144:raise ValueError('PRIVATE_CONFIG_REQUIRED')
    def pairs(items):
        result={}
        for key,value in items:
            if key in result:raise ValueError('DUPLICATE_CONFIG_FIELD')
            result[key]=value
        return result
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('INVALID_CONFIG_NUMBER'))),raw

def load(path):
    path=Path(path);run=owned_directory(path.parent)
    config,raw=read_private(path);marker,_=read_private(run/'CONNECTION-OWNED.json');installed,_=read_private(run/('BUSINESS-INSTALLED.json' if path.name in {'business-suite.json','business-client.json'} else 'INSTALLED.json'))
    if marker.get('protocol')!='CP30_CONNECTION_BOOTSTRAP_V1' or marker.get('run')!=str(run) or marker.get('owner')!=os.getuid() or installed.get('id')!=marker.get('id') or installed.get('configs',{}).get(path.name)!=hashlib.sha256(raw).hexdigest():raise ValueError('REVIEWED_PRIVATE_CONFIG_PIN_REQUIRED')
    return config
