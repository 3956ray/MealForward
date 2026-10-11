// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {S0bBase, StoreEscrow} from "./S0bBase.sol";

contract S0bTimeTest is S0bBase {
    function testT04ExactSecondsUTC8WindowStartEndGapMidnightAndNextDay() public {
        uint256 day = (block.timestamp / 1 days + 2) * 1 days - 8 hours;
        uint256[10] memory offsets = [
            uint256(540 * 60 - 1),
            540 * 60,
            600 * 60 - 1,
            600 * 60,
            780 * 60 - 1,
            780 * 60,
            86400 - 1,
            86400,
            86400 + 540 * 60,
            86400 + 600 * 60
        ];
        bool[10] memory allowed = [false, true, true, false, false, true, true, false, true, false];
        for (uint256 i; i < 10; i++) {
            vm.warp(day);
            StoreEscrow.TermsInput memory t = terms(MEAL_A, 1, 3, TERMS_A);
            t.windowCount = 2;
            t.startMinute0 = 540;
            t.endMinute0 = 600;
            t.startMinute1 = 780;
            t.endMinute1 = 1440;
            StoreEscrow e = custom(token, t);
            pay(e, t, 1);
            bytes32 v = issueAt(e, MEAL_A, 0, 1, referenceTerms(e, t));
            // Issue outside the window is allowed when the original 72h horizon intersects it.
            vm.warp(day + offsets[i]);
            bytes memory data = abi.encodeCall(StoreEscrow.lock, (key(), v, uint256(1), block.timestamp + 1));
            if (allowed[i]) {
                vm.prank(e.operatorAuthority());
                (bool ok, bytes memory out) = address(e).call(data);
                assertTrue(ok);
                bytes32 l = abi.decode(out, (bytes32));
                marking(e, v, 1, l);
            } else {
                reject(e, e.operatorAuthority(), data, StoreEscrow.TimeDenied.selector);
            }
        }
    }

    function testT04MarkerBoundarySeparateFromLockAndUnusedSecondPair() public {
        uint256 day = (block.timestamp / 1 days + 2) * 1 days - 8 hours;
        StoreEscrow.TermsInput memory t = terms(MEAL_A, 1, 3, TERMS_A);
        t.startMinute0 = 540;
        t.endMinute0 = 600;
        vm.warp(day);
        s = custom(token, t);
        pay(s, t, 2);
        bytes32 v0 = issueAt(s, MEAL_A, 0, 1, referenceTerms(s, t));
        bytes32 v1 = issueAt(s, MEAL_A, 1, 1, referenceTerms(s, t));
        vm.warp(day + 540 * 60);
        bytes32 l0 = locking(s, v0, 1);
        bytes32 l1 = locking(s, v1, 1);
        vm.warp(day + 600 * 60 - 1);
        marking(s, v0, 1, l0);
        vm.warp(day + 600 * 60);
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.markHandover, (key(), v1, uint256(1), l1, block.timestamp + 1)),
            StoreEscrow.TimeDenied.selector
        );
        reporting(s, v0, 1, l0, s.getVoucher(v0).markerId);
        assertEq(uint8(s.getUnit(0).bucket), 2);
    }

    function testT04ExpiryMinusOneEqualityPlusOneAndAllDeadlineEqualities() public {
        fund(s, quote(PAYER, 1, 4, false));
        bytes32 h = referenceTerms(s, terms(MEAL_A, 2, PRICE_A, TERMS_A));
        reject(
            s,
            s.issuerAuthority(),
            abi.encodeCall(StoreEscrow.issue, (key(), MEAL_A, uint8(0), uint256(1), h, block.timestamp)),
            StoreEscrow.TimeDenied.selector
        );
        bytes32 v0 = issueA(0);
        bytes32 v1 = issueA(1);
        bytes32 v2 = issueA(2);
        bytes32 v3 = issueA(3);
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.lock, (key(), v0, uint256(1), block.timestamp)),
            StoreEscrow.TimeDenied.selector
        );
        bytes32 l = locking(s, v3, 1);
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.markHandover, (key(), v3, uint256(1), l, block.timestamp)),
            StoreEscrow.TimeDenied.selector
        );
        uint256 expiry = s.getVoucher(v0).expiresAt;
        vm.warp(expiry - 1);
        locking(s, v0, 1);
        marking(s, v3, 1, l);
        reject(
            s,
            s.issuerAuthority(),
            abi.encodeCall(StoreEscrow.expire, (key(), v1, uint256(1))),
            StoreEscrow.NotExpired.selector
        );
        vm.warp(expiry);
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.lock, (key(), v1, uint256(1), expiry + 1)),
            StoreEscrow.TimeDenied.selector
        );
        expiring(s, v1, 1);
        vm.warp(expiry + 1);
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.lock, (key(), v2, uint256(1), expiry + 2)),
            StoreEscrow.TimeDenied.selector
        );
        expiring(s, v2, 1);
        reporting(s, v3, 1, l, s.getVoucher(v3).markerId);
        reject(
            s,
            s.issuerAuthority(),
            abi.encodeCall(StoreEscrow.expire, (key(), v0, uint256(1))),
            StoreEscrow.InvalidUnitState.selector
        );
    }

    function testT04InvalidWindowPriceDigestsAdjacentWindowsAndOverflow() public {
        for (uint256 i; i < 12; i++) {
            StoreEscrow.TermsInput memory t = terms(MEAL_A, 1, 3, TERMS_A);
            if (i == 0) t.windowCount = 0;
            if (i == 1) t.windowCount = 3;
            if (i == 2) t.endMinute0 = 0;
            if (i == 3) t.endMinute0 = 1441;
            if (i == 4) t.startMinute0 = 1440;
            if (i == 5) t.startMinute1 = 1;
            if (i == 6) {
                t.windowCount = 2;
                t.startMinute1 = 100;
                t.endMinute1 = 200;
            }
            if (i == 7) {
                t.windowCount = 2;
                t.endMinute0 = 100;
                t.startMinute1 = 200;
                t.endMinute1 = 100;
            }
            if (i == 8) t.bodyDigest = 0;
            if (i == 9) t.imageDigest = 0;
            if (i == 10) t.unitPrice = 0;
            if (i == 11) t.mealId = 0;
            vm.expectRevert(StoreEscrow.InvalidCatalog.selector);
            custom(token, t);
        }
        StoreEscrow.TermsInput memory adjacent = terms(MEAL_A, 1, 3, TERMS_A);
        adjacent.windowCount = 2;
        adjacent.endMinute0 = 600;
        adjacent.startMinute1 = 600;
        adjacent.endMinute1 = 1440;
        s = custom(token, adjacent);
        pay(s, adjacent, 1);
        vm.warp(type(uint256).max - 100);
        reject(
            s,
            s.issuerAuthority(),
            abi.encodeCall(
                StoreEscrow.issue, (key(), MEAL_A, uint8(0), uint256(1), referenceTerms(s, adjacent), type(uint256).max)
            ),
            bytes4(0)
        );
        assertEq(uint8(s.getUnit(0).bucket), 0);
    }
}
