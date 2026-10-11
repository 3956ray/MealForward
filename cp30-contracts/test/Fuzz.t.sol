// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {C0TestBase, StoreEscrow} from "./C0TestBase.sol";

contract FinancialFuzzTest is C0TestBase {
    function testFuzzOriginalPricePartialRefund(uint96 rawPrice, uint8 rawQuantity, uint16 rawMask) public {
        uint256 price = uint256(rawPrice) + 1;
        uint256 quantity = uint256(rawQuantity) % 10 + 1;
        StoreEscrow escrow = new StoreEscrow(token, bytes32(uint256(4)), PAYER, authority, catalog(price));
        vm.prank(PAYER);
        token.approve(address(escrow), quantity * price);
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, quantity, false);
        q.unitPrice = price;
        q.amount = price * quantity;
        bytes32 id = fund(escrow, q);
        uint16 mask = rawMask & uint16((1 << quantity) - 1);
        if (mask == 0) mask = 1;
        uint256 returned = refund(escrow, PAYER, id, mask);
        assertEq(returned, countBits(mask) * price);
        assertEq(escrow.totalFundedAmount(), quantity * price);
        assertEq(escrow.totalRefundedAmount(), returned);
        assertEq(escrow.availableAmount(), quantity * price - returned);
        assertEq(token.balanceOf(PAYER), 1e30 - quantity * price + returned);
        assertEq(token.balanceOf(address(escrow)), escrow.availableAmount());
        assertEq(escrow.lifetimeFundedUnits(), quantity);
    }

    function testFuzzEverySignatureFieldRejectsMutation(uint256 fieldSeed, uint8 rawQuantity) public {
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, uint256(rawQuantity) % 10 + 1, false);
        bytes memory sig = signature(stores[0], q);
        uint256 field = fieldSeed % 9;
        if (field == 0) q.quoteId = bytes32(uint256(2));
        if (field == 1) q.payer = OTHER_PAYER;
        if (field == 2) q.mealId = MEAL_B;
        if (field == 3) ++q.currentVersion;
        if (field == 4) q.termsHash = TERMS_B;
        if (field == 5) ++q.quantity;
        if (field == 6) ++q.unitPrice;
        if (field == 7) ++q.amount;
        if (field == 8) ++q.deadline;
        vm.expectRevert(StoreEscrow.UnauthorizedQuote.selector);
        vm.prank(q.payer);
        stores[0].fund(q, sig);
        assertEq(stores[0].totalFundedAmount(), 0);
        assertEq(token.balanceOf(PAYER), 1e30);
    }

    function testFuzzLifetimeCapAcrossMealsPayersAndRefund(uint8 rawFirst, bool secondFirst) public {
        uint256 firstQuantity = uint256(rawFirst) % 9 + 1;
        uint256 secondQuantity = 10 - firstQuantity;
        StoreEscrow.FundingQuote memory a = quote(PAYER, 1, firstQuantity, false);
        StoreEscrow.FundingQuote memory b = quote(OTHER_PAYER, 2, secondQuantity, true);
        bytes32 first;
        if (secondFirst) {
            fund(stores[0], b);
            first = fund(stores[0], a);
        } else {
            first = fund(stores[0], a);
            refund(stores[0], PAYER, first, 1);
            fund(stores[0], b);
        }
        if (secondFirst) refund(stores[0], PAYER, first, 1);
        StoreEscrow.FundingQuote memory extra = quote(PAYER, 3, 1, false);
        bytes memory sig = signature(stores[0], extra);
        vm.expectRevert(StoreEscrow.CapExceeded.selector);
        vm.prank(PAYER);
        stores[0].fund(extra, sig);
        assertEq(stores[0].lifetimeFundedUnits(), 10);
        assertEq(stores[0].totalFundedAmount(), firstQuantity * PRICE_A + secondQuantity * PRICE_B);
        assertEq(stores[0].availableUnits(), 9);
        assertEq(stores[0].totalRefundedAmount(), PRICE_A);
    }

    function testFuzzRefundPartitionAndNoDoubleCredit(uint8 rawQuantity, uint16 rawMask) public {
        uint256 quantity = uint256(rawQuantity) % 10 + 1;
        uint16 all = uint16((1 << quantity) - 1);
        uint16 firstMask = rawMask & all;
        if (firstMask == 0) firstMask = 1;
        bytes32 id = fund(stores[0], quote(PAYER, 1, quantity, false));
        refund(stores[0], PAYER, id, firstMask);
        uint16 remaining = all ^ firstMask;
        if (remaining != 0) refund(stores[0], PAYER, id, remaining);
        vm.expectRevert(StoreEscrow.AlreadyRefunded.selector);
        refund(stores[0], PAYER, id, firstMask);
        assertEq(stores[0].getBatch(id).refundedMask, all);
        assertEq(stores[0].refundedUnits(), quantity);
        assertEq(stores[0].availableAmount(), 0);
        assertEq(stores[0].totalFundedAmount(), stores[0].totalRefundedAmount());
        assertEq(token.balanceOf(PAYER), 1e30);
        assertEq(stores[0].lifetimeFundedUnits(), quantity);
    }
}
