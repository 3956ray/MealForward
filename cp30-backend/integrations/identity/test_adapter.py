"""Five pure mapping checks. Fake token verification exists only in these tests, never composition."""
import base64
import builtins
from dataclasses import replace
import hashlib
import hmac
import json
import unittest
from unittest.mock import patch, Mock

from server.dynamic_contracts import ClaimProfile, ENVIRONMENT_ID, VerifiedIdentity
from identity import (
    DynamicIdentityAdapter, IdentityAdapterError, SignedEmailClaimProfile, compose_dynamic_identity,
)


def compact(payload):
    def b64(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
    # Explicitly not a signed/valid JWT. The test seam checks mapping only.
    return b64({"alg": "RS256", "kid": "public-synthetic"}) + "." + b64(payload) + ".synthetic"


class NoNetworkJwks:
    def get_keys(self, kid):
        raise AssertionError("Mapping tests must never fetch or access verification keys")


class IdentityMappingTest(unittest.TestCase):
    def setUp(self):
        self.profile = ClaimProfile(ENVIRONMENT_ID, "public-synthetic-issuer", ("public-synthetic-audience",), True)
        # Fictional test paths; they are not claims claimed to exist in real Dynamic tokens.
        self.email_profile = SignedEmailClaimProfile(
            ("test_signed_email",), ("test_signed_email_verified",), "string", "boolean", True, mode="signed_boolean")
        self.payload = {"iss": self.profile.issuer, "sub": "public-synthetic-subject", "exp": 200,
                        "test_signed_email": "Alice@EXAMPLE.test", "test_signed_email_verified": True}
        self.verified = VerifiedIdentity(ENVIRONMENT_ID, self.profile.issuer, self.payload["sub"], 200,
                                         frozenset({"user:basic"}), None)
        self.dynamic_profile = replace(self.profile,issuer="app.dynamicauth.com/"+ENVIRONMENT_ID,audiences=("https://localhost:16443",))
        self.dynamic_verified = replace(self.verified,issuer=self.dynamic_profile.issuer)
        self.clock = lambda: 100
        self.jwks = NoNetworkJwks()
        self.canonical = Mock(side_effect=lambda raw: "Alice@example.test" if raw == "Alice@EXAMPLE.test" else raw)
        # Public, deterministic, in-memory fixture; no secret/profile/key file is read or written.
        fixture = b"PUBLIC_SYNTHETIC_HMAC_FIXTURE_NOT_A_SECRET"
        self.email_key = lambda email: hmac.new(fixture, b"test-email\0" + email.encode(), hashlib.sha256).hexdigest()
        self.subject_key = lambda env, issuer, sub: hmac.new(
            fixture, ("test-subject\0" + "\0".join((env, issuer, sub))).encode(), hashlib.sha256).hexdigest()

    def adapter(self, email_profile=None, *, missing=False, verified_email_provider=None):
        return DynamicIdentityAdapter(profile=self.dynamic_profile if email_profile is not None and email_profile.mode=="dynamic_verified_profile" else self.profile, jwks=self.jwks, clock=self.clock,
            email_profile=None if missing else (email_profile or self.email_profile),
            canonical_email=self.canonical, email_key=self.email_key, subject_key=self.subject_key,
            verified_email_provider=verified_email_provider)

    def testDynamicProfileModeRequiresFixedSignedEmailPath(self):
        profile=SignedEmailClaimProfile(email_path=("email",),email_type="string",
            approved=True,mode="dynamic_verified_profile")
        self.assertTrue(profile.ready())
        for bad in (replace(profile,approved=False),replace(profile,email_path=("other",)),
                replace(profile,verified_path=("email_verified",)),replace(profile,verified_type="boolean"),
                replace(profile,credentials_path=("verified_credentials",)),replace(profile,format_key="format"),
                replace(profile,credential_email_key="email")):
            self.assertFalse(bad.ready())

    def testDynamicProfileVerificationPrecedesProviderAndKeepsHmacBinding(self):
        profile=SignedEmailClaimProfile(email_path=("email",),email_type="string",
            approved=True,mode="dynamic_verified_profile")
        provider=Mock(return_value=True)
        adapter=self.adapter(profile,verified_email_provider=provider)
        raw=compact({**self.payload,"iss":self.dynamic_profile.issuer,"email":"Alice@EXAMPLE.test"})
        with patch("identity.adapter._load_verifier",return_value=Mock(side_effect=ValueError("inert rejection"))):
            with self.assertRaises(ValueError):adapter.verify_bearer("Bearer "+raw)
        provider.assert_not_called()
        with patch("identity.adapter._load_verifier",return_value=Mock(return_value=replace(self.dynamic_verified,subject="other"))):
            with self.assertRaises(IdentityAdapterError):adapter.verify_bearer("Bearer "+raw)
        provider.assert_not_called()
        with patch("identity.adapter._load_verifier",return_value=Mock(return_value=self.dynamic_verified)):
            identity=adapter.verify_bearer("Bearer "+raw)
        provider.assert_called_once_with(raw,self.dynamic_verified.subject,self.dynamic_verified.environment_id,
            "Alice@example.test",expected_origin=self.dynamic_profile.audiences[0],canonical_email=adapter._canonical,
            verified_session_public_key=None)
        binding=adapter.normalize_binding(identity)
        self.assertEqual(binding.email_key,self.email_key("Alice@example.test"))
        self.assertEqual(binding.subject_hash,self.subject_key(ENVIRONMENT_ID,self.dynamic_profile.issuer,self.payload["sub"]))

    def testDynamicProfileProviderMustExplicitlyVerify(self):
        profile=SignedEmailClaimProfile(email_path=("email",),email_type="string",
            approved=True,mode="dynamic_verified_profile")
        raw=compact({**self.payload,"iss":self.dynamic_profile.issuer,"email":"Alice@EXAMPLE.test"})
        for provider in (None,Mock(return_value=False),Mock(return_value="true"),
                Mock(side_effect=ValueError("Never expose private provider details"))):
            with patch("identity.adapter._load_verifier",return_value=Mock(return_value=self.dynamic_verified)):
                with self.assertRaises(IdentityAdapterError) as failed:
                    self.adapter(profile,verified_email_provider=provider).verify_bearer("Bearer "+raw)
            self.assertIn(failed.exception.code,{"VERIFIED_EMAIL_PROVIDER_NOT_CONFIGURED","EMAIL_CLAIM_REJECTED"})
            self.assertNotIn("provider details",str(failed.exception))

    def testDynamicProfileUsesOnlyVerifiedSessionPublicKey(self):
        profile=SignedEmailClaimProfile(email_path=("email",),email_type="string",
            approved=True,mode="dynamic_verified_profile")
        public_key="0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
        provider=Mock(return_value=True);adapter=self.adapter(profile,verified_email_provider=provider)
        payload={**self.payload,"iss":self.dynamic_profile.issuer,"email":"Alice@EXAMPLE.test"}
        for fields in ({"sessionPublicKey":public_key},{"session_public_key":public_key},
                {"sessionPublicKey":public_key,"session_public_key":public_key}):
            provider.reset_mock()
            with patch("identity.adapter._load_verifier",return_value=Mock(return_value=self.dynamic_verified)):
                adapter.verify_bearer("Bearer "+compact({**payload,**fields}))
            self.assertEqual(provider.call_args.kwargs['verified_session_public_key'],public_key)
        for fields in ({"sessionPublicKey":None},{"sessionPublicKey":None,"session_public_key":public_key},
                {"sessionPublicKey":public_key,"session_public_key":"03"+public_key[2:]}):
            provider.reset_mock()
            with patch("identity.adapter._load_verifier",return_value=Mock(return_value=self.dynamic_verified)):
                with self.assertRaises(IdentityAdapterError) as failed:
                    adapter.verify_bearer("Bearer "+compact({**payload,**fields}))
            self.assertEqual(failed.exception.code,"DYNAMIC_PROFILE_SESSION_PUBLIC_KEY_INVALID")
            provider.assert_not_called()

    def testDynamicProfileFixedDiagnosticCodesAndStatuses(self):
        from identity.dynamic_verified_email import DynamicVerifiedEmailError
        profile=SignedEmailClaimProfile(email_path=("email",),email_type="string",
            approved=True,mode="dynamic_verified_profile")
        raw=compact({**self.payload,"iss":self.dynamic_profile.issuer,"email":"Alice@EXAMPLE.test"})
        for code,status in (("DYNAMIC_PROFILE_HTTP_403",503),("DYNAMIC_PROFILE_TOP_EMAIL_MISMATCH",401)):
            provider=Mock(side_effect=DynamicVerifiedEmailError(code))
            with patch("identity.adapter._load_verifier",return_value=Mock(return_value=self.dynamic_verified)):
                with self.assertRaises(IdentityAdapterError) as failed:
                    self.adapter(profile,verified_email_provider=provider).verify_bearer("Bearer "+raw)
            self.assertEqual((failed.exception.code,failed.exception.status),(code,status))

    def testApprovedMappingPrivateIdentityAndHashedBinding(self):
        raw = compact(self.payload)
        adapter = self.adapter()
        with patch("identity.adapter._load_verifier", return_value=Mock(return_value=self.verified)) as load:
            identity = adapter.verify_bearer("Bearer " + raw)
            load.return_value.assert_called_once_with(raw, profile=self.profile, clock=self.clock, jwks=self.jwks)
        self.assertEqual(identity.private_projection(), {"environment_id": ENVIRONMENT_ID,
            "issuer": self.profile.issuer, "subject": self.payload["sub"], "email": "Alice@example.test", "expires_at": 200})
        self.assertNotIn("Alice", repr(identity))
        binding = adapter.normalize_binding(identity)
        self.assertEqual(binding.email_key, self.email_key("Alice@example.test"))
        self.assertEqual(binding.subject_hash, self.subject_key(ENVIRONMENT_ID, self.profile.issuer, self.payload["sub"]))
        self.assertEqual(set(binding.to_json()), {"environment_id", "issuer", "subject_hash", "email_key", "expires_at"})
        self.assertEqual(identity.public_projection(), {"status": "IDENTITY_VERIFIED", "expires_at": 200})
        self.assertEqual(binding.public_projection(), identity.public_projection())
        for value in (raw, "Alice@example.test", self.payload["sub"], "owner", "merchant"):
            self.assertNotIn(value, json.dumps(binding.public_projection()))

    def testAbsentOrUnapprovedMappingAndDependencyAreExplicit(self):
        for profile in (None, replace(self.email_profile, approved=False),
                        replace(self.email_profile, verified_type="string"), replace(self.email_profile, mode=None)):
            with self.subTest(profile=profile), patch("identity.adapter._load_verifier") as load:
                adapter = self.adapter(profile, missing=profile is None)
                with self.assertRaises(IdentityAdapterError) as failed:
                    adapter.verify_bearer("Bearer " + compact(self.payload))
                self.assertEqual(failed.exception.code, "EMAIL_PROFILE_NOT_CONFIGURED")
                self.assertEqual(failed.exception.status, 503)
                load.assert_not_called()
        with self.assertRaises(IdentityAdapterError) as failed:
            compose_dynamic_identity(profile=self.profile, clock=self.clock, email_profile=None,
                canonical_email=self.canonical, email_key=self.email_key, subject_key=self.subject_key)
        self.assertEqual(failed.exception.code, "EMAIL_PROFILE_NOT_CONFIGURED")
        actual_import = builtins.__import__
        def missing_dependency(name, *args, **kwargs):
            if name == "server.dynamic_jwt":
                raise ModuleNotFoundError("jwt unavailable in this synthetic test")
            return actual_import(name, *args, **kwargs)
        with patch("builtins.__import__", side_effect=missing_dependency):
            with self.assertRaises(IdentityAdapterError) as failed:
                self.adapter().verify_bearer("Bearer " + compact(self.payload))
            self.assertEqual(failed.exception.code, "DEPENDENCY_NOT_CONFIGURED")

    def testSubjectBindingAndStrictSignedVerificationEvidenceReject(self):
        for payload, verified, code in (
            (self.payload, replace(self.verified, subject="different-verified-subject"), "IDENTITY_BINDING_REJECTED"),
            ({**self.payload, "test_signed_email_verified": False}, self.verified, "EMAIL_CLAIM_REJECTED"),
            ({**self.payload, "test_signed_email_verified": "true"}, self.verified, "EMAIL_CLAIM_REJECTED"),
            ({k: v for k, v in self.payload.items() if k != "test_signed_email_verified"}, self.verified, "EMAIL_CLAIM_REJECTED"),
        ):
            with self.subTest(code=code), patch("identity.adapter._load_verifier", return_value=lambda *args, **kwargs: verified):
                with self.assertRaises(IdentityAdapterError) as failed:
                    self.adapter().verify_bearer("Bearer " + compact(payload))
                self.assertEqual(failed.exception.code, code)
        self.canonical.assert_not_called()

    def credential_profile(self, **changes):
        profile = SignedEmailClaimProfile(mode="signed_verified_credentials", approved=True, email_type="string",
            email_path=("test_signed_email",), credentials_path=("test_verified_credentials",),
            format_key="test_format", credential_email_key="test_public_identifier")
        return replace(profile, **changes)

    def testSignedVerifiedCredentialsUniqueTargetOrDirectEmail(self):
        credentials = [{"test_format": "blockchain", "test_public_identifier": "not-an-email"},
                       {"test_format": "email", "test_public_identifier": "Alice@example.test"},
                       {"test_format": "email", "test_public_identifier": "different@example.test"}]
        cases = [
            (self.credential_profile(), {**self.payload, "test_verified_credentials": credentials}),
            (self.credential_profile(email_path=None),
             {"iss": self.payload["iss"], "sub": self.payload["sub"], "exp": 200,
              "test_verified_credentials": credentials[:2]}),
            (self.credential_profile(credential_email_key="test_email"),
             {**self.payload, "test_verified_credentials": [{"test_format": "email", "test_email": "Alice@example.test"}]}),
        ]
        for profile, payload in cases:
            with self.subTest(profile=profile), patch("identity.adapter._load_verifier", return_value=Mock(return_value=self.verified)):
                adapter = self.adapter(profile)
                identity = adapter.verify_bearer("Bearer " + compact(payload))
                self.assertEqual(identity.email, "Alice@example.test")
                self.assertEqual(adapter.normalize_binding(identity).email_key, self.email_key("Alice@example.test"))

    def testSignedVerifiedCredentialsRejectsAmbiguityMissingTypesAndTopLevelOnly(self):
        email = {"test_format": "email", "test_public_identifier": "Alice@example.test"}
        for value in ([], [email, email], [{"test_format": "email"}],
                      [{"test_format": "email", "test_public_identifier": 123}],
                      [{"test_public_identifier": "Alice@example.test"}],
                      [{"test_format": True, "test_public_identifier": "Alice@example.test"}],
                      [{"test_format": "email", "public_identifier": "Alice@example.test"}],
                      [{"test_format": "email", "test_public_identifier": "different@example.test"}], {}, [None]):
            with self.subTest(value=value), patch("identity.adapter._load_verifier", return_value=Mock(return_value=self.verified)):
                with self.assertRaises(IdentityAdapterError) as failed:
                    self.adapter(self.credential_profile()).verify_bearer("Bearer " + compact(
                        {**self.payload, "test_verified_credentials": value}))
                self.assertEqual(failed.exception.code, "EMAIL_CLAIM_REJECTED")
        for payload, profile in (
            (self.payload, self.credential_profile()),
            ({**self.payload, "test_verified_credentials": [email, {"test_format": "email", "test_public_identifier": "different@example.test"}]},
             self.credential_profile(email_path=None)),
            ({**self.payload, "test_signed_email": 123, "test_verified_credentials": [email]}, self.credential_profile()),
        ):
            with self.subTest(profile=profile), patch("identity.adapter._load_verifier", return_value=Mock(return_value=self.verified)):
                with self.assertRaises(IdentityAdapterError) as failed:
                    self.adapter(profile).verify_bearer("Bearer " + compact(payload))
                self.assertEqual(failed.exception.code, "EMAIL_CLAIM_REJECTED")
        # Subject binding is evaluated before any credential inspection/normalization.
        self.canonical.reset_mock()
        with patch("identity.adapter._load_verifier", return_value=Mock(return_value=replace(self.verified, subject="other"))):
            with self.assertRaises(IdentityAdapterError) as failed:
                self.adapter(self.credential_profile()).verify_bearer("Bearer " + compact(
                    {**self.payload, "test_verified_credentials": [email]}))
            self.assertEqual(failed.exception.code, "IDENTITY_BINDING_REJECTED")
        self.canonical.assert_not_called()


if __name__ == "__main__":
    unittest.main()
