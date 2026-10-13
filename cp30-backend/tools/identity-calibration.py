"""Explicit preparation-page routes only; no server, persistence or business session.

Root may compose Routes(origin, jwks=<fixed-environment public-key provider>) into
its owned preparation server. Import/constructor never fetch keys or start HTTP.
The provider must use the fixed Dynamic environment JWKS, never token URLs.
"""
import base64
import json
from pathlib import Path
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
ENVIRONMENT = '7fe95f70-e5cc-4c3c-beed-a133e81268dc'

def inspect_token(raw, *, origin, jwks, clock=time.time):
    # Fixed repository modules are pure identity verification, not auth/mapping.
    project = str(ROOT.parent)
    if project not in sys.path:
        sys.path.insert(0, project)
    from server.dynamic_contracts import ClaimProfile
    from server.dynamic_jwt import _json, verify_access_token
    if type(raw) is not str or len(raw) > 16384:
        raise ValueError('CALIBRATION_REJECTED')
    parts = raw.split('.')
    if len(parts) != 3:
        raise ValueError('CALIBRATION_REJECTED')
    claims = _json(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
    issuer = 'app.dynamicauth.com/' + ENVIRONMENT
    if type(claims) is not dict or claims.get('iss') != issuer:
        raise ValueError('CALIBRATION_REJECTED')
    audience = claims.get('aud')
    audiences = (audience,) if type(audience) is str else tuple(audience or ())
    if 'aud' in claims and (type(audience) not in (str, list) or not audiences
            or len(audiences) > 8 or any(type(a) is not str for a in audiences)):
        raise ValueError('CALIBRATION_REJECTED')
    # Candidate is used transiently for signature/time/environment verification.
    # It is never installed or returned as an approved policy.
    candidate = ClaimProfile(ENVIRONMENT, issuer, audiences, verified=True,
        allow_absent_audience='aud' not in claims,
        allow_absent_environment_id='environment_id' not in claims,
        allow_absent_sid='sid' not in claims)
    identity = verify_access_token(raw, profile=candidate, clock=clock, jwks=jwks)
    fields = ('iss', 'aud', 'environment_id', 'sub', 'sid', 'iat', 'exp', 'nbf',
        'scope', 'email', 'email_verified', 'verified_credentials')
    def kind(value):
        return {str:'string', bool:'boolean', int:'integer', list:'array', dict:'object',
            type(None):'null'}.get(type(value), 'other')
    structure = {name: {'present': name in claims,
        'type': kind(claims[name]) if name in claims else 'absent'} for name in fields}
    credentials = claims.get('verified_credentials')
    credential_schema = {}
    unique_email_schema = None
    email_count = None
    if type(credentials) is list and len(credentials) <= 32:
        email_credentials = [c for c in credentials if type(c) is dict and c.get('format') == 'email']
        email_count = len(email_credentials)
        if email_count == 1:
            unique_email_schema = {name: kind(email_credentials[0][name])
                for name in ('format', 'email', 'address', 'id', 'public_identifier')
                if name in email_credentials[0]}
        for name in ('format', 'email', 'address', 'id', 'public_identifier'):
            credential_schema[name] = sorted({kind(c[name]) for c in credentials
                if type(c) is dict and name in c})
    # Only recognized public audience values can be exported. Unknown signed
    # values remain redacted; inspect types without disclosing arbitrary claims.
    public_audiences = all(a in {origin, ENVIRONMENT, issuer} for a in audiences)
    return {'status': 'SIGNED_IDENTITY_SAMPLE_VERIFIED', 'profileApproved': False,
        'businessSessionCreated': False, 'rolesGranted': False,
        'candidateProfile': {'environment_id': ENVIRONMENT, 'issuer': issuer,
            'audiences': list(audiences) if public_audiences else None,
            'audiencesRedacted': not public_audiences, 'verified': False,
            'allow_absent_audience': candidate.allow_absent_audience,
            'allow_absent_environment_id': candidate.allow_absent_environment_id,
            'allow_absent_sid': candidate.allow_absent_sid},
        'claimStructure': structure, 'credentialStructure': credential_schema,
        'uniqueEmailCredentialStructure': unique_email_schema,
        'signedEmailEvidence': {'emailStringPresent': type(claims.get('email')) is str,
            'emailVerifiedBoolean': claims.get('email_verified') if type(claims.get('email_verified')) is bool else None,
            'emailCredentialCount': email_count},
        'scopeReview': {'userBasic': 'user:basic' in identity.scopes,
            'additionalScopesPresent': identity.scopes != frozenset({'user:basic'})}}

class Routes:
    def __init__(self, origin, *, jwks, clock=time.time):
        from urllib.parse import urlsplit
        parsed = urlsplit(origin)
        if (parsed.scheme != 'https' or parsed.hostname not in {'localhost', '127.0.0.1'}
            or parsed.port is None or not 1024 <= parsed.port <= 65535
            or origin != f'https://{parsed.hostname}:{parsed.port}'):
            raise ValueError('EXACT_NEW_ORIGIN_REQUIRED')
        self.origin, self.jwks, self.clock = origin, jwks, clock
        self.lock = threading.Lock()
        self.attempts = 0

    def handle(self, method, path, headers, body=b''):
        """Return (status, bytes, headers), or None for another prep-server route.

        Caller must enforce the body cap before buffering, suppress request body
        logging, and pass lowercase header names. Never invoke business routes.
        """
        common = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff'}
        paths = {'/identity-calibration': ROOT/'tools/identity-calibration.html',
            '/identity-calibration.js': ROOT/'tools/identity-calibration.js',
            '/assets/identity.js': ROOT/'consumer/assets/identity.js'}
        if method == 'GET' and path in paths:
            common['Content-Type'] = 'text/html; charset=utf-8' if path == '/identity-calibration' else 'text/javascript; charset=utf-8'
            return 200, paths[path].read_bytes(), common
        if path != '/identity-calibration/inspect':
            return None
        common['Content-Type'] = 'application/json'
        try:
            if (method != 'POST' or headers.get('origin') != self.origin
                or headers.get('x-cp30-identity-calibration') != '1'
                or headers.get('content-type') != 'application/json'
                or type(body) is not bytes or len(body) > 18432):
                raise ValueError()
            with self.lock:
                if self.attempts >= 8:
                    raise ValueError()
                self.attempts += 1
                packet = json.loads(body)
                if type(packet) is not dict or set(packet) != {'accessToken'}:
                    raise ValueError()
                result = inspect_token(packet['accessToken'], origin=self.origin,
                    jwks=self.jwks, clock=self.clock)
            return 200, json.dumps(result, separators=(',', ':')).encode(), common
        except Exception:
            # No exception text, token, email, OTP or private claim in diagnostics.
            return 401, b'{"status":"CALIBRATION_REJECTED"}', common
