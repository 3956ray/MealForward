"""Only confirmed immutable catalog images may be served publicly."""
import re

def handle(gateway,method,path,q):
    match=re.fullmatch(r'/v1/stores/([0-9a-f]{64})/meals/([0-9a-f]{64})/versions/([1-9][0-9]{0,77})/image',path)
    if method!='GET' or not match:return None
    store,meal,version=match.groups()
    return gateway._fixed(gateway.api_ledger,'live_catalog_image',{**q,'store':store,'meal':meal,'version':version},read_only=True)
