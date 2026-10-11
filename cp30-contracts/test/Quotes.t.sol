// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {C0TestBase, StoreEscrow, VmC0} from "./C0TestBase.sol";

contract QuotesTest is C0TestBase {
    function testIndependentEIP712DigestAndFundEvent() public {
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 3, false);
        assertEq(stores[0].quoteDigest(q), referenceDigest(q, 31337, address(stores[0])));
        vm.recordLogs();
        bytes32 batchId = fund(stores[0], q);
        VmC0.Log[] memory logs = vm.getRecordedLogs();
        VmC0.Log memory entry = logs[logs.length - 1];
        assertEq(entry.emitter, address(stores[0]));
        assertEq(
            entry.topics[0],
            keccak256("Funded(bytes32,bytes32,address,bytes32,uint256,bytes32,uint256,uint256,uint256,uint256)")
        );
        assertEq(entry.topics[1], q.quoteId);
        assertEq(entry.topics[2], batchId);
        assertEq(entry.topics[3], bytes32(uint256(uint160(PAYER))));
        assertEq(
            keccak256(entry.data),
            keccak256(abi.encode(MEAL_A, uint256(2), TERMS_A, PRICE_A, uint256(3), uint256(0), 3 * PRICE_A))
        );
    }

    function testEveryQuoteFieldIsSignatureBound() public {
        StoreEscrow.FundingQuote memory original = quote(PAYER, 1, 1, false);
        bytes memory sig = signature(stores[0], original);
        for (uint256 field; field < 9; ++field) {
            StoreEscrow.FundingQuote memory changed = quote(PAYER, 1, 1, false);
            if (field == 0) changed.quoteId = bytes32(uint256(2));
            if (field == 1) changed.payer = OTHER_PAYER;
            if (field == 2) changed.mealId = MEAL_B;
            if (field == 3) ++changed.currentVersion;
            if (field == 4) changed.termsHash = TERMS_B;
            if (field == 5) ++changed.quantity;
            if (field == 6) ++changed.unitPrice;
            if (field == 7) ++changed.amount;
            if (field == 8) ++changed.deadline;
            vm.expectRevert(StoreEscrow.UnauthorizedQuote.selector);
            vm.prank(changed.payer);
            stores[0].fund(changed, sig);
        }
        assertEq(stores[0].totalFundedAmount(), 0);
        assertEq(token.balanceOf(PAYER), 1e30);
    }

    function testWrongChainEscrowNameAndVersionDomainsRejected() public {
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 1, false);
        bytes memory sig = signature(stores[0], q);
        vm.expectRevert(StoreEscrow.UnauthorizedQuote.selector);
        vm.prank(PAYER);
        stores[1].fund(q, sig);
        vm.chainId(10143);
        vm.expectRevert(StoreEscrow.UnauthorizedQuote.selector);
        vm.prank(PAYER);
        stores[0].fund(q, sig);
        vm.chainId(31337);
        for (uint256 mutation; mutation < 2; ++mutation) {
            bytes32 domain = keccak256(
                abi.encode(
                    DOMAIN_TYPEHASH,
                    keccak256(bytes(mutation == 0 ? "Wrong Funding" : "MealForward C0 Funding")),
                    keccak256(bytes(mutation == 0 ? "1" : "2")),
                    uint256(31337),
                    address(stores[0])
                )
            );
            bytes32 payload = stores[0].quotePayloadHash(q);
            (uint8 v, bytes32 r, bytes32 s) =
                vm.sign(SYNTHETIC_AUTHORITY_FIXTURE, keccak256(abi.encodePacked("\x19\x01", domain, payload)));
            vm.expectRevert(StoreEscrow.UnauthorizedQuote.selector);
            vm.prank(PAYER);
            stores[0].fund(q, abi.encodePacked(r, s, v));
        }
    }

    function testWrongSignerMalformedAndMalleableSignaturesRejected() public {
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 1, false);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xbad, stores[0].quoteDigest(q));
        vm.expectRevert(StoreEscrow.UnauthorizedQuote.selector);
        vm.prank(PAYER);
        stores[0].fund(q, abi.encodePacked(r, s, v));
        vm.expectRevert();
        vm.prank(PAYER);
        stores[0].fund(q, hex"1234");
        (v, r, s) = vm.sign(SYNTHETIC_AUTHORITY_FIXTURE, stores[0].quoteDigest(q));
        uint256 curveOrder = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
        vm.expectRevert();
        vm.prank(PAYER);
        stores[0].fund(q, abi.encodePacked(r, bytes32(curveOrder - uint256(s)), v == 27 ? uint8(28) : uint8(27)));
        assertEq(stores[0].lifetimeFundedUnits(), 0);
    }

    function testSenderMustBeOriginalPayerIncludingReplay() public {
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 1, false);
        bytes memory sig = signature(stores[0], q);
        vm.expectRevert(StoreEscrow.UnauthorizedPayer.selector);
        vm.prank(OTHER_PAYER);
        stores[0].fund(q, sig);
        fund(stores[0], q);
        vm.expectRevert(StoreEscrow.UnauthorizedPayer.selector);
        vm.prank(OTHER_PAYER);
        stores[0].fund(q, sig);
    }

    function testAuthorizedQuoteCannotOverrideCatalogAndValueChecks() public {
        for (uint256 mutation; mutation < 9; ++mutation) {
            StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 1, false);
            if (mutation == 0) q.quoteId = bytes32(0);
            if (mutation == 1) q.quantity = 0;
            if (mutation == 2) q.quantity = 11;
            if (mutation == 3) q.mealId = bytes32(uint256(999));
            if (mutation == 4) q.currentVersion = 1;
            if (mutation == 5) q.termsHash = TERMS_B;
            if (mutation == 6) ++q.unitPrice;
            if (mutation == 7) ++q.amount;
            if (mutation == 8) q.payer = address(0);
            bytes memory sig = signature(stores[0], q);
            bytes4 expected =
                mutation >= 3 && mutation <= 6 ? StoreEscrow.TermsMismatch.selector : StoreEscrow.InvalidQuote.selector;
            vm.expectRevert(expected);
            vm.prank(q.payer);
            stores[0].fund(q, sig);
        }
        (, bytes32 batchId) = stores[0].quoteUses(bytes32(uint256(1)));
        assertEq(batchId, bytes32(0));
        assertEq(stores[0].totalFundedAmount(), 0);
    }

    function testDeadlineExclusiveAndFailedQuoteDoesNotOccupyKey() public {
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 1, false);
        bytes memory sig = signature(stores[0], q);
        vm.warp(q.deadline);
        vm.expectRevert(StoreEscrow.QuoteExpired.selector);
        vm.prank(PAYER);
        stores[0].fund(q, sig);
        (, bytes32 batchId) = stores[0].quoteUses(q.quoteId);
        assertEq(batchId, bytes32(0));
        q.deadline = block.timestamp + 1;
        fund(stores[0], q);
    }

    function testSameQuoteReturnsOriginalAfterDeadlineCapAndRefund() public {
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 10, false);
        bytes32 batchId = fund(stores[0], q);
        uint256 balance = token.balanceOf(PAYER);
        assertEq(fund(stores[0], q), batchId);
        vm.warp(q.deadline + 72 hours);
        assertEq(fund(stores[0], q), batchId);
        assertEq(token.balanceOf(PAYER), balance);
        refund(stores[0], PAYER, batchId, 0x3ff);
        balance = token.balanceOf(PAYER);
        assertEq(fund(stores[0], q), batchId);
        assertEq(token.balanceOf(PAYER), balance);
        assertEq(stores[0].availableAmount(), 0);
        assertEq(stores[0].lifetimeFundedUnits(), 10);
        vm.expectRevert();
        vm.prank(PAYER);
        stores[0].fund(q, hex"00");
    }

    function testSameKeyDifferentAuthorizedPayloadConflicts() public {
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 1, false);
        bytes32 original = fund(stores[0], q);
        for (uint256 mutation; mutation < 3; ++mutation) {
            StoreEscrow.FundingQuote memory changed =
                quote(mutation == 0 ? OTHER_PAYER : PAYER, 1, mutation == 1 ? 2 : 1, mutation == 2);
            bytes memory sig = signature(stores[0], changed);
            vm.expectRevert(StoreEscrow.QuoteConflict.selector);
            vm.prank(changed.payer);
            stores[0].fund(changed, sig);
        }
        (, bytes32 actual) = stores[0].quoteUses(q.quoteId);
        assertEq(actual, original);
        assertEq(stores[0].totalFundedAmount(), PRICE_A);
    }
}
