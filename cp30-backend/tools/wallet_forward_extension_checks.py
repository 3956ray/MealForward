"""Pure function checks only: no run/private files, processes or database access."""

import importlib.util
import copy
from pathlib import Path
import unittest

path = Path(__file__).with_name("wallet-forward-extension.py")
spec = importlib.util.spec_from_file_location("wallet_forward_extension", path)
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class ExtensionChecks(unittest.TestCase):
    @staticmethod
    def runtime_fixture(*, terminal=False):
        namespace = "synthetic_new_run"
        checkpoint = {"ledgerRevision": 0, "ledgerHead": "1" * 64, "materialHash": "2" * 64,
                      "epochs": {"source_epoch": 1, "credential_epoch": 1, "restore_generation": 1},
                      "floors": {"runtime_nonce": {}}, "globalFloors": {"runtime_nonce": {}}}
        raw, head, sequence = b"", "0" * 64, 0

        def append(kind, data):
            nonlocal raw, head, sequence
            sequence += 1
            payload = {"sequence": sequence, "parent": head, "namespace": namespace, "kind": kind, "data": data}
            head = tool._sha(tool._canonical(payload))
            raw += tool._canonical({**payload, "digest": head}) + b"\n"

        append("HEADER", {"protocol": "CP30_RUNTIME_LEDGER_CONTROLLER_V1", "checkpoint": checkpoint})
        state = tool._parse_runtime(raw, namespace)
        append("PREPARED", {"checkpoint": state.checkpoint,
                            "mutation_id": "95b11417-f18f-457f-8804-68e361f9164f"})
        state = tool._parse_runtime(raw, namespace)
        if terminal:
            ticket = copy.deepcopy(state.pending)
            mutation = ticket["mutation"]
            proof = {"namespace": namespace, "mutation_id": mutation["id"],
                     "sequence": mutation["sequence"], "digest": mutation["digest"],
                     "priorRevision": 0, "priorHead": checkpoint["ledgerHead"],
                     "ledgerRevision": 1, "ledgerHead": "3" * 64,
                     "materialHash": checkpoint["materialHash"], "epochs": checkpoint["epochs"],
                     "floors": checkpoint["floors"], "globalFloors": checkpoint["globalFloors"]}
            append("COMMITTED", {"ticket": ticket, "proof": proof})
            state = tool._parse_runtime(raw, namespace)
        return state

    def test_original_approved_origin(self):
        self.assertEqual(tool._origin("https://localhost:16443", 16443), "https://localhost:16443")
        self.assertEqual(tool._origin("https://127.0.0.1:16443", 16443), "https://127.0.0.1:16443")

    def test_equal_snapshot_has_canonical_key_order(self):
        tool._assert_equal({"floors": {}, "material": [1]}, {"material": [1], "floors": {}})

    def test_changed_snapshot_closes(self):
        with self.assertRaises(tool.ExtensionClosed):
            tool._assert_equal({"floors": {"a": 1}}, {"floors": {"a": 2}})

    def test_exact_original_config_and_installation_row(self):
        context = {"namespace": "synthetic_new_run", "origin": "https://localhost:16443", "expiry": 4102444800}
        config = {"protocol": tool.PROTOCOL, "installId": "95b11417-f18f-457f-8804-68e361f9164f",
                  "namespace": context["namespace"], "origin": context["origin"], "port": 16443,
                  "chainId": 10143, "challengeTtlSeconds": 180, "sessionTtlSeconds": 3600,
                  "activationExpiresAt": context["expiry"], "principalHmacKey": "1" * 64}
        tool._validate_config(config, context)
        manifest = {"configSha256": "a" * 64}
        row = (config["namespace"], config["installId"], manifest["configSha256"],
               config["origin"], 10143, True, config["activationExpiresAt"])
        tool._match_row(row, config, manifest)
        with self.assertRaises(tool.ExtensionClosed):
            tool._validate_config({**config, "activationExpiresAt": context["expiry"] + 1}, context)
        with self.assertRaises(tool.ExtensionClosed):
            tool._match_row((*row[:2], "b" * 64, *row[3:]), config, manifest)

    def test_committed_original_table_snapshot_recovery(self):
        original = (("c1_private", "deployment"), ("c1_live_private", "stores"), ("c1_runtime_private", "state"))
        additions = tuple(("c1_private", name) for name in
                          ("wallet_login_installation", "wallet_login_challenges", "wallet_principals"))
        preparation = {"originalDatabase": {"tables": {".".join(name): {} for name in original}}}
        self.assertEqual(tool._recover_table_list((*original, *additions), preparation), tuple(sorted(original)))
        with self.assertRaises(tool.ExtensionClosed):
            tool._recover_table_list((*original, *additions, ("c1_private", "unrelated")), preparation)

    def test_external_prepared_closes_even_when_sql_pending_null(self):
        state = self.runtime_fixture()
        status = {**state.checkpoint, "configured": True, "materialMatches": True, "pending": None}
        with self.assertRaises(tool.ExtensionClosed):
            tool._match_runtime(state, status, {"runtime_nonce": {}}, None)

    def test_retained_terminal_requires_exact_ack_checkpoint(self):
        state = self.runtime_fixture(terminal=True)
        status = {**state.checkpoint, "configured": True, "materialMatches": True, "pending": None}
        ticket, proof = state.terminal["ticket"], state.terminal["proof"]
        ack = {"finished": True, "prepared_sequence": ticket["mutation"]["sequence"],
               "prepared_digest": ticket["mutation"]["digest"], "ticket": ticket, "proof": proof}
        tool._match_runtime(state, status, {"runtime_nonce": {}}, ack)
        with self.assertRaises(tool.ExtensionClosed):
            tool._match_runtime(state, status, {"runtime_nonce": {}}, {**ack, "finished": False})

    def test_normal_wallet_security_floor_subject_and_challenge_id(self):
        namespace, subject = "synthetic_new_run", "a" * 64
        challenge_id = "95b11417-f18f-457f-8804-68e361f9164f"
        floors = {"owner": {subject: 1}, "wallet_challenge": {challenge_id: 2}}

        class ReadOnlyFixture:
            def __init__(self, revisions):
                self.revisions = revisions

            def execute(self, sql, parameters):
                if "verified_owner_bindings" in sql:
                    expected_sql = "SELECT revision FROM c1_private.verified_owner_bindings WHERE ns=%s AND subject=%s"
                    expected_parameters = (namespace, subject)
                    value = self.revisions["owner"]
                else:
                    expected_sql = "SELECT revision FROM c1_private.wallet_login_challenges WHERE ns=%s AND id=%s::uuid"
                    expected_parameters = (namespace, challenge_id)
                    value = self.revisions["wallet_challenge"]
                if sql != expected_sql or parameters != expected_parameters:
                    raise AssertionError("Noncanonical fixed floor lookup")
                return type("Result", (), {"fetchone": lambda self: (value,)})()

        tool._check_security_floors(ReadOnlyFixture({"owner": 1, "wallet_challenge": 2}), namespace, floors, 1, 1)
        for values in ({"owner": 0, "wallet_challenge": 2}, {"owner": 1, "wallet_challenge": 1}):
            with self.assertRaises(tool.ExtensionClosed):
                tool._check_security_floors(ReadOnlyFixture(values), namespace, floors, 1, 1)

    def test_retained_old_session_floor_is_strict_integer_lower_bound(self):
        namespace, session_hash = "synthetic_new_run", "b" * 64

        class SessionFixture:
            def __init__(self, revision):
                self.revision = revision

            def execute(self, sql, parameters):
                if (sql != "SELECT revision FROM c1_private.sessions WHERE ns=%s AND hash=decode(%s,'hex')"
                        or parameters != (namespace, session_hash)):
                    raise AssertionError("Noncanonical session floor lookup")
                revision = self.revision
                return type("Result", (), {"fetchone": lambda self: (revision,)})()

        floors = {"session": {session_hash: 1}}
        tool._check_security_floors(SessionFixture(2), namespace, floors, 1, 1)
        for revision in (0, True, "2"):
            with self.assertRaises(tool.ExtensionClosed):
                tool._check_security_floors(SessionFixture(revision), namespace, floors, 1, 1)
        with self.assertRaises(tool.ExtensionClosed):
            tool._check_security_floors(SessionFixture(2), namespace, {"session": {session_hash: True}}, 1, 1)


if __name__ == "__main__":
    unittest.main()
