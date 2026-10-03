import unittest

from server.contracts import ApiError
from server.dynamic_contracts import CP17_COOKIES, ClaimProfile, ENVIRONMENT_ID
from server.dynamic_jwt import verify_access_token


class DynamicContractTests(unittest.TestCase):
    def test_unverified_profile_never_accepts_or_fetches(self):
        class NoNetwork:
            def get_keys(self, kid):
                raise AssertionError('An unverified profile must not fetch keys')
        with self.assertRaises(ApiError) as caught:
            verify_access_token('not-a-token', profile=ClaimProfile(ENVIRONMENT_ID, ''),
                                clock=lambda: 100, jwks=NoNetwork())
        self.assertEqual((caught.exception.status, caught.exception.code),
                         (503, 'DYNAMIC_PROFILE_UNVERIFIED'))

    def test_cookie_namespace_does_not_collide_with_legacy(self):
        self.assertEqual(len({CP17_COOKIES.work, CP17_COOKIES.support, CP17_COOKIES.recipient}), 3)
        self.assertTrue(all(value.startswith('cp17_') for value in vars(CP17_COOKIES).values()))
