"""Bounded 029 source regression checks, no PG/HTTP/chain or run files."""
import hashlib
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[2]


def body(source):
    return re.search(r'CREATE OR REPLACE FUNCTION c1_runtime_internal\.live_projection\(n text,q jsonb\).*?AS \$\$(.*?)\$\$;',source,re.S).group(1)


class Checks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        original=(ROOT/'connection-migrations/026-wallet-principal.sql').read_bytes()
        assert hashlib.sha256(original).hexdigest()=='2636058c20a4515b58562e3cbc58e7820006dbf9ddefc0e0e4edb9081669677e'
        cls.original=body(original.decode())
        cls.forward=(ROOT/'connection-migrations/029-live-projection-rows-variable.sql').read_text()
        cls.corrected=body(cls.forward)

    def test_only_local_identifier_changes_with_original_json_keys_unchanged(self):
        reverted=re.sub(r"'(?:''|[^'])*'|\bv_rows\b",lambda m:m.group(0) if m.group(0).startswith("'") else 'rows',self.corrected)
        self.assertEqual(reverted,self.original)
        self.assertIn("v_rows jsonb=q->'rows'",self.corrected)
        self.assertNotIn('#variable_conflict',self.corrected)

    def test_snapshot_update_and_credential_revocation_use_input_projection(self):
        self.assertIn("UPDATE stores SET snapshot=snap,rows=rows-'receipt'",self.original)
        self.assertNotIn("rows jsonb=",self.corrected.replace('v_rows jsonb=',''))
        self.assertIn("UPDATE stores SET snapshot=snap,rows=v_rows-'receipt',revision=revision+1",self.corrected)
        self.assertIn("jsonb_array_elements(v_rows->'vouchers')",self.corrected)

    def test_forward_replaces_only_the_same_security_definer_function(self):
        outside=self.forward.replace('$$'+self.corrected+'$$','$$BODY$$')
        outside=re.sub(r'--[^\n]*','',outside).strip()
        self.assertEqual(outside,'CREATE OR REPLACE FUNCTION c1_runtime_internal.live_projection(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_private,pg_temp AS $$BODY$$;')


if __name__=='__main__':unittest.main()
