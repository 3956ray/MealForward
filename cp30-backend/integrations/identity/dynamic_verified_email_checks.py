"""Small pure-memory contract checks. No live token, HTTP, secrets or sessions."""

import copy
import ast
import json
import unittest

from dynamic_verified_email import (
    DynamicVerifiedEmailError, ENVIRONMENT_ID, PROFILE_ERROR_CODES, PROFILE_TRANSPORT_ERROR_CODES,
    _FETCH_SCRIPT, _request_headers, verify_dynamic_verified_email,
)

SUBJECT = "95b11417-f18f-457f-8804-68e361f9164f"
EMAIL = "example@example.invalid"
# Explicit synthetic compact-token shape; never authenticated or sent on a network.
TOKEN = "synthetic.synthetic.synthetic"
ORIGIN = "https://127.0.0.1:18443"
PROFILE = {
    "id": SUBJECT, "projectEnvironmentId": ENVIRONMENT_ID, "email": EMAIL,
    "verifiedCredentials": [
        {"id": SUBJECT + "-wallet", "format": "blockchain", "signInEnabled": True,
         "extra_sensitive": "ignored"},
        {"id": "email-credential", "format": "email", "signInEnabled": True,
         "email": EMAIL, "public_identifier": EMAIL},
    ],
    "extra_sensitive": {"ignored": True},
}


class ProfileChecks(unittest.TestCase):
    @staticmethod
    def forbidden_json(parsed):
        # Execute only the worker's exact pure classifier AST; no worker imports,
        # environment clearing, stdin, HTTP or subprocess execution in these checks.
        tree = ast.parse(_FETCH_SCRIPT)
        definition = next(node for node in tree.body
                          if isinstance(node, ast.FunctionDef) and node.name == "classify_forbidden_json")
        namespace = {}
        exec(compile(ast.Module(body=[definition], type_ignores=[]), "<pure-diagnostic>", "exec"), namespace)
        result = namespace["classify_forbidden_json"](parsed)
        if result not in PROFILE_TRANSPORT_ERROR_CODES:
            raise AssertionError("Unapproved diagnostic code")
        return result

    def verify(self, profile, **overrides):
        calls = []

        def fetch(token, *, expected_origin, verified_session_public_key, timeout):
            calls.append((token == TOKEN, expected_origin == ORIGIN,
                          verified_session_public_key == inputs.get("verified_session_public_key"),
                          0 < timeout <= 3.0))
            return json.dumps(profile).encode()

        inputs = {"expected_subject": SUBJECT, "expected_environment": ENVIRONMENT_ID,
                  "canonical_expected_email": EMAIL, "expected_origin": ORIGIN}
        inputs.update(overrides)
        result = verify_dynamic_verified_email(
            TOKEN, **inputs, canonical_email=lambda value: value.strip().lower(), fetch=fetch)
        self.assertEqual(calls, [(True, True, True, True)])
        self.assertIs(result, True)

    def test_normal_single_get_ignores_extra_fields(self):
        self.verify(PROFILE)

    def test_public_identifier_only_uses_main_canonical_policy(self):
        profile = copy.deepcopy(PROFILE)
        del profile["verifiedCredentials"][1]["email"]
        profile["verifiedCredentials"][1]["public_identifier"] = EMAIL.upper()
        self.verify(profile)

    def test_exact_binding_and_unique_enabled_email(self):
        examples = []
        for field, code in (("id", "SUBJECT_MISMATCH"),
                            ("projectEnvironmentId", "ENVIRONMENT_MISMATCH"),
                            ("email", "TOP_EMAIL_MISMATCH")):
            profile = copy.deepcopy(PROFILE)
            profile[field] = "different"
            examples.append((profile, code))
        profile = copy.deepcopy(PROFILE)
        profile["verifiedCredentials"][1]["public_identifier"] = "other@example.invalid"
        examples.append((profile, "EMAIL_CREDENTIAL_VALUE_MISMATCH"))
        profile = copy.deepcopy(PROFILE)
        profile["verifiedCredentials"][1]["signInEnabled"] = False
        examples.append((profile, "EMAIL_CREDENTIAL_DISABLED"))
        profile = copy.deepcopy(PROFILE)
        duplicate = copy.deepcopy(profile["verifiedCredentials"][1])
        duplicate["id"] = "second-email-credential"
        profile["verifiedCredentials"].append(duplicate)
        examples.append((profile, "EMAIL_CREDENTIAL_AMBIGUOUS"))
        for profile, code in examples:
            with self.subTest(case=len(profile["verifiedCredentials"])):
                with self.assertRaises(DynamicVerifiedEmailError) as caught:
                    self.verify(profile)
                self.assertEqual(str(caught.exception), "DYNAMIC_PROFILE_" + code)
                self.assertIn(caught.exception.code, PROFILE_ERROR_CODES)

    def test_nonboolean_credential_flag_rejected(self):
        profile = copy.deepcopy(PROFILE)
        profile["verifiedCredentials"][1]["signInEnabled"] = 1
        with self.assertRaises(DynamicVerifiedEmailError) as caught:
            self.verify(profile)
        self.assertEqual(caught.exception.code, "DYNAMIC_PROFILE_CREDENTIALS_INVALID")

    def test_fixed_request_headers_with_approved_origins(self):
        for origin in (ORIGIN, "https://localhost:1024", "https://127.0.0.1:65535"):
            self.assertEqual(_request_headers(TOKEN, origin), {
                "Authorization": "Bearer " + TOKEN, "Origin": origin,
                "Accept": "application/json", "Accept-Encoding": "identity",
                "Content-Type": "application/json", "x-dyn-api-version": "API/0.73.0",
            })

    def test_verified_public_key_encoding_and_optional_header(self):
        # Encoding-shaped synthetic public values only; no key generation/signing.
        for public_key in ("02" + "11" * 32, "03" + "22" * 32, "04" + "33" * 64):
            self.verify(PROFILE, verified_session_public_key=public_key)
            headers = _request_headers(TOKEN, ORIGIN, public_key)
            self.assertEqual(headers["x-dyn-session-public-key"], public_key)
        self.assertNotIn("x-dyn-session-public-key", _request_headers(TOKEN, ORIGIN))
        compile(_FETCH_SCRIPT, "<fixed-profile-worker>", "exec")

    def test_email_credential_missing_has_fixed_code(self):
        profile = copy.deepcopy(PROFILE)
        profile["verifiedCredentials"] = profile["verifiedCredentials"][:1]
        with self.assertRaises(DynamicVerifiedEmailError) as caught:
            self.verify(profile)
        self.assertEqual(caught.exception.code, "DYNAMIC_PROFILE_EMAIL_CREDENTIAL_MISSING")

    def test_official_top_and_nested_403_codes(self):
        for code, suffix in (
            ("invalid_session_public_key", "INVALID_SESSION_PUBLIC_KEY"),
            ("invalid_cors_origins", "INVALID_CORS_ORIGINS"),
            ("invalid_scopes", "INVALID_SCOPES"), ("invalid_user", "INVALID_USER"),
        ):
            expected = "DYNAMIC_PROFILE_HTTP_403_" + suffix
            self.assertEqual(self.forbidden_json({"error": "ignored", "code": code}), expected)
            self.assertEqual(self.forbidden_json({"error": {"message": "ignored", "code": code}}), expected)
            self.assertEqual(self.forbidden_json({"code": code, "error": {"code": code}}), expected)

    def test_403_structure_only_categories(self):
        for parsed, suffix in (
            ({"error": "ignored"}, "ERROR_NO_CODE"),
            ({"error": {"message": "ignored"}}, "NESTED_ERROR_NO_CODE"),
            ({"error": "ignored", "code": "unrecognized"}, "TOP_CODE_UNKNOWN"),
            ({"error": {"code": "unrecognized"}}, "NESTED_CODE_UNKNOWN"),
            ({"code": "unrecognized", "error": {"code": "unrecognized"}}, "BOTH_CODE_UNKNOWN"),
            ({"code": "invalid_user", "error": {"code": "invalid_scopes"}}, "CODE_CONFLICT"),
            ({"code": None}, "CODE_INVALID"),
        ):
            self.assertEqual(self.forbidden_json(parsed), "DYNAMIC_PROFILE_HTTP_403_JSON_" + suffix)

    def test_cloudflare_exact_1010_has_fixed_denial_code(self):
        self.assertEqual(self.forbidden_json({
            "cloudflare_error": True, "error_code": 1010,
            "error_name": "browser_signature_banned", "detail": "ignored",
        }), "DYNAMIC_PROFILE_EDGE_ACCESS_DENIED_1010")

    def test_cloudflare_unknown_and_noncanonical_types_stay_fixed(self):
        for error_code, error_name in (
            ("1010", "browser_signature_banned"), (True, "browser_signature_banned"),
            (1010.0, "browser_signature_banned"), (1010, "unrecognized"),
            (9999, "unrecognized"),
        ):
            self.assertEqual(self.forbidden_json({
                "cloudflare_error": True, "error_code": error_code, "error_name": error_name,
            }), "DYNAMIC_PROFILE_EDGE_ACCESS_DENIED")
        self.assertEqual(self.forbidden_json({
            "cloudflare_error": "true", "error_code": 1010,
            "error_name": "browser_signature_banned",
        }), "DYNAMIC_PROFILE_HTTP_403_JSON_OTHER")


if __name__ == "__main__":
    unittest.main()
