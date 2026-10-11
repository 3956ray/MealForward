// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {C0TestBase, StoreEscrow, MockERC20} from "./C0TestBase.sol";

/// @dev The reference owns original chosen inputs and successful transitions. Getters are assertions only.
contract LifecycleHandler is C0TestBase {
    struct Ref {
        bytes32 batch;
        bytes32 meal;
        bytes32 hash;
        uint256 price;
        uint256 version;
        uint8 local;
        uint8 bucket;
        uint256 gen;
        bytes32 voucher;
        uint256 issued;
        bytes32 lockId;
        bytes32 marker;
    }
    StoreEscrow public immutable escrow;
    MockERC20 public immutable coin;
    Ref[10] private model;
    uint256 private serial = 1000;
    uint256 public funded;
    uint256 public donated;
    uint256 public paidOwner;
    uint256 public returned;
    uint256[12] public successes;
    uint256[12] public rejections;
    uint256[12] public noops;
    bool private safetyPause;
    bytes private lastData;
    address private lastCaller;
    bytes32 private lastResult;

    constructor(StoreEscrow e, MockERC20 t) {
        escrow = e;
        coin = t;
        coin.mint(PAYER, 1e30);
        vm.prank(PAYER);
        coin.approve(address(e), type(uint256).max);
        add(terms(MEAL_A, 1, 3, TERMS_A), 3);
        add(terms(MEAL_B, 1, 5, TERMS_B), 3);
        StoreEscrow.TermsInput memory v2 = terms(MEAL_A, 2, 7, TERMS_B);
        vm.prank(e.catalogAuthority());
        e.publish(bytes32(++serial), 0, v2);
        add(v2, 4);
    }

    function add(StoreEscrow.TermsInput memory t, uint256 qty) private {
        bytes32 hash = referenceTerms(escrow, t);
        bytes32 qId = bytes32(++serial);
        StoreEscrow.FundingQuote memory q = StoreEscrow.FundingQuote(
            qId, PAYER, t.mealId, t.version, hash, qty, t.unitPrice, qty * t.unitPrice, block.timestamp + 600
        );
        bytes memory sig = signature(escrow, q);
        vm.prank(PAYER);
        bytes32 b = escrow.fund(q, sig);
        for (uint8 i; i < qty; i++) {
            uint256 seq;
            while (seq < 10 && model[seq].price != 0) seq++;
            model[seq] = Ref(b, t.mealId, hash, t.unitPrice, t.version, i, 0, 0, 0, 0, 0, 0);
        }
        funded += qty * t.unitPrice;
    }

    function callSuccess(uint8 action, address caller, bytes memory data) private returns (bytes32 result) {
        vm.prank(caller);
        (bool ok, bytes memory out) = address(escrow).call(data);
        require(ok, "model fresh success rejected");
        result = abi.decode(out, (bytes32));
        successes[action]++;
        lastData = data;
        lastCaller = caller;
        lastResult = result;
    }

    function eligible(uint8 action, uint256 start) private view returns (bool, uint8) {
        for (uint256 i; i < 10; i++) {
            uint8 n = uint8((start + i) % 10);
            Ref storage r = model[n];
            bool match_;
            if (action == 1) match_ = n >= 2 && r.bucket == 1 && r.lockId == 0 && block.timestamp < r.issued + 259200;
            if (action == 2) {
                match_ = r.bucket == 1 && r.lockId != 0 && r.marker == 0 && block.timestamp < r.issued + 259200;
            }
            if (action == 3) match_ = r.bucket == 1 && r.marker != 0;
            if (action == 4) match_ = r.bucket == 2;
            if (action == 5) {
                match_ = r.bucket == 1 && r.lockId == 0 && r.marker == 0 && block.timestamp >= r.issued + 259200;
            }
            if (action == 6) match_ = n >= 8 && r.bucket == 0;
            if (match_) return (true, n);
        }
        return (false, 0);
    }

    function step(uint8 rawAction, uint256 seed) external {
        uint8 action = rawAction % 12;
        bytes32 id = bytes32(++serial);
        if (action == 0) {
            if (safetyPause) {
                noops[action]++;
                return;
            }
            bytes32 meal = seed % 2 == 0 ? MEAL_A : MEAL_B;
            bool found;
            uint8 n;
            for (uint8 i; i < 10; i++) {
                Ref storage r = model[i];
                if (
                    r.meal == meal
                        && (r.bucket == 0
                            || (r.bucket == 1
                                && r.lockId == 0
                                && r.marker == 0
                                && block.timestamp >= r.issued + 259200))
                ) {
                    found = true;
                    n = i;
                    break;
                }
            }
            if (!found) {
                noops[action]++;
                return;
            }
            Ref storage r = model[n];
            uint256 gen = r.gen + 1;
            bytes32 result = callSuccess(
                action,
                escrow.issuerAuthority(),
                abi.encodeCall(StoreEscrow.issue, (id, meal, n, gen, r.hash, block.timestamp + 600))
            );
            // Normalization is independently predicted for all ten original units, including the other meal.
            for (uint8 i; i < 10; i++) {
                Ref storage x = model[i];
                if (x.bucket == 1 && x.lockId == 0 && x.marker == 0 && block.timestamp >= x.issued + 259200) {
                    x.bucket = 0;
                }
            }
            require(
                result
                    == keccak256(abi.encode(keccak256("MealForwardVoucherV1"), block.chainid, address(escrow), n, gen)),
                "voucher domain"
            );
            r.bucket = 1;
            r.gen = gen;
            r.voucher = result;
            r.issued = block.timestamp;
            r.lockId = 0;
            r.marker = 0;
        } else if (action <= 6) {
            if (safetyPause && (action == 1 || action == 2)) {
                noops[action]++;
                return;
            }
            (bool found, uint8 n) = eligible(action, seed % 10);
            if (!found) {
                noops[action]++;
                return;
            }
            Ref storage r = model[n];
            if (action == 1) {
                r.lockId = callSuccess(
                    action,
                    escrow.operatorAuthority(),
                    abi.encodeCall(StoreEscrow.lock, (id, r.voucher, r.gen, block.timestamp + 600))
                );
            }
            if (action == 2) {
                r.marker = callSuccess(
                    action,
                    escrow.operatorAuthority(),
                    abi.encodeCall(StoreEscrow.markHandover, (id, r.voucher, r.gen, r.lockId, block.timestamp + 600))
                );
            }
            if (action == 3) {
                callSuccess(
                    action,
                    escrow.operatorAuthority(),
                    abi.encodeCall(StoreEscrow.report, (id, r.voucher, r.gen, r.lockId, r.marker))
                );
                r.bucket = 2;
            }
            if (action == 4) {
                require(
                    uint256(
                        callSuccess(action, escrow.owner(), abi.encodeCall(StoreEscrow.settle, (id, r.voucher, r.gen)))
                    ) == r.price,
                    "original settle"
                );
                r.bucket = 3;
                paidOwner += r.price;
            }
            if (action == 5) {
                require(
                    uint256(
                        callSuccess(
                            action, escrow.issuerAuthority(), abi.encodeCall(StoreEscrow.expire, (id, r.voucher, r.gen))
                        )
                    ) == n,
                    "original expire"
                );
                r.bucket = 0;
            }
            if (action == 6) {
                require(
                    uint256(
                        callSuccess(
                            action,
                            PAYER,
                            abi.encodeCall(StoreEscrow.refundWithIntent, (id, r.batch, uint16(uint256(1) << r.local)))
                        )
                    ) == r.price,
                    "original refund"
                );
                r.bucket = 4;
                returned += r.price;
            }
        } else if (action == 7) {
            bool awaitingMarker;
            for (uint256 i; i < 10; i++) {
                if (model[i].bucket == 1 && model[i].lockId != 0 && model[i].marker == 0) awaitingMarker = true;
            }
            vm.warp(block.timestamp + (awaitingMarker || seed % 2 == 0 ? 1 : 259200));
            successes[action]++;
        } else if (action == 8) {
            uint256 amount = seed % 100 + 1;
            coin.mint(address(escrow), amount);
            donated += amount;
            successes[action]++;
        } else if (action == 9) {
            if (lastData.length == 0) {
                noops[action]++;
                return;
            }
            vm.recordLogs();
            vm.prank(lastCaller);
            (bool ok, bytes memory out) = address(escrow).call(lastData);
            require(
                ok && abi.decode(out, (bytes32)) == lastResult && vm.getRecordedLogs().length == 0,
                "historical lookup effects"
            );
            successes[action]++;
        } else if (action == 10) {
            // Original operator cannot settle, even after a successful historical operation.
            vm.prank(escrow.operatorAuthority());
            (bool ok, bytes memory err) =
                address(escrow).call(abi.encodeCall(StoreEscrow.settle, (id, model[seed % 10].voucher, uint256(1))));
            require(!ok && bytes4(err) == StoreEscrow.UnauthorizedRole.selector, "foreign role");
            rejections[action]++;
        } else {
            uint256 rev = escrow.controlRevision();
            callSuccess(
                action, escrow.catalogAuthority(), abi.encodeCall(StoreEscrow.setPaused, (id, rev, !safetyPause))
            );
            safetyPause = !safetyPause;
        }
    }

    function assertModel() external view {
        uint256[5] memory counts;
        uint256[5] memory amounts;
        for (uint8 i; i < 10; i++) {
            Ref memory r = model[i];
            counts[r.bucket]++;
            amounts[r.bucket] += r.price;
            StoreEscrow.Unit memory u = escrow.getUnit(i);
            require(
                u.batchId == r.batch && u.localIndex == r.local && u.payer == PAYER && u.mealId == r.meal
                    && u.version == r.version && u.termsHash == r.hash && u.unitPrice == r.price,
                "original input binding"
            );
            require(
                uint8(u.bucket) == r.bucket && u.generation == r.gen && u.voucherId == r.voucher, "reference lifecycle"
            );
            if (r.gen > 0) {
                StoreEscrow.Voucher memory v = escrow.getVoucher(r.voucher);
                require(
                    v.issuedAt == r.issued && v.expiresAt == r.issued + 259200 && v.lockId == r.lockId
                        && v.markerId == r.marker,
                    "clock and processing reference"
                );
            }
        }
        StoreEscrow.Accounting memory z = escrow.getAccounting();
        uint256 sum;
        for (uint8 i; i < 5; i++) {
            require(z.counts[i] == counts[i] && z.amounts[i] == amounts[i], "five buckets");
            sum += amounts[i];
        }
        require(sum == funded && z.fundedAmount == funded && z.fundedUnits == 10, "F partition");
        require(
            z.liability == amounts[0] + amounts[1] + amounts[2] && z.liability == funded - paidOwner - returned,
            "liability"
        );
        require(
            coin.balanceOf(address(escrow)) == z.liability + donated && escrow.surplus() == donated,
            "coverage and donation"
        );
        require(
            coin.balanceOf(PAYER) == 1e30 - funded + returned && coin.balanceOf(escrow.owner()) == paidOwner,
            "exact original endpoints"
        );
    }
}

contract S0bStatefulTest is C0TestBase {
    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }
    LifecycleHandler private handler;

    function setUp() public override {
        vm.chainId(31337);
        vm.warp(1800000000);
        authority = vm.addr(SYNTHETIC_AUTHORITY_FIXTURE);
        token = new MockERC20();
        StoreEscrow.CatalogEntry[] memory cs = new StoreEscrow.CatalogEntry[](2);
        cs[0] = StoreEscrow.CatalogEntry(terms(MEAL_A, 1, 3, TERMS_A), true);
        cs[1] = StoreEscrow.CatalogEntry(terms(MEAL_B, 1, 5, TERMS_B), true);
        StoreEscrow e = new StoreEscrow(token, bytes32(uint256(9)), address(0x201), authority, roles(), cs);
        handler = new LifecycleHandler(e, token);
    }

    function targetContracts() external view returns (address[] memory t) {
        t = new address[](1);
        t[0] = address(handler);
    }

    function targetSelectors() external view returns (FuzzSelector[] memory t) {
        bytes4[] memory ss = new bytes4[](1);
        ss[0] = LifecycleHandler.step.selector;
        t = new FuzzSelector[](1);
        t[0] = FuzzSelector(address(handler), ss);
    }

    function invariantIndependentFullLifecycleOriginalInputReference() public view {
        handler.assertModel();
    }

    function afterInvariant() public {
        // No lifecycle bootstrap: these counters are all actual random-handler successes.
        assertTrue(handler.successes(0) > 3);
        uint256 actions;
        string memory row = '{"success":[';
        for (uint256 i; i < 12; i++) {
            uint256 n = handler.successes(i);
            actions += n;
            row = string.concat(row, i == 0 ? "" : ",", decimal(n));
        }
        row = string.concat(row, '],"rejected":[');
        for (uint256 i; i < 12; i++) {
            uint256 n = handler.rejections(i);
            actions += n;
            row = string.concat(row, i == 0 ? "" : ",", decimal(n));
        }
        row = string.concat(row, '],"noop":[');
        for (uint256 i; i < 12; i++) {
            uint256 n = handler.noops(i);
            actions += n;
            row = string.concat(row, i == 0 ? "" : ",", decimal(n));
        }
        assertEq(actions, 256);
        vm.writeLine("evidence/s0b/lifecycle-actions.jsonl", string.concat(row, "]}"));
    }

    function decimal(uint256 n) private pure returns (string memory) {
        if (n == 0) return "0";
        uint256 x = n;
        uint256 digits;
        while (x > 0) {
            digits++;
            x /= 10;
        }
        bytes memory b = new bytes(digits);
        while (n > 0) {
            b[--digits] = bytes1(uint8(48 + n % 10));
            n /= 10;
        }
        return string(b);
    }
}
