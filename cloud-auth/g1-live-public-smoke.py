#!/usr/bin/env python3
"""Anonymous, read-only public HTTPS smoke test of G1 Auth Pilot boundaries.

No cookies, SIWE challenges, signatures, wallets, passwords, original data,
state changes or fund/issue/settlement operations. Never send any POST request.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ORIGIN = "https://mealforward-cp31-auth-laodao.onrender.com"
ROUTES = {
    "/health": (200, "ready"),
    "/v1/connection": (200, "CP31_AUTH_PILOT_ONLY"),
    "/v1/identity/setup": (200, None),
    "/v1/stores": (503, "ORIGINAL_BUSINESS_NOT_CONNECTED"),
    "/v1/ledger": (503, "ORIGINAL_BUSINESS_NOT_CONNECTED"),
    "/v1/my/orders": (503, "ORIGINAL_BUSINESS_NOT_CONNECTED"),
    "/v1/my/claims": (503, "ORIGINAL_BUSINESS_NOT_CONNECTED"),
    "/v1/my/vouchers": (503, "ORIGINAL_BUSINESS_NOT_CONNECTED"),
    "/v1/me": (401, "UNAUTHENTICATED"),
    "/v1/store-registrations": (401, "UNAUTHENTICATED"),
}


def safe_get(path):
    request = urllib.request.Request(
        ORIGIN + path, method="GET",
        headers={"Accept": "application/json", "Cache-Control": "no-store"},
    )
    try:
        response = urllib.request.urlopen(request, timeout=35)
    except urllib.error.HTTPError as exception:
        response = exception
    with response:
        if urllib.parse.urlsplit(response.geturl()).netloc != urllib.parse.urlsplit(ORIGIN).netloc:
            raise ValueError("ORIGIN_REDIRECT_DENIED")
        if "application/json" not in response.headers.get("content-type", ""):
            raise ValueError("NONJSON_SERVICE_RESPONSE")
        raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError("RESPONSE_TOO_LARGE")
        return response.status, json.loads(raw)


def run():
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("MF_G1_PUBLIC_SMOKE_ALLOWED") != "yes":
        raise ValueError("CI_READ_ONLY_OPT_IN_REQUIRED")
    for attempt in range(4):
        try:
            code, health = safe_get("/health")
            if code == 200 and health.get("status") == "ready":
                break
        except (urllib.error.URLError, TimeoutError) as err:
            if attempt == 3:
                raise ValueError("AUTH_PILOT_UNREACHABLE") from None
        if attempt == 3:
            raise ValueError("AUTH_PILOT_HEALTH_NOT_READY")
        time.sleep(7)
    for path, (expected_code, expected_detail) in ROUTES.items():
        code, body = safe_get(path)
        if code != expected_code:
            raise ValueError("HTTP_STATUS_MISMATCH_" + path.replace("/", "_"))
        if path == "/health":
            if body.get("status") != expected_detail or body.get("mode") != "AUTH_PILOT_ONLY":
                raise ValueError("HEALTH_MODE_MISMATCH")
        elif path == "/v1/connection":
            if any((
                body.get("mode") != expected_detail,
                body.get("authPilot") is not True,
                body.get("walletActionsEnabled") is True,
                body.get("transactionActionsEnabled") is not False,
                body.get("businessSourceConnected") is not False,
                body.get("originalPrincipalCompatible") is not False,
            )):
                raise ValueError("G1_SOURCE_MODE_NOT_PINNED")
        elif path == "/v1/identity/setup":
            if (body.get("walletLoginEnabled") is not True
                or body.get("walletLoginChainId") != 10143
                or body.get("walletLoginOrigin") != ORIGIN):
                raise ValueError("SIWE_ORIGIN_OR_CHAIN_MISMATCH")
        else:
            if body.get("error") != expected_detail:
                raise ValueError("ABSENT_BUSINESS_NOT_FAIL_CLOSED")
            if code == 503 and body.get("mode") != "CP31_AUTH_PILOT_ONLY":
                raise ValueError("BUSINESS_UNAVAILABLE_MODE_MISSING")

    print(json.dumps({
        "status": "G1_AUTH_PILOT_PUBLIC_HTTPS_PASS",
        "health": "READY",
        "authenticationProtocol": "REAL_SIWE_PILOT_NOT_BUSINESS",
        "businessSourceConnected": False,
        "originalPrincipalCompatible": False,
        "businessRoutesConfirmedUnavailable": 5,
        "anonymousPrivateReadRejected": True,
        "walletOrFundTransactionSent": False,
        "originalCP30RuntimeTouched": False,
    }, sort_keys=True))


if __name__ == "__main__":
    try:
        run()
    except Exception as exception:
        # No response bodies, tokens, cookies, private data or stack traces.
        code = str(exception) if isinstance(exception, ValueError) else type(exception).__name__
        print(json.dumps({"status": "G1_AUTH_PILOT_PUBLIC_HTTPS_BLOCKED", "reason": code[:95]}), file=sys.stderr)
        sys.exit(1)
