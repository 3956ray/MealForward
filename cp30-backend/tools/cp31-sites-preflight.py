"""Read-only CP31 Sites static build preflight for the bounded CP30 HTTPS server.

This does NOT install or change the owned runtime, its source pins, private
configs, PostgreSQL, journal, wallet state, signer grants, or network listeners.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1]
PROJECT = BACKEND.parent
SITE = PROJECT / 'sites-frontend' / 'dist'
SRC = BACKEND / 'src'
FILES = (
    'index.html', 'app.js', 'live-api.mjs', 'ledger-view.mjs',
    'model.mjs', 'image.mjs', 'onboarding-view.mjs', 'styles.css',
    'assets/bowl.jpg', 'assets/hero-meal.jpg',
    'assets/vegetables.jpg', 'assets/live-wallet.mjs',
    'assets/qrcode.min.js',
)


def check():
    if not SITE.is_dir() or SITE.is_symlink():
        raise ValueError('CP31_SITES_BUILD_MISSING')
    if str(SRC) not in sys.path:
        sys.path.insert(0, str(SRC))
    from c1.static_assets import StaticAssets
    manifest = list(FILES)
    assets = StaticAssets(str(SITE.resolve()), manifest)
    index = assets.get('/index.html')[1].decode('utf-8')
    app = assets.get('/app.js')[1].decode('utf-8')
    api = assets.get('/live-api.mjs')[1].decode('utf-8')
    if "connect-src 'self'" not in index or "default-src 'self'" not in index:
        raise ValueError('CP31_CSP_SAME_ORIGIN_REQUIRED')
    if "const LIVE_MODE=true;" not in app:
        raise ValueError('CP31_LIVE_FRONTEND_REQUIRED')
    if "'/v1/connection'" not in api or "'/v1/identity/setup'" not in api:
        raise ValueError('CP31_SAME_ORIGIN_API_REQUIRED')
    if "'/v1/ledger'" not in api:
        raise ValueError('CP31_REAL_LEDGER_API_REQUIRED')
    if assets.get('/v1/me') or assets.get('/../../bootstrap-password'):
        raise ValueError('CP31_API_OR_TRAVERSAL_OVERLAP')
    if assets.get('/') != assets.get('/index.html'):
        raise ValueError('CP31_INDEX_ALIAS_REQUIRED')
    for file in FILES:
        if assets.get('/' + file) is None:
            raise ValueError('CP31_MISSING_PUBLIC_ASSET')
    return {
        'status': 'PASS',
        'mode': 'read_only_preflight',
        'staticRoot': str(SITE.resolve()),
        'staticFiles': manifest,
        'files': len(manifest),
        'apiNamespaceReserved': '/v1/',
        'walletSigningOrDatabaseWrites': False,
    }


if __name__ == '__main__':
    try:
        print(json.dumps(check(), indent=2, ensure_ascii=False))
    except (ValueError, OSError, ImportError, UnicodeError) as exc:
        print(json.dumps({'status': 'BLOCKED', 'error': str(exc)[:160]}), file=sys.stderr)
        sys.exit(1)
