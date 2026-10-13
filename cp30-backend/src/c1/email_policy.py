"""The existing canonical-email/HMAC policy, isolated from fixture construction."""
import hashlib,hmac,re

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

