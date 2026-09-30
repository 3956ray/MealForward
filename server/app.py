"""Loopback-only, fictional CP8 state service. It is not a payment or identity system."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import secrets
import sqlite3
import time
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "demo.sqlite3"
ACTORS = {
    "supporter": "supporter",
    "partner": "partner",
    "staff_a": "staff",
    "staff_b": "staff",
    "settler": "settler",
    "admin": "admin",
}
# Keep this internal ID so the simulated owner's existing locks/groups remain usable.
OWNER_ACTOR = "staff_a"
SIMULATED_DESTINATION = "SHOP-DEMO-ALLOWLISTED-ADDRESS（虚构）"
SHOP = {
    "id": "shop-demo",
    "name": "拾光小食堂（虚构演示）",
    "partner": "社区伙伴演示站（虚构演示）",
    "meal": "一份标准热餐",
    "hours": "演示时段 11:00–14:00",
    "contact": "演示联系：请向现场机构工作人员咨询（无真实电话）",
    "address": "演示街区 · 无真实地址",
}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code


def now() -> int:
    return int(time.time())


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=5, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=5000")
    return db


SCHEMA = """
CREATE TABLE IF NOT EXISTS batch (
 id TEXT PRIMARY KEY, price INTEGER NOT NULL, f INTEGER NOT NULL, a INTEGER NOT NULL,
 r INTEGER NOT NULL, h INTEGER NOT NULL, s INTEGER NOT NULL, x INTEGER NOT NULL,
 l INTEGER NOT NULL, rule_version TEXT NOT NULL, paused INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recipients (
 ref TEXT PRIMARY KEY, eligible INTEGER NOT NULL, quota_remaining INTEGER NOT NULL,
 channel_verified INTEGER NOT NULL, rule_version TEXT NOT NULL, reason TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, actor TEXT NOT NULL, role TEXT NOT NULL,
 voucher_id TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS operations (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, intent_key TEXT NOT NULL,
 status TEXT NOT NULL, target TEXT, outcome TEXT, created_at INTEGER NOT NULL,
 UNIQUE(actor, action, intent_key)
);
CREATE TABLE IF NOT EXISTS vouchers (
 id TEXT PRIMARY KEY, recipient_ref TEXT NOT NULL REFERENCES recipients(ref),
 secret TEXT NOT NULL UNIQUE, code TEXT UNIQUE, code_expires INTEGER,
 status TEXT NOT NULL, delivery_status TEXT NOT NULL, delivery_method TEXT,
 delivery_actor TEXT, delivery_at INTEGER, lock_actor TEXT,
 lock_operation TEXT, lock_confirmed INTEGER NOT NULL DEFAULT 0,
 handoff_declared INTEGER NOT NULL DEFAULT 0, report_operation TEXT,
 settlement_operation TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS issuances (
 operation_id TEXT PRIMARY KEY REFERENCES operations(id), request_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS issuance_vouchers (
 operation_id TEXT NOT NULL REFERENCES issuances(operation_id),
 voucher_id TEXT NOT NULL UNIQUE REFERENCES vouchers(id), position INTEGER NOT NULL,
 PRIMARY KEY(operation_id, position)
);
CREATE TABLE IF NOT EXISTS processing_groups (
 id TEXT PRIMARY KEY, staff_actor TEXT NOT NULL, shop_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS processing_items (
 group_id TEXT NOT NULL REFERENCES processing_groups(id), voucher_id TEXT NOT NULL REFERENCES vouchers(id),
 position INTEGER NOT NULL, PRIMARY KEY(group_id, voucher_id), UNIQUE(group_id, position)
);
CREATE TABLE IF NOT EXISTS cases (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, voucher_id TEXT,
 kind TEXT NOT NULL, detail TEXT NOT NULL, stage TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, amount INTEGER NOT NULL,
 source TEXT NOT NULL, created_at INTEGER NOT NULL
);
"""


def init(path: Path) -> None:
    with closing(connect(path)) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(SCHEMA)
        if not db.execute("SELECT 1 FROM batch").fetchone():
            seed(db, "normal")
        # Additive CP11 migration: never reset balances, quotas, sessions or old vouchers.
        with db:
            db.execute("BEGIN IMMEDIATE")
            for op in db.execute("SELECT * FROM operations WHERE action='issue' AND status='SUCCESS'").fetchall():
                if db.execute("SELECT 1 FROM issuances WHERE operation_id=?", (op["id"],)).fetchone():
                    continue
                v = db.execute("SELECT * FROM vouchers WHERE id=?", (op["target"],)).fetchone()
                if v:
                    snapshot = issue_snapshot({"recipient_ref": v["recipient_ref"], "quantity": 1,
                                               "batch_id": batch(db)["id"], "quote_price": batch(db)["price"],
                                               "rule_version": batch(db)["rule_version"]})
                    db.execute("INSERT INTO issuances VALUES (?,?)", (op["id"], snapshot))
                    db.execute("INSERT INTO issuance_vouchers VALUES (?,?,0)", (op["id"], v["id"]))


def seed(db: sqlite3.Connection, scenario: str) -> None:
    if scenario not in ("normal", "paused"):
        raise ApiError(400, "BAD_SCENARIO", "仅能重置为 normal 或 paused 演示。")
    for table in ("processing_items", "processing_groups", "issuance_vouchers", "issuances", "events", "cases", "vouchers", "operations", "sessions", "recipients", "batch"):
        db.execute(f"DELETE FROM {table}")
    paused = scenario == "paused"
    f, a, r, h = (200, 0, 100, 100) if paused else (0, 0, 0, 0)
    db.execute(
        "INSERT INTO batch VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        ("batch-demo", 100, f, a, r, h, 0, 0, 0, "R-demo-v1", int(paused), now()),
    )
    db.executemany(
        "INSERT INTO recipients VALUES (?,?,?,?,?,?)",
        [
            ("REF-A", 1, 3, 1, "R-demo-v1", "虚构服务计划已确认；本期初始 3 份，非真实家庭资格"),
            ("REF-B", 0, 0, 1, "R-demo-v1", "未有当前服务计划确认"),
            ("REF-C", 1, 1, 0, "R-demo-v1", "资格合格，但私人交付渠道尚未核对"),
            ("REF-D", 1, 0, 1, "R-demo-v1", "本期额度已用完"),
        ],
    )
    if paused:
        for ref, status in (("REF-R", "active"), ("REF-H", "reported")):
            db.execute(
                "INSERT INTO recipients VALUES (?,?,?,?,?,?)",
                (ref, 1, 0, 1, "R-demo-v1", "暂停前已发行的虚构样例"),
            )
            db.execute(
                "INSERT INTO vouchers (id,recipient_ref,secret,status,delivery_status,created_at) VALUES (?,?,?,?,?,?)",
                ("voucher-" + ref.lower(), ref, secrets.token_urlsafe(24), status, "handover", now()),
            )
        db.execute(
            "INSERT INTO events (kind,amount,source,created_at) VALUES (?,?,?,?)",
            ("seed_paused", 200, "预置暂停异常 · 本地模拟", now()),
        )
    check_balance(db)


def batch(db: sqlite3.Connection) -> sqlite3.Row:
    return db.execute("SELECT * FROM batch WHERE id='batch-demo'").fetchone()


def check_balance(db: sqlite3.Connection) -> None:
    b = batch(db)
    if not b or b["f"] != sum(b[k] for k in ("a", "r", "h", "s", "x")):
        raise AssertionError("F=A+R+H+S+X violated")
    if min(b[k] for k in ("f", "a", "r", "h", "s", "x", "l")) < 0 or b["l"] > b["a"]:
        raise AssertionError("invalid batch balance or L")
    reserved = db.execute(
        "SELECT COUNT(*) FROM vouchers WHERE status IN ('active','locked','handoff','report_unknown')"
    ).fetchone()[0]
    reported = db.execute(
        "SELECT COUNT(*) FROM vouchers WHERE status IN ('reported','settlement_unknown')"
    ).fetchone()[0]
    settled = db.execute("SELECT COUNT(*) FROM vouchers WHERE status='settled'").fetchone()[0]
    if reserved * b["price"] != b["r"] or reported * b["price"] != b["h"] or settled * b["price"] != b["s"]:
        raise AssertionError("voucher and batch amounts differ")


def rowdict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row else None


def issue_session(db: sqlite3.Connection, actor: str, role: str, voucher_id: str | None = None) -> str:
    token = secrets.token_urlsafe(32)
    db.execute(
        "INSERT INTO sessions VALUES (?,?,?,?,?)",
        (token_hash(token), actor, role, voucher_id, now()),
    )
    return token


def auth(db: sqlite3.Connection, header: str | None, required: bool = False) -> sqlite3.Row | None:
    if not header:
        if required:
            raise ApiError(401, "LOGIN_REQUIRED", "请选择本地模拟角色或打开私密邀请。")
        return None
    if not header.startswith("Bearer "):
        raise ApiError(401, "BAD_SESSION", "演示会话格式不正确。")
    session = db.execute(
        "SELECT * FROM sessions WHERE token_hash=?", (token_hash(header[7:]),)
    ).fetchone()
    if not session:
        raise ApiError(401, "SESSION_EXPIRED", "演示会话已失效，请重新选择角色或打开原邀请。")
    return session


def require_role(session: sqlite3.Row | None, *roles: str) -> None:
    if session is None:
        raise ApiError(401, "LOGIN_REQUIRED", "此动作需先选择本地模拟角色。")
    if session["role"] not in roles:
        raise ApiError(403, "FORBIDDEN", "当前演示角色无权执行此动作。")


def can_settle(session: sqlite3.Row) -> bool:
    # Legacy settler remains an internal fixture, not a separate product identity.
    return session["role"] == "settler" or (session["role"] == "staff" and session["actor"] == OWNER_ACTOR)


def ensure_active(db: sqlite3.Connection) -> None:
    if batch(db)["paused"]:
        raise ApiError(409, "PAUSED", "此虚构批次已暂停新操作；旧操作仍可查询。")


def update_balance(db: sqlite3.Connection, **changes: int) -> None:
    fields = ",".join(f"{k}={k}+?" for k in changes)
    db.execute(
        f"UPDATE batch SET {fields},updated_at=? WHERE id='batch-demo'",
        (*changes.values(), now()),
    )


def event(db: sqlite3.Connection, kind: str, amount: int, source: str) -> None:
    db.execute(
        "INSERT INTO events (kind,amount,source,created_at) VALUES (?,?,?,?)",
        (kind, amount, source, now()),
    )


def op_dict(db: sqlite3.Connection, op_id: str) -> dict:
    return rowdict(db.execute("SELECT * FROM operations WHERE id=?", (op_id,)).fetchone())


def old_op(db: sqlite3.Connection, actor: str, action: str, intent_key: str) -> dict | None:
    row = db.execute(
        "SELECT * FROM operations WHERE actor=? AND action=? AND intent_key=?",
        (actor, action, intent_key),
    ).fetchone()
    return rowdict(row)


def create_op(
    db: sqlite3.Connection, actor: str, action: str, intent_key: str,
    status: str, target: str | None = None, outcome: str | None = None,
) -> dict:
    op_id = "op-" + secrets.token_hex(8)
    db.execute(
        "INSERT INTO operations VALUES (?,?,?,?,?,?,?,?)",
        (op_id, actor, action, intent_key, status, target, outcome, now()),
    )
    return op_dict(db, op_id)


def get_voucher(db: sqlite3.Connection, voucher_id: str) -> sqlite3.Row:
    v = db.execute("SELECT * FROM vouchers WHERE id=?", (voucher_id,)).fetchone()
    if not v:
        raise ApiError(404, "NOT_FOUND", "找不到此虚构餐券。")
    return v


def issue_snapshot(body: dict) -> str:
    return json.dumps({k: body.get(k) for k in ("recipient_ref", "quantity", "batch_id", "quote_price", "rule_version")}, sort_keys=True, separators=(",", ":"))


def issuance_view(db: sqlite3.Connection, op_id: str, actor: str) -> dict:
    row = db.execute("SELECT i.*,o.actor FROM issuances i JOIN operations o ON o.id=i.operation_id WHERE i.operation_id=? AND o.actor=?", (op_id, actor)).fetchone()
    if not row:
        raise ApiError(404, "NOT_FOUND", "找不到本机构原发行结果；不可据此判断未提交。")
    request = json.loads(row["request_json"])
    vouchers = [rowdict(v) for v in db.execute("SELECT v.id,v.recipient_ref,v.status,v.delivery_status,v.delivery_method,v.delivery_at,v.created_at FROM issuance_vouchers iv JOIN vouchers v ON v.id=iv.voucher_id WHERE iv.operation_id=? ORDER BY iv.position", (op_id,))]
    return {"operation": op_dict(db, op_id), "request": request, "vouchers": vouchers}


def checked_code(db: sqlite3.Connection, code: str) -> sqlite3.Row:
    v = db.execute("SELECT * FROM vouchers WHERE code=?", (code,)).fetchone()
    if not v or not v["code_expires"] or v["code_expires"] <= now():
        raise ApiError(404, "CODE_INVALID", "展示码不存在或已过期，请重新出示有效码。")
    if v["status"] != "active" or v["delivery_status"] not in ("sent", "handover", "acknowledged"):
        raise ApiError(409, "LOCK_CONFLICT", "此券不可开始新的处理。")
    return v


def own_group(db: sqlite3.Connection, group_id: str, actor: str) -> sqlite3.Row:
    group = db.execute("SELECT * FROM processing_groups WHERE id=? AND staff_actor=? AND shop_id=?", (group_id, actor, SHOP["id"])).fetchone()
    if not group:
        raise ApiError(404, "NOT_FOUND", "找不到本店本人处理组。")
    return group


def group_view(db: sqlite3.Connection, group: sqlite3.Row) -> dict:
    items = []
    for v in db.execute("SELECT v.id,v.status,v.lock_actor,v.lock_confirmed FROM processing_items i JOIN vouchers v ON v.id=i.voucher_id WHERE i.group_id=? ORDER BY i.position", (group["id"],)):
        own = v["lock_actor"] == group["staff_actor"]
        items.append({"voucher_id": v["id"], "status": v["status"] if own else ("needs_code" if v["status"] == "active" else "unavailable"), "owned": own, "lock_confirmed": bool(v["lock_confirmed"]) if own else False})
    return {"id": group["id"], "created_at": group["created_at"], "items": items}


def action(db: sqlite3.Connection, session: sqlite3.Row, body: dict) -> dict:
    name = body.get("action")
    if name == "precheck":
        require_role(session, "staff")
        code = body.get("code")
        v = db.execute("SELECT * FROM vouchers WHERE code=?", (code,)).fetchone()
        if not v or not v["code_expires"] or v["code_expires"] < now():
            raise ApiError(404, "CODE_INVALID", "展示码不存在或已过期，请在线刷新原券。")
        if v["delivery_status"] not in ("sent", "handover", "acknowledged"):
            raise ApiError(409, "NOT_DELIVERED", "此券尚未记录定向交付。")
        if v["status"] != "active":
            raise ApiError(409, "ALREADY_HANDLED", "此券正在处理或已处理，请查询原操作。")
        return {"message": "只读预检查有效；尚未取得处理权。", "check": {"voucher_id": v["id"], "meal": SHOP["meal"], "shop": SHOP["name"], "status": "可申请处理权", "code": code}}

    key = body.get("intent_key")
    if not isinstance(name, str) or not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,100}", key):
        raise ApiError(400, "BAD_INTENT", "写操作需要有效的稳定意图键。")
    actor = session["actor"]
    # A repeated request returns the original evidence even if the batch has since paused.
    previous = old_op(db, actor, name, key)
    if previous and name == "issue":
        require_role(session, "partner")
        original = issuance_view(db, previous["id"], actor)
        if issue_snapshot(body) != issue_snapshot(original["request"]):
            raise ApiError(409, "INTENT_CONFLICT", "同一发行意图的数量或规则快照不一致，请查询原结果。")
        return {"message": "返回原N券发行，未再次预留。", "operation": previous, "issuance": original}
    if previous:
        return {"message": "已返回原操作，未重复执行。", "operation": previous}

    if name == "support":
        require_role(session, "supporter")
        ensure_active(db)
        quantity = body.get("quantity")
        outcome = body.get("outcome", "success")
        if not isinstance(quantity, int) or isinstance(quantity, bool) or not 1 <= quantity <= 20:
            raise ApiError(400, "BAD_QUANTITY", "演示份数须为 1–20 的整数。")
        current = batch(db)
        if body.get("quote_price") != current["price"] or body.get("rule_version") != current["rule_version"]:
            raise ApiError(409, "QUOTE_CHANGED", "报价或规则已变化，请重新审阅。")
        if outcome not in ("success", "unknown", "failure"):
            raise ApiError(400, "BAD_OUTCOME", "模拟结果无效。")
        if batch(db)["f"]:
            raise ApiError(409, "BATCH_ALREADY_FUNDED", "此单笔演示批次已有支持，请重置样例。")
        if db.execute("SELECT 1 FROM operations WHERE action='support' AND status='UNKNOWN'").fetchone():
            raise ApiError(409, "ORIGINAL_UNKNOWN", "原入款结果待核，只能查询原操作。")
        status = {"success": "SUCCESS", "unknown": "UNKNOWN", "failure": "FAILED"}[outcome]
        op = create_op(db, actor, name, key, status, "batch-demo", outcome)
        if outcome == "success":
            amount = quantity * batch(db)["price"]
            update_balance(db, f=amount, a=amount)
            event(db, "support_confirmed", amount, "模拟入款确认")
        return {"message": "模拟支持操作已记录。", "operation": op}

    if name == "issue":
        require_role(session, "partner")
        ensure_active(db)
        quantity = body.get("quantity")
        if type(quantity) is not int or not 1 <= quantity <= 20:
            raise ApiError(400, "BAD_QUANTITY", "发行数量须为1–20的整数，每券仅一份。")
        b = batch(db)
        if body.get("batch_id") != b["id"] or body.get("quote_price") != b["price"] or body.get("rule_version") != b["rule_version"]:
            raise ApiError(409, "QUOTE_CHANGED", "批次、价格或规则已变化，请重新审阅。")
        ref = body.get("recipient_ref")
        recipient = db.execute("SELECT * FROM recipients WHERE ref=?", (ref,)).fetchone()
        if not recipient:
            raise ApiError(404, "NOT_FOUND", "此领取关联不在本机构演示范围。")
        if not recipient["eligible"] or recipient["quota_remaining"] < quantity:
            raise ApiError(409, "NOT_ELIGIBLE", "资格未确认或本期份额不足。")
        if recipient["rule_version"] != b["rule_version"]:
            raise ApiError(409, "QUOTE_CHANGED", "此关联规则需重新核对。")
        if not recipient["channel_verified"]:
            raise ApiError(409, "CHANNEL_UNVERIFIED", "私人交付渠道尚未核对。")
        if b["a"] - b["l"] < quantity * b["price"]:
            raise ApiError(409, "INSUFFICIENT_A", "可发餐款 A−L 不足。")
        op = create_op(db, actor, name, key, "SUCCESS", None, "success")
        db.execute("UPDATE operations SET target=? WHERE id=?", (op["id"], op["id"]))
        db.execute("INSERT INTO issuances VALUES (?,?)", (op["id"], issue_snapshot(body)))
        first = None
        for position in range(quantity):
            voucher_id, secret = "voucher-" + secrets.token_hex(7), secrets.token_urlsafe(24)
            db.execute("INSERT INTO vouchers (id,recipient_ref,secret,status,delivery_status,created_at) VALUES (?,?,?,?,?,?)", (voucher_id, ref, secret, "active", "pending", now()))
            db.execute("INSERT INTO issuance_vouchers VALUES (?,?,?)", (op["id"], voucher_id, position))
            first = first or {"id": voucher_id, "secret": secret}
        db.execute("UPDATE recipients SET quota_remaining=quota_remaining-? WHERE ref=?", (quantity, ref))
        update_balance(db, a=-quantity * b["price"], r=quantity * b["price"])
        event(db, "voucher_issued", quantity * b["price"], "机构模拟发行确认")
        result = {"message": f"已确认发行{quantity}张单份券。", "operation": op_dict(db, op["id"]), "issuance": issuance_view(db, op["id"], actor)}
        if quantity == 1:  # Retain the single-voucher action response for CP8 clients.
            result["voucher"] = first
        return result

    if name == "group_create":
        require_role(session, "staff")
        group_id = "group-" + secrets.token_hex(8)
        db.execute("INSERT INTO processing_groups VALUES (?,?,?,?)", (group_id, actor, SHOP["id"], now()))
        op = create_op(db, actor, name, key, "SUCCESS", group_id, "success")
        return {"message": "已建立本次处理列表；尚未获得任何处理权。", "operation": op}

    if name == "group_add":
        require_role(session, "staff")
        group = own_group(db, body.get("group_id"), actor)
        v = checked_code(db, body.get("code"))
        position = db.execute("SELECT COUNT(*) FROM processing_items WHERE group_id=?", (group["id"],)).fetchone()[0]
        if position >= 20:
            raise ApiError(409, "GROUP_FULL", "本地每次处理最多20张券。")
        db.execute("INSERT OR IGNORE INTO processing_items VALUES (?,?,?)", (group["id"], v["id"], position))
        op = create_op(db, actor, name, key, "SUCCESS", group["id"], "success")
        return {"message": "已加入本次处理；仍需主动申请唯一处理权。", "operation": op}

    if name == "deliver":
        require_role(session, "partner")
        voucher_id = body.get("voucher_id")
        method = body.get("method")
        if method not in ("sent", "handover", "failed", "reshare"):
            raise ApiError(400, "BAD_METHOD", "交付方式无效。")
        v = get_voucher(db, voucher_id)
        if v["status"] != "active":
            raise ApiError(409, "BAD_VOUCHER_STATE", "此券已有处理锁或申报，不能再分享。")
        if method == "reshare":
            if v["delivery_status"] not in ("failed", "sent", "handover"):
                raise ApiError(409, "BAD_DELIVERY_STATE", "此状态不能再次分享。")
            new_status = "sent"
        else:
            new_status = method
        db.execute(
            "UPDATE vouchers SET delivery_status=?,delivery_method=?,delivery_actor=?,delivery_at=? WHERE id=?",
            (new_status, method, actor, now(), voucher_id),
        )
        op = create_op(db, actor, name, key, "SUCCESS", voucher_id, "success")
        return {"message": "仅记录机构执行的模拟交付动作，不证明指定本人收到。", "operation": op, "voucher": {"id": voucher_id, "secret": v["secret"]}}

    if name == "acknowledge":
        require_role(session, "recipient")
        voucher_id = session["voucher_id"]
        v = get_voucher(db, voucher_id)
        if v["status"] != "active":
            raise ApiError(409, "ALREADY_HANDLED", "此券已进入门店处理或结算，不能再追加收到声明。")
        if v["delivery_status"] not in ("sent", "handover", "acknowledged"):
            raise ApiError(409, "NOT_DELIVERED", "尚无已执行的定向交付记录。")
        db.execute("UPDATE vouchers SET delivery_status='acknowledged' WHERE id=?", (voucher_id,))
        op = create_op(db, actor, name, key, "SUCCESS", voucher_id, "success")
        return {"message": "已记录持链接者主动声明；不证明指定自然人收到。", "operation": op}

    if name == "lock":
        require_role(session, "staff")
        ensure_active(db)
        code = body.get("code")
        v = db.execute("SELECT * FROM vouchers WHERE code=?", (code,)).fetchone()
        if not v or not v["code_expires"] or v["code_expires"] < now():
            raise ApiError(404, "CODE_INVALID", "展示码不存在或已过期。")
        if v["delivery_status"] not in ("sent", "handover", "acknowledged") or v["status"] != "active":
            raise ApiError(409, "LOCK_CONFLICT", "此券不可取得新的处理权。")
        if body.get("group_id"):
            group = own_group(db, body["group_id"], actor)
            if not db.execute("SELECT 1 FROM processing_items WHERE group_id=? AND voucher_id=?", (group["id"], v["id"])).fetchone():
                raise ApiError(409, "NOT_IN_GROUP", "请先主动把此券加入本次处理。")
        op = create_op(db, actor, name, key, "WAITING_CONFIRMATION", v["id"], None)
        db.execute(
            "UPDATE vouchers SET status='locked',lock_actor=?,lock_operation=?,code=NULL,code_expires=NULL WHERE id=?",
            (actor, op["id"], v["id"]),
        )
        return {"message": "正在取得模拟处理权；须显式确认后才能交餐。", "operation": op}

    if name == "confirm_lock":
        require_role(session, "staff")
        op_id = body.get("operation_id")
        op = db.execute("SELECT * FROM operations WHERE id=? AND action='lock'", (op_id,)).fetchone()
        if not op or op["actor"] != actor:
            raise ApiError(403, "FORBIDDEN", "只能确认本人原锁操作。")
        v = get_voucher(db, op["target"])
        if v["lock_operation"] != op_id or v["lock_actor"] != actor:
            raise ApiError(409, "LOCK_CONFLICT", "原处理权不再属于此演示店员。")
        if op["status"] == "SUCCESS" and v["lock_confirmed"]:
            return {"message": "已返回原已确认处理权。", "operation": rowdict(op)}
        if op["status"] != "WAITING_CONFIRMATION" or v["status"] != "locked":
            raise ApiError(409, "BAD_LOCK_STATE", "锁仍未达到可确认状态。")
        db.execute("UPDATE operations SET status='SUCCESS',outcome='success' WHERE id=?", (op_id,))
        db.execute("UPDATE vouchers SET lock_confirmed=1 WHERE id=?", (v["id"],))
        return {"message": "模拟处理权已明确确认，可以交餐。", "operation": op_dict(db, op_id)}

    if name == "handoff":
        require_role(session, "staff")
        v = get_voucher(db, body.get("voucher_id"))
        if v["status"] != "locked" or not v["lock_confirmed"] or v["lock_actor"] != actor:
            raise ApiError(409, "NO_CONFIRMED_LOCK", "未持有已确认处理权，不能声明交餐。")
        db.execute("UPDATE vouchers SET status='handoff',handoff_declared=1 WHERE id=?", (v["id"],))
        op = create_op(db, actor, name, key, "SUCCESS", v["id"], "success")
        return {"message": "已记录店员声明交餐；尚未申报到账。", "operation": op}

    if name == "report":
        require_role(session, "staff")
        v = get_voucher(db, body.get("voucher_id"))
        if v["lock_actor"] != actor or not v["lock_confirmed"] or not v["handoff_declared"] or v["status"] != "handoff":
            raise ApiError(409, "REPORT_BLOCKED", "须为原确认锁店员，且已声明交餐、原申报无未知。")
        outcome = body.get("outcome", "success")
        if outcome not in ("success", "unknown", "failure"):
            raise ApiError(400, "BAD_OUTCOME", "模拟结果无效。")
        status = {"success": "SUCCESS", "unknown": "UNKNOWN", "failure": "FAILED"}[outcome]
        op = create_op(db, actor, name, key, status, v["id"], outcome)
        db.execute("UPDATE vouchers SET report_operation=? WHERE id=?", (op["id"], v["id"]))
        if outcome == "success":
            db.execute("UPDATE vouchers SET status='reported' WHERE id=?", (v["id"],))
            update_balance(db, r=-batch(db)["price"], h=batch(db)["price"])
            event(db, "merchant_report_confirmed", batch(db)["price"], "店员声明 · 模拟申报确认")
        elif outcome == "unknown":
            db.execute("UPDATE vouchers SET status='report_unknown' WHERE id=?", (v["id"],))
        return {"message": "模拟申报已记录；未知时只查原操作。", "operation": op}

    if name == "settle":
        if not can_settle(session):
            raise ApiError(403, "FORBIDDEN", "当前演示身份无权模拟本店结算。")
        ensure_active(db)
        v = get_voucher(db, body.get("voucher_id"))
        if v["status"] != "reported":
            raise ApiError(409, "NOT_PAYABLE", "此券不在可模拟结算的 H 状态。")
        if v["settlement_operation"]:
            old = op_dict(db, v["settlement_operation"])
            if old["status"] == "UNKNOWN":
                raise ApiError(409, "ORIGINAL_UNKNOWN", "原付款结果待核，只能查原操作。")
        outcome = body.get("outcome", "success")
        if outcome not in ("success", "unknown", "failure"):
            raise ApiError(400, "BAD_OUTCOME", "模拟结果无效。")
        status = {"success": "SUCCESS", "unknown": "UNKNOWN", "failure": "FAILED"}[outcome]
        op = create_op(db, actor, name, key, status, v["id"], outcome)
        db.execute("UPDATE vouchers SET settlement_operation=? WHERE id=?", (op["id"], v["id"]))
        if outcome == "success":
            db.execute("UPDATE vouchers SET status='settled' WHERE id=?", (v["id"],))
            update_balance(db, h=-batch(db)["price"], s=batch(db)["price"])
            event(db, "settlement_confirmed", batch(db)["price"], "授权角色 · 模拟结算确认")
        elif outcome == "unknown":
            db.execute("UPDATE vouchers SET status='settlement_unknown' WHERE id=?", (v["id"],))
        return {"message": "模拟结算已记录；失败/未知时 H 保留。", "operation": op}

    if name == "case":
        require_role(session, "supporter", "partner", "staff", "recipient")
        kind = str(body.get("kind", "一般求助"))[:80]
        detail = str(body.get("text", ""))[:200]
        voucher_id = body.get("voucher_id")
        if session["role"] == "recipient":
            voucher_id = session["voucher_id"]
        elif voucher_id:
            get_voucher(db, voucher_id)
            if session["role"] == "supporter":
                raise ApiError(403, "FORBIDDEN", "支持者不能以券号建立私有领取案件。")
        case_id = "case-" + secrets.token_hex(7)
        db.execute(
            "INSERT INTO cases VALUES (?,?,?,?,?,?,?)",
            (case_id, actor, voucher_id, kind, detail, "待机构处理 · 本地模拟", now()),
        )
        op = create_op(db, actor, name, key, "SUCCESS", case_id, "success")
        return {"message": "已建立私人演示案件；普通咨询不占退款锁 L。", "operation": op, "case": {"id": case_id, "stage": "待机构处理 · 本地模拟"}}

    raise ApiError(400, "UNKNOWN_ACTION", "未知的本地模拟动作。")


def public_state(db: sqlite3.Connection) -> dict:
    b = rowdict(batch(db))
    # The public batch is deliberately day-granular: exact write time on a
    # one-voucher batch would reveal the time of a private issue/meal event.
    b["updated_at"] = ((b["updated_at"] + 8 * 3600) // 86400) * 86400 - 8 * 3600
    b["F"], b["A"], b["R"], b["H"], b["S"], b["X"], b["L"] = (b[k] for k in ("f", "a", "r", "h", "s", "x", "l"))
    b["available"] = b["a"] - b["l"]
    # Per-voucher issue/report/settlement timestamps could reveal a recipient's visit
    # in a one-shop demo. Publish only batch-level support/pause evidence here.
    events = [rowdict(x) for x in db.execute(
        "SELECT kind,amount,source,created_at FROM events "
        "WHERE kind IN ('support_confirmed','seed_paused') ORDER BY id DESC LIMIT 20"
    )]
    return {
        "brand": {"name": "留膳", "english": "mealforward", "slogan": "留一膳，待一人。"},
        "shop": SHOP,
        "batch": b,
        "events": events,
        "paused": bool(b["paused"]),
        "simulation": "本地模拟 · 全部实体和金额均为虚构",
    }


def work_state(db: sqlite3.Connection, session: sqlite3.Row | None) -> dict | None:
    if not session:
        return None
    role, actor = session["role"], session["actor"]
    if role == "supporter":
        return {
            "actor": actor, "role": role,
            "operations": [rowdict(x) for x in db.execute("SELECT * FROM operations WHERE actor=? ORDER BY created_at DESC", (actor,))],
            "cases": [rowdict(x) for x in db.execute("SELECT id,kind,stage,created_at FROM cases WHERE actor=? ORDER BY created_at DESC", (actor,))],
        }
    if role == "partner":
        return {
            "actor": actor, "role": role,
            "issuances": [issuance_view(db, row["id"], actor) for row in db.execute("SELECT o.id FROM operations o JOIN issuances i ON i.operation_id=o.id WHERE o.actor=? ORDER BY o.created_at DESC,o.rowid DESC", (actor,)).fetchall()],
            "recipients": [rowdict(x) for x in db.execute("SELECT * FROM recipients ORDER BY ref")],
            "vouchers": [rowdict(x) for x in db.execute("SELECT id,recipient_ref,status,delivery_status,delivery_method,delivery_actor,delivery_at,created_at FROM vouchers ORDER BY created_at DESC")],
            "cases": [rowdict(x) for x in db.execute("SELECT * FROM cases WHERE voucher_id IS NOT NULL OR actor=? ORDER BY created_at DESC", (actor,))],
        }
    if role == "staff":
        rows = db.execute(
            "SELECT id,status,delivery_status,lock_actor,lock_operation,lock_confirmed,handoff_declared,report_operation,settlement_operation,created_at FROM vouchers WHERE lock_actor=? ORDER BY created_at DESC",
            (actor,),
        )
        return {
            "actor": actor, "role": role, "redemptions": [rowdict(x) for x in rows],
            "groups": [group_view(db, g) for g in db.execute("SELECT * FROM processing_groups WHERE staff_actor=? AND shop_id=? ORDER BY rowid DESC", (actor, SHOP["id"])).fetchall()],
            "payables": payable_rows(db),
            "can_settle": can_settle(session),
            **({"destination": SIMULATED_DESTINATION} if can_settle(session) else {}),
            "cases": [rowdict(x) for x in db.execute("SELECT id,voucher_id,kind,stage,created_at FROM cases WHERE actor=? ORDER BY created_at DESC", (actor,))],
        }
    if role == "settler":
        return {"actor": actor, "role": role, "payables": payable_rows(db), "can_settle": True, "destination": SIMULATED_DESTINATION}
    if role == "admin":
        return {"actor": actor, "role": role, "pause": {"paused": bool(batch(db)["paused"]), "reason": "预设异常演练 · 仅本地模拟", "scope": "新入款、发行、新锁、新付款", "old_balances_retained": True}}
    if role == "recipient":
        return {"actor": actor, "role": role}
    return None


def payable_rows(db: sqlite3.Connection) -> list[dict]:
    return [rowdict(x) for x in db.execute(
        "SELECT v.id AS voucher_id,v.status,v.report_operation,v.settlement_operation,o.status AS settlement_status,v.created_at "
        "FROM vouchers v LEFT JOIN operations o ON o.id=v.settlement_operation "
        "WHERE v.status IN ('reported','settlement_unknown','settled') ORDER BY v.created_at DESC"
    )]


def voucher_view(db: sqlite3.Connection, session: sqlite3.Row) -> dict:
    require_role(session, "recipient")
    v = get_voucher(db, session["voucher_id"])
    usable = v["status"] == "active" and v["delivery_status"] in ("sent", "handover", "acknowledged") and not batch(db)["paused"]
    code = None
    expires = None
    if usable:
        code = secrets.token_hex(3).upper()
        expires = now() + 120
        db.execute("UPDATE vouchers SET code=?,code_expires=? WHERE id=?", (code, expires, v["id"]))
    else:
        db.execute("UPDATE vouchers SET code=NULL,code_expires=NULL WHERE id=?", (v["id"],))
    cases = [rowdict(x) for x in db.execute("SELECT id,kind,stage,created_at FROM cases WHERE voucher_id=? AND actor=?", (v["id"], session["actor"]))]
    return {
        "id": v["id"], "shop": SHOP["name"], "meal": SHOP["meal"], "hours": SHOP["hours"],
        "status": v["status"], "delivery_status": v["delivery_status"],
        "code": code, "code_expires": expires, "cases": cases,
        "note": "持链接者不等于已核验的指定自然人；本地模拟。",
    }


class Handler(BaseHTTPRequestHandler):
    db_path = DEFAULT_DB

    def log_message(self, format: str, *args: object) -> None:
        # Never log request paths, headers or bodies; private invitation may be in a fragment.
        return

    def send_json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def body(self) -> dict:
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 0 or size > 65536:
                raise ValueError("too large")
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError("not an object")
            return body
        except (ValueError, json.JSONDecodeError):
            raise ApiError(400, "BAD_JSON", "请求必须是较小的 JSON 对象。")

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        try:
            with closing(connect(self.db_path)) as db:
                session = auth(db, self.headers.get("Authorization"))
                if path == "/api/state":
                    state = public_state(db)
                    state["work"] = work_state(db, session)
                    self.send_json(200, state)
                    return
                if path == "/api/voucher/status":
                    require_role(session, "recipient")
                    v = get_voucher(db, session["voucher_id"])
                    self.send_json(200, {"status": v["status"], "delivery_status": v["delivery_status"], "paused": bool(batch(db)["paused"])})
                    return
                if path == "/api/voucher":
                    require_role(session, "recipient")
                    db.execute("BEGIN IMMEDIATE")
                    result = voucher_view(db, session)
                    db.commit()
                    self.send_json(200, result)
                    return
                if path.startswith("/api/issuances/"):
                    require_role(session, "partner")
                    value = unquote(path.removeprefix("/api/issuances/"))
                    if value.startswith("by-intent/"):
                        op = old_op(db, session["actor"], "issue", value.removeprefix("by-intent/"))
                        if not op:
                            raise ApiError(404, "NOT_FOUND", "未查到原发行；不可据此断言未提交或重发。")
                        value = op["id"]
                    self.send_json(200, {"issuance": issuance_view(db, value, session["actor"])})
                    return
                if path.startswith("/api/partner-invite/"):
                    require_role(session, "partner")
                    v = get_voucher(db, unquote(path.removeprefix("/api/partner-invite/")))
                    if v["status"] != "active":
                        raise ApiError(409, "BAD_VOUCHER_STATE", "此券已进入处理，不能再展示邀请。")
                    self.send_json(200, {"id": v["id"], "secret": v["secret"]})
                    return
                if path.startswith("/api/groups/"):
                    require_role(session, "staff")
                    group = own_group(db, unquote(path.removeprefix("/api/groups/")), session["actor"])
                    self.send_json(200, {"group": group_view(db, group)})
                    return
                if path.startswith("/api/operations/"):
                    require_role(session, "supporter", "partner", "staff", "settler", "recipient")
                    op_id = path.removeprefix("/api/operations/")
                    op = op_dict(db, op_id)
                    if not op:
                        raise ApiError(404, "NOT_FOUND", "找不到原操作。")
                    if op["actor"] != session["actor"]:
                        raise ApiError(403, "FORBIDDEN", "不能查看其他角色的私有原操作。")
                    self.send_json(200, {"operation": op})
                    return
                raise ApiError(404, "NOT_FOUND", "接口不存在。")
        except ApiError as exc:
            self.send_json(exc.status, {"error": str(exc), "code": exc.code})

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        try:
            payload = self.body()
            with closing(connect(self.db_path)) as db:
                db.execute("BEGIN IMMEDIATE")
                if path == "/api/session":
                    actor = payload.get("actor")
                    if actor not in ACTORS:
                        raise ApiError(400, "BAD_ACTOR", "未知的虚构演示角色。")
                    role = ACTORS[actor]
                    result = {"token": issue_session(db, actor, role), "actor": actor, "role": role}
                elif path == "/api/invite/exchange":
                    secret = payload.get("secret")
                    if not isinstance(secret, str) or len(secret) > 200:
                        raise ApiError(400, "BAD_INVITE", "私密邀请格式无效。")
                    v = db.execute("SELECT id FROM vouchers WHERE secret=?", (secret,)).fetchone()
                    if not v:
                        raise ApiError(404, "INVITE_NOT_FOUND", "私密邀请无效，请联系机构。")
                    result = {"token": issue_session(db, "recipient:" + v["id"], "recipient", v["id"])}
                elif path == "/api/reset":
                    seed(db, payload.get("scenario", "normal"))
                    result = {"message": "已重置虚构演示场景。", "scenario": payload.get("scenario", "normal")}
                elif path == "/api/act":
                    session = auth(db, self.headers.get("Authorization"), required=True)
                    result = action(db, session, payload)
                    check_balance(db)
                else:
                    raise ApiError(404, "NOT_FOUND", "接口不存在。")
                db.commit()
                self.send_json(200, result)
        except ApiError as exc:
            self.send_json(exc.status, {"error": str(exc), "code": exc.code})
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "并发状态已变化，请查原操作并刷新。", "code": "CONFLICT"})


def main() -> None:
    parser = argparse.ArgumentParser(description="mealforward CP8 loopback simulation")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--reset", choices=("normal", "paused"))
    args = parser.parse_args()
    init(args.db)
    if args.reset:
        with closing(connect(args.db)) as db:
            db.execute("BEGIN IMMEDIATE")
            seed(db, args.reset)
            db.commit()
        print(f"Reset fictional scenario: {args.reset}")
        return
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.RequestHandlerClass.db_path = args.db
    print(f"mealforward fictional API on http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
