// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {S0bBase, StoreEscrow} from "./S0bBase.sol";

contract S0bFuzzTest is S0bBase {
    function testFuzzIndependentFiveBucketOriginalPriceAndGeneration(uint64 rawPrice, uint8 rawQty, uint256 choices)
        public
    {
        uint256 price = uint256(rawPrice) % 1e18 + 1;
        uint256 qty = uint256(rawQty) % 9 + 2;
        StoreEscrow.TermsInput memory t = terms(MEAL_A, 1, price, TERMS_A);
        s = custom(token, t);
        bytes32 b = pay(s, t, qty);
        bytes32 hash = referenceTerms(s, t);
        uint256[5] memory counts;
        bytes32[10] memory vouchers;
        for (uint8 i; i < qty; i++) {
            vouchers[i] = issueAt(s, MEAL_A, i, 1, hash);
            counts[1]++;
        }
        for (uint8 i; i < qty; i++) {
            uint256 choice = (choices >> (i * 3)) % 5;
            if (choice == 2 || choice == 3) {
                deliver(s, vouchers[i], 1);
                counts[1]--;
                counts[2]++;
                if (choice == 3) {
                    settling(s, vouchers[i], 1);
                    counts[2]--;
                    counts[3]++;
                }
            }
        }
        vm.warp(block.timestamp + 72 hours);
        for (uint8 i; i < qty; i++) {
            uint256 choice = (choices >> (i * 3)) % 5;
            if (choice == 0 || choice == 4) {
                expiring(s, vouchers[i], 1);
                counts[1]--;
                counts[0]++;
                if (choice == 4) {
                    refund(s, PAYER, b, uint16(uint256(1) << i));
                    counts[0]--;
                    counts[4]++;
                }
            }
        }
        StoreEscrow.Accounting memory actual = s.getAccounting();
        for (uint256 i; i < 5; i++) {
            assertEq(actual.counts[i], counts[i]);
            assertEq(actual.amounts[i], counts[i] * price);
        }
        partition(s, counts[0] * price, counts[1] * price, counts[2] * price, counts[3] * price, counts[4] * price, 0);
        assertEq(token.balanceOf(PAYER), 1e30 - qty * price + counts[4] * price);
        assertEq(token.balanceOf(s.owner()), counts[3] * price);
    }

    function testFuzzOriginalWindowSecondsClassification(uint16 rawStart, uint16 rawLength, uint32 rawSecond) public {
        uint16 start = rawStart % 1440;
        uint16 end = uint16(uint256(start) + uint256(rawLength) % (1440 - start) + 1);
        StoreEscrow.TermsInput memory t = terms(MEAL_A, 1, 3, TERMS_A);
        t.startMinute0 = start;
        t.endMinute0 = end;
        uint256 day = (block.timestamp / 1 days + 2) * 1 days - 8 hours;
        vm.warp(day);
        s = custom(token, t);
        pay(s, t, 1);
        bytes32 v = issueAt(s, MEAL_A, 0, 1, referenceTerms(s, t));
        uint256 second = uint256(rawSecond) % 86400;
        vm.warp(day + second);
        bool allowed = second >= uint256(start) * 60 && second < uint256(end) * 60;
        bytes memory data = abi.encodeCall(StoreEscrow.lock, (key(), v, uint256(1), block.timestamp + 1));
        if (allowed) {
            vm.prank(s.operatorAuthority());
            (bool ok,) = address(s).call(data);
            assertTrue(ok);
        } else {
            reject(s, s.operatorAuthority(), data, StoreEscrow.TimeDenied.selector);
        }
        assertEq(uint8(s.getUnit(0).bucket), 1);
    }
}
