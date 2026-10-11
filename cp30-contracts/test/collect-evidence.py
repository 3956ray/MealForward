"""Validate scoped offline result counts and reconcile handler successes to runner attempts."""
import json
from pathlib import Path

EVIDENCE = Path(__file__).resolve().parents[1] / "evidence"


def read(name):
    return json.loads((EVIDENCE / name).read_text())


def results(name):
    entries = [
        {"suite": suite, "test": test, **result}
        for suite, data in read(name).items()
        for test, result in data["test_results"].items()
    ]
    assert entries and all(item["status"] == "Success" for item in entries), name
    return entries


unit = results("unit.json")
fuzz = results("fuzz.json")
invariant = results("invariant.json")
historical_root = results("historical-root.json")
historical_testnet = results("historical-testnet.json")
assert len(fuzz) == 4 and sum(r["kind"]["Fuzz"]["runs"] for r in fuzz) == 10000
assert all(r["kind"]["Fuzz"]["runs"] == 2500 for r in fuzz)
assert len(invariant) == 1
kind = invariant[0]["kind"]["Invariant"]
assert kind["runs"] == 64 and kind["calls"] == 16384 and kind["reverts"] == 0
rows = [json.loads(line) for line in (EVIDENCE / "invariant-actions.jsonl").read_text().splitlines() if line]
# Installed Foundry makes one additional afterInvariant call verifying the final run.
# Preserve that row in raw evidence, and exclude it from random-attempt accounting only after proving it matches.
assert len(rows) == kind["runs"] + 1 and rows[-1] == rows[-2]
random_rows = rows[:kind["runs"]]
keys = ("funds", "refunds", "donations", "replays", "rejectedTamper", "rejectedForeign", "rejectedCap", "refundNoops")
totals = {key: sum(row[key] for row in random_rows) for key in keys}
bootstrap = 3 * kind["runs"]
random = {
    "fundAction": {"success": totals["funds"] - bootstrap, "expectedRejection": totals["rejectedCap"], "noop": 0},
    "refundAction": {"success": totals["refunds"] - bootstrap, "expectedRejection": 0, "noop": totals["refundNoops"]},
    "donateAction": {"success": totals["donations"] - bootstrap, "expectedRejection": 0, "noop": 0},
    "replayAction": {"success": totals["replays"], "expectedRejection": 0, "noop": 0},
    "tamperAction": {"success": 0, "expectedRejection": totals["rejectedTamper"], "noop": 0},
    "foreignRefundAction": {"success": 0, "expectedRejection": totals["rejectedForeign"], "noop": 0},
}
for name, metrics in kind["metrics"].items():
    action = random[name.rsplit(".", 1)[1]]
    assert metrics["calls"] == sum(action.values()), (name, metrics, action)
    assert metrics["reverts"] == 0 and metrics["discards"] == 0
    action["attempts"] = metrics["calls"]
for row in random_rows:
    assert row["funds"] > 3 and row["refunds"] > 3 and row["donations"] > 3
    assert row["mealAFunds"] > 0 and row["mealBFunds"] > 0
    assert all(2 <= value <= 10 for value in row["storeFundedUnits"])
    assert all(0 < returned <= funded for returned, funded in zip(row["storeRefundedUnits"], row["storeFundedUnits"]))
    assert row["rejectedCap"] > 0

gas_results = results("gas-calls.json")
gas = dict(line.rsplit(": ", 1) for line in gas_results[0]["decoded_logs"])
summary = {
    "status": "COMPLETE_FOR_INDEPENDENT_REVIEW_NOT_ACCEPTED",
    "seed": "0xc030",
    "unit": {"tests": len(unit), "failures": 0},
    "fuzz": {"methods": {r["test"]: r["kind"]["Fuzz"]["runs"] for r in fuzz}, "cases": 10000, "failures": 0},
    "invariant": {"runs": 64, "depth": 256, "calls": 16384, "unexpectedReverts": 0,
                  "hookRows": len(rows), "extraFinalVerificationRow": 1,
                  "bootstrapPerRun": {"funds": 3, "refunds": 3, "donations": 3},
                  "includingBootstrapTotals": totals, "randomActions": random,
                  "minMaxSuccessesPerRun": {key: [min(r[key] for r in random_rows), max(r[key] for r in random_rows)] for key in keys},
                  "perStoreFundedUnitsMinMax": [[min(r["storeFundedUnits"][i] for r in random_rows), max(r["storeFundedUnits"][i] for r in random_rows)] for i in range(3)],
                  "perStoreRefundedUnitsMinMax": [[min(r["storeRefundedUnits"][i] for r in random_rows), max(r["storeRefundedUnits"][i] for r in random_rows)] for i in range(3)]},
    "historical": {"rootMethods": len(historical_root), "rootFuzzCases": sum(r["kind"].get("Fuzz", {}).get("runs", 0) for r in historical_root), "testnetNamedOfflineMethods": len(historical_testnet), "failures": 0},
    "gas": {"measurement": "local EVM call incl ABI/call overhead, excl intrinsic transaction fees; warmth varies in one test; not Monad cost", "calls": {key: int(value) for key, value in gas.items()}},
    "notRun": ["real asset/network/wallet/auth", "R/H/S/fulfillment", "database/API/worker", "SDK/NFT integration", "higher-cap capacity", "track eligibility"],
}
(EVIDENCE / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps({"unit": summary["unit"], "fuzzCases": 10000, "invariantCalls": 16384, "randomActions": random}, indent=2))
