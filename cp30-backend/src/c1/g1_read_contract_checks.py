"""CP31 G1 gateway regression: offline only, no PG17, signer, original runtime, or RPC.

Validates route -> original SQL command mapping, read-only ledger flag, and
source predicates that tie private records to the authenticated principal.
These source assertions DO NOT establish installed database/RLS correctness.
"""
from pathlib import Path
import unittest
from types import SimpleNamespace
from .live_checks import Ledger, Client
from .live_gateway import LiveGateway

MIGRATION = Path(__file__).resolve().parents[2] / 'connection-migrations' / '044-live-multi-meal.sql'
STORE = 'a' * 64


class G1ReadContractChecks(unittest.TestCase):
    def setUp(self):
        self.api,worker=Ledger(),Ledger()
        clients={role:Client() for role in ('quoteAuthority','issuerAuthority','operatorAuthority')}
        config={'enabled':True,'asset':{'chainId':31337,'address':'0x'+'2'*40,'decimals':6,
            'symbol':'TEST','codeHash':'0x'+'9'*64,'reviewed':True},'maxSnapshotAgeSeconds':120}
        self.gateway=LiveGateway(api_ledger=self.api,worker_ledger=worker,config=config,clients=clients,
            activation_gate=SimpleNamespace(allowed=lambda *_:True),clock=lambda:100)
        self.api.responses['live_api']={'items': []}

    def test_all_public_and_wallet_scoped_read_routes_use_read_only_transaction(self):
        routes = {
            '/v1/stores': 'public_stores',
            '/v1/ledger': 'public_ledger',
            '/v1/stores/' + STORE + '/meals': 'public_meals',
            '/v1/my/orders': 'my_orders',
            '/v1/my/claims': 'my_claims',
            '/v1/my/vouchers': 'my_vouchers',
        }
        for path, command in routes.items():
            with self.subTest(path=path):
                before=len(self.api.calls)
                payload = {'session_hash': 'd' * 64} if '/my/' in path else {}
                result = self.gateway.handle('GET', path, payload, {}, {})
                self.assertEqual(result, {'items': []})
                self.assertEqual(len(self.api.calls), before + 1)
                method, q, read_only = self.api.calls[-1]
                self.assertEqual((method, q['op'], read_only), ('live_api', command, True))
                self.assertEqual(q.get('session_hash'),payload.get('session_hash'))
                self.assertTrue(q['ticket']['readOnly'])

    def test_private_lookups_do_not_reclassify_post_or_mutate(self):
        self.api.responses['live_api']={'items': []}
        for path in ('/v1/my/orders', '/v1/my/claims', '/v1/my/vouchers'):
            with self.subTest(path=path):
                before=len(self.api.calls)
                with self.assertRaises(ValueError):
                    self.gateway.handle('POST', path, {'session_hash': 'a'*64}, {}, {})
                self.assertEqual(len(self.api.calls),before)

    def test_actual_checked_in_sql_binds_private_reads_to_server_subject(self):
        sql=MIGRATION.read_text(encoding='utf-8')
        start=sql.index("IF op='my_orders'")
        stop=sql.index("IF op='voucher_get'", start)
        scoped=sql[start:stop]
        self.assertIn("WHERE ns=n AND subject=s.subject AND action='fund'",scoped)
        self.assertIn("WHERE ns=n AND subject=s.subject AND recipient_key=ident.recipient_key AND action='issue'",scoped)
        self.assertIn("WHERE ns=n AND recipient_key=ident.recipient_key",scoped)
        get_start=sql.index("IF op='voucher_get'",stop)
        get_stop=sql.index("IF op IN('wallet_material'",get_start)
        self.assertIn("recipient_key=ident.recipient_key",sql[get_start:get_stop])

    def test_public_ledger_sql_has_only_aggregates_no_private_voucher_or_recipient(self):
        sql=MIGRATION.read_text(encoding='utf-8')
        start=sql.index("IF op='public_ledger'")
        stop=sql.index("IF op IN('my_orders'",start)
        public=sql[start:stop]
        for field in ("'store'","'financial'","'funded'"):
            self.assertIn(field,public)
        for forbidden in ("recipient_key","session_hash","display","signature","email","voucher_dto"):
            self.assertNotIn(forbidden,public.lower())

    def test_public_meals_project_live_catalog_version_not_draft(self):
        sql=MIGRATION.read_text(encoding='utf-8')
        self.assertIn("AND state='LIVE'",sql)
        self.assertIn("CREATE FUNCTION c1_live_private.menu_items(",sql)
        self.assertIn("'listed',j->'listed'",sql)
        self.assertIn("'version',v",sql)


if __name__=='__main__':
    unittest.main()
