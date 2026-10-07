"""Composition-only policies; requests cannot select a network or rule."""
from dataclasses import dataclass
from server.chain.client import RULE


@dataclass(frozen=True)
class BusinessPolicy:
    chain_id: int
    rule: str
    max_quantity: int
    wallet_kinds: tuple
    shared_service_signer: bool = False


LOCAL_POLICY = BusinessPolicy(31337, RULE, 20, ('local-test', 'dynamic', 'mera'))


def validate_policy(policy, deployment):
    if policy is LOCAL_POLICY:
        if deployment['chainId'] != 31337: raise ValueError('Local policy requires 31337')
        return
    from server.manual_business.policy import MANUAL_POLICY
    if policy is not MANUAL_POLICY or deployment['chainId'] != 10143:
        raise ValueError('Unrecognized composition policy')
