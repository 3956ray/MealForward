// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {C0TestBase, IERC20, StoreEscrow, ThreeStoreFactory} from "./C0TestBase.sol";

contract FactoryTest is C0TestBase {
    function testThreeStoresEachReachTenAndOneRefundDoesNotAffectOthers() public {
        bytes32[3] memory batch;
        for (uint256 i; i < 3; ++i) {
            batch[i] = fund(stores[i], quoteFor(stores[i], PAYER, 1, 10, false));
        }
        refund(stores[0], PAYER, batch[0], 512);
        for (uint256 i; i < 3; ++i) {
            assertEq(stores[i].lifetimeFundedUnits(), 10);
        }
        assertEq(stores[1].availableAmount(), 10 * PRICE_A);
        assertEq(stores[2].availableAmount(), 10 * PRICE_A);
        assertEq(stores[0].availableAmount(), 9 * PRICE_A);
        assertEq(stores[1].getBatch(batch[1]).refundedMask, 0);
        assertEq(stores[2].getBatch(batch[2]).refundedMask, 0);
    }

    function testExactlyThreeFixedStoresAndNoFourthSlot() public {
        for (uint256 i; i < 3; ++i) {
            StoreEscrow escrow = stores[i];
            assertEq(escrow.storeId(), bytes32(i + 1));
            assertEq(escrow.owner(), address(uint160(0x201 + i)));
            assertEq(escrow.receiver(), escrow.owner());
            assertEq(address(escrow.asset()), address(token));
            assertEq(escrow.quoteAuthority(), authority);
            assertEq(factory.escrowFor(bytes32(i + 1)), address(escrow));
            assertEq(escrow.currentVersion(MEAL_A), 2);
            (uint256 oldPrice, bytes32 oldHash) = escrow.catalog(MEAL_A, 1);
            assertEq(oldPrice, 4_000_000);
            assertEq(oldHash, referenceTerms(escrow, terms(MEAL_A, 1, 4_000_000, keccak256("synthetic A v1"))));
            assertTrue(address(escrow) != address(stores[(i + 1) % 3]));
        }
        vm.expectRevert();
        factory.escrows(3);
        assertEq(factory.escrowFor(bytes32(uint256(4))), address(0));
        (bool ok,) =
            address(factory).call(abi.encodeWithSignature("createStore(bytes32,address)", bytes32(uint256(4)), PAYER));
        assertTrue(!ok);
    }

    function testRejectZeroAndDuplicateFactorySlots() public {
        ThreeStoreFactory.StoreConfig[3] memory cs = configs();
        cs[2].storeId = cs[0].storeId;
        vm.expectRevert(ThreeStoreFactory.DuplicateStore.selector);
        new ThreeStoreFactory(token, authority, cs);
        cs = configs();
        cs[1].storeId = bytes32(0);
        vm.expectRevert(ThreeStoreFactory.InvalidConfiguration.selector);
        new ThreeStoreFactory(token, authority, cs);
        cs = configs();
        cs[0].owner = address(0);
        vm.expectRevert(ThreeStoreFactory.InvalidConfiguration.selector);
        new ThreeStoreFactory(token, authority, cs);
    }

    function testRejectMissingAssetOrAuthority() public {
        vm.expectRevert(ThreeStoreFactory.InvalidConfiguration.selector);
        new ThreeStoreFactory(IERC20(address(0)), authority, configs());
        vm.expectRevert(ThreeStoreFactory.InvalidConfiguration.selector);
        new ThreeStoreFactory(IERC20(PAYER), authority, configs());
        vm.expectRevert(ThreeStoreFactory.InvalidConfiguration.selector);
        new ThreeStoreFactory(token, address(0), configs());
        vm.expectRevert(StoreEscrow.InvalidConfiguration.selector);
        new StoreEscrow(token, bytes32(0), PAYER, authority, roles(), catalog(PRICE_A));
        vm.expectRevert(StoreEscrow.InvalidConfiguration.selector);
        new StoreEscrow(token, bytes32(uint256(4)), address(0), authority, roles(), catalog(PRICE_A));
        vm.expectRevert(StoreEscrow.InvalidConfiguration.selector);
        new StoreEscrow(token, bytes32(uint256(4)), PAYER, address(0), roles(), catalog(PRICE_A));
    }

    function testInvalidLastCatalogRevertsAtomicFactoryCreation() public {
        ThreeStoreFactory.StoreConfig[3] memory cs = configs();
        cs[2].catalog[0].terms.unitPrice = 0;
        vm.expectRevert(StoreEscrow.InvalidCatalog.selector);
        new ThreeStoreFactory(token, authority, cs);
        // Existing factory identity and asset balances are untouched by failed constructor execution.
        assertEq(factory.escrowFor(bytes32(uint256(3))), address(stores[2]));
        assertEq(token.balanceOf(address(stores[0])), 0);
    }

    function testRejectInvalidCatalogFieldsDuplicatesAndMissingCurrent() public {
        for (uint256 mutation; mutation < 7; ++mutation) {
            StoreEscrow.CatalogEntry[] memory entries = catalog(PRICE_A);
            if (mutation == 0) entries = new StoreEscrow.CatalogEntry[](0);
            if (mutation == 1) entries[0].terms.mealId = bytes32(0);
            if (mutation == 2) entries[0].terms.version = 0;
            if (mutation == 3) entries[0].terms.bodyDigest = bytes32(0);
            if (mutation == 4) entries[1] = entries[0];
            if (mutation == 5) entries[0].current = true;
            if (mutation == 6) entries[1].current = false;
            vm.expectRevert(StoreEscrow.InvalidCatalog.selector);
            new StoreEscrow(token, bytes32(uint256(4)), PAYER, authority, roles(), entries);
        }
    }

    function testNoAdminWithdrawalChangePublicationOrNativeMealPayment() public {
        bytes32 batch = fund(stores[0], quoteFor(stores[0], PAYER, 1, 2, false));
        bytes[] memory attempts = new bytes[](6);
        attempts[0] = abi.encodeWithSignature("setReceiver(address)", OTHER_PAYER);
        attempts[1] = abi.encodeWithSignature("setAsset(address)", OTHER_PAYER);
        attempts[2] = abi.encodeWithSignature("withdraw(uint256)", PRICE_A);
        attempts[3] = abi.encodeWithSignature("rescue(address,uint256)", address(token), PRICE_A);
        attempts[4] = abi.encodeWithSignature("publish(bytes32,uint256)", MEAL_A, 3);
        attempts[5] = abi.encodeWithSignature("upgradeTo(address)", OTHER_PAYER);
        for (uint256 i; i < attempts.length; ++i) {
            vm.prank(stores[0].owner());
            (bool ok,) = address(stores[0]).call(attempts[i]);
            assertTrue(!ok);
        }
        vm.deal(PAYER, 1 ether);
        vm.prank(PAYER);
        (bool sent,) = address(stores[0]).call{value: 1 ether}("");
        assertTrue(!sent);
        StoreEscrow.FundingQuote memory q = quote(PAYER, 2, 1, false);
        bytes memory sig = signature(stores[0], q);
        vm.prank(PAYER);
        (bool payableFund,) = address(stores[0]).call{value: 1}(abi.encodeCall(StoreEscrow.fund, (q, sig)));
        assertTrue(!payableFund);
        assertEq(address(stores[0]).balance, 0);
        assertEq(token.balanceOf(address(stores[0])), 2 * PRICE_A);
        assertEq(stores[0].getBatch(batch).payer, PAYER);
    }

    function testStoreAssetCapAndBatchIsolation() public {
        bytes32 a = fund(stores[0], quoteFor(stores[0], PAYER, 1, 10, false));
        bytes32 b = fund(stores[1], quoteFor(stores[1], OTHER_PAYER, 1, 1, true));
        assertTrue(a != b);
        assertEq(stores[0].lifetimeFundedUnits(), 10);
        assertEq(stores[1].lifetimeFundedUnits(), 1);
        assertEq(stores[2].lifetimeFundedUnits(), 0);
        vm.expectRevert(StoreEscrow.InvalidBatch.selector);
        refund(stores[1], PAYER, a, 1);
        refund(stores[0], PAYER, a, 1);
        assertEq(stores[1].availableAmount(), PRICE_B);
        assertEq(stores[1].getBatch(b).refundedMask, 0);
        assertEq(token.balanceOf(address(stores[2])), 0);
    }
}
