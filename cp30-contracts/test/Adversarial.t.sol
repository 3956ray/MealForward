// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {C0TestBase, IERC20, StoreEscrow} from "./C0TestBase.sol";
import {AdversarialERC20, NoReturnERC20} from "./mocks/AdversarialERC20.sol";

contract AdversarialTest is C0TestBase {
    function testCrossEntryCallbacksFundToRefundAndRefundToFundAreGuarded() public {
        AdversarialERC20 bad = new AdversarialERC20();
        StoreEscrow escrow = maliciousEscrow(bad);
        bytes32 id = fund(escrow, quote(PAYER, 1, 2, false));
        bad.configureCallback(address(escrow), abi.encodeCall(StoreEscrow.refund, (id, uint16(1))));
        bad.configure(AdversarialERC20.Behavior.CallbackCatch, AdversarialERC20.Behavior.Normal);
        fund(escrow, quote(PAYER, 2, 1, false));
        assertEq(escrow.getBatch(id).refundedMask, 0);
        assertEq(uint32(bad.callbackError()), uint32(bytes4(keccak256("ReentrancyGuardReentrantCall()"))));
        StoreEscrow.FundingQuote memory inner = quote(address(bad), 3, 1, false);
        bad.configureCallback(address(escrow), abi.encodeCall(StoreEscrow.fund, (inner, signature(escrow, inner))));
        bad.configure(AdversarialERC20.Behavior.Normal, AdversarialERC20.Behavior.CallbackCatch);
        refund(escrow, PAYER, id, 1);
        assertEq(uint32(bad.callbackError()), uint32(bytes4(keccak256("ReentrancyGuardReentrantCall()"))));
        assertEq(escrow.lifetimeFundedUnits(), 3);
        (, bytes32 nestedBatch) = escrow.quoteUses(inner.quoteId);
        assertEq(nestedBatch, bytes32(0));
    }

    function testCrossStoreCallbacksNeedTheirOwnPayerDomainAndBatchAuthorization() public {
        AdversarialERC20 bad = new AdversarialERC20();
        StoreEscrow escrow = maliciousEscrow(bad);
        StoreEscrow other = new StoreEscrow(bad, bytes32(uint256(5)), OTHER_PAYER, authority, catalog(PRICE_A));
        StoreEscrow.FundingQuote memory inner = quote(PAYER, 2, 1, false);
        bad.configureCallback(address(other), abi.encodeCall(StoreEscrow.fund, (inner, signature(other, inner))));
        bad.configure(AdversarialERC20.Behavior.CallbackCatch, AdversarialERC20.Behavior.Normal);
        bytes32 id = fund(escrow, quote(PAYER, 1, 1, false));
        assertEq(uint32(bad.callbackError()), uint32(StoreEscrow.UnauthorizedPayer.selector));
        inner.payer = address(bad);
        bad.configureCallback(address(other), abi.encodeCall(StoreEscrow.fund, (inner, signature(escrow, inner))));
        fund(escrow, quote(PAYER, 3, 1, false));
        assertEq(uint32(bad.callbackError()), uint32(StoreEscrow.UnauthorizedQuote.selector));
        bad.configureCallback(address(other), abi.encodeCall(StoreEscrow.refund, (id, uint16(1))));
        bad.configure(AdversarialERC20.Behavior.Normal, AdversarialERC20.Behavior.CallbackCatch);
        refund(escrow, PAYER, id, 1);
        assertEq(uint32(bad.callbackError()), uint32(StoreEscrow.InvalidBatch.selector));
        assertEq(other.lifetimeFundedUnits(), 0);
        assertEq(other.totalFundedAmount(), 0);
        assertEq(bad.balanceOf(address(other)), 0);
    }

    function testCaughtCallbackFollowedByIncorrectDeltaStillRollsBackOuterAction() public {
        AdversarialERC20 bad = new AdversarialERC20();
        StoreEscrow escrow = maliciousEscrow(bad);
        bad.configureCallback(address(escrow), abi.encodeCall(StoreEscrow.refund, (bytes32(uint256(99)), uint16(1))));
        bad.configure(AdversarialERC20.Behavior.CallbackCatch, AdversarialERC20.Behavior.Normal);
        bad.configureCallbackExtraCredit(true);
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 2, false);
        bytes memory sig = signature(escrow, q);
        vm.expectRevert(StoreEscrow.TransferDeltaMismatch.selector);
        vm.prank(PAYER);
        escrow.fund(q, sig);
        assertEq(escrow.lifetimeFundedUnits(), 0);
        assertEq(bad.callbackAttempts(), 0);
        assertEq(bad.balanceOf(PAYER), 100 * PRICE_A);
        bad.configureCallbackExtraCredit(false);
        bad.configure(AdversarialERC20.Behavior.Normal, AdversarialERC20.Behavior.Normal);
        bytes32 id = fund(escrow, q);
        bad.configureCallbackExtraCredit(true);
        bad.configure(AdversarialERC20.Behavior.Normal, AdversarialERC20.Behavior.CallbackCatch);
        vm.expectRevert(StoreEscrow.TransferDeltaMismatch.selector);
        refund(escrow, PAYER, id, 1);
        assertEq(escrow.getBatch(id).refundedMask, 0);
        assertEq(bad.callbackAttempts(), 0);
        assertEq(bad.balanceOf(address(escrow)), 2 * PRICE_A);
    }

    function testIncomingReceiverTaxRollsBackPayerEscrowFeeAllowanceAndQuote() public {
        expectIncomingDeltaReject(AdversarialERC20.Behavior.Tax);
    }

    function testIncomingSenderExtraFeeRollsBackPayerEscrowFeeAllowanceAndQuote() public {
        expectIncomingDeltaReject(AdversarialERC20.Behavior.ExtraDebit);
    }

    function expectIncomingDeltaReject(AdversarialERC20.Behavior behavior) private {
        AdversarialERC20 bad = new AdversarialERC20();
        StoreEscrow escrow = maliciousEscrow(bad);
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 3, false);
        bytes memory sig = signature(escrow, q);
        bad.configure(behavior, AdversarialERC20.Behavior.Normal);
        vm.expectRevert(StoreEscrow.TransferDeltaMismatch.selector);
        vm.prank(PAYER);
        escrow.fund(q, sig);
        assertEq(bad.balanceOf(PAYER), 100 * PRICE_A);
        assertEq(bad.balanceOf(address(escrow)), 0);
        assertEq(bad.balanceOf(bad.FEE_COLLECTOR()), 0);
        assertEq(bad.allowance(PAYER, address(escrow)), 20 * PRICE_A);
        assertEq(bad.transferFromCalls(), 0);
        assertEq(escrow.totalFundedAmount(), 0);
        assertEq(escrow.availableAmount(), 0);
        assertEq(escrow.totalRefundedAmount(), 0);
        assertEq(escrow.lifetimeFundedUnits(), 0);
        (bytes32 payload, bytes32 id) = escrow.quoteUses(q.quoteId);
        assertEq(payload, bytes32(0));
        assertEq(id, bytes32(0));
        bytes32 expectedBatch = keccak256(abi.encode(block.chainid, address(escrow), q.quoteId));
        assertEq(escrow.getBatch(expectedBatch).payer, address(0));
    }

    function maliciousEscrow(AdversarialERC20 bad) private returns (StoreEscrow escrow) {
        escrow = new StoreEscrow(bad, bytes32(uint256(4)), PAYER, authority, catalog(PRICE_A));
        bad.mint(PAYER, 100 * PRICE_A);
        vm.prank(PAYER);
        bad.approve(address(escrow), 20 * PRICE_A);
    }

    function testIncomingFalseRevertTaxExtraDebitCreditRebaseAndNoMoveAtomic() public {
        AdversarialERC20 bad = new AdversarialERC20();
        StoreEscrow escrow = maliciousEscrow(bad);
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 3, false);
        bytes memory sig = signature(escrow, q);
        for (uint256 mode = 1; mode <= 7; ++mode) {
            bad.configure(AdversarialERC20.Behavior(mode), AdversarialERC20.Behavior.Normal);
            vm.expectRevert();
            vm.prank(PAYER);
            escrow.fund(q, sig);
            assertEq(bad.balanceOf(PAYER), 100 * PRICE_A);
            assertEq(bad.balanceOf(address(escrow)), 0);
            assertEq(bad.allowance(PAYER, address(escrow)), 20 * PRICE_A);
            assertEq(bad.balanceOf(bad.FEE_COLLECTOR()), 0);
            assertEq(bad.transferFromCalls(), 0);
            assertEq(escrow.totalFundedAmount(), 0);
            assertEq(escrow.lifetimeFundedUnits(), 0);
            (, bytes32 id) = escrow.quoteUses(q.quoteId);
            assertEq(id, bytes32(0));
        }
        bad.configure(AdversarialERC20.Behavior.Normal, AdversarialERC20.Behavior.Normal);
        fund(escrow, q);
        assertEq(escrow.availableAmount(), 3 * PRICE_A);
    }

    function testOutgoingFalseRevertTaxExtraDebitCreditRebaseAndNoMoveAtomic() public {
        AdversarialERC20 bad = new AdversarialERC20();
        StoreEscrow escrow = maliciousEscrow(bad);
        bytes32 id = fund(escrow, quote(PAYER, 1, 3, false));
        bad.mint(address(escrow), 10);
        for (uint256 mode = 1; mode <= 7; ++mode) {
            bad.configure(AdversarialERC20.Behavior.Normal, AdversarialERC20.Behavior(mode));
            vm.expectRevert();
            refund(escrow, PAYER, id, 5);
            assertEq(bad.balanceOf(PAYER), 97 * PRICE_A);
            assertEq(bad.balanceOf(address(escrow)), 3 * PRICE_A + 10);
            assertEq(escrow.getBatch(id).refundedMask, 0);
            assertEq(escrow.totalRefundedAmount(), 0);
            assertEq(escrow.refundedUnits(), 0);
            assertEq(escrow.availableAmount(), 3 * PRICE_A);
            assertEq(bad.balanceOf(bad.FEE_COLLECTOR()), 0);
            assertEq(bad.transferCalls(), 0);
        }
        bad.configure(AdversarialERC20.Behavior.Normal, AdversarialERC20.Behavior.Normal);
        refund(escrow, PAYER, id, 5);
        assertEq(escrow.surplus(), 10);
    }

    function testStandardNoReturnTokenFundAndPartialRefund() public {
        NoReturnERC20 legacy = new NoReturnERC20();
        StoreEscrow escrow =
            new StoreEscrow(IERC20(address(legacy)), bytes32(uint256(4)), PAYER, authority, catalog(PRICE_A));
        legacy.mint(PAYER, 100 * PRICE_A);
        vm.prank(PAYER);
        legacy.approve(address(escrow), 3 * PRICE_A);
        bytes32 id = fund(escrow, quote(PAYER, 1, 3, false));
        refund(escrow, PAYER, id, 5);
        assertEq(legacy.balanceOf(PAYER), 99 * PRICE_A);
        assertEq(legacy.balanceOf(address(escrow)), PRICE_A);
        assertEq(legacy.allowance(PAYER, address(escrow)), 0);
    }

    function testIncomingAndOutgoingCallbacksRejectedByReentrancyGuard() public {
        AdversarialERC20 bad = new AdversarialERC20();
        StoreEscrow escrow = maliciousEscrow(bad);
        StoreEscrow.FundingQuote memory inner = quote(address(bad), 2, 1, false);
        bytes memory sig = signature(escrow, inner);
        bad.configureCallback(address(escrow), abi.encodeCall(StoreEscrow.fund, (inner, sig)));
        bad.configure(AdversarialERC20.Behavior.CallbackCatch, AdversarialERC20.Behavior.Normal);
        bytes32 id = fund(escrow, quote(PAYER, 1, 3, false));
        assertEq(bad.callbackAttempts(), 1);
        assertTrue(!bad.callbackSucceeded());
        assertEq(uint32(bad.callbackError()), uint32(bytes4(keccak256("ReentrancyGuardReentrantCall()"))));
        assertEq(escrow.lifetimeFundedUnits(), 3);
        bad.configureCallback(address(escrow), abi.encodeCall(StoreEscrow.refund, (id, uint16(2))));
        bad.configure(AdversarialERC20.Behavior.Normal, AdversarialERC20.Behavior.CallbackCatch);
        refund(escrow, PAYER, id, 1);
        assertEq(bad.callbackAttempts(), 2);
        assertTrue(!bad.callbackSucceeded());
        assertEq(uint32(bad.callbackError()), uint32(bytes4(keccak256("ReentrancyGuardReentrantCall()"))));
        assertEq(escrow.getBatch(id).refundedMask, 1);
    }

    function testBubblingCallbackFailureRollsBackFundAndRefund() public {
        AdversarialERC20 bad = new AdversarialERC20();
        StoreEscrow escrow = maliciousEscrow(bad);
        bad.configureCallback(address(escrow), abi.encodeCall(StoreEscrow.refund, (bytes32(uint256(99)), uint16(1))));
        bad.configure(AdversarialERC20.Behavior.CallbackBubble, AdversarialERC20.Behavior.Normal);
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 3, false);
        bytes memory sig = signature(escrow, q);
        vm.expectRevert();
        vm.prank(PAYER);
        escrow.fund(q, sig);
        assertEq(escrow.lifetimeFundedUnits(), 0);
        assertEq(bad.callbackAttempts(), 0);
        bad.configure(AdversarialERC20.Behavior.Normal, AdversarialERC20.Behavior.Normal);
        bytes32 id = fund(escrow, q);
        bad.configureCallback(address(escrow), abi.encodeCall(StoreEscrow.refund, (id, uint16(2))));
        bad.configure(AdversarialERC20.Behavior.Normal, AdversarialERC20.Behavior.CallbackBubble);
        vm.expectRevert();
        refund(escrow, PAYER, id, 1);
        assertEq(escrow.getBatch(id).refundedMask, 0);
        assertEq(bad.callbackAttempts(), 0);
        assertEq(escrow.availableAmount(), 3 * PRICE_A);
    }

    function testSuccessfulLookupReadsNoTokenBalanceAllowanceOrTransferEvenAfterFullRefund() public {
        AdversarialERC20 bad = new AdversarialERC20();
        StoreEscrow escrow = maliciousEscrow(bad);
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 10, false);
        bytes32 id = fund(escrow, q);
        vm.prank(PAYER);
        bad.approve(address(escrow), 0);
        bad.burn(PAYER, bad.balanceOf(PAYER));
        bad.configureBalanceRead(true);
        vm.warp(q.deadline + 1);
        vm.recordLogs();
        assertEq(fund(escrow, q), id);
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(bad.transferFromCalls(), 1);
        bad.configureBalanceRead(false);
        refund(escrow, PAYER, id, 0x3ff);
        assertEq(bad.transferCalls(), 1);
        bad.burn(PAYER, bad.balanceOf(PAYER));
        bad.configureBalanceRead(true);
        assertEq(fund(escrow, q), id);
        assertEq(bad.transferFromCalls(), 1);
        assertEq(bad.transferCalls(), 1);
        assertEq(escrow.availableAmount(), 0);
        assertEq(escrow.totalRefundedAmount(), 10 * PRICE_A);
    }

    function testMalformedReturnAndNoReturnNoMovementFailAtomically() public {
        AdversarialERC20 bad = new AdversarialERC20();
        StoreEscrow escrow = maliciousEscrow(bad);
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 2, false);
        bytes memory sig = signature(escrow, q);
        bad.configure(AdversarialERC20.Behavior.MalformedReturn, AdversarialERC20.Behavior.Normal);
        vm.expectRevert();
        vm.prank(PAYER);
        escrow.fund(q, sig);
        assertEq(bad.balanceOf(PAYER), 100 * PRICE_A);
        assertEq(escrow.lifetimeFundedUnits(), 0);
        bad.configure(AdversarialERC20.Behavior.Normal, AdversarialERC20.Behavior.MalformedReturn);
        bytes32 id = fund(escrow, q);
        vm.expectRevert();
        refund(escrow, PAYER, id, 1);
        assertEq(escrow.getBatch(id).refundedMask, 0);
        assertEq(bad.balanceOf(address(escrow)), 2 * PRICE_A);

        NoReturnERC20 legacy = new NoReturnERC20();
        StoreEscrow other =
            new StoreEscrow(IERC20(address(legacy)), bytes32(uint256(5)), PAYER, authority, catalog(PRICE_A));
        legacy.mint(PAYER, 100 * PRICE_A);
        vm.prank(PAYER);
        legacy.approve(address(other), q.amount);
        sig = signature(other, q);
        legacy.configureNoMove(true);
        vm.expectRevert(StoreEscrow.TransferDeltaMismatch.selector);
        vm.prank(PAYER);
        other.fund(q, sig);
        assertEq(legacy.allowance(PAYER, address(other)), q.amount);
        legacy.configureNoMove(false);
        id = fund(other, q);
        legacy.configureNoMove(true);
        vm.expectRevert(StoreEscrow.TransferDeltaMismatch.selector);
        refund(other, PAYER, id, 1);
        assertEq(other.getBatch(id).refundedMask, 0);
        assertEq(other.availableAmount(), q.amount);
    }

    function testBalanceReadRevertDoesNotBecomeAZeroBalanceOrAStoredOperation() public {
        AdversarialERC20 bad = new AdversarialERC20();
        StoreEscrow escrow = maliciousEscrow(bad);
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 2, false);
        bytes memory sig = signature(escrow, q);
        bad.configureBalanceRead(true);
        vm.expectRevert();
        vm.prank(PAYER);
        escrow.fund(q, sig);
        assertEq(escrow.lifetimeFundedUnits(), 0);
        (, bytes32 id) = escrow.quoteUses(q.quoteId);
        assertEq(id, bytes32(0));
        bad.configureBalanceRead(false);
        id = fund(escrow, q);
        bad.configureBalanceRead(true);
        vm.expectRevert();
        refund(escrow, PAYER, id, 1);
        assertEq(escrow.getBatch(id).refundedMask, 0);
        assertEq(escrow.totalRefundedAmount(), 0);
    }
}
