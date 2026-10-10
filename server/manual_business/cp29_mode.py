"""Explicit, bounded exception for one operator exercising two test roles."""
from .cp29_identity import FP_RE, validate_mappings

MODE = 'single-operator-testnet'
ORIGIN = 'http://127.0.0.1:15287'
ENVIRONMENT = '7fe95f70-e5cc-4c3c-beed-a133e81268dc'
CONTRACT = '0xD60ceD42A67e6B7bE2A3d17464181875b75531a9'
DEPLOYMENT = '60b8e4d0b25c4cf73bf49b0e4fb1c0c909cd0f77837caa2bd4d58183416807d1'
RUN = 'cp29-first-meal-20261009'
ACTORS = {'partner': 'cp29-partner', 'owner': 'cp29-owner'}
DISCLAIMER = '单操作者测试，不等于两个独立自然人交接'


def validate_identity_mode(config, now):
    actors = config.get('cp29WorkActors')
    if not isinstance(actors, dict) or set(actors) != {'partnerActorId', 'ownerActorId'}:
        raise ValueError('Explicit work actors required')
    subjects = config.get('trustedSubjects')
    if 'cp29IdentityMode' not in config:
        if 'cp29IdentityWindow' in config:
            raise ValueError('Identity window requires explicit mode')
        validate_mappings(subjects, partner_actor=actors['partnerActorId'], owner_actor=actors['ownerActorId'])
        return None
    if config['cp29IdentityMode'] != MODE:
        raise ValueError('Unknown identity mode')
    expected = {'origin': ORIGIN, 'environmentId': ENVIRONMENT, 'chainId': 10143,
                'deploymentId': DEPLOYMENT, 'runId': RUN}
    if any(type(config.get(k)) is not type(v) or config[k] != v for k, v in expected.items()):
        raise ValueError('Single operator mode is bound to the fixed CP29 deployment')
    # register_deployment emits lowercase addresses; checksum spelling is the
    # same fixed address, not a different deployment or expanded allowlist.
    address = config.get('contractAddress')
    if not isinstance(address, str) or address.lower() != CONTRACT.lower():
        raise ValueError('Fixed CP29 contract required')
    window = config.get('cp29IdentityWindow')
    if (not isinstance(window, dict) or set(window) != {'issuedAt', 'expiresAt'} or
            any(type(window[k]) is not int for k in window) or
            not window['issuedAt'] <= now < window['expiresAt'] or
            not 0 < window['expiresAt'] - window['issuedAt'] <= 8 * 3600):
        raise ValueError('Explicit current identity window, maximum eight hours, required')
    if actors != {'partnerActorId': ACTORS['partner'], 'ownerActorId': ACTORS['owner']}:
        raise ValueError('Fixed distinct work actors required')
    if (not isinstance(subjects, dict) or len(subjects) != 1 or
            any(not isinstance(k, str) or not FP_RE.fullmatch(k) for k in subjects)):
        raise ValueError('Exactly one verified keyed identity required')
    roles = next(iter(subjects.values()))
    if not isinstance(roles, dict) or set(roles) != set(ACTORS):
        raise ValueError('Both explicit fixed role mappings required')
    for role, actor in ACTORS.items():
        entry = roles[role]
        if (not isinstance(entry, dict) or set(entry) != {'actorId', 'revision'} or
                entry['actorId'] != actor or type(entry['revision']) is not int or entry['revision'] < 1):
            raise ValueError('Fixed actor with current mapping revision required')
    return window['expiresAt']
