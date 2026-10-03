"""Explicit diagnostic only. A signed sample is NOT an approved auth profile."""
from dataclasses import asdict
import json
import os
from pathlib import Path
import re
import secrets

import jwt

from server.contracts import ApiError
from server.dynamic_contracts import ClaimProfile, ENVIRONMENT_ID
from server.dynamic_jwt import verify_access_token


class ProfileCapture:
    def __init__(self, directory, *, clock, jwks):
        self.root = Path(directory)
        self.clock, self.jwks = clock, jwks
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.root.is_symlink(): raise ValueError('Private capture directory required')
        self.root.chmod(0o700)

    def cleanup(self):
        now = int(self.clock())
        for path in self.root.glob('*.json'):
            if path.is_symlink(): raise ValueError('Invalid capture file')
            try: expired = json.loads(path.read_text()).get('expiresAt', 0) <= now
            except (ValueError, TypeError): expired = True
            if expired: path.unlink()

    def inspect(self, raw):
        self.cleanup()
        if len(list(self.root.glob('*.json'))) >= 20:
            raise ApiError(429, 'PROFILE_CAPTURE_LIMIT', 'Try later')
        try:
            if not isinstance(raw, str) or len(raw) > 16384: raise ValueError()
            # Read only to construct a diagnostic candidate; nothing is returned or persisted
            # until the pure verifier checks the signature and all required claims.
            claims = jwt.decode(raw, options={'verify_signature': False})
            issuer = claims.get('iss')
            audience = claims.get('aud')
            if 'aud' in claims and not isinstance(audience, (str, list)): raise ValueError()
            audiences = (audience,) if isinstance(audience, str) else tuple(audience or ())
            if 'environment_id' not in claims and issuer != f'app.dynamicauth.com/{ENVIRONMENT_ID}':
                raise ValueError('No diagnostic environment binding')
            candidate = ClaimProfile(ENVIRONMENT_ID, issuer, audiences, verified=True,
                                     allow_absent_audience='aud' not in claims,
                                     allow_absent_environment_id='environment_id' not in claims,
                                     allow_absent_sid='sid' not in claims)
            identity = verify_access_token(raw, profile=candidate, clock=self.clock, jwks=self.jwks)
        except ApiError: raise
        except (ValueError, TypeError, jwt.PyJWTError, RecursionError):
            raise ApiError(401, 'DYNAMIC_TOKEN_REJECTED', 'Diagnostic sample rejected') from None
        now = int(self.clock()); capture_id = secrets.token_hex(16)
        profile = {**asdict(candidate), 'verified': False}
        public = dict(captureId=capture_id, expiresAt=min(now+600,identity.expires_at),
                      candidateProfile=profile, scopes=sorted(identity.scopes),
                      remainingTokenSeconds=identity.expires_at-now, grantsWorkAccess=False)
        # Sub is local maintenance data, never included in the HTTP response, token or logs.
        record = {**public, 'subject':identity.subject, 'capturedAt':now}
        path = self.root/(capture_id+'.json')
        with open(path, 'x', opener=lambda name, flags: os.open(name, flags, 0o600)) as file:
            json.dump(record, file, separators=(',', ':'))
        return public

    def read_for_maintenance(self, capture_id):
        self.cleanup()
        if not re.fullmatch('[0-9a-f]{32}', capture_id): raise ValueError('Invalid capture identifier')
        path = self.root/(capture_id+'.json')
        if path.is_symlink(): raise ValueError('Invalid capture file')
        record = json.loads(path.read_text())
        if record['expiresAt'] <= int(self.clock()): raise ValueError('Capture expired')
        return record


def main():
    """Maintenance-only config creation, never exposed as an HTTP role assignment."""
    import argparse
    import sqlite3
    import time
    from server.dynamic_mapping import scope_allowed
    parser=argparse.ArgumentParser(description='Write a new trusted config from an explicitly reviewed short-lived sample')
    parser.add_argument('--directory',required=True)
    parser.add_argument('--capture-id',required=True)
    parser.add_argument('--actor',required=True)
    parser.add_argument('--database',required=True)
    parser.add_argument('--reviewed-profile',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    capture=ProfileCapture(args.directory,clock=time.time,jwks=None)
    record=capture.read_for_maintenance(args.capture_id)
    reviewed=json.loads(Path(args.reviewed_profile).read_text())
    expected={**record['candidateProfile'],'verified':True}
    if reviewed!=expected: raise ValueError('Reviewed profile must exactly match the sampled shape and explicit verified=true')
    with sqlite3.connect(Path(args.database).resolve().as_uri()+'?mode=ro',uri=True) as db:
        db.row_factory=sqlite3.Row
        user=db.execute('SELECT * FROM users WHERE id=?',(args.actor,)).fetchone()
        if not user or not user['enabled'] or not scope_allowed(user): raise ValueError('Existing enabled scoped actor required')
    authority={'sourceVersion':'reviewed-'+args.capture_id,'claimProfile':reviewed,
               'mappings':[{'environment_id':ENVIRONMENT_ID,'issuer':reviewed['issuer'],
                            'subject':record['subject'],'actor_id':args.actor}]}
    with open(args.output,'x',opener=lambda name,flags:os.open(name,flags,0o600)) as file:
        json.dump(authority,file,indent=2)
    (capture.root/(args.capture_id+'.json')).unlink()
    print('New private authority config written; activation requires an explicit backend restart with --dynamic-authority-file')


if __name__=='__main__': main()
