"""Unimplemented private adapter contracts; keys and durable authority runtime are main-owned."""
from __future__ import annotations
from typing import Protocol

ORIGINAL_OPERATION_V1 = 'CP30_ORIGINAL_OPERATION_V1'


class PrivateQuoteAuthorityClient(Protocol):
    def sign_original_quote(self, record: dict) -> str:
        """Authenticated private client; retain original quoteId/full typed-data/digest.

        Return the fixed EOA quoteAuthority signature, never sign a changed request or
        create a new quoteId on a response-loss retry. No key is accepted by business codec.
        """
        ...


class PrivateOperationClient(Protocol):
    original_lookup_protocol: str  # Must be ORIGINAL_OPERATION_V1 in reviewed composition.
    expected_role: str             # issuerAuthority OR operatorAuthority, composition-pinned.

    def send_original(self, record: dict) -> str:
        """After durable UNKNOWN claim only, persist original scope/opId/paramsDigest/
        fixed deployment before any possibly signed/submitted action; return original hash.
        """
        ...

    def lookup_original(self, record: dict) -> str | None:
        """Read only the original durable attempt; None never authorizes a re-send.
        Verify same chain/escrow/role/caller/opId/paramsDigest/calldata, or reject.
        """
        ...
