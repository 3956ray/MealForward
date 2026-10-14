"""Static source-delta gate for migration 045. Safe without PG or private run.

Validate one tightly scoped forward-only replacement against pinned prior SQL;
for actual SQL execution also run the isolated PG17 test runner separately.
"""
from pathlib import Path
import hashlib, re, unittest

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text()

def extract(sql, name):
    pattern = r'(?m)^CREATE(?: OR REPLACE)? FUNCTION c1_runtime_internal\.' + re.escape(name) + r'\(n text,q jsonb\) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER.*?\$\$;'
    matches = re.findall(pattern, sql, re.S)
    if len(matches) != 1:
        raise AssertionError((name, len(matches)))
    return matches[0]

class HotfixSourceParity(unittest.TestCase):
    def setUp(self):
        self.migration = read('connection-migrations/045-live-runtime-hotfix-parity.sql')
        self.original_ledger = extract(read('migrations/019-private-original-ledger.sql'), 'ledger_reserve')
        self.original_live = extract(read('connection-migrations/044-live-multi-meal.sql'), 'live_api')
        self.new_ledger = extract(self.migration, 'ledger_reserve')
        self.new_live = extract(self.migration, 'live_api')

    def test_originals_are_pinned(self):
        expected = {
            'migrations/019-private-original-ledger.sql': '63d49ac17054446e51c7474db2c45f54bd20a7fe4d4adcc4658b92554cd3331c',
            'connection-migrations/043-live-catalog-execution.sql': 'c79e1e5d7b5c7164486f44069afa4229645d005538ae2de8bb06faf5cd4a6c4b',
            'connection-migrations/044-live-multi-meal.sql': 'cf82137dd1ca66c4a850912d9bea0f5bf42986fbab728eaff7ce6541a423b8bf',
        }
        for path, digest in expected.items():
            self.assertEqual(hashlib.sha256((ROOT/path).read_bytes()).hexdigest(), digest, path)
        for name, data in (('ledger_reserve', self.original_ledger), ('live_api', self.original_live)):
            digest = hashlib.sha256(data.encode()).hexdigest()
            self.assertIn('Original '+ ('019' if name=='ledger_reserve' else '044') +' '+name+' function SHA256: '+digest, self.migration)

    def test_guard_rejects_initialized_runtime(self):
        self.assertIn('IF EXISTS (SELECT 1 FROM c1_runtime_private.state)',self.migration)
        self.assertIn('FRESH_UNINITIALIZED_RUNTIME_REQUIRED',self.migration)
        self.assertIn('TO c1_auto_binding;',self.migration)

    def test_ledger_reservation_exact_delta(self):
        old = "OR (a.role='operatorAuthority' AND a.reservation_original->>'operation' IN('lock','markHandover','report'))) THEN"
        replacement = "OR (a.role='operatorAuthority' AND a.reservation_original->>'operation' IN('lock','markHandover','report'))\n OR (a.role='catalogAuthority' AND a.reservation_original->>'operation' IN('publish','setListed'))) THEN"
        self.assertEqual(self.original_ledger.count(old),1)
        self.assertEqual(self.new_ledger, self.original_ledger.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1).replace(old,replacement))
        self.assertEqual(self.new_ledger.count('SIGNING_GRANT_REQUIRED'),1)
        self.assertEqual(self.new_ledger.count('ORIGINAL_NONCE_ALREADY_RESERVED'),1)

    def test_capacity_exact_delta(self):
        old = "AND action='fund' AND stage<>'FINAL_SUCCEEDED'),0)>10 THEN PERFORM fail('CAPACITY');END IF;"
        replacement = "AND action='fund' AND stage<>'FINAL_SUCCEEDED' AND (signed_quote IS NULL OR (parameters->>'deadline')::bigint>now)),0)>10 THEN PERFORM fail('CAPACITY');END IF;"
        self.assertEqual(self.original_live.count(old),1)
        self.assertEqual(self.new_live,self.original_live.replace(old,replacement))
        self.assertIn("RETURN jsonb_build_object('reviewId'",self.new_live)
        self.assertIn("action='issue'",self.new_live)

    def test_migration_has_only_expected_top_level_commands(self):
        self.assertTrue(self.migration.startswith('-- CP30 fresh-install SQL parity'))
        self.assertEqual(self.migration.count('CREATE OR REPLACE FUNCTION c1_runtime_internal.'),2)
        self.assertEqual(self.migration.count('GRANT EXECUTE ON FUNCTION'),1)
        self.assertNotIn('DROP TABLE ',self.migration.upper())
        self.assertNotIn('TRUNCATE ',self.migration.upper())
        self.assertNotIn('ALTER ROLE ',self.migration.upper())
        self.assertNotIn('UPDATE c1_runtime_private.state SET',self.migration)

if __name__=='__main__':
    unittest.main()
