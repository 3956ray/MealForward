"""Verified identity exchange slot; no assertion fallback, raw JWT storage or SDK IO."""
from .onboarding_adapter import IntegrationRejected

PUBLIC_ENVIRONMENT_ID='7fe95f70-e5cc-4c3c-beed-a133e81268dc'

class IdentityGateway:
    def __init__(self,adapter=None,session_authority=None,*,origin=None,service_client=None):
        self.adapter,self.authority,self.origin,self.client=adapter,session_authority,origin,service_client
    def setup(self):
        if self.client is not None:
            try:return self.client.setup()
            except Exception:return {'status':'NOT_CONFIGURED','sdkLoginEnabled':False,'walletProofEnabled':False,'missing':['Private verified-identity authority is unavailable']}
        missing=[]
        if self.adapter is None:missing.extend([
            'Reviewed JWT issuer, audience, sandbox/environment claim and JWKS policy for the new origin',
            'Reviewed signed-email claim path and signed verified-email evidence',
        ])
        if self.authority is None:missing.append('Private verified-identity/session/CSRF and wallet-binding persistence authority')
        return {'status':'NOT_CONFIGURED' if missing else 'CONFIGURED_NOT_ACTIVATED',
            'sdkLoginEnabled':not missing,'environmentId':PUBLIC_ENVIRONMENT_ID,'missing':missing,
            'publicReusable':['Dynamic sandbox environment ID only; this is not a verified JWT claim profile'],
            'newOriginRequirements':['Exact new HTTPS origin and Dynamic allowed-origin approval','Exact reviewed issuer/audience/environment and JWKS key/rotation policy','Signed email and verified-email claim mapping; no client email/roles','Session/CSRF namespace and owner-wallet binding proof authority']}
    def login(self,body,request_context):
        if self.setup()['missing']:raise IntegrationRejected('EMAIL_PROFILE_NOT_CONFIGURED',503)
        if type(body) is not dict or set(body)!={'accessToken'} or not isinstance(body['accessToken'],str) or len(body['accessToken'])>32768:raise IntegrationRejected('INVALID_REQUEST',422)
        # The concrete helper verifies JWT cryptography/claims before extracting
        # email evidence. The private authority atomically rotates session/CSRF
        # and preserves recovery/journal epochs; API callers cannot select actors.
        if self.client is not None:return self.client.call('login',body,request_context)
        verified=self.adapter.verify_bearer('Bearer '+body['accessToken'])
        binding=self.adapter.normalize_binding(verified)
        return self.authority.exchange_verified_identity(binding,request_context,self.origin)
    def wallet_prepare(self,body,context):
        if self.client is None or self.setup().get('walletProofEnabled') is not True:raise IntegrationRejected('WALLET_PROOF_NOT_CONFIGURED',503)
        return self.client.call('wallet_prepare',body,context)
    def wallet_submit(self,body,context):
        if self.client is None or self.setup().get('walletProofEnabled') is not True:raise IntegrationRejected('WALLET_PROOF_NOT_CONFIGURED',503)
        return self.client.call('wallet_submit',body,context)
    def wallet_login_challenge(self,body,context):
        if self.client is None or self.setup().get('walletLoginEnabled') is not True:raise IntegrationRejected('WALLET_LOGIN_DISABLED',503)
        return self.client.call('wallet_login_challenge',body,context)
    def wallet_login(self,body,context):
        if self.client is None or self.setup().get('walletLoginEnabled') is not True:raise IntegrationRejected('WALLET_LOGIN_DISABLED',503)
        return self.client.call('wallet_login',body,context)
