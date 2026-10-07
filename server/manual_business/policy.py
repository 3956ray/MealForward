from server.business_policy import BusinessPolicy
from .identity import RULE

MANUAL_POLICY = BusinessPolicy(10143, RULE, 3, ('metamask',), shared_service_signer=True)
