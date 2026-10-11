// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {S0bBase, StoreEscrow, IERC20} from "./S0bBase.sol";
import {ThreeStoreFactory} from "../contracts/ThreeStoreFactory.sol";

contract S0bLifecycleTest is S0bBase {
    function testT01ConstructorHighestCurrentAndSeparateRoles() public {
        for (uint256 i; i < 3; i++) {
            assertEq(stores[i].catalogAuthority(), address(uint160(0x401 + i * 16)));
            assertEq(stores[i].issuerAuthority(), address(uint160(0x402 + i * 16)));
            assertEq(stores[i].operatorAuthority(), address(uint160(0x403 + i * 16)));
            StoreEscrow.Authorities memory a = roles();
            if (i == 0) a.catalog = address(0);
            if (i == 1) a.issuer = address(0);
            if (i == 2) a.operator = address(0);
            vm.expectRevert(StoreEscrow.InvalidConfiguration.selector);
            new StoreEscrow(token, bytes32(uint256(1)), PAYER, authority, a, catalog(PRICE_A));
        }
        StoreEscrow.CatalogEntry[] memory cs = catalog(PRICE_A);
        cs[0].current = true;
        cs[1].current = false;
        vm.expectRevert(StoreEscrow.InvalidCatalog.selector);
        new StoreEscrow(token, bytes32(uint256(1)), PAYER, authority, roles(), cs);
        ThreeStoreFactory.StoreConfig[3] memory fc = configs();
        fc[2].authorities.operator = address(0);
        vm.expectRevert(StoreEscrow.InvalidConfiguration.selector);
        new ThreeStoreFactory(token, authority, fc);
    }

    function testT01PaidV1PublicationV2OriginalHashPriceWindowAndOrder() public {
        StoreEscrow.TermsInput memory a = terms(MEAL_A, 1, 3, TERMS_A);
        a.startMinute0 = 540;
        a.endMinute0 = 600;
        s = custom(token, a);
        uint256 start = (block.timestamp / 1 days + 1) * 1 days + 1 hours;
        vm.warp(start);
        bytes32 batch = pay(s, a, 2);
        bytes32 h = referenceTerms(s, a);
        StoreEscrow.TermsInput memory b = terms(MEAL_A, 2, 5, TERMS_B);
        b.startMinute0 = 780;
        b.endMinute0 = 840;
        publish(s, b);
        pay(s, b, 1);
        assertEq(s.getTerms(MEAL_A, 1).termsHash, h);
        assertEq(s.getBatch(batch).unitPrice, 3);
        bytes32 v = issueAt(s, MEAL_A, 0, 1, h);
        assertEq(s.getUnit(0).unitPrice, 3);
        locking(s, v, 1);
        assertEq(s.nextCandidate(MEAL_A).unitSeq, 1);
        vm.warp(start + 4 hours);
        bytes32 v2 = issueAt(s, MEAL_A, 1, 1, h);
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.lock, (key(), v2, uint256(1), block.timestamp + 600)),
            StoreEscrow.TimeDenied.selector
        );
        assertEq(s.getUnit(2).unitPrice, 5);
        assertEq(s.getUnit(2).version, 2);
    }

    function testT01RevisionPublicationAndListingNeverOverwriteOrReopen() public {
        StoreEscrow.TermsInput memory t = terms(MEAL_A, 3, 7, TERMS_B);
        bytes32 id = key();
        reject(
            s,
            s.owner(),
            abi.encodeCall(StoreEscrow.publish, (id, uint256(0), t)),
            StoreEscrow.UnauthorizedRole.selector
        );
        reject(
            s,
            s.catalogAuthority(),
            abi.encodeCall(StoreEscrow.publish, (id, uint256(1), t)),
            StoreEscrow.StaleRevision.selector
        );
        publish(s, t);
        assertTrue(s.listed(MEAL_A));
        reject(
            s,
            s.catalogAuthority(),
            abi.encodeCall(StoreEscrow.publish, (key(), uint256(1), t)),
            StoreEscrow.InvalidCatalog.selector
        );
        paused(s, true);
        closed(s);
        bytes32 other = keccak256("new meal");
        t.mealId = other;
        t.version = 1;
        publish(s, t);
        assertTrue(!s.listed(other));
        assertTrue(s.closed() && s.paused());
        listed(s, other, true);
        paused(s, false);
        assertTrue(s.closed());
        reject(
            s,
            s.catalogAuthority(),
            abi.encodeCall(StoreEscrow.close, (key(), s.controlRevision())),
            StoreEscrow.NoChange.selector
        );
        reject(
            s,
            s.catalogAuthority(),
            abi.encodeCall(StoreEscrow.setPaused, (key(), s.controlRevision(), false)),
            StoreEscrow.NoChange.selector
        );
        reject(
            s,
            s.catalogAuthority(),
            abi.encodeCall(StoreEscrow.setListed, (key(), s.controlRevision(), other, true)),
            StoreEscrow.NoChange.selector
        );
        assertEq(s.getTerms(MEAL_A, 2).unitPrice, PRICE_A);
    }

    function testT01ManyUnfundedVersionsDoNotChangeEarliestPaidAllocation() public {
        fund(s, quote(PAYER, 1, 1, false));
        bytes32 h = referenceTerms(s, terms(MEAL_A, 2, PRICE_A, TERMS_A));
        for (uint256 v = 3; v < 103; v++) {
            publish(s, terms(MEAL_A, v, v, TERMS_B));
        }
        bytes32 id = issueAt(s, MEAL_A, 0, 1, h);
        assertEq(s.getVoucher(id).termsHash, h);
        assertEq(s.getUnit(0).version, 2);
    }

    function testT02ExpiredEarliestReentryCrossMealAndAtomicMismatch() public {
        fund(s, quote(PAYER, 1, 2, false));
        fund(s, quote(PAYER, 2, 1, true));
        bytes32 old = issueA(0);
        bytes32 locked = issueA(1);
        locking(s, locked, 1);
        vm.warp(block.timestamp + 72 hours);
        StoreEscrow.Candidate memory c = s.nextCandidate(MEAL_A);
        assertTrue(c.available && c.needsExpiry);
        assertEq(c.unitSeq, 0);
        assertEq(c.nextGeneration, 2);
        reject(
            s,
            s.issuerAuthority(),
            abi.encodeCall(
                StoreEscrow.issue, (key(), MEAL_A, uint8(1), uint256(2), c.termsHash, block.timestamp + 600)
            ),
            StoreEscrow.CandidateMismatch.selector
        );
        assertTrue(!s.getVoucher(old).expired);
        assertEq(uint8(s.getUnit(0).bucket), 1);
        bytes32 next = issueAt(s, MEAL_A, 0, 2, c.termsHash);
        assertTrue(s.getVoucher(old).expired);
        assertTrue(next != old);
        assertEq(s.nextCandidate(MEAL_B).unitSeq, 2);
        assertTrue(!s.nextCandidate(MEAL_A).available);
        reject(
            s,
            s.issuerAuthority(),
            abi.encodeCall(StoreEscrow.expire, (key(), locked, uint256(1))),
            StoreEscrow.InvalidUnitState.selector
        );
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.lock, (key(), old, uint256(1), block.timestamp + 600)),
            StoreEscrow.InvalidVoucher.selector
        );
    }

    function testT03FreshGenerationClockSeventyTwoHoursLookupNotRights() public {
        fund(s, quote(PAYER, 1, 1, false));
        bytes32 h = referenceTerms(s, terms(MEAL_A, 2, PRICE_A, TERMS_A));
        bytes32 id = key();
        uint256 deadline = block.timestamp + 1;
        vm.prank(s.issuerAuthority());
        bytes32 v = s.issue(id, MEAL_A, 0, 1, h, deadline);
        uint256 t0 = block.timestamp;
        assertEq(
            v, keccak256(abi.encode(keccak256("MealForwardVoucherV1"), block.chainid, address(s), uint8(0), uint256(1)))
        );
        assertEq(s.getVoucher(v).issuedAt, t0);
        assertEq(s.getVoucher(v).expiresAt, t0 + 259200);
        vm.warp(t0 + 259200);
        vm.prank(s.issuerAuthority());
        assertEq(s.issue(id, MEAL_A, 0, 1, h, deadline), v);
        assertEq(s.getVoucher(v).expiresAt, t0 + 259200);
        assertEq(expiring(s, v, 1), 0);
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.lock, (key(), v, uint256(1), block.timestamp + 1)),
            StoreEscrow.InvalidVoucher.selector
        );
        bytes32 fresh = issueAt(s, MEAL_A, 0, 2, h);
        assertEq(s.getVoucher(fresh).expiresAt, block.timestamp + 259200);
        vm.prank(s.issuerAuthority());
        assertEq(s.issue(id, MEAL_A, 0, 1, h, deadline), v);
        assertEq(s.getUnit(0).generation, 2);
    }

    function testT05LockMarkerRolesStoreGenerationNoBackdateAndLateReport() public {
        fund(s, quote(PAYER, 1, 2, false));
        bytes32 v = issueA(0);
        bytes32 noMarker = issueA(1);
        reject(
            s,
            stores[1].operatorAuthority(),
            abi.encodeCall(StoreEscrow.lock, (key(), v, uint256(1), block.timestamp + 600)),
            StoreEscrow.UnauthorizedRole.selector
        );
        reject(
            stores[1],
            stores[1].operatorAuthority(),
            abi.encodeCall(StoreEscrow.lock, (key(), v, uint256(1), block.timestamp + 600)),
            StoreEscrow.InvalidVoucher.selector
        );
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.lock, (key(), v, uint256(2), block.timestamp + 600)),
            StoreEscrow.InvalidVoucher.selector
        );
        bytes32 l = locking(s, v, 1);
        assertEq(uint8(s.getUnit(0).bucket), 1);
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.lock, (key(), v, uint256(1), block.timestamp + 600)),
            StoreEscrow.AlreadyLocked.selector
        );
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.markHandover, (key(), v, uint256(1), key(), block.timestamp + 600)),
            StoreEscrow.InvalidLock.selector
        );
        vm.roll(123);
        bytes32 m = marking(s, v, 1, l);
        uint256 at = block.timestamp;
        assertEq(s.getVoucher(v).handoverBlock, 123);
        bytes32 nl = locking(s, noMarker, 1);
        vm.warp(at + 4 days);
        paused(s, true);
        closed(s);
        listed(s, MEAL_A, false);
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.report, (key(), noMarker, uint256(1), nl, key())),
            StoreEscrow.InvalidMarker.selector
        );
        reject(
            s,
            s.issuerAuthority(),
            abi.encodeCall(StoreEscrow.expire, (key(), noMarker, uint256(1))),
            StoreEscrow.InvalidUnitState.selector
        );
        reporting(s, v, 1, l, m);
        assertEq(s.getVoucher(v).handoverRecordedAt, at);
        assertEq(uint8(s.getUnit(0).bucket), 2);
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.settle, (key(), v, uint256(1))),
            StoreEscrow.UnauthorizedRole.selector
        );
        assertEq(settling(s, v, 1), PRICE_A);
        assertEq(token.balanceOf(s.owner()), PRICE_A);
        reject(
            s,
            s.owner(),
            abi.encodeCall(StoreEscrow.settle, (key(), v, uint256(1))),
            StoreEscrow.InvalidUnitState.selector
        );
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeWithSignature(
                "markHandover(bytes32,bytes32,uint256,bytes32,uint256,uint256)", key(), v, 1, l, at, at
            ),
            bytes4(0)
        );
    }

    function testT06CompleteControlsPreserveOldVoucherRights() public {
        for (uint256 mode; mode < 3; mode++) {
            StoreEscrow e = stores[mode];
            fund(e, quoteFor(e, PAYER, 1, 3, false));
            bytes32 h = referenceTerms(e, terms(MEAL_A, 2, PRICE_A, TERMS_A));
            bytes32 v = issueAt(e, MEAL_A, 0, 1, h);
            bytes32 safe = issueAt(e, MEAL_A, 1, 1, h);
            bytes32 l;
            bytes32 m;
            if (mode == 2) {
                l = locking(e, v, 1);
                m = marking(e, v, 1, l);
                paused(e, true);
            }
            if (mode == 0) listed(e, MEAL_A, false);
            if (mode == 1) closed(e);
            StoreEscrow.FundingQuote memory q = quoteFor(e, PAYER, 2, 1, false);
            reject(
                e, PAYER, abi.encodeCall(StoreEscrow.fund, (q, signature(e, q))), StoreEscrow.OperatingDenied.selector
            );
            reject(
                e,
                e.issuerAuthority(),
                abi.encodeCall(StoreEscrow.issue, (key(), MEAL_A, uint8(2), uint256(1), h, block.timestamp + 600)),
                StoreEscrow.OperatingDenied.selector
            );
            if (mode < 2) {
                l = locking(e, v, 1);
                m = marking(e, v, 1, l);
            } else {
                reject(
                    e,
                    e.operatorAuthority(),
                    abi.encodeCall(StoreEscrow.lock, (key(), safe, uint256(1), block.timestamp + 600)),
                    StoreEscrow.OperatingDenied.selector
                );
                reject(
                    e,
                    e.operatorAuthority(),
                    abi.encodeCall(StoreEscrow.markHandover, (key(), v, uint256(1), l, block.timestamp + 600)),
                    StoreEscrow.OperatingDenied.selector
                );
            }
            vm.warp(block.timestamp + 72 hours);
            reporting(e, v, 1, l, m);
            settling(e, v, 1);
            expiring(e, safe, 1);
            refund(e, PAYER, e.getUnit(1).batchId, 6);
            partition(e, 0, 0, 0, PRICE_A, 2 * PRICE_A, 0);
        }
    }

    function testT06PauseMarkerSameTimestampBothOrdersAndResumeNoExtension() public {
        fund(s, quote(PAYER, 1, 2, false));
        bytes32 v = issueA(0);
        bytes32 l = locking(s, v, 1);
        paused(s, true);
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.markHandover, (key(), v, uint256(1), l, block.timestamp + 600)),
            StoreEscrow.OperatingDenied.selector
        );
        paused(s, false);
        bytes32 m = marking(s, v, 1, l);
        paused(s, true);
        reporting(s, v, 1, l, m);
        uint256 expiry = s.getVoucher(v).expiresAt;
        closed(s);
        vm.warp(expiry);
        paused(s, false);
        assertTrue(s.closed());
        assertEq(s.getVoucher(v).expiresAt, expiry);
        settling(s, v, 1);
    }

    function testT07IssueRefundBothOrdersAndLockExpiryBothOrders() public {
        bytes32 b = fund(s, quote(PAYER, 1, 2, false));
        refund(s, PAYER, b, 1);
        bytes32 v = issueAt(s, MEAL_A, 1, 1, referenceTerms(s, terms(MEAL_A, 2, PRICE_A, TERMS_A)));
        reject(s, PAYER, abi.encodeCall(StoreEscrow.refund, (b, uint16(2))), StoreEscrow.InvalidUnitState.selector);
        bytes32 l = locking(s, v, 1);
        vm.warp(block.timestamp + 72 hours);
        reject(
            s,
            s.issuerAuthority(),
            abi.encodeCall(StoreEscrow.expire, (key(), v, uint256(1))),
            StoreEscrow.InvalidUnitState.selector
        );
        assertEq(s.getVoucher(v).lockId, l);
        StoreEscrow e = stores[1];
        fund(e, quoteFor(e, PAYER, 1, 1, false));
        bytes32 x = issueAt(e, MEAL_A, 0, 1, referenceTerms(e, terms(MEAL_A, 2, PRICE_A, TERMS_A)));
        vm.warp(block.timestamp + 72 hours);
        expiring(e, x, 1);
        reject(
            e,
            e.operatorAuthority(),
            abi.encodeCall(StoreEscrow.lock, (key(), x, uint256(1), block.timestamp + 1)),
            StoreEscrow.InvalidVoucher.selector
        );
        assertEq(e.availableUnits(), 1);
    }

    function testT08MixedUnsafeMasksAtomicAndOriginalPayer() public {
        bytes32 b = fund(s, quote(PAYER, 1, 5, false));
        bytes32 r = issueA(0);
        bytes32 h = issueA(1);
        deliver(s, h, 1);
        bytes32 settled = issueA(2);
        deliver(s, settled, 1);
        settling(s, settled, 1);
        refund(s, PAYER, b, 8);
        uint16[4] memory masks = [uint16(17), uint16(18), uint16(20), uint16(24)];
        for (uint256 i; i < 4; i++) {
            reject(
                s,
                PAYER,
                abi.encodeCall(StoreEscrow.refundWithIntent, (key(), b, masks[i])),
                i == 3 ? StoreEscrow.AlreadyRefunded.selector : StoreEscrow.InvalidUnitState.selector
            );
        }
        assertEq(s.getBatch(b).refundedMask, 8);
        assertEq(s.availableUnits(), 1);
        reject(
            s,
            s.owner(),
            abi.encodeCall(StoreEscrow.refundWithIntent, (key(), b, uint16(16))),
            StoreEscrow.UnauthorizedPayer.selector
        );
        assertTrue(r != h);
        assertEq(s.lifetimeFundedUnits(), 5);
    }

    function testGoldenFiveBucketMixedPriceTrajectory() public {
        StoreEscrow.TermsInput memory a = terms(MEAL_A, 1, 3, TERMS_A);
        s = custom(token, a);
        bytes32 b1 = pay(s, a, 2);
        StoreEscrow.TermsInput memory b = terms(MEAL_A, 2, 5, TERMS_B);
        publish(s, b);
        bytes32 b2 = pay(s, b, 2);
        StoreEscrow.TermsInput memory c = terms(MEAL_A, 3, 7, TERMS_A);
        publish(s, c);
        pay(s, c, 1);
        bytes32 v0 = issueAt(s, MEAL_A, 0, 1, referenceTerms(s, a));
        bytes32 v1 = issueAt(s, MEAL_A, 1, 1, referenceTerms(s, a));
        bytes32 v2 = issueAt(s, MEAL_A, 2, 1, referenceTerms(s, b));
        bytes32 v3 = issueAt(s, MEAL_A, 3, 1, referenceTerms(s, b));
        bytes32 v4 = issueAt(s, MEAL_A, 4, 1, referenceTerms(s, c));
        bytes32 l2 = locking(s, v2, 1);
        bytes32 m2 = marking(s, v2, 1, l2);
        deliver(s, v3, 1);
        deliver(s, v4, 1);
        settling(s, v4, 1);
        vm.warp(block.timestamp + 72 hours);
        expiring(s, v0, 1);
        token.mint(address(s), 2);
        partition(s, 3, 8, 5, 7, 0, 2);
        reporting(s, v2, 1, l2, m2);
        partition(s, 3, 3, 10, 7, 0, 2);
        settling(s, v3, 1);
        partition(s, 3, 3, 5, 12, 0, 2);
        expiring(s, v1, 1);
        partition(s, 6, 0, 5, 12, 0, 2);
        refund(s, PAYER, b1, 1);
        partition(s, 3, 0, 5, 12, 3, 2);
        settling(s, v2, 1);
        partition(s, 3, 0, 0, 17, 3, 2);
        refund(s, PAYER, b1, 2);
        partition(s, 0, 0, 0, 17, 6, 2);
        assertEq(s.getBatch(b2).refundedMask, 0);
        assertEq(s.lifetimeFundedUnits(), 5);
    }

    function testFreshCandidateGenerationHashAndPostConsumptionNewKeysRejectAtomically() public {
        bytes32 b = fund(s, quote(PAYER, 1, 2, false));
        bytes32 h = referenceTerms(s, terms(MEAL_A, 2, PRICE_A, TERMS_A));
        for (uint256 i; i < 3; i++) {
            bytes32 id = key();
            reject(
                s,
                s.issuerAuthority(),
                abi.encodeCall(
                    StoreEscrow.issue,
                    (
                        id,
                        MEAL_A,
                        uint8(i == 0 ? 1 : 0),
                        uint256(i == 1 ? 2 : 1),
                        i == 2 ? TERMS_B : h,
                        block.timestamp + 600
                    )
                ),
                StoreEscrow.CandidateMismatch.selector
            );
            assertEq(s.getOperation(id).kind, 0);
            assertEq(s.availableUnits(), 2);
        }
        bytes32 v = issueA(0);
        bytes32 l = locking(s, v, 1);
        bytes32 m = marking(s, v, 1, l);
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.markHandover, (key(), v, uint256(2), l, block.timestamp + 600)),
            StoreEscrow.InvalidVoucher.selector
        );
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.markHandover, (key(), v, uint256(1), l, block.timestamp + 600)),
            StoreEscrow.InvalidMarker.selector
        );
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.report, (key(), v, uint256(2), l, m)),
            StoreEscrow.InvalidVoucher.selector
        );
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.report, (key(), v, uint256(1), l, key())),
            StoreEscrow.InvalidMarker.selector
        );
        reporting(s, v, 1, l, m);
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.report, (key(), v, uint256(1), l, m)),
            StoreEscrow.InvalidUnitState.selector
        );
        reject(
            s,
            s.owner(),
            abi.encodeCall(StoreEscrow.settle, (key(), v, uint256(2))),
            StoreEscrow.InvalidVoucher.selector
        );
        settling(s, v, 1);
        refund(s, PAYER, b, 2);
        reject(
            s,
            s.issuerAuthority(),
            abi.encodeCall(StoreEscrow.issue, (key(), MEAL_A, uint8(1), uint256(1), h, block.timestamp + 600)),
            StoreEscrow.CandidateUnavailable.selector
        );
        assertEq(s.lifetimeFundedUnits(), 2);
    }
}
