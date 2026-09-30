"""Contract tests for the fictional local state service."""

import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server.app import Handler, ThreadingHTTPServer, init


class FlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        Handler.db_path = Path(cls.tmp.name) / "flow.sqlite3"
        init(Handler.db_path)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.base = "http://127.0.0.1:" + str(cls.server.server_address[1])
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.tmp.cleanup()

    def setUp(self):
        status, _ = self.req("POST", "/api/reset", {"scenario": "normal"})
        self.assertEqual(status, 200)

    @classmethod
    def req(cls, method, path, body=None, token=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        data = json.dumps(body).encode() if body is not None else None
        request = Request(cls.base + path, data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=5) as response:
                return response.status, json.load(response)
        except HTTPError as exc:
            return exc.code, json.load(exc)

    def login(self, actor):
        status, result = self.req("POST", "/api/session", {"actor": actor})
        self.assertEqual(status, 200)
        return result["token"]

    def act(self, token, action, key, **kwargs):
        if action == "issue":
            kwargs.setdefault("quantity", 1)
            kwargs.setdefault("batch_id", "batch-demo")
            kwargs.setdefault("quote_price", 100)
            kwargs.setdefault("rule_version", "R-demo-v1")
        if action == "support":
            kwargs.setdefault("quote_price", 100)
            kwargs.setdefault("rule_version", "R-demo-v1")
        return self.req("POST", "/api/act", {"action": action, "intent_key": key, **kwargs}, token)

    def funded_voucher(self):
        supporter = self.login("supporter")
        partner = self.login("partner")
        status, _ = self.act(supporter, "support", "fund-once-0001", quantity=1)
        self.assertEqual(status, 200)
        status, result = self.act(partner, "issue", "issue-once-0001", recipient_ref="REF-A")
        self.assertEqual(status, 200)
        voucher_id = result["voucher"]["id"]
        secret = result["voucher"]["secret"]
        status, _ = self.act(partner, "deliver", "deliver-once-01", voucher_id=voucher_id, method="sent")
        self.assertEqual(status, 200)
        status, exchange = self.req("POST", "/api/invite/exchange", {"secret": secret})
        self.assertEqual(status, 200)
        recipient = exchange["token"]
        status, view = self.req("GET", "/api/voucher", token=recipient)
        self.assertEqual(status, 200)
        self.assertIsNotNone(view["code"])
        return supporter, partner, recipient, voucher_id, secret, view["code"]

    def assert_balance(self, f, a, r, h, s):
        status, state = self.req("GET", "/api/state")
        self.assertEqual(status, 200)
        b = state["batch"]
        self.assertEqual([b[x] for x in ("F", "A", "R", "H", "S", "X", "L")], [f, a, r, h, s, 0, 0])
        self.assertEqual(b["F"], b["A"] + b["R"] + b["H"] + b["S"] + b["X"])
        self.assertEqual(b["available"], b["A"] - b["L"])
        self.assertEqual((b["updated_at"] + 8 * 3600) % 86400, 0)
        return state

    def issue_many(self, quantity=3, key="family-issue-001"):
        supporter, partner = self.login("supporter"), self.login("partner")
        self.assertEqual(self.act(supporter, "support", "family-fund-001", quantity=quantity)[0], 200)
        status, result = self.act(partner, "issue", key, quantity=quantity, recipient_ref="REF-A")
        self.assertEqual(status, 200)
        return partner, result["issuance"]

    def test_family_atomic_quantity_idempotency_and_privacy(self):
        partner, issuance = self.issue_many()
        ids = [v["id"] for v in issuance["vouchers"]]
        self.assertEqual(len(set(ids)), 3)
        self.assert_balance(300, 0, 300, 0, 0)
        self.assertNotIn("secret", json.dumps(issuance))
        status, repeated = self.act(partner, "issue", "family-issue-001", quantity=3, recipient_ref="REF-A")
        self.assertEqual(status, 200)
        self.assertEqual(repeated["issuance"], issuance)
        self.assertEqual(self.act(partner, "issue", "family-issue-001", quantity=2, recipient_ref="REF-A")[1]["code"], "INTENT_CONFLICT")
        status, recovered = self.req("GET", "/api/issuances/by-intent/family-issue-001", token=partner)
        self.assertEqual(recovered["issuance"], issuance)
        secrets = [self.req("GET", "/api/partner-invite/" + vid, token=partner)[1]["secret"] for vid in ids]
        self.assertEqual(len(set(secrets)), 3)
        _, exchange = self.req("POST", "/api/invite/exchange", {"secret": secrets[0]})
        for token in (None, self.login("supporter"), self.login("staff_a"), self.login("settler"), exchange["token"]):
            self.assertIn(self.req("GET", "/api/issuances/" + issuance["operation"]["id"], token=token)[0], (401, 403))
            self.assertIn(self.req("GET", "/api/partner-invite/" + ids[0], token=token)[0], (401, 403))
        _, state = self.req("GET", "/api/state", token=self.login("staff_a"))
        for hidden in ("recipient_ref", "issuances", *secrets, *ids):
            self.assertNotIn(hidden, json.dumps(state))

    def test_family_invalid_requests_and_transaction_rollback(self):
        from server.app import connect
        from contextlib import closing
        supporter, partner = self.login("supporter"), self.login("partner")
        self.act(supporter, "support", "fund-invalid-001", quantity=3)
        for i, quantity in enumerate((0, -1, 1.5, True, "3", 21, 4)):
            self.assertNotEqual(self.act(partner, "issue", "bad-count-" + str(i), quantity=quantity, recipient_ref="REF-A")[0], 200)
        self.assertEqual(self.act(partner, "issue", "bad-price-001", quantity=3, recipient_ref="REF-A", quote_price=101)[1]["code"], "QUOTE_CHANGED")
        self.assertEqual(self.act(partner, "issue", "bad-rule-001", quantity=3, recipient_ref="REF-A", rule_version="changed")[1]["code"], "QUOTE_CHANGED")
        with closing(connect(Handler.db_path)) as db:
            db.execute("UPDATE batch SET l=100")
        self.assertEqual(self.act(partner, "issue", "insufficient-001", quantity=3, recipient_ref="REF-A")[1]["code"], "INSUFFICIENT_A")
        with closing(connect(Handler.db_path)) as db:
            db.execute("UPDATE batch SET l=0")
            db.execute("CREATE TRIGGER fail_second BEFORE INSERT ON vouchers WHEN (SELECT COUNT(*) FROM vouchers)=1 BEGIN SELECT RAISE(ABORT, 'test failure'); END")
        try:
            self.assertEqual(self.act(partner, "issue", "rollback-issue-001", quantity=3, recipient_ref="REF-A")[0], 409)
            self.assert_balance(300, 300, 0, 0, 0)
            with closing(connect(Handler.db_path)) as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM vouchers").fetchone()[0], 0)
                self.assertEqual(db.execute("SELECT quota_remaining FROM recipients WHERE ref='REF-A'").fetchone()[0], 3)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM issuances").fetchone()[0], 0)
        finally:
            with closing(connect(Handler.db_path)) as db:
                db.execute("DROP TRIGGER fail_second")

    def test_family_same_intent_concurrently_returns_original_set(self):
        supporter, partner = self.login("supporter"), self.login("partner")
        self.act(supporter, "support", "fund-identical-01", quantity=3)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.act(partner, "issue", "same-intent-001", quantity=3, recipient_ref="REF-A"), range(2)))
        self.assertEqual([r[0] for r in results], [200, 200])
        self.assertEqual(results[0][1]["issuance"], results[1][1]["issuance"])
        self.assert_balance(300, 0, 300, 0, 0)

    def test_family_competing_issue_intents_never_overspend(self):
        supporter, partner = self.login("supporter"), self.login("partner")
        self.act(supporter, "support", "fund-compete-01", quantity=3)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda key: self.act(partner, "issue", key, quantity=2, recipient_ref="REF-A"), ["issue-compete-a", "issue-compete-b"]))
        self.assertEqual(sorted(x[0] for x in results), [200, 409])
        self.assert_balance(300, 100, 200, 0, 0)

    def test_processing_groups_restore_only_presented_vouchers(self):
        partner, issuance = self.issue_many()
        a, b = self.login("staff_a"), self.login("staff_b")
        status, group = self.act(a, "group_create", "group-create-01")
        gid = group["operation"]["target"]
        codes = []
        for i, v in enumerate(issuance["vouchers"][:2]):
            self.act(partner, "deliver", "send-family-" + str(i), voucher_id=v["id"], method="sent")
            _, secret = self.req("GET", "/api/partner-invite/" + v["id"], token=partner)
            _, session = self.req("POST", "/api/invite/exchange", {"secret": secret["secret"]})
            _, view = self.req("GET", "/api/voucher", token=session["token"])
            codes.append(view["code"])
            self.assertEqual(self.act(a, "group_add", "group-add-" + str(i), group_id=gid, code=view["code"])[0], 200)
        self.assertEqual(self.act(a, "group_add", "group-add-again", group_id=gid, code=codes[0])[0], 200)
        status, response = self.req("GET", "/api/groups/" + gid, token=a)
        self.assertEqual(len(response["group"]["items"]), 2)
        self.assertNotIn(issuance["vouchers"][2]["id"], json.dumps(response))
        for forbidden in ("recipient_ref", "secret", "code", "issuance"):
            self.assertNotIn('"' + forbidden + '"', json.dumps(response))
        self.assertEqual(self.req("GET", "/api/groups/" + gid, token=b)[0], 404)
        self.assertEqual(self.act(b, "group_add", "foreign-group-01", group_id=gid, code=codes[0])[0], 404)
        self.assertNotEqual(self.act(a, "lock", "no-code-lock-01", voucher_id=issuance["vouchers"][0]["id"], group_id=gid)[0], 200)
        _, lock = self.act(a, "lock", "group-lock-001", code=codes[0], group_id=gid)
        self.act(a, "confirm_lock", "group-confirm-1", operation_id=lock["operation"]["id"])
        self.act(a, "handoff", "group-handoff-1", voucher_id=issuance["vouchers"][0]["id"])
        self.act(a, "report", "group-report-01", voucher_id=issuance["vouchers"][0]["id"], outcome="unknown")
        _, restored = self.req("GET", "/api/groups/" + gid, token=self.login("staff_a"))
        self.assertEqual([i["status"] for i in restored["group"]["items"]], ["report_unknown", "needs_code"])
        self.assert_balance(300, 0, 300, 0, 0)

    def test_cp10_additive_migration_preserves_all_existing_data(self):
        from server.app import connect
        from contextlib import closing
        _, _, _, vid, _, _ = self.funded_voucher()
        with tempfile.TemporaryDirectory() as directory:
            oldpath = Path(directory) / "old.sqlite3"
            with closing(connect(Handler.db_path)) as source, closing(connect(oldpath)) as old:
                source.backup(old)
                # Reconstruct CP10 schema/target semantics without CP11 tables.
                old.execute("UPDATE operations SET target=? WHERE action='issue'", (vid,))
                for table in ("processing_items", "processing_groups", "issuance_vouchers", "issuances"):
                    old.execute("DROP TABLE " + table)
                tables = ("batch", "recipients", "sessions", "operations", "vouchers", "events", "cases")
                before = {t: [dict(x) for x in old.execute("SELECT * FROM " + t)] for t in tables}
            init(oldpath)
            init(oldpath)
            with closing(connect(oldpath)) as migrated:
                after = {t: [dict(x) for x in migrated.execute("SELECT * FROM " + t)] for t in tables}
                self.assertEqual(before, after)
                self.assertEqual(migrated.execute("SELECT COUNT(*) FROM issuance_vouchers").fetchone()[0], 1)

    def test_recipient_status_probe_does_not_reissue_code(self):
        supporter, _, recipient, _, _, code = self.funded_voucher()
        status, response = self.req("GET", "/api/voucher/status")
        self.assertEqual(status, 401)
        status, response = self.req("GET", "/api/voucher/status", token=supporter)
        self.assertEqual(status, 403)
        status, response = self.req("GET", "/api/voucher/status", token=recipient)
        self.assertEqual((status, response), (200, {"status": "active", "delivery_status": "sent", "paused": False}))
        staff = self.login("staff_a")
        status, response = self.req("POST", "/api/act", {"action": "precheck", "code": code}, staff)
        self.assertEqual(status, 200)
        self.assertEqual(response["check"]["status"], "可申请处理权")
        status, response = self.act(staff, "lock", "status-lock-a01", code=code)
        self.assertEqual(status, 200)
        status, response = self.req("GET", "/api/voucher/status", token=recipient)
        self.assertEqual((status, response), (200, {"status": "locked", "delivery_status": "sent", "paused": False}))
        self.assertNotIn("code", response)

    def test_owner_keeps_original_identity_through_simulated_settlement(self):
        supporter, partner, recipient, voucher_id, secret, code = self.funded_voucher()
        owner, other = self.login("staff_a"), self.login("staff_b")
        _, state = self.req("GET", "/api/state", token=owner)
        self.assertTrue(state["work"]["can_settle"])
        self.assertIn("虚构", state["work"]["destination"])
        _, state = self.req("GET", "/api/state", token=other)
        self.assertFalse(state["work"]["can_settle"])
        self.assertNotIn("destination", state["work"])
        self.assertEqual(self.act(owner, "settle", "owner-before-report", voucher_id=voucher_id)[0], 409)
        _, locked = self.act(owner, "lock", "owner-lock-001", code=code)
        self.assertEqual(self.act(owner, "confirm_lock", "owner-confirm-001", operation_id=locked["operation"]["id"])[0], 200)
        self.assertEqual(self.act(owner, "handoff", "owner-handoff-001", voucher_id=voucher_id)[0], 200)
        self.assertEqual(self.act(owner, "report", "owner-report-001", voucher_id=voucher_id)[0], 200)
        for token in (other, supporter, partner, recipient):
            self.assertEqual(self.act(token, "settle", "owner-denied-001", voucher_id=voucher_id)[0], 403)
        status, settled = self.act(owner, "settle", "owner-settle-001", voucher_id=voucher_id)
        self.assertEqual(status, 200)
        self.assertEqual(settled["operation"]["actor"], "staff_a")
        status, original = self.req("GET", "/api/operations/" + settled["operation"]["id"], token=owner)
        self.assertEqual(status, 200)
        self.assertEqual(original["operation"], settled["operation"])
        status, repeated = self.act(owner, "settle", "owner-settle-001", voucher_id=voucher_id)
        self.assertEqual(status, 200)
        self.assertEqual(repeated["operation"], settled["operation"])
        self.assert_balance(100, 0, 0, 0, 100)

    def test_full_flow_permissions_and_idempotency(self):
        supporter, partner, recipient, voucher_id, secret, code = self.funded_voucher()
        self.assert_balance(100, 0, 100, 0, 0)
        status, old = self.act(partner, "issue", "issue-once-0001", recipient_ref="REF-A")
        self.assertEqual(status, 200)
        self.assertEqual(old["issuance"]["vouchers"][0]["id"], voucher_id)
        status, state = self.req("GET", "/api/state")
        self.assertNotIn("REF-A", json.dumps(state))
        self.assertNotIn(secret, json.dumps(state))
        self.assertNotIn("secret", json.dumps(state))
        status, _ = self.req("GET", "/api/voucher")
        self.assertEqual(status, 401)
        status, _ = self.req("GET", "/api/voucher", token=supporter)
        self.assertEqual(status, 403)
        status, _ = self.act(supporter, "issue", "wrong-role-issue", recipient_ref="REF-A")
        self.assertEqual(status, 403)

        staff = self.login("staff_a")
        status, staff_state = self.req("GET", "/api/state", token=staff)
        self.assertEqual(status, 200)
        self.assertNotIn("REF-A", json.dumps(staff_state))
        self.assertNotIn(secret, json.dumps(staff_state))
        status, _ = self.req("GET", "/api/operations/" + old["operation"]["id"], token=staff)
        self.assertEqual(status, 403)
        status, _ = self.req("GET", "/api/operations/" + old["operation"]["id"], token=supporter)
        self.assertEqual(status, 403)

        status, checked = self.req("POST", "/api/act", {"action": "precheck", "code": code}, staff)
        self.assertEqual(status, 200)
        self.assertEqual(checked["check"]["voucher_id"], voucher_id)
        self.assertNotIn("recipient_ref", checked["check"])
        status, locked = self.act(staff, "lock", "lock-staff-a-01", code=code)
        self.assertEqual(status, 200)
        op_id = locked["operation"]["id"]
        self.assertEqual(locked["operation"]["status"], "WAITING_CONFIRMATION")
        status, blocked = self.act(staff, "handoff", "handoff-too-soon", voucher_id=voucher_id)
        self.assertEqual(status, 409)
        self.assertEqual(blocked["code"], "NO_CONFIRMED_LOCK")
        status, _ = self.act(staff, "confirm_lock", "confirm-lock-a01", operation_id=op_id)
        self.assertEqual(status, 200)
        status, _ = self.act(staff, "handoff", "handoff-staff-a1", voucher_id=voucher_id)
        self.assertEqual(status, 200)
        self.assert_balance(100, 0, 100, 0, 0)
        status, _ = self.act(staff, "report", "report-staff-a01", voucher_id=voucher_id, outcome="success")
        self.assertEqual(status, 200)
        self.assert_balance(100, 0, 0, 100, 0)
        settler = self.login("settler")
        status, _ = self.act(settler, "settle", "settle-once-01", voucher_id=voucher_id, outcome="success")
        self.assertEqual(status, 200)
        state = self.assert_balance(100, 0, 0, 0, 100)
        self.assertEqual([event["kind"] for event in state["events"]], ["support_confirmed"])
        status, _ = self.act(settler, "settle", "settle-once-01", voucher_id=voucher_id, outcome="success")
        self.assertEqual(status, 200)
        self.assert_balance(100, 0, 0, 0, 100)
        status, view = self.req("GET", "/api/voucher", token=recipient)
        self.assertEqual(status, 200)
        self.assertIsNone(view["code"])
        status, response = self.act(recipient, "acknowledge", "too-late-ack-01")
        self.assertEqual((status, response["code"]), (409, "ALREADY_HANDLED"))

    def test_issue_guards_delivery_retry_and_consultation(self):
        supporter = self.login("supporter")
        partner = self.login("partner")
        status, changed = self.act(supporter, "support", "old-quote-0001", quantity=1, quote_price=90)
        self.assertEqual((status, changed["code"]), (409, "QUOTE_CHANGED"))
        for ref, expected in (("REF-A", "INSUFFICIENT_A"), ("REF-B", "NOT_ELIGIBLE"), ("REF-C", "CHANNEL_UNVERIFIED"), ("REF-D", "NOT_ELIGIBLE")):
            status, response = self.act(partner, "issue", "before-fund-" + ref, recipient_ref=ref)
            self.assertEqual(status, 409)
            self.assertEqual(response["code"], expected)
        self.assert_balance(0, 0, 0, 0, 0)
        self.act(supporter, "support", "fund-once-0002", quantity=1)
        for ref, expected in (("REF-B", "NOT_ELIGIBLE"), ("REF-C", "CHANNEL_UNVERIFIED"), ("REF-D", "NOT_ELIGIBLE")):
            status, response = self.act(partner, "issue", "after-fund-" + ref, recipient_ref=ref)
            self.assertEqual((status, response["code"]), (409, expected))
        status, result = self.act(partner, "issue", "issue-recipient-a", recipient_ref="REF-A")
        self.assertEqual(status, 200)
        vid = result["voucher"]["id"]
        secret = result["voucher"]["secret"]
        self.assert_balance(100, 0, 100, 0, 0)
        status, _ = self.act(partner, "deliver", "deliver-failed-01", voucher_id=vid, method="failed")
        self.assertEqual(status, 200)
        status, retry = self.act(partner, "deliver", "deliver-retry-01", voucher_id=vid, method="reshare")
        self.assertEqual(status, 200)
        self.assertEqual(retry["voucher"]["secret"], secret)
        self.assert_balance(100, 0, 100, 0, 0)
        status, pstate = self.req("GET", "/api/state", token=partner)
        self.assertEqual(status, 200)
        self.assertEqual(len(pstate["work"]["vouchers"]), 1)
        status, _ = self.act(supporter, "case", "case-consult-01", kind="退款咨询", text="SUPPORTER_PRIVATE_MARKER")
        self.assertEqual(status, 200)
        self.assert_balance(100, 0, 100, 0, 0)
        status, partner_state = self.req("GET", "/api/state", token=partner)
        self.assertEqual(status, 200)
        self.assertNotIn("SUPPORTER_PRIVATE_MARKER", json.dumps(partner_state))

    def test_recipient_case_stays_private_and_does_not_hold_funds(self):
        supporter, partner, recipient, _, _, _ = self.funded_voucher()
        status, result = self.act(recipient, "case", "recipient-case-01", kind="餐券求助", text="RECIPIENT_PRIVATE_MARKER")
        self.assertEqual(status, 200)
        self.assertEqual(result["case"]["stage"], "待机构处理 · 本地模拟")
        self.assert_balance(100, 0, 100, 0, 0)

        status, partner_state = self.req("GET", "/api/state", token=partner)
        self.assertEqual(status, 200)
        self.assertIn("RECIPIENT_PRIVATE_MARKER", json.dumps(partner_state))
        for token in (supporter, self.login("staff_a")):
            status, private_state = self.req("GET", "/api/state", token=token)
            self.assertEqual(status, 200)
            self.assertNotIn("RECIPIENT_PRIVATE_MARKER", json.dumps(private_state))
        status, voucher_view = self.req("GET", "/api/voucher", token=recipient)
        self.assertEqual(status, 200)
        self.assertEqual(voucher_view["cases"][0]["stage"], "待机构处理 · 本地模拟")

    def test_two_staff_compete_for_one_lock(self):
        _, _, _, voucher_id, _, code = self.funded_voucher()
        staff_a, staff_b = self.login("staff_a"), self.login("staff_b")
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(self.act, staff_a, "lock", "race-staff-a-01", code=code),
                pool.submit(self.act, staff_b, "lock", "race-staff-b-01", code=code),
            ]
            results = [f.result() for f in futures]
        self.assertEqual(sorted(status for status, _ in results), [200, 404])
        winner = next(i for i, (status, _) in enumerate(results) if status == 200)
        winning_token = (staff_a, staff_b)[winner]
        losing_token = (staff_a, staff_b)[1 - winner]
        op_id = results[winner][1]["operation"]["id"]
        status, _ = self.act(losing_token, "confirm_lock", "wrong-confirm-01", operation_id=op_id)
        self.assertEqual(status, 403)
        status, _ = self.act(winning_token, "confirm_lock", "right-confirm-01", operation_id=op_id)
        self.assertEqual(status, 200)
        status, _ = self.act(losing_token, "handoff", "wrong-handoff-01", voucher_id=voucher_id)
        self.assertEqual(status, 409)
        self.assert_balance(100, 0, 100, 0, 0)

    def test_unknown_originals_and_pause(self):
        supporter = self.login("supporter")
        status, first = self.act(supporter, "support", "unknown-fund-01", quantity=1, outcome="unknown")
        self.assertEqual(status, 200)
        status, again = self.act(supporter, "support", "unknown-fund-01", quantity=1, outcome="success")
        self.assertEqual(status, 200)
        self.assertEqual(again["operation"]["id"], first["operation"]["id"])
        status, blocked = self.act(supporter, "support", "unknown-fund-02", quantity=1, outcome="success")
        self.assertEqual((status, blocked["code"]), (409, "ORIGINAL_UNKNOWN"))
        self.assert_balance(0, 0, 0, 0, 0)

        status, _ = self.req("POST", "/api/reset", {"scenario": "paused"})
        self.assertEqual(status, 200)
        supporter, partner, staff, settler = [self.login(x) for x in ("supporter", "partner", "staff_a", "settler")]
        state = self.assert_balance(200, 0, 100, 100, 0)
        self.assertTrue(state["paused"])
        status, _ = self.act(supporter, "support", "paused-support-1", quantity=1)
        self.assertEqual(status, 409)
        status, _ = self.act(partner, "issue", "paused-issue-01", recipient_ref="REF-A")
        self.assertEqual(status, 409)
        status, _ = self.act(staff, "lock", "paused-lock-001", code="MISSING")
        self.assertEqual(status, 409)
        status, _ = self.act(settler, "settle", "paused-settle01", voucher_id="voucher-ref-h")
        self.assertEqual(status, 409)
        self.assert_balance(200, 0, 100, 100, 0)

    def test_unknown_report_and_settlement_keep_original_amount(self):
        _, _, _, voucher_id, _, code = self.funded_voucher()
        staff = self.login("staff_a")
        _, lock = self.act(staff, "lock", "lock-for-unknown", code=code)
        self.act(staff, "confirm_lock", "confirm-for-unknown", operation_id=lock["operation"]["id"])
        self.act(staff, "handoff", "handoff-for-unknown", voucher_id=voucher_id)
        status, unknown = self.act(staff, "report", "report-unknown-01", voucher_id=voucher_id, outcome="unknown")
        self.assertEqual(status, 200)
        status, _ = self.act(staff, "report", "report-again-001", voucher_id=voucher_id, outcome="success")
        self.assertEqual(status, 409)
        status, query = self.req("GET", "/api/operations/" + unknown["operation"]["id"], token=staff)
        self.assertEqual(status, 200)
        self.assertEqual(query["operation"]["status"], "UNKNOWN")
        self.assert_balance(100, 0, 100, 0, 0)

        self.req("POST", "/api/reset", {"scenario": "normal"})
        _, _, _, voucher_id, _, code = self.funded_voucher()
        staff = self.login("staff_a")
        _, lock = self.act(staff, "lock", "lock-for-settle", code=code)
        self.act(staff, "confirm_lock", "confirm-for-settle", operation_id=lock["operation"]["id"])
        self.act(staff, "handoff", "handoff-for-settle", voucher_id=voucher_id)
        self.act(staff, "report", "report-for-settle", voucher_id=voucher_id)
        settler = self.login("settler")
        status, unknown = self.act(settler, "settle", "settle-unknown-1", voucher_id=voucher_id, outcome="unknown")
        self.assertEqual(status, 200)
        status, blocked = self.act(settler, "settle", "settle-again-001", voucher_id=voucher_id, outcome="success")
        self.assertEqual((status, blocked["code"]), (409, "NOT_PAYABLE"))
        self.assert_balance(100, 0, 0, 100, 0)
        status, query = self.req("GET", "/api/operations/" + unknown["operation"]["id"], token=settler)
        self.assertEqual(status, 200)
        self.assertEqual(query["operation"]["status"], "UNKNOWN")

    def test_confirmed_failures_retry_only_after_original_check(self):
        _, _, recipient, voucher_id, _, code = self.funded_voucher()
        staff = self.login("staff_a")
        status, refreshed = self.req("GET", "/api/voucher", token=recipient)
        self.assertEqual(status, 200)
        self.assertNotEqual(code, refreshed["code"])
        status, invalid = self.req("POST", "/api/act", {"action": "precheck", "code": code}, staff)
        self.assertEqual((status, invalid["code"]), (404, "CODE_INVALID"))
        _, lock = self.act(staff, "lock", "failure-path-lock", code=refreshed["code"])
        self.act(staff, "confirm_lock", "failure-path-confirm", operation_id=lock["operation"]["id"])
        self.act(staff, "handoff", "failure-path-handoff", voucher_id=voucher_id)
        status, failed = self.act(staff, "report", "failure-path-report", voucher_id=voucher_id, outcome="failure")
        self.assertEqual(status, 200)
        op_id = failed["operation"]["id"]
        status, queried = self.req("GET", "/api/operations/" + op_id, token=staff)
        self.assertEqual(status, 200)
        self.assertEqual(queried["operation"]["status"], "FAILED")
        self.assert_balance(100, 0, 100, 0, 0)
        status, _ = self.act(staff, "report", "failure-path-report-retry", voucher_id=voucher_id, outcome="success")
        self.assertEqual(status, 200)
        self.assert_balance(100, 0, 0, 100, 0)
        settler = self.login("settler")
        status, failed = self.act(settler, "settle", "failure-path-settle", voucher_id=voucher_id, outcome="failure")
        self.assertEqual(status, 200)
        status, queried = self.req("GET", "/api/operations/" + failed["operation"]["id"], token=settler)
        self.assertEqual(status, 200)
        self.assertEqual(queried["operation"]["status"], "FAILED")
        self.assert_balance(100, 0, 0, 100, 0)
        status, _ = self.act(settler, "settle", "failure-path-settle-retry", voucher_id=voucher_id, outcome="success")
        self.assertEqual(status, 200)
        self.assert_balance(100, 0, 0, 0, 100)


if __name__ == "__main__":
    unittest.main()
