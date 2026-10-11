// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {S0bBase, StoreEscrow, IERC20} from "./S0bBase.sol";
import {AdversarialERC20, NoReturnERC20} from "./mocks/AdversarialERC20.sol";

contract S0bSettlementTest is S0bBase {
    function setupBad() private returns (AdversarialERC20 bad, StoreEscrow e, bytes32 b, bytes32 v) {
        bad = new AdversarialERC20();
        bad.mint(PAYER, 1000);
        e = custom(bad, terms(MEAL_A, 1, 3, TERMS_A));
        b = pay(e, terms(MEAL_A, 1, 3, TERMS_A), 3);
        v = issueAt(e, MEAL_A, 0, 1, referenceTerms(e, terms(MEAL_A, 1, 3, TERMS_A)));
        deliver(e, v, 1);
        bad.mint(address(e), 1);
    }

    function testT09SettlementAllAdversarialTokenDeltasRollbackBucketsKeysFeesAndAllowance() public {
        for (uint256 mode = 1; mode <= 10; mode++) {
            if (mode == 8 || mode == 9) continue;
            (AdversarialERC20 bad, StoreEscrow e, bytes32 b, bytes32 v) = setupBad();
            bytes32 id = key();
            bad.configure(AdversarialERC20.Behavior.Normal, AdversarialERC20.Behavior(mode));
            reject(e, e.owner(), abi.encodeCall(StoreEscrow.settle, (id, v, uint256(1))), bytes4(0));
            assertEq(uint8(e.getUnit(0).bucket), 2);
            assertEq(e.getVoucher(v).settleId, 0);
            assertEq(e.getOperation(id).kind, 0);
            assertEq(bad.balanceOf(address(e)), 10);
            assertEq(bad.balanceOf(e.owner()), 0);
            assertEq(bad.balanceOf(PAYER), 991);
            assertEq(bad.balanceOf(bad.FEE_COLLECTOR()), 0);
            assertEq(e.getBatch(b).refundedMask, 0);
            assertEq(bad.transferCalls(), 0);
            assertEq(bad.allowance(PAYER, address(e)), type(uint256).max);
            bad.configure(AdversarialERC20.Behavior.Normal, AdversarialERC20.Behavior.Normal);
            vm.prank(e.owner());
            assertEq(e.settle(id, v, 1), 3);
            partition(e, 6, 0, 0, 3, 0, 1);
        }
    }

    function entrance(uint256 index, StoreEscrow e, bytes32 batch, bytes32 v) private returns (bytes memory) {
        bytes32 id = key();
        if (index == 0) return abi.encodeCall(StoreEscrow.publish, (id, uint256(0), terms(MEAL_A, 2, 5, TERMS_B)));
        if (index == 1) return abi.encodeCall(StoreEscrow.setListed, (id, uint256(0), MEAL_A, false));
        if (index == 2) return abi.encodeCall(StoreEscrow.setPaused, (id, uint256(0), true));
        if (index == 3) return abi.encodeCall(StoreEscrow.close, (id, uint256(0)));
        if (index == 4) {
            return abi.encodeCall(StoreEscrow.issue, (id, MEAL_A, uint8(1), uint256(1), TERMS_A, block.timestamp + 600));
        }
        if (index == 5) return abi.encodeCall(StoreEscrow.lock, (id, v, uint256(1), block.timestamp + 600));
        if (index == 6) {
            return abi.encodeCall(StoreEscrow.markHandover, (id, v, uint256(1), id, block.timestamp + 600));
        }
        if (index == 7) return abi.encodeCall(StoreEscrow.report, (id, v, uint256(1), id, id));
        if (index == 8) return abi.encodeCall(StoreEscrow.settle, (id, v, uint256(1)));
        if (index == 9) return abi.encodeCall(StoreEscrow.expire, (id, v, uint256(1)));
        if (index == 10) return abi.encodeCall(StoreEscrow.refundWithIntent, (id, batch, uint16(2)));
        if (index == 11) return abi.encodeCall(StoreEscrow.refund, (batch, uint16(2)));
        StoreEscrow.FundingQuote memory q = StoreEscrow.FundingQuote(
            id,
            address(e.asset()),
            MEAL_A,
            1,
            referenceTerms(e, terms(MEAL_A, 1, 3, TERMS_A)),
            1,
            3,
            3,
            block.timestamp + 600
        );
        return abi.encodeCall(StoreEscrow.fund, (q, signature(e, q)));
    }

    function outerData(uint256 which, StoreEscrow e, bytes32 b, bytes32 v, bytes32 id) private returns (bytes memory) {
        if (which == 0) {
            StoreEscrow.FundingQuote memory q = StoreEscrow.FundingQuote(
                id, PAYER, MEAL_A, 1, referenceTerms(e, terms(MEAL_A, 1, 3, TERMS_A)), 1, 3, 3, block.timestamp + 600
            );
            return abi.encodeCall(StoreEscrow.fund, (q, signature(e, q)));
        }
        if (which == 1) return abi.encodeCall(StoreEscrow.refundWithIntent, (id, b, uint16(2)));
        return abi.encodeCall(StoreEscrow.settle, (id, v, uint256(1)));
    }

    function testT09AllThirteenEntrancesDuringFundRefundSettlementCatchAndBubble() public {
        for (uint256 outer; outer < 3; outer++) {
            for (uint256 nested; nested < 13; nested++) {
                for (uint256 bubble; bubble < 2; bubble++) {
                    (AdversarialERC20 bad, StoreEscrow e, bytes32 b, bytes32 v) = setupBad();
                    bytes32 id = key();
                    bytes memory data = outerData(outer, e, b, v, id);
                    bad.configureCallback(address(e), entrance(nested, e, b, v));
                    AdversarialERC20.Behavior behavior = bubble == 0
                        ? AdversarialERC20.Behavior.CallbackCatch
                        : AdversarialERC20.Behavior.CallbackBubble;
                    bad.configure(
                        outer == 0 ? behavior : AdversarialERC20.Behavior.Normal,
                        outer == 0 ? AdversarialERC20.Behavior.Normal : behavior
                    );
                    if (bubble == 1) {
                        reject(e, outer == 2 ? e.owner() : PAYER, data, bytes4(0));
                        assertEq(e.lifetimeFundedUnits(), 3);
                        assertEq(e.getBatch(b).refundedMask, 0);
                        assertEq(uint8(e.getUnit(0).bucket), 2);
                        assertEq(e.getOperation(id).kind, 0);
                        (, bytes32 used) = e.quoteUses(id);
                        assertEq(used, 0);
                        assertEq(bad.callbackAttempts(), 0);
                        assertEq(bad.balanceOf(address(e)), 10);
                        assertEq(bad.balanceOf(PAYER), 991);
                        assertEq(bad.balanceOf(e.owner()), 0);
                        bad.configure(AdversarialERC20.Behavior.Normal, AdversarialERC20.Behavior.Normal);
                    }
                    vm.prank(outer == 2 ? e.owner() : PAYER);
                    (bool ok,) = address(e).call(data);
                    assertTrue(ok);
                    if (bubble == 0) {
                        assertTrue(!bad.callbackSucceeded());
                        assertEq(
                            uint32(bad.callbackError()), uint32(bytes4(keccak256("ReentrancyGuardReentrantCall()")))
                        );
                        assertEq(bad.callbackAttempts(), 1);
                    }
                    assertEq(e.controlRevision(), 0);
                    assertTrue(!e.paused() && !e.closed());
                    assertEq(e.lifetimeFundedUnits(), outer == 0 ? 4 : 3);
                    assertEq(e.getBatch(b).refundedMask, outer == 1 ? 2 : 0);
                    assertEq(uint8(e.getUnit(0).bucket), outer == 2 ? 3 : 2);
                }
            }
        }
    }

    function testT09CaughtSettlementCallbackWrongDeltaAndBalanceReadRollback() public {
        (AdversarialERC20 bad, StoreEscrow e,, bytes32 v) = setupBad();
        bytes32 id = key();
        bad.configureCallback(address(e), abi.encodeCall(StoreEscrow.setPaused, (key(), uint256(0), true)));
        bad.configure(AdversarialERC20.Behavior.Normal, AdversarialERC20.Behavior.CallbackCatch);
        bad.configureCallbackExtraCredit(true);
        reject(
            e,
            e.owner(),
            abi.encodeCall(StoreEscrow.settle, (id, v, uint256(1))),
            StoreEscrow.TransferDeltaMismatch.selector
        );
        assertEq(bad.callbackAttempts(), 0);
        assertEq(e.getOperation(id).kind, 0);
        assertEq(uint8(e.getUnit(0).bucket), 2);
        assertEq(bad.balanceOf(e.owner()), 0);
        bad.configureCallbackExtraCredit(false);
        bad.configureBalanceRead(true);
        reject(e, e.owner(), abi.encodeCall(StoreEscrow.settle, (id, v, uint256(1))), bytes4(0));
        assertEq(e.getOperation(id).kind, 0);
    }

    function testT09NoReturnSettlementExactDeltaAndNoMovementRollback() public {
        NoReturnERC20 legacy = new NoReturnERC20();
        legacy.mint(PAYER, 1000);
        StoreEscrow e = custom(IERC20(address(legacy)), terms(MEAL_A, 1, 3, TERMS_A));
        pay(e, terms(MEAL_A, 1, 3, TERMS_A), 1);
        bytes32 v = issueAt(e, MEAL_A, 0, 1, referenceTerms(e, terms(MEAL_A, 1, 3, TERMS_A)));
        deliver(e, v, 1);
        bytes32 id = key();
        legacy.configureNoMove(true);
        reject(
            e,
            e.owner(),
            abi.encodeCall(StoreEscrow.settle, (id, v, uint256(1))),
            StoreEscrow.TransferDeltaMismatch.selector
        );
        assertEq(e.getOperation(id).kind, 0);
        assertEq(uint8(e.getUnit(0).bucket), 2);
        legacy.configureNoMove(false);
        vm.prank(e.owner());
        assertEq(e.settle(id, v, 1), 3);
        assertEq(legacy.balanceOf(e.owner()), 3);
    }
}
