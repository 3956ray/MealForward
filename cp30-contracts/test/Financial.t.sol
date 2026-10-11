// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {C0TestBase, StoreEscrow, MockERC20, VmC0} from "./C0TestBase.sol";

contract FinancialTest is C0TestBase {
    function testGoldenThreeFourThreeDifferentPricesAndFullRefundCannotReopenCap() public {
        bytes32 a = fund(stores[0], quote(PAYER, 1, 3, false));
        bytes32 b = fund(stores[0], quote(OTHER_PAYER, 2, 4, true));
        bytes32 c = fund(stores[0], quote(PAYER, 3, 3, false));
        assertEq(stores[0].getBatch(a).firstUnit, 0);
        assertEq(stores[0].getBatch(b).firstUnit, 3);
        assertEq(stores[0].getBatch(c).firstUnit, 7);
        refund(stores[0], PAYER, a, 5);
        refund(stores[0], OTHER_PAYER, b, 9);
        refund(stores[0], PAYER, c, 1);
        assertEq(stores[0].totalFundedAmount(), 74_000_000);
        assertEq(stores[0].totalRefundedAmount(), 37_000_000);
        assertEq(stores[0].availableAmount(), 37_000_000);
        assertEq(stores[0].availableUnits(), 5);
        assertEq(token.balanceOf(PAYER), 1e30 - 18_000_000);
        assertEq(token.balanceOf(OTHER_PAYER), 1e30 - 19_000_000);
        refund(stores[0], PAYER, a, 2);
        refund(stores[0], OTHER_PAYER, b, 6);
        refund(stores[0], PAYER, c, 6);
        StoreEscrow.FundingQuote memory extra = quote(PAYER, 4, 1, false);
        bytes memory sig = signature(stores[0], extra);
        vm.expectRevert(StoreEscrow.CapExceeded.selector);
        vm.prank(PAYER);
        stores[0].fund(extra, sig);
        assertEq(stores[0].availableAmount(), 0);
        assertEq(stores[0].totalFundedAmount(), 74_000_000);
        assertEq(stores[0].lifetimeFundedUnits(), 10);
    }

    function testBatchLocalHighBitsAndMixedAlreadyRefundedMaskAtomic() public {
        fund(stores[0], quote(PAYER, 1, 3, false));
        bytes32 b = fund(stores[0], quote(PAYER, 2, 7, true));
        assertEq(stores[0].getBatch(b).firstUnit, 3);
        assertEq(refund(stores[0], PAYER, b, 64), PRICE_B); // Batch bit 6 is store-global unit 9.
        uint256 beforeBalance = token.balanceOf(PAYER);
        vm.expectRevert(StoreEscrow.AlreadyRefunded.selector);
        refund(stores[0], PAYER, b, 65);
        vm.expectRevert(StoreEscrow.InvalidRefundMask.selector);
        refund(stores[0], PAYER, b, 513);
        assertEq(token.balanceOf(PAYER), beforeBalance);
        assertEq(stores[0].getBatch(b).refundedMask, 64);
        bytes32 ten = fund(stores[1], quote(PAYER, 3, 10, false));
        assertEq(refund(stores[1], PAYER, ten, 512), PRICE_A);
        vm.expectRevert(StoreEscrow.InvalidRefundMask.selector);
        refund(stores[1], PAYER, ten, 1025);
        assertEq(stores[1].getBatch(ten).refundedMask, 512);
    }

    function testOwnerAsOriginalPayerHasOnlyTheirOwnRefundRights() public {
        address owner = stores[0].owner();
        token.mint(owner, 10 * PRICE_A);
        vm.prank(owner);
        token.approve(address(stores[0]), PRICE_A);
        bytes32 own = fund(stores[0], quote(owner, 1, 1, false));
        bytes32 foreign = fund(stores[0], quote(PAYER, 2, 1, false));
        vm.expectRevert(StoreEscrow.UnauthorizedPayer.selector);
        refund(stores[0], owner, foreign, 1);
        refund(stores[0], owner, own, 1);
        assertEq(token.balanceOf(owner), 10 * PRICE_A);
        assertEq(token.balanceOf(address(factory)), 0);
        assertEq(token.balanceOf(authority), 0);
    }

    function testMixedOriginalPricesPayersAndContinuousUnitSequence() public {
        bytes32 a = fund(stores[0], quote(PAYER, 1, 3, false));
        bytes32 b = fund(stores[0], quote(OTHER_PAYER, 2, 2, true));
        StoreEscrow.Batch memory aa = stores[0].getBatch(a);
        StoreEscrow.Batch memory bb = stores[0].getBatch(b);
        assertEq(aa.payer, PAYER);
        assertEq(aa.mealId, MEAL_A);
        assertEq(aa.version, 2);
        assertEq(aa.termsHash, TERMS_A);
        assertEq(aa.unitPrice, PRICE_A);
        assertEq(aa.quantity, 3);
        assertEq(aa.firstUnit, 0);
        assertEq(bb.payer, OTHER_PAYER);
        assertEq(bb.mealId, MEAL_B);
        assertEq(bb.unitPrice, PRICE_B);
        assertEq(bb.firstUnit, 3);
        vm.recordLogs();
        refund(stores[0], PAYER, a, 5);
        VmC0.Log[] memory logs = vm.getRecordedLogs();
        VmC0.Log memory entry = logs[logs.length - 1];
        assertEq(entry.topics[0], keccak256("Refunded(bytes32,address,uint16,uint256,uint256)"));
        assertEq(entry.topics[1], a);
        assertEq(entry.topics[2], bytes32(uint256(uint160(PAYER))));
        assertEq(keccak256(entry.data), keccak256(abi.encode(uint16(5), uint256(2), 2 * PRICE_A)));
        assertEq(stores[0].availableAmount(), PRICE_A + 2 * PRICE_B);
        assertEq(stores[0].totalRefundedAmount(), 2 * PRICE_A);
        assertEq(stores[0].totalFundedAmount(), 3 * PRICE_A + 2 * PRICE_B);
        assertEq(stores[0].availableUnits(), 3);
        assertEq(stores[0].lifetimeFundedUnits(), 5);
        assertEq(token.balanceOf(OTHER_PAYER), 1e30 - 2 * PRICE_B);
    }

    function testQuantityOneAndTenAndCapNotRestoredByRefund() public {
        bytes32 a = fund(stores[0], quote(PAYER, 1, 1, false));
        refund(stores[0], PAYER, a, 1);
        bytes32 b = fund(stores[0], quote(OTHER_PAYER, 2, 9, true));
        refund(stores[0], OTHER_PAYER, b, 0x1ff);
        StoreEscrow.FundingQuote memory q = quote(PAYER, 3, 1, false);
        bytes memory sig = signature(stores[0], q);
        vm.expectRevert(StoreEscrow.CapExceeded.selector);
        vm.prank(PAYER);
        stores[0].fund(q, sig);
        assertEq(stores[0].lifetimeFundedUnits(), 10);
        assertEq(stores[0].availableUnits(), 0);
        assertEq(stores[0].totalFundedAmount(), stores[0].totalRefundedAmount());
        assertEq(token.balanceOf(address(stores[0])), 0);
        fund(stores[1], quote(PAYER, 1, 10, false));
        assertEq(stores[1].lifetimeFundedUnits(), 10);
    }

    function testCompetingFinalCapAcrossMealsAndPayers() public {
        fund(stores[0], quote(PAYER, 1, 9, false));
        StoreEscrow.FundingQuote memory first = quote(PAYER, 2, 1, false);
        StoreEscrow.FundingQuote memory second = quote(OTHER_PAYER, 3, 1, true);
        bytes memory secondSig = signature(stores[0], second);
        fund(stores[0], first);
        vm.expectRevert(StoreEscrow.CapExceeded.selector);
        vm.prank(OTHER_PAYER);
        stores[0].fund(second, secondSig);
        (, bytes32 rejectedBatch) = stores[0].quoteUses(second.quoteId);
        assertEq(rejectedBatch, bytes32(0));
        assertEq(token.balanceOf(OTHER_PAYER), 1e30);
    }

    function testRefundMaskBoundsDuplicatesAndWrongPayerOrService() public {
        bytes32 id = fund(stores[0], quote(PAYER, 1, 3, false));
        vm.expectRevert(StoreEscrow.InvalidRefundMask.selector);
        refund(stores[0], PAYER, id, 0);
        vm.expectRevert(StoreEscrow.InvalidRefundMask.selector);
        refund(stores[0], PAYER, id, 8);
        vm.expectRevert(StoreEscrow.InvalidRefundMask.selector);
        refund(stores[0], PAYER, id, 0xffff);
        vm.expectRevert(StoreEscrow.UnauthorizedPayer.selector);
        refund(stores[0], OTHER_PAYER, id, 1);
        address owner = stores[0].owner();
        vm.expectRevert(StoreEscrow.UnauthorizedPayer.selector);
        refund(stores[0], owner, id, 1);
        vm.expectRevert(StoreEscrow.UnauthorizedPayer.selector);
        refund(stores[0], authority, id, 1);
        vm.expectRevert(StoreEscrow.InvalidBatch.selector);
        refund(stores[0], PAYER, bytes32(uint256(999)), 1);
        refund(stores[0], PAYER, id, 5);
        vm.expectRevert(StoreEscrow.AlreadyRefunded.selector);
        refund(stores[0], PAYER, id, 1);
        vm.expectRevert(StoreEscrow.AlreadyRefunded.selector);
        refund(stores[0], PAYER, id, 3);
        assertEq(stores[0].getBatch(id).refundedMask, 5);
        refund(stores[0], PAYER, id, 2);
        assertEq(stores[0].totalRefundedAmount(), 3 * PRICE_A);
        assertEq(token.balanceOf(PAYER), 1e30);
    }

    function testNewQuoteCannotReuseARefundedUnit() public {
        bytes32 a = fund(stores[0], quote(PAYER, 1, 2, false));
        refund(stores[0], PAYER, a, 1);
        bytes32 b = fund(stores[0], quote(PAYER, 2, 1, false));
        assertEq(stores[0].getBatch(b).firstUnit, 2);
        vm.expectRevert(StoreEscrow.AlreadyRefunded.selector);
        refund(stores[0], PAYER, a, 1);
        assertEq(stores[0].getBatch(b).refundedMask, 0);
        assertEq(stores[0].availableAmount(), 2 * PRICE_A);
    }

    function testDonationsRemainSurplusAndWrongTokenDoesNotFund() public {
        vm.prank(PAYER);
        token.transfer(address(stores[0]), 123);
        assertEq(stores[0].surplus(), 123);
        assertEq(stores[0].totalFundedAmount(), 0);
        assertEq(stores[0].lifetimeFundedUnits(), 0);
        bytes32 id = fund(stores[0], quote(PAYER, 1, 2, false));
        refund(stores[0], PAYER, id, 3);
        assertEq(stores[0].surplus(), 123);
        assertEq(token.balanceOf(address(stores[0])), 123);
        MockERC20 wrong = new MockERC20();
        wrong.mint(OTHER_PAYER, 100 * PRICE_A);
        vm.prank(OTHER_PAYER);
        wrong.transfer(address(stores[1]), PRICE_A);
        vm.prank(OTHER_PAYER);
        token.approve(address(stores[1]), 0);
        vm.prank(OTHER_PAYER);
        wrong.approve(address(stores[1]), PRICE_A);
        StoreEscrow.FundingQuote memory q = quote(OTHER_PAYER, 2, 1, false);
        bytes memory sig = signature(stores[1], q);
        vm.expectRevert();
        vm.prank(OTHER_PAYER);
        stores[1].fund(q, sig);
        assertEq(stores[1].totalFundedAmount(), 0);
        assertEq(token.balanceOf(address(stores[1])), 0);
        assertEq(wrong.balanceOf(address(stores[1])), PRICE_A);
    }

    function testInsufficientBalanceAndAllowanceFailAtomicallyAndKeyCanRetry() public {
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 2, false);
        bytes memory sig = signature(stores[0], q);
        vm.prank(PAYER);
        token.approve(address(stores[0]), q.amount - 1);
        vm.expectRevert();
        vm.prank(PAYER);
        stores[0].fund(q, sig);
        assertEq(stores[0].lifetimeFundedUnits(), 0);
        (, bytes32 id) = stores[0].quoteUses(q.quoteId);
        assertEq(id, bytes32(0));
        vm.prank(PAYER);
        token.approve(address(stores[0]), q.amount);
        token.burn(PAYER, 1e30 - q.amount + 1);
        vm.expectRevert();
        vm.prank(PAYER);
        stores[0].fund(q, sig);
        assertEq(token.allowance(PAYER, address(stores[0])), q.amount);
        token.mint(PAYER, 1);
        fund(stores[0], q);
        assertEq(token.allowance(PAYER, address(stores[0])), 0);
    }

    function testExternalNegativeRebaseFailsClosedWithoutErasingLiability() public {
        bytes32 id = fund(stores[0], quote(PAYER, 1, 2, false));
        token.burn(address(stores[0]), 1);
        vm.expectRevert(StoreEscrow.Insolvent.selector);
        refund(stores[0], PAYER, id, 1);
        StoreEscrow.FundingQuote memory q = quote(PAYER, 2, 1, false);
        bytes memory sig = signature(stores[0], q);
        vm.expectRevert(StoreEscrow.Insolvent.selector);
        vm.prank(PAYER);
        stores[0].fund(q, sig);
        assertEq(stores[0].availableAmount(), 2 * PRICE_A);
        assertEq(stores[0].getBatch(id).refundedMask, 0);
        vm.expectRevert(StoreEscrow.Insolvent.selector);
        stores[0].surplus();
    }

    function testMultiplicationAndLifetimeAmountOverflowRollback() public {
        MockERC20 large = new MockERC20();
        StoreEscrow escrow = new StoreEscrow(large, bytes32(uint256(4)), PAYER, authority, catalog(type(uint256).max));
        large.mint(PAYER, type(uint256).max);
        vm.prank(PAYER);
        large.approve(address(escrow), type(uint256).max);
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 2, false);
        q.unitPrice = type(uint256).max;
        q.amount = 1;
        bytes memory sig = signature(escrow, q);
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", 0x11));
        vm.prank(PAYER);
        escrow.fund(q, sig);
        assertEq(escrow.totalFundedAmount(), 0);
        q.quantity = 1;
        q.amount = type(uint256).max;
        bytes32 id = fund(escrow, q);
        refund(escrow, PAYER, id, 1);
        StoreEscrow.FundingQuote memory second = quote(PAYER, 2, 1, true);
        sig = signature(escrow, second);
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", 0x11));
        vm.prank(PAYER);
        escrow.fund(second, sig);
        assertEq(escrow.totalFundedAmount(), type(uint256).max);
        assertEq(escrow.lifetimeFundedUnits(), 1);
        (, bytes32 rejected) = escrow.quoteUses(second.quoteId);
        assertEq(rejected, bytes32(0));
    }
}
