"""Fixed Dynamic profile supplement, called ONLY after strict access-JWT verification.

Main supplies the already verified subject/environment/signed email and its existing
pure canonical_email policy. This module creates no identity/session/role. Success
is only True; failures contain fixed codes, never response/token/email values.
Import is inert. Production fetch uses an isolated child with no inherited env;
the outer deadline also bounds DNS/TLS and slow response reads. No persistent data.

Official response contract:
https://www.dynamic.xyz/docs/api-reference/sdk/get-the-current-users-profile
Trusted test injection: fetch(raw_token, *, expected_origin: str,
verified_session_public_key: str | None, timeout: float) -> bytes. Injected
fetch must honor the supplied total budget; it is never selected by browser input.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from collections.abc import Callable

ENVIRONMENT_ID = "7fe95f70-e5cc-4c3c-beed-a133e81268dc"
PROFILE_URL = "https://app.dynamicauth.com/api/v0/sdk/" + ENVIRONMENT_ID + "/users"
MAX_RESPONSE_BYTES = 256 * 1024
TOTAL_SECONDS = 3.0
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_CREDENTIAL_ID = re.compile(r"[A-Za-z0-9_-]{1,160}")
_FORMAT = re.compile(r"[a-zA-Z][a-zA-Z0-9_-]{0,63}")
_TOKEN = re.compile(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
_ORIGIN = re.compile(r"https://(?:localhost|127\.0\.0\.1):([1-9][0-9]{3,4})")
# Installed Client keychain compresses P-256 raw SEC1, then emits lowercase hex
# without 0x. Installed utils raw exporter also emits lowercase hex without 0x.
# This checks encoding only; the public header is not an identity/signature proof.
_SESSION_PUBLIC_KEY = re.compile(r"(?:(?:02|03)[0-9a-f]{64}|04[0-9a-f]{128})")
PROFILE_TRANSPORT_ERROR_CODES = frozenset("DYNAMIC_PROFILE_" + suffix for suffix in (
    "NETWORK", "TIMEOUT", "HTTP_401", "HTTP_403", "HTTP_429", "HTTP_OTHER",
    "CONTENT_TYPE", "CONTENT_ENCODING", "SIZE", "HTTP_403_HTML",
    "HTTP_403_JSON_OTHER", "HTTP_403_INVALID_SESSION_PUBLIC_KEY",
    "HTTP_403_INVALID_CORS_ORIGINS", "HTTP_403_INVALID_SCOPES", "HTTP_403_INVALID_USER",
    "HTTP_403_JSON_ERROR_NO_CODE", "HTTP_403_JSON_NESTED_ERROR_NO_CODE",
    "HTTP_403_JSON_TOP_CODE_UNKNOWN", "HTTP_403_JSON_NESTED_CODE_UNKNOWN",
    "HTTP_403_JSON_BOTH_CODE_UNKNOWN", "HTTP_403_JSON_CODE_CONFLICT",
    "HTTP_403_JSON_CODE_INVALID", "EDGE_CHALLENGE",
    "EDGE_ACCESS_DENIED_1010", "EDGE_ACCESS_DENIED",
))
PROFILE_ERROR_CODES = PROFILE_TRANSPORT_ERROR_CODES | frozenset(
    "DYNAMIC_PROFILE_" + suffix for suffix in (
        "INPUT_INVALID", "ORIGIN_INVALID", "SESSION_PUBLIC_KEY_INVALID", "PARSE", "SUBJECT_MISMATCH",
        "ENVIRONMENT_MISMATCH", "TOP_EMAIL_MISMATCH", "CREDENTIALS_INVALID",
        "EMAIL_CREDENTIAL_MISSING", "EMAIL_CREDENTIAL_AMBIGUOUS",
        "EMAIL_CREDENTIAL_DISABLED", "EMAIL_CREDENTIAL_VALUE_MISMATCH",
    )
)


class DynamicVerifiedEmailError(ValueError):
    """Fixed code only. Caller must not log function arguments or response bytes."""

    def __init__(self, code: str = "DYNAMIC_PROFILE_INPUT_INVALID"):
        self.code = code if code in PROFILE_ERROR_CODES else "DYNAMIC_PROFILE_INPUT_INVALID"
        super().__init__(self.code)


def _validate_origin(origin: str) -> None:
    match = _ORIGIN.fullmatch(origin) if type(origin) is str else None
    if not match or not 1024 <= int(match[1]) <= 65535:
        raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_ORIGIN_INVALID")


def _validate_session_public_key(key: str | None) -> None:
    if key is not None and (type(key) is not str or not _SESSION_PUBLIC_KEY.fullmatch(key)):
        raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_SESSION_PUBLIC_KEY_INVALID")


def _request_headers(raw_token: str, expected_origin: str,
                     verified_session_public_key: str | None = None) -> dict[str, str]:
    """Pure trusted metadata helper; never logged or exposed by production callers."""
    _validate_origin(expected_origin)
    _validate_session_public_key(verified_session_public_key)
    headers = {"Authorization": "Bearer " + raw_token, "Origin": expected_origin,
               "Accept": "application/json", "Accept-Encoding": "identity",
               "Content-Type": "application/json", "x-dyn-api-version": "API/0.73.0"}
    if verified_session_public_key is not None:
        headers["x-dyn-session-public-key"] = verified_session_public_key
    return headers


# Empty env plus -I prevent proxy, Python, CA overrides and inherited secrets.
# macOS may insert locale env on launch: clear it before importing network code.
# Token, approved Origin and optional verified public key use bounded JSON stdin.
_FETCH_SCRIPT = r'''
import os
os.environ.clear()
import sys, ssl, urllib.request, urllib.error, socket, json, re
class FixedError(Exception):
    pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if headers.get('cf-mitigated', '').strip().lower() == 'challenge':
            raise FixedError('DYNAMIC_PROFILE_EDGE_CHALLENGE')
        raise FixedError('DYNAMIC_PROFILE_HTTP_OTHER')
def fail(code):
    # Only fixed allowlisted code; never exception text or response body.
    sys.stdout.write(json.dumps({'error': code}, separators=(',', ':')))
    sys.exit(1)
def check_headers(response):
    if response.headers.get('cf-mitigated', '').strip().lower() == 'challenge':
        raise FixedError('DYNAMIC_PROFILE_EDGE_CHALLENGE')
def read_body(response):
    if response.headers.get('Content-Encoding', 'identity').lower() != 'identity':
        raise FixedError('DYNAMIC_PROFILE_CONTENT_ENCODING')
    length = response.headers.get('Content-Length')
    if length is not None and (not length.isdecimal() or int(length) > 262144):
        raise FixedError('DYNAMIC_PROFILE_SIZE')
    body = response.read(262145)
    if not body or len(body) > 262144:
        raise FixedError('DYNAMIC_PROFILE_SIZE')
    return body
def classify_forbidden_json(parsed):
    # SDK APIError reads top-level code; official OpenAPI also permits error.code.
    # Return ONLY fixed diagnostic constants, never error/message/payload values.
    if type(parsed) is not dict:
        return 'DYNAMIC_PROFILE_HTTP_403_JSON_OTHER'
    if type(parsed.get('cloudflare_error')) is bool and parsed['cloudflare_error'] is True:
        if (type(parsed.get('error_code')) is int and parsed['error_code'] == 1010
                and parsed.get('error_name') == 'browser_signature_banned'):
            return 'DYNAMIC_PROFILE_EDGE_ACCESS_DENIED_1010'
        return 'DYNAMIC_PROFILE_EDGE_ACCESS_DENIED'
    error = parsed.get('error')
    top_present = 'code' in parsed
    nested_present = type(error) is dict and 'code' in error
    top = parsed.get('code')
    nested = error.get('code') if type(error) is dict else None
    if not top_present and not nested_present:
        if type(error) is str:
            return 'DYNAMIC_PROFILE_HTTP_403_JSON_ERROR_NO_CODE'
        if type(error) is dict:
            return 'DYNAMIC_PROFILE_HTTP_403_JSON_NESTED_ERROR_NO_CODE'
        return 'DYNAMIC_PROFILE_HTTP_403_JSON_OTHER'
    if (top_present and type(top) is not str) or (nested_present and type(nested) is not str):
        return 'DYNAMIC_PROFILE_HTTP_403_JSON_CODE_INVALID'
    if top_present and nested_present and top != nested:
        return 'DYNAMIC_PROFILE_HTTP_403_JSON_CODE_CONFLICT'
    code = top if top_present else nested
    known = {
        'invalid_session_public_key': 'DYNAMIC_PROFILE_HTTP_403_INVALID_SESSION_PUBLIC_KEY',
        'invalid_cors_origins': 'DYNAMIC_PROFILE_HTTP_403_INVALID_CORS_ORIGINS',
        'invalid_scopes': 'DYNAMIC_PROFILE_HTTP_403_INVALID_SCOPES',
        'invalid_user': 'DYNAMIC_PROFILE_HTTP_403_INVALID_USER',
    }
    if code in known:
        return known[code]
    if top_present and nested_present:
        return 'DYNAMIC_PROFILE_HTTP_403_JSON_BOTH_CODE_UNKNOWN'
    return ('DYNAMIC_PROFILE_HTTP_403_JSON_TOP_CODE_UNKNOWN' if top_present else
            'DYNAMIC_PROFILE_HTTP_403_JSON_NESTED_CODE_UNKNOWN')
def forbidden_code(response):
    check_headers(response)
    content_type = response.headers.get_content_type()
    if content_type == 'text/html':
        return 'DYNAMIC_PROFILE_HTTP_403_HTML'
    if content_type != 'application/json':
        return 'DYNAMIC_PROFILE_HTTP_403'
    body = read_body(response)
    try:
        parsed = json.loads(body.decode('utf-8'))
        return classify_forbidden_json(parsed)
    except Exception:
        pass
    return 'DYNAMIC_PROFILE_HTTP_403_JSON_OTHER'
try:
    wire = sys.stdin.buffer.read(17409)
    if len(wire) > 17408:
        raise FixedError('DYNAMIC_PROFILE_INPUT_INVALID')
    wrapper = json.loads(wire.decode('ascii'))
    if type(wrapper) is not dict or set(wrapper) != {'token', 'origin', 'sessionPublicKey'}:
        raise FixedError('DYNAMIC_PROFILE_INPUT_INVALID')
    token, origin = wrapper['token'], wrapper['origin']
    if (type(token) is not str or not 1 <= len(token) <= 16384 or
            not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', token)):
        raise FixedError('DYNAMIC_PROFILE_INPUT_INVALID')
    match = re.fullmatch(r'https://(?:localhost|127\.0\.0\.1):([1-9][0-9]{3,4})', origin) if type(origin) is str else None
    if not match or not 1024 <= int(match[1]) <= 65535:
        raise FixedError('DYNAMIC_PROFILE_ORIGIN_INVALID')
    public_key = wrapper['sessionPublicKey']
    if public_key is not None and (type(public_key) is not str or not re.fullmatch(
            r'(?:(?:02|03)[0-9a-f]{64}|04[0-9a-f]{128})', public_key)):
        raise FixedError('DYNAMIC_PROFILE_SESSION_PUBLIC_KEY_INVALID')
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), NoRedirect(),
        urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    headers = {'Authorization': 'Bearer ' + token, 'Origin': origin,
               'Accept': 'application/json', 'Accept-Encoding': 'identity',
               'Content-Type': 'application/json', 'x-dyn-api-version': 'API/0.73.0'}
    if public_key is not None:
        headers['x-dyn-session-public-key'] = public_key
    request = urllib.request.Request(
        'https://app.dynamicauth.com/api/v0/sdk/7fe95f70-e5cc-4c3c-beed-a133e81268dc/users',
        headers=headers, method='GET')
    with opener.open(request, timeout=3.0) as response:
        check_headers(response)
        if response.status != 200:
            raise FixedError('DYNAMIC_PROFILE_HTTP_OTHER')
        if response.headers.get_content_type() != 'application/json':
            raise FixedError('DYNAMIC_PROFILE_CONTENT_TYPE')
        body = read_body(response)
    sys.stdout.buffer.write(body)
except FixedError as error:
    fail(error.args[0])
except urllib.error.HTTPError as error:
    try:
        check_headers(error)
        fail(forbidden_code(error) if error.code == 403 else
             'DYNAMIC_PROFILE_HTTP_' + str(error.code) if error.code in (401, 429) else
             'DYNAMIC_PROFILE_HTTP_OTHER')
    except FixedError as classified:
        fail(classified.args[0])
    except (TimeoutError, socket.timeout):
        fail('DYNAMIC_PROFILE_TIMEOUT')
    except Exception:
        fail('DYNAMIC_PROFILE_NETWORK')
except (TimeoutError, socket.timeout):
    fail('DYNAMIC_PROFILE_TIMEOUT')
except urllib.error.URLError as error:
    fail('DYNAMIC_PROFILE_TIMEOUT' if isinstance(error.reason, (TimeoutError, socket.timeout))
         else 'DYNAMIC_PROFILE_NETWORK')
except BaseException:
    fail('DYNAMIC_PROFILE_NETWORK')
'''


def _fixed_fetch(raw_token: str, *, expected_origin: str,
                 verified_session_public_key: str | None, timeout: float) -> bytes:
    _request_headers(raw_token, expected_origin, verified_session_public_key)
    try:
        result = subprocess.run(
            [sys.executable, "-I", "-B", "-c", _FETCH_SCRIPT],
            input=json.dumps({"token": raw_token, "origin": expected_origin,
                              "sessionPublicKey": verified_session_public_key},
                             separators=(",", ":"), ensure_ascii=True).encode("ascii"),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, env={}, timeout=timeout, check=False,
        )
        if result.returncode != 0:
            code = "DYNAMIC_PROFILE_NETWORK"
            if len(result.stdout) <= 256:
                try:
                    error = json.loads(result.stdout)
                    if (type(error) is dict and set(error) == {"error"}
                            and type(error["error"]) is str and error["error"] in PROFILE_ERROR_CODES):
                        code = error["error"]
                except Exception:
                    pass
            raise DynamicVerifiedEmailError(code)
        return result.stdout
    except subprocess.TimeoutExpired:
        raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_TIMEOUT") from None
    except DynamicVerifiedEmailError:
        raise
    except Exception:
        raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_NETWORK") from None


def _pairs(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_PARSE")
        result[key] = value
    return result


def _invalid_constant(value: str) -> None:
    raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_PARSE")


def verify_dynamic_verified_email(
    raw_token: str, expected_subject: str, expected_environment: str,
    canonical_expected_email: str, *, expected_origin: str,
    canonical_email: Callable[[str], str],
    verified_session_public_key: str | None = None,
    fetch: Callable[..., bytes] | None = None,
) -> bool:
    """One profile GET after JWT verification; True iff exact verified-email binding.

    Main must call outside any DB transaction, before creating its authenticated
    business session. Inputs are trusted verifier results, never browser claims.
    expected_origin is Main's approved ClaimProfile singleton audience, restricted
    to canonical HTTPS localhost/127.0.0.1 with an explicit port 1024..65535.
    canonical_email must be Main's existing pure, bounded string policy.
    verified_session_public_key comes only from the SAME strictly verified JWT
    claim; None omits the header. No private key/nonce/signature is requested.
    No subject/email/credential/token data is returned or retained on this module.
    """
    deadline = time.monotonic() + TOTAL_SECONDS

    def canonical(value: object, code: str) -> str:
        try:
            if type(value) is not str or not 1 <= len(value) <= 320:
                raise ValueError()
            normalized = canonical_email(value)
            if type(normalized) is not str or not 1 <= len(normalized) <= 320:
                raise ValueError()
            return normalized
        except Exception:
            raise DynamicVerifiedEmailError(code) from None

    try:
        _validate_origin(expected_origin)
        _validate_session_public_key(verified_session_public_key)
        if (type(raw_token) is not str or not 1 <= len(raw_token) <= 16384
                or not _TOKEN.fullmatch(raw_token)
                or type(expected_subject) is not str or not _UUID.fullmatch(expected_subject)
                or expected_environment != ENVIRONMENT_ID
                or type(expected_environment) is not str or not callable(canonical_email)
                or canonical(canonical_expected_email, "DYNAMIC_PROFILE_INPUT_INVALID") != canonical_expected_email):
            raise DynamicVerifiedEmailError()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_TIMEOUT")
        try:
            body = (fetch or _fixed_fetch)(
                raw_token, expected_origin=expected_origin,
                verified_session_public_key=verified_session_public_key, timeout=remaining)
        except DynamicVerifiedEmailError:
            raise
        except TimeoutError:
            raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_TIMEOUT") from None
        except Exception:
            raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_NETWORK") from None
        if type(body) is not bytes or not 1 <= len(body) <= MAX_RESPONSE_BYTES:
            raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_SIZE")
        try:
            profile = json.loads(body.decode("utf-8"), object_pairs_hook=_pairs,
                                 parse_constant=_invalid_constant)
            if type(profile) is not dict:
                raise ValueError()
        except Exception:
            raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_PARSE") from None
        if profile.get("id") != expected_subject:
            raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_SUBJECT_MISMATCH")
        if profile.get("projectEnvironmentId") != expected_environment:
            raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_ENVIRONMENT_MISMATCH")
        if canonical(profile.get("email"), "DYNAMIC_PROFILE_TOP_EMAIL_MISMATCH") != canonical_expected_email:
            raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_TOP_EMAIL_MISMATCH")
        credentials = profile.get("verifiedCredentials")
        if type(credentials) is not list or not 1 <= len(credentials) <= 128:
            raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_CREDENTIALS_INVALID")
        enabled_emails = []
        ids = set()
        for credential in credentials:
            if (type(credential) is not dict
                    or type(credential.get("id")) is not str
                    or not _CREDENTIAL_ID.fullmatch(credential["id"])
                    or credential["id"] in ids
                    or type(credential.get("format")) is not str
                    or not _FORMAT.fullmatch(credential["format"])
                    or type(credential.get("signInEnabled")) is not bool):
                raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_CREDENTIALS_INVALID")
            ids.add(credential["id"])
            if credential["format"] != "email":
                continue
            values = [canonical(credential[key], "DYNAMIC_PROFILE_EMAIL_CREDENTIAL_VALUE_MISMATCH")
                      for key in ("email", "public_identifier")
                      if key in credential]
            if not values or len(set(values)) != 1:
                raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_EMAIL_CREDENTIAL_VALUE_MISMATCH")
            if credential["signInEnabled"]:
                enabled_emails.append(values[0])
        email_count = sum(credential["format"] == "email" for credential in credentials)
        if not email_count:
            raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_EMAIL_CREDENTIAL_MISSING")
        if not enabled_emails:
            raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_EMAIL_CREDENTIAL_DISABLED")
        if len(enabled_emails) != 1:
            raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_EMAIL_CREDENTIAL_AMBIGUOUS")
        if enabled_emails != [canonical_expected_email]:
            raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_EMAIL_CREDENTIAL_VALUE_MISMATCH")
        if time.monotonic() >= deadline:
            raise DynamicVerifiedEmailError("DYNAMIC_PROFILE_TIMEOUT")
        return True
    except DynamicVerifiedEmailError:
        raise
    except Exception:
        raise DynamicVerifiedEmailError() from None
