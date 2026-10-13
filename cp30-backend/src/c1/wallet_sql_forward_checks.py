"""Bounded source checks for 027; no PostgreSQL, run data or journal access.

The assignment check covers the failing security_mutations UPDATE only. It is
not a PostgreSQL parser or a substitute for the owned normal PG validation.
"""
import hashlib
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
ORIGINAL_SHA = '2636058c20a4515b58562e3cbc58e7820006dbf9ddefc0e0e4edb9081669677e'


def function_body(source):
    match = re.search(r'CREATE (?:OR REPLACE )?FUNCTION c1_api\.security_apply\(n text,q jsonb\).*?AS \$\$(.*?)\$\$;', source, re.S)
    if not match:
        raise AssertionError('security_apply function absent')
    return match.group(1)


def mutation_assignment_collisions(body, schema):
    declarations = body.split('DECLARE', 1)[1].split('BEGIN', 1)[0]
    variables = {part.strip().split()[0] for part in declarations.split(';') if part.strip()}
    table = re.search(r'CREATE TABLE c1_private\.security_mutations\((.*?)\);', schema, re.S).group(1)
    columns = set(re.findall(r'(?:^|,)\s*(\w+)\s+(?:text|uuid|jsonb|bigint)\b', table))
    collisions = set()
    for assignments in re.findall(r'UPDATE security_mutations SET (.*?) WHERE ', body, re.S):
        for assignment in assignments.split(','):
            rhs = assignment.split('=', 1)[1]
            collisions |= set(re.findall(r'(?<![\w.])\b(\w+)\b(?!\s*\.)', rhs)) & variables & columns
    return collisions


class Checks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        original = (ROOT / 'connection-migrations/026-wallet-principal.sql').read_bytes()
        if hashlib.sha256(original).hexdigest() != ORIGINAL_SHA:
            raise AssertionError('installed 026 source changed')
        cls.original = function_body(original.decode())
        cls.forward = (ROOT / 'connection-migrations/027-wallet-security-result.sql').read_text()
        cls.corrected = function_body(cls.forward)
        cls.schema = (ROOT / 'migrations/001-business.sql').read_text()

    def test_reproduced_name_collision_is_absent_after_forward_fix(self):
        self.assertEqual(mutation_assignment_collisions(self.original, self.schema), {'result'})
        self.assertEqual(mutation_assignment_collisions(self.corrected, self.schema), set())

    def test_challenge_and_login_commit_the_local_response(self):
        self.assertIn("v_result=jsonb_build_object('challenge',p->'challenge')", self.corrected)
        self.assertIn("v_result=jsonb_build_object('authenticated',true", self.corrected)
        self.assertIn('VALUES(n,m.id,m.sequence,m.digest,v_result,f)', self.corrected)
        self.assertIn("state='APPLIED',result=v_result WHERE ns=n AND id=m.id;RETURN v_result", self.corrected)

    def test_only_local_variable_changes_without_owner_acl_or_data_edits(self):
        self.assertEqual(re.sub(r'\bv_result\b', 'result', self.corrected), self.original)
        outside = self.forward.replace('$$' + self.corrected + '$$', '$$BODY$$')
        outside = re.sub(r'--[^\n]*', '', outside).strip()
        self.assertEqual(outside, 'CREATE OR REPLACE FUNCTION c1_api.security_apply(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$BODY$$;')
        self.assertNotIn('#variable_conflict', self.corrected)


if __name__ == '__main__':
    unittest.main()
