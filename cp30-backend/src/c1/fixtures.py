"""Private synthetic fixture construction, never imported by the browser API."""
import base64,hashlib,hmac,io,json,re,secrets
from .encoding import encode_hash,terms,object_hash,image_hash

def canonical_email(raw):
    if type(raw) is not str or not raw.isascii():raise ValueError('UNSUPPORTED_EMAIL')
    value=raw.strip(' ')
    if len(value)>254 or value.count('@')!=1:raise ValueError('UNSUPPORTED_EMAIL')
    local,domain=value.split('@')
    if not 1<=len(local)<=64 or not 1<=len(domain)<=253 or not re.fullmatch(r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+",local) or local.startswith('.') or local.endswith('.') or '..' in local:raise ValueError('UNSUPPORTED_EMAIL')
    for label in domain.split('.'):
        if not 1<=len(label)<=63 or not re.fullmatch('[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?',label):raise ValueError('UNSUPPORTED_EMAIL')
    return local+'@'+domain.lower()

def email_key(namespace,email,key):
    values=[namespace.encode(),canonical_email(email).encode()]
    message=b'MCPAY-C1-EMAIL-v1'+b''.join(len(value).to_bytes(4,'big')+value for value in values)
    return hmac.new(key,message,hashlib.sha256).hexdigest()

def build(namespace,run,key,now=1800000000,price='3'):
    from PIL import Image
    from .model import initial_snapshot
    png=io.BytesIO();Image.new('RGB',(16,16),(35,100,70)).save(png,format='PNG',compress_level=6,optimize=False);im=png.getvalue();ih=image_hash(im,run)
    scopes={};versions=[];snapshots=[]
    payers={f'0x{v:040x}':'1000000' for v in [0x71,0x72,0x73,0x74]}
    for num in range(1,4):
        st='S'+str(num);scope=dict(namespace=namespace,chain_id=31337,store=st,store_id=object_hash(st),escrow=f'0x{0x100+num:040x}',asset=f'0x{0x200:040x}',owner=f'0x{0x10+num:040x}',receiver=f'0x{0x10+num:040x}',catalog=f'0x{0x20+num:040x}',issuer=f'0x{0x30+num:040x}',operator=f'0x{0x40+num:040x}',quote=f'0x{0x50:040x}',rule_version='S0b-3cb717ec',deployment_generation=1,baseline='3cb717ec6fca60b80106783631a1e22b8abaff18')
        scope['config_digest']=hashlib.sha256(json.dumps(scope,sort_keys=True).encode()).hexdigest();scopes[st]=scope
        name='Warm meal '+st;description='Synthetic local meal\nOriginal terms';bh=encode_hash('body',name=name,description=description)['bodyDigest'];th=terms(scope,'meal',1,price,bh,ih,[[0,1440]])
        versions.append(dict(store=st,meal='meal',version=1,body=base64.b64encode(json.dumps([name,description],ensure_ascii=False).encode()).decode(),image=base64.b64encode(im).decode(),body_digest=bh[2:],image_digest=ih[2:],terms_hash=th[2:],price=price,windows=[[0,1440]],name=name,description=description,listed=True))
        catalog={object_hash('meal'):{'1':dict(price=price,terms_hash=th,body_digest=bh,image_digest=ih,windows=[[0,1440]],body_available=True,image_available=True)}}
        snapshots.append(initial_snapshot(scope,catalog,payers,now))
    emails={'alice':'alice@example.test','bob':'bob@example.test','same':'alice@EXAMPLE.test','owner1':'owner1@example.test','owner2':'owner2@example.test','owner3':'owner3@example.test'}
    identities=[dict(subject=subject,canonical_email=canonical_email(email),email_key=email_key(namespace,email,key),**({'payer':f'0x{0x71 if subject=="alice" else 0x72 if subject=="bob" else 0x73:040x}'} if subject in {'alice','bob','same'} else {})) for subject,email in emails.items()]
    return dict(now=now,manifest={'stores':scopes},stores=[{'id':'S1'},{'id':'S2'},{'id':'S3'}],identities=identities,grants=[{'store':'S'+str(i),'subject':'owner'+str(i)} for i in range(1,4)],terms=versions),dict(now=now,snapshots=snapshots)
