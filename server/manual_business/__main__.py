"""Persistent preparation entry. Active runtime composition requires a later approved configuration."""
import argparse
import json
import os
import secrets
import subprocess
from pathlib import Path
from server.backend import canonical, digest
from server.local_e2e.__main__ import serve
from .web import create_app

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['prepare', 'resume'])
    parser.add_argument('--directory', required=True)
    parser.add_argument('--port', type=int, default=15287)
    parser.add_argument('--identity-profile', help='Explicit operator-reviewed exact-origin claim profile; never a token or wallet key')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535: raise ValueError('Unprivileged loopback port required')
    directory = Path(args.directory).resolve()
    if args.command == 'prepare':
        directory.mkdir(mode=0o700, parents=True, exist_ok=False)
        config = {'version': 1, 'purpose': 'cp28-preparation-only', 'runId': secrets.token_hex(16),
                  'origin': f'http://127.0.0.1:{args.port}'}
        path = directory/'preparation.json'
        with path.open('x') as f:
            os.chmod(path, 0o600); f.write(canonical(config)+'\n'); f.flush(); os.fsync(f.fileno())
        anchor = directory.parent/(directory.name+'.preparation-anchor')
        with anchor.open('x') as f:
            os.chmod(anchor, 0o600); f.write(digest(canonical(config))+'\n'); f.flush(); os.fsync(f.fileno())
    else:
        config = json.loads((directory/'preparation.json').read_text())
        anchor = directory.parent/(directory.name+'.preparation-anchor')
        if anchor.read_text().strip() != digest(canonical(config)) or config.get('purpose') != 'cp28-preparation-only':
            raise ValueError('Preparation identity mismatch; preserve original files')
        if config['origin'] != f'http://127.0.0.1:{args.port}': raise ValueError('Resume requires original port')
    sha = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    dirty = subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    config['sourceSha'] = sha+('-dirty' if dirty else '')
    if not (ROOT/'manual-business-harness/dist/index.html').is_file(): raise ValueError('Build manual-business-harness before serving')
    from .identity_preparation import IdentityPreparation, load_profile
    profile, check = load_profile(args.identity_profile, config['origin'])
    identity = IdentityPreparation(config['origin'], profile=profile, source_check=check)
    print(canonical({'url': config['origin'], 'runId': config['runId'], 'sourceSha': config['sourceSha'],
                     'state': 'BLOCKED', 'directory': str(directory), 'pid': os.getpid(), 'realWallet': 'NOT_RUN',
                     'identityProfileConfigured': profile is not None}), flush=True)
    serve(create_app(config, identity_preparation=identity), args.port)


if __name__ == '__main__': main()
