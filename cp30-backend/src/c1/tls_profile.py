"""Validate newly approved local TLS material in future setup; never issue keys."""
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlsplit

def validate_tls(tls,origin):
    from cryptography import x509
    from cryptography.hazmat.primitives.serialization import load_pem_private_key,Encoding,PublicFormat
    cert=x509.load_pem_x509_certificate(Path(tls['certfile']).read_bytes())
    key=load_pem_private_key(Path(tls['keyfile']).read_bytes(),password=None)
    if cert.public_key().public_bytes(Encoding.DER,PublicFormat.SubjectPublicKeyInfo)!=key.public_key().public_bytes(Encoding.DER,PublicFormat.SubjectPublicKeyInfo):raise ValueError('NEW_TLS_KEY_CERT_MISMATCH')
    now=datetime.now(timezone.utc)
    if not cert.not_valid_before_utc<=now<cert.not_valid_after_utc:raise ValueError('NEW_TLS_VALIDITY_REQUIRED')
    host=urlsplit(origin).hostname;san=cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    names=san.get_values_for_type(x509.DNSName);addresses=[str(v) for v in san.get_values_for_type(x509.IPAddress)]
    if host not in names and host not in addresses:raise ValueError('NEW_TLS_ORIGIN_SAN_REQUIRED')
    return True
