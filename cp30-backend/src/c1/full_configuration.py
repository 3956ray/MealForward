"""Non-IO validation for explicitly reviewed fresh full-app source inputs."""
from copy import deepcopy
import hashlib,re
from urllib.parse import urlsplit
from .onboarding_adapter import IntegrationRejected

def validate_origin(origin,port):
    if type(port) is not int or not 1024<=port<=65535 or type(origin) is not str:raise ValueError('FIXED_HTTPS_ORIGIN_REQUIRED')
    parsed=urlsplit(origin)
    if parsed.scheme!='https' or parsed.hostname not in {'127.0.0.1','localhost'} or parsed.port!=port or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or parsed.netloc!=parsed.hostname+':'+str(port) or origin!='https://'+parsed.netloc:raise ValueError('FIXED_HTTPS_ORIGIN_REQUIRED')
    return origin

def validate_application(source,registrar_profile):
    p=deepcopy(source)
    if p.get('enabled') is not True or p.get('mode')!='CP30_FULL_APPLICATION':raise ValueError('FULL_APPLICATION_NOT_APPROVED')
    validate_origin(p['origin'],p['httpPort'])
    if p.get('allowedOriginApproved') is not True or p.get('allowedOrigin')!=p['origin']:raise ValueError('NEW_ORIGIN_APPROVAL_REQUIRED')
    claims=p['identity']['claimProfile'];email=p['identity']['emailProfile']
    if claims.get('verified') is not True or claims.get('issuer')!='app.dynamicauth.com/7fe95f70-e5cc-4c3c-beed-a133e81268dc' or type(claims.get('audiences')) is not list or (not claims['audiences'] and claims.get('allow_absent_audience') is not True):raise ValueError('NEW_CLAIM_PROFILE_REQUIRED')
    if email.get('approved') is not True:raise ValueError('SIGNED_EMAIL_PROFILE_REQUIRED')
    if email.get('mode')=='dynamic_verified_profile' and (claims['audiences']!=[p['origin']] or any(claims.get(key) is not False for key in ('allow_absent_audience','allow_absent_environment_id','allow_absent_sid'))):raise ValueError('VERIFIED_EMAIL_ORIGIN_NOT_CONFIGURED')
    from .identity_runtime import identity_modules
    adapter,_=identity_modules();normalized=dict(email)
    for field in ('email_path','verified_path','credentials_path'):
        if normalized.get(field) is not None:normalized[field]=tuple(normalized[field])
    if not adapter.SignedEmailClaimProfile(**normalized).ready():raise ValueError('SIGNED_EMAIL_PROFILE_REQUIRED')
    if claims.get('environment_id')!='7fe95f70-e5cc-4c3c-beed-a133e81268dc':raise ValueError('APPROVED_SANDBOX_ENVIRONMENT_REQUIRED')
    for key in ('walletKindRpc','registrationObserver','business','broadcastRpc'):
        if type(p.get(key)) is not dict:raise ValueError('COMPLETE_NEW_CONNECTION_INPUTS_REQUIRED')
    for settings in (p['walletKindRpc'],p['registrationObserver'],p['business'].get('rpc'),p['broadcastRpc']):
        if type(settings) is not dict or not {'endpoint','allowedEndpoints','allowedHosts','pythonExecutable'}<=set(settings):raise ValueError('REVIEWED_RPC_CONFIGURATION_REQUIRED')
        from .registrar_rpc import endpoint
        endpoint(settings)
    if p['walletKindRpc']['profile']['chainId']!=int(registrar_profile['chainId']) or p['registrationObserver']['profile']['chainId']!=int(registrar_profile['chainId']):raise ValueError('READONLY_CHAIN_PROFILE_MISMATCH')
    wallet=p['walletProof']
    if type(wallet.get('chainId')) is not int or wallet['chainId']!=int(registrar_profile['chainId']) or wallet.get('verifyingContract')!=registrar_profile['factory'] or wallet.get('backendOriginHash')!='0x'+hashlib.sha256(p['origin'].encode()).hexdigest():raise ValueError('ORIGIN_WALLET_DOMAIN_MISMATCH')
    if set(p['businessTemplate']['roles'])!={'quoteAuthority','issuerAuthority','operatorAuthority'}:raise ValueError('THREE_APPROVED_ROLES_REQUIRED')
    for role,value in p['businessTemplate']['roles'].items():
        caps=value['profileCaps'];grant=value['grant']
        if caps.get('registrar')!=registrar_profile['registrar'] or value.get('account')!=registrar_profile[role] or grant.get('enabled') is not True:raise ValueError('APPROVED_ROLE_TEMPLATE_REQUIRED')
        for key in ('maxGas','maxFeePerGas','maxPriorityFeePerGas','maxTransactionCostWei'):
            if type(caps.get(key)) is not str or not re.fullmatch('(0|[1-9][0-9]{0,77})',caps[key]):raise ValueError('CANONICAL_ROLE_CAPS_REQUIRED')
        if int(caps['maxGas'])<=0 or int(caps['maxFeePerGas'])<=0 or int(caps['maxPriorityFeePerGas'])>int(caps['maxFeePerGas']) or int(caps['maxGas'])*int(caps['maxFeePerGas'])>int(caps['maxTransactionCostWei']):raise ValueError('BOUNDED_ROLE_CAPS_REQUIRED')
    business=p['business'];asset=business['asset']
    if any(type(business.get(k)) is not dict for k in ('observer','approvalBudget')):raise ValueError('COMPLETE_BUSINESS_OBSERVER_INPUTS_REQUIRED')
    if asset.get('reviewed') is not True or asset.get('address')!=registrar_profile['asset'] or asset.get('chainId')!=int(registrar_profile['chainId']) or asset.get('decimals')!=registrar_profile['assetDecimals'] or asset.get('symbol')!=registrar_profile['assetSymbol']:raise ValueError('REVIEWED_ASSET_PROFILE_MISMATCH')
    return p
