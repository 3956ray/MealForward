"""Verify original persisted bytes outside transactions, then CAS their MVCC row."""
import base64
import json
from .encoding import content_hash


class ContentUnavailable(ValueError):
    pass


def verify_material(material, run):
    try:
        name=base64.b64decode(material['name']).decode('utf-8',errors='strict')
        description=base64.b64decode(material['description']).decode('utf-8',errors='strict')
        body=base64.b64decode(material['body'])
        image=base64.b64decode(material['image'])
        # The JSON carrier must preserve the exact original UTF-8 fields.
        if json.loads(body.decode('utf-8',errors='strict')) != [name,description]:
            raise ContentUnavailable()
        hashes=content_hash(image,run,material['scope'],material['meal'],material['version'],
                            material['price'],name,description,material['windows'])
        body_digest,image_digest,terms_digest=(hashes[key] for key in ('bodyDigest','imageDigest','termsHash'))
        if (body_digest,image_digest,terms_digest)!=(material['bodyDigest'],material['imageDigest'],material['termsHash']):
            raise ContentUnavailable()
        return {key:material[key] for key in ('store','meal','version','rowVersion','bodyDigest','imageDigest','termsHash')}
    except (ValueError,KeyError,TypeError,UnicodeError):
        raise ContentUnavailable('CONTENT_UNAVAILABLE') from None


def verify_original(database,namespace,request,run):
    material=database.call('content_material',namespace,request)
    if material.get('error'):return material
    try:
        proofs=[verify_material(item,run) for item in material['items']]
    except ContentUnavailable:
        return {'error':'CONTENT_UNAVAILABLE','status':503}
    return database.call('content_verify',namespace,{**request,'proofs':proofs})
