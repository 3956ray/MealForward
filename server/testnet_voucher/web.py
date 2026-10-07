"""CP23 Dynamic-authorized partner delivery plus no-login recipient voucher session."""
from collections import defaultdict, deque
import time
from flask import jsonify, make_response, request
from server.testnet_scope import authorize
from .core import VoucherError

BASE = "/api/v1/testnet-voucher"
COOKIE = "cp23_voucher_session"

def register(app, auth, work_store, scope_file, vouchers, clock=time.monotonic):
    attempts = defaultdict(deque)
    def limited(key: str, limit: int):
        now = clock(); queue = attempts[(request.remote_addr or "unknown", key)]
        while queue and now - queue[0] >= 60: queue.popleft()
        if len(queue) >= limit: raise VoucherError("RATE_LIMITED", 429)
        queue.append(now)
    def partner():
        actor = auth.require("partner"); authorize(work_store, actor, scope_file); return actor
    @app.errorhandler(VoucherError)
    def voucher_error(error): return jsonify(code=error.code), error.status
    @app.get("/api/v1/work/testnet-voucher")
    def work_voucher():
        actor = partner(); return jsonify(vouchers.partner_view(actor.partner_id))
    @app.post("/api/v1/work/testnet-voucher/invite")
    def invite():
        actor = auth.require("partner", csrf=True); authorize(work_store, actor, scope_file)
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or set(payload) != {"action"} or payload["action"] not in ("create", "rotate"):
            raise VoucherError("INVALID_REQUEST", 400)
        origin = request.headers.get("Origin")
        if origin not in ("http://127.0.0.1:15207", "http://localhost:15207"): raise VoucherError("ORIGIN_DENIED", 403)
        limited("partner-invite", 6)
        def recheck():
            current = partner()
            if current.actor_id != actor.actor_id: raise VoucherError("TESTNET_SCOPE_DENIED", 403)
            return current
        return jsonify(vouchers.create_invite(actor.partner_id, origin, rotate=payload["action"] == "rotate", guard=recheck))
    @app.post(BASE + "/exchange")
    def exchange():
        limited("exchange", 30)
        if request.headers.get("X-MealForward-Voucher") != "1": raise VoucherError("REQUEST_GUARD_REQUIRED", 403)
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or set(payload) != {"secret"}: raise VoucherError("INVALID_REQUEST", 400)
        token, view = vouchers.exchange(payload["secret"]); response = jsonify(view)
        response.set_cookie(COOKIE, token, httponly=True, secure=False, samesite="Strict", path=BASE, max_age=8 * 60 * 60)
        return response
    @app.get(BASE + "/session")
    def session():
        limited("session", 120); return jsonify(vouchers.session(request.cookies.get(COOKIE, "")))
    @app.post(BASE + "/display")
    def display():
        limited("display", 30)
        if request.headers.get("X-MealForward-Voucher") != "1" or request.get_json(silent=True) != {}:
            raise VoucherError("INVALID_REQUEST", 400)
        return jsonify(vouchers.create_display(request.cookies.get(COOKIE, ""), request.headers.get("X-CSRF-Token", "")))
    @app.post(BASE + "/logout")
    def logout():
        if request.headers.get("X-MealForward-Voucher") != "1" or request.get_json(silent=True) != {}:
            raise VoucherError("INVALID_REQUEST", 400)
        vouchers.logout(request.cookies.get(COOKIE, "")); response = make_response("", 204)
        response.delete_cookie(COOKIE, path=BASE, httponly=True, samesite="Strict"); return response
