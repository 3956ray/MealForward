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

    def test_full_flow_permissions_and_idempotency(self):
        supporter, partner, recipient, voucher_id, secret, code = self.funded_voucher()
        self.assert_balance(100, 0, 100, 0, 0)
        status, old = self.act(partner, "issue", "issue-once-0001", recipient_ref="REF-A")
        self.assertEqual(status, 200)
        self.assertEqual(old["operation"]["target"], voucher_id)
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
