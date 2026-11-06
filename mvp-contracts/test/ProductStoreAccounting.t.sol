// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ProductCatalog as C} from "../contracts/ProductCatalog.sol";
import {ProductFunding as F} from "../contracts/ProductFunding.sol";
import {ProductEscrow as E} from "../contracts/ProductEscrow.sol";
import {EscrowVm, EscrowTestAsset} from "./ProductEscrow.t.sol";

contract ProductStoreAccountingTest {
    EscrowVm constant vm = EscrowVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant OWNER_A = address(0xa001);
    address constant OWNER_B = address(0xb001);
    address constant DONOR = address(0xd001);
    address constant PLATFORM = address(0xf001);
    uint256 constant VERIFIER_KEY = 0x123456;
    bytes32 constant A = keccak256("accounting-store-a");
    bytes32 constant B = keccak256("accounting-store-b");
    bytes32 constant MEAL = keccak256("accounting-meal");
    uint256 constant START = 1800000000;
    EscrowTestAsset token;
    E escrow;
    bytes32 a1;
    bytes32 a2;
    bytes32 b1;
    uint256 request;

    function setUp() public {
        vm.warp(START);
        token = new EscrowTestAsset();
        escrow = new E(token, PLATFORM, vm.addr(VERIFIER_KEY), 7200);
        token.mint(DONOR, 1e15);
        vm.prank(DONOR); token.approve(address(escrow), type(uint256).max);
        vm.prank(OWNER_A); escrow.registerStore(_id(), A);
        vm.prank(OWNER_B); escrow.registerStore(_id(), B);
        _publish(A, OWNER_A, 0, 7_000_000, 4);
        a1 = _fund(A, 1, 7_000_000, 4);
        _publish(A, OWNER_A, 1, 9_000_000, 3);
        a2 = _fund(A, 2, 9_000_000, 3);
        _publish(B, OWNER_B, 0, 12_000_000, 5);
        b1 = _fund(B, 1, 12_000_000, 5);
    }

    function _id() private returns (bytes32) { return bytes32(++request); }
    function _publish(bytes32 store, address owner, uint256 version, uint256 price, uint256 quantity) private {
        C.TermsInput memory terms = C.TermsInput(price, keccak256("body"), keccak256("image"), 1, 0, 1440, 0, 0);
        vm.prank(owner); escrow.publish(_id(), store, MEAL, version, terms, quantity, START + 10 days);
    }
    function _fund(bytes32 store, uint256 version, uint256 price, uint256 quantity) private returns (bytes32) {
        F.FundingRequest memory r = F.FundingRequest(_id(), store, MEAL, version,
            escrow.getTerms(store, MEAL, version).termsHash, quantity, price * quantity, START + 10 days);
        vm.prank(DONOR); return escrow.fund(r);
    }
    function _claim(bytes32 batch, uint256 index, uint256 generation, address who) private returns (bytes32) {
        vm.prank(PLATFORM); return escrow.claim(_id(), batch, index, generation, who);
    }
    function _redeem(bytes32 id, address owner) private {
        E.Voucher memory voucher = escrow.getVoucher(id);
        E.RedemptionPermit memory permit = E.RedemptionPermit(id, voucher.generation, owner, block.timestamp, block.timestamp + 120);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VERIFIER_KEY, escrow.redemptionDigest(permit));
        vm.prank(owner); escrow.redeem(_id(), id, voucher.generation, permit, abi.encodePacked(r, s, v));
    }
    function _settle(bytes32 id, address owner) private {
        uint256 generation = escrow.getVoucher(id).generation;
        vm.prank(owner); escrow.settle(_id(), id, generation);
    }
    function _close(bytes32 store, address owner) private {
        vm.prank(owner); escrow.closeStore(_id(), store);
    }
    function _refund(bytes32 batch, address owner) private {
        vm.prank(owner); escrow.refundBatch(_id(), batch);
    }
    function _sumBatch(E.Accounting memory total, bytes32 id) private view returns (E.Accounting memory) {
        F.Batch memory batch = escrow.getBatch(id);
        E.BatchAccounting memory value = escrow.getBatchAccounting(id);
        total.fundedQuantity += batch.quantity;
        total.fundedAmount += batch.amount;
        total.claimedQuantity += value.claimedQuantity;
        total.claimedAmount += value.claimedAmount;
        total.handedOverQuantity += value.handedOverQuantity;
        total.handedOverAmount += value.handedOverAmount;
        total.settledQuantity += value.settledQuantity;
        total.settledAmount += value.settledAmount;
        total.refundPendingQuantity += value.refundPendingQuantity;
        total.refundPendingAmount += value.refundPendingAmount;
        total.refundedQuantity += value.refundedQuantity;
        total.refundedAmount += value.refundedAmount;
        total.availableQuantity = total.fundedQuantity - total.claimedQuantity - total.handedOverQuantity
            - total.settledQuantity - total.refundPendingQuantity - total.refundedQuantity;
        total.availableAmount = total.fundedAmount - total.claimedAmount - total.handedOverAmount
            - total.settledAmount - total.refundPendingAmount - total.refundedAmount;
        total.liability = total.fundedAmount - total.settledAmount - total.refundedAmount;
        return total;
    }
    function _check() private view {
        E.Accounting memory expectedA;
        expectedA = _sumBatch(expectedA, a1);
        expectedA = _sumBatch(expectedA, a2);
        E.Accounting memory expectedB;
        expectedB = _sumBatch(expectedB, b1);
        E.Accounting memory actualA = escrow.getStoreAccounting(A);
        E.Accounting memory actualB = escrow.getStoreAccounting(B);
        require(keccak256(abi.encode(expectedA)) == keccak256(abi.encode(actualA)), "store A equals original batches");
        require(keccak256(abi.encode(expectedB)) == keccak256(abi.encode(actualB)), "store B equals original batches");
        uint256[15] memory fieldsA = abi.decode(abi.encode(actualA), (uint256[15]));
        uint256[15] memory fieldsB = abi.decode(abi.encode(actualB), (uint256[15]));
        uint256[15] memory global = abi.decode(abi.encode(escrow.accounting()), (uint256[15]));
        for (uint256 i; i < 15; ++i) require(fieldsA[i] + fieldsB[i] == global[i], "sum of stores equals global");
        require(token.balanceOf(address(escrow)) == actualA.liability + actualB.liability, "all liabilities backed");
    }

    function testUnknownAndEmptyStoresReturnZeroWithoutChangingGlobalAccounting() public {
        bytes32 before = keccak256(abi.encode(escrow.accounting()));
        E.Accounting memory zero;
        require(keccak256(abi.encode(escrow.getStoreAccounting(bytes32(0)))) == keccak256(abi.encode(zero)), "unknown zero");
        bytes32 empty = keccak256("registered-empty");
        vm.prank(OWNER_A); escrow.registerStore(_id(), empty);
        _close(empty, OWNER_A);
        require(keccak256(abi.encode(escrow.getStoreAccounting(empty))) == keccak256(abi.encode(zero)), "closed empty zero");
        require(keccak256(abi.encode(escrow.accounting())) == before, "reads and empty store do not change global");
        _check();
    }

    function testMixedStoresVersionsExpiryClosureRefundAndSettlementStayConserved() public {
        _check();
        bytes32 first = _claim(a1, 0, 1, address(0x101));
        bytes32 expiring = _claim(a2, 2, 1, address(0x102));
        bytes32 other = _claim(b1, 4, 1, address(0x103));
        _check(); _redeem(first, OWNER_A); _redeem(other, OWNER_B); _check();
        vm.warp(START + 7200); escrow.expire(expiring); _check();
        bytes32 next = _claim(a2, 2, 2, address(0x104));
        _redeem(next, OWNER_A); _settle(first, OWNER_A); _settle(other, OWNER_B); _check();
        _claim(a1, 1, 1, address(0x105)); _check();
        _close(A, OWNER_A); _check();
        E.Accounting memory closed = escrow.getStoreAccounting(A);
        require(closed.claimedQuantity == 0 && closed.availableQuantity == 0 && closed.refundPendingQuantity == 5, "cancelled claims pending refund");
        require(closed.refundPendingAmount == 39_000_000 && closed.settledAmount == 7_000_000, "original mixed prices");
        _refund(a1, OWNER_A); _check(); _close(B, OWNER_B); _check();
        _refund(b1, DONOR); _check(); _refund(a2, OWNER_A); _check();
        vm.warp(START + 7380); _settle(next, OWNER_A); _check();
        require(escrow.getStoreAccounting(A).liability == 0 && escrow.getStoreAccounting(B).liability == 0, "no outstanding liability");
        require(escrow.getStoreAccounting(A).settledAmount == 16_000_000, "handover to settlement after closure");
        require(escrow.getStoreAccounting(B).settledAmount == 12_000_000, "other store isolated");
    }

    function testStoreCountersRollbackWithFailedSettlementAndRefund() public {
        bytes32 voucher = _claim(a1, 0, 1, address(0x101));
        _redeem(voucher, OWNER_A); vm.warp(START + 180); _close(A, OWNER_A);
        bytes32 before = keccak256(abi.encode(escrow.getStoreAccounting(A)));
        token.rejectForTest();
        vm.prank(OWNER_A); vm.expectRevert(); escrow.settle(_id(), voucher, 1);
        require(keccak256(abi.encode(escrow.getStoreAccounting(A))) == before, "settlement counter rollback");
        vm.prank(OWNER_A); vm.expectRevert(); escrow.refundBatch(_id(), a1);
        require(keccak256(abi.encode(escrow.getStoreAccounting(A))) == before, "refund counter rollback");
        _check(); token.acceptForTest(); _settle(voucher, OWNER_A); _refund(a1, OWNER_A); _check();
    }

    function testLazyExpiryUpdatesStoreClaimedCountersExactlyOnce() public {
        bytes32 prior = _claim(a1, 3, 1, address(0x101));
        vm.warp(START + 7200); _claim(a1, 3, 2, address(0x102));
        require(escrow.getVoucher(prior).status == E.Status.Expired, "prior generation expired");
        require(escrow.getStoreAccounting(A).claimedQuantity == 1 && escrow.getStoreAccounting(A).claimedAmount == 7_000_000, "one current claim");
        _check();
    }

    function testFuzzStoreAccountingConservation(uint8 index, bool expiredFirst, bool handover, bool settleBeforeClosure) public {
        bytes32 voucher = _claim(a1, uint256(index) % 4, 1, address(0x101));
        if (expiredFirst) { vm.warp(START + 7200); voucher = _claim(a1, uint256(index) % 4, 2, address(0x102)); }
        _check();
        if (handover) {
            _redeem(voucher, OWNER_A);
            if (settleBeforeClosure) { vm.warp(block.timestamp + 180); _settle(voucher, OWNER_A); }
        }
        _check(); _close(A, OWNER_A); _check(); _refund(a1, OWNER_A); _refund(a2, OWNER_A); _check();
        if (handover && !settleBeforeClosure) { vm.warp(block.timestamp + 180); _settle(voucher, OWNER_A); }
        _check();
    }
}
