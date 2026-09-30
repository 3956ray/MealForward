// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {MealForward} from "../../contracts/MealForward.sol";

interface Vm {
    function deal(address, uint256) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectRevert() external;
    function chainId(uint256) external;
}
contract RejectPayment { receive() external payable { revert("no payment"); } }
contract ForceValue {
    constructor(address payable target) payable { selfdestruct(target); }
}
contract ReenterMerchant {
    MealForward public escrow;
    bytes32 public voucher;
    bool public attempted;
    bool public reentered;
    function configure(MealForward e, bytes32 v) external { escrow = e; voucher = v; }
    receive() external payable {
        attempted = true;
        (reentered,) = address(escrow).call(abi.encodeCall(escrow.settle, (bytes32(uint256(9999)), voucher)));
    }
}

contract MealForwardTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MealForward m;
    address constant PAYER = address(101);
    address constant PAYER2 = address(102);
    address constant ISSUER = address(103);
    address constant OPERATOR = address(104);
    address constant OTHER_OPERATOR = address(105);
    address constant SETTLER = address(106);
    address constant MERCHANT = address(107);
    uint256 constant PRICE = 1e15;
    bytes32 constant RULE = keccak256("mealforward-cp13-local-v1");

    function setUp() public {
        vm.chainId(31337);
        m = new MealForward(address(this), MERCHANT);
        grant(m);
        vm.deal(PAYER, 10 ether);
        vm.deal(PAYER2, 10 ether);
        vm.deal(address(this), 10 ether);
    }
    function grant(MealForward e) private {
        e.grantRole(e.SUPPORTER_ROLE(), PAYER);
        e.grantRole(e.SUPPORTER_ROLE(), PAYER2);
        e.grantRole(e.ISSUER_ROLE(), ISSUER);
        e.grantRole(e.OPERATOR_ROLE(), OPERATOR);
        e.grantRole(e.OPERATOR_ROLE(), OTHER_OPERATOR);
        e.grantRole(e.SETTLER_ROLE(), SETTLER);
    }
    function fund(MealForward e, address payer, uint256 id, uint256 n) private returns (bytes32) {
        vm.prank(payer);
        return e.fund{value: n * PRICE}(bytes32(id), n, RULE);
    }
    function ids(uint256 offset, uint256 n) private pure returns (bytes32[] memory vs) {
        vs = new bytes32[](n);
        for (uint256 i; i < n; ++i) vs[i] = bytes32(offset + i);
    }
    function issue(MealForward e, bytes32 batch, uint256 offset, uint256 n) private {
        vm.prank(ISSUER); e.issue(bytes32(offset), batch, ids(offset, n));
    }
    function report(MealForward e, uint256 voucherId) private {
        vm.prank(OPERATOR); e.lock(bytes32(voucherId), bytes32(voucherId), bytes32(voucherId));
        vm.prank(OPERATOR); e.report(bytes32(voucherId), bytes32(voucherId), bytes32(voucherId));
    }
    function assertBatch(MealForward e, bytes32 batch, uint256 a, uint256 r, uint256 h, uint256 s) private view {
        (uint256 f,uint256 aa,uint256 rr,uint256 hh,uint256 ss,uint256 x,uint256 l) = e.getBatch(batch);
        assert(aa == a && rr == r && hh == h && ss == s);
        assert(f == aa + rr + hh + ss + x && x == 0 && l == 0);
        assert(address(e).balance >= e.liability());
    }
    function testThreeVoucherFlowAndTwoBatchIsolation() public {
        bytes32 a = fund(m, PAYER, 1, 3);
        bytes32 b = fund(m, PAYER, 2, 2);
        issue(m, a, 10, 3);
        report(m, 10);
        vm.prank(SETTLER); m.settle(bytes32(uint256(10)), bytes32(uint256(10)));
        assertBatch(m, a, 0, 2 * PRICE, 0, PRICE);
        assertBatch(m, b, 2 * PRICE, 0, 0, 0);
        assert(MERCHANT.balance == PRICE);
        assert(m.totalFunded() == 5 * PRICE && m.liability() == 4 * PRICE);
    }
    function testCrossBatchVoucherIdsAndIndependentSettlement() public {
        bytes32 a = fund(m, PAYER, 1, 1);
        bytes32 b = fund(m, PAYER, 2, 1);
        issue(m, a, 10, 1);
        vm.expectRevert(MealForward.DuplicateId.selector);
        vm.prank(ISSUER); m.issue(bytes32(uint256(20)), b, ids(10, 1));
        assertBatch(m, b, PRICE, 0, 0, 0);
        issue(m, b, 20, 1); report(m, 20);
        vm.prank(SETTLER); m.settle(bytes32(uint256(20)), bytes32(uint256(20)));
        assertBatch(m, a, 0, PRICE, 0, 0);
        assertBatch(m, b, 0, 0, 0, PRICE);
        report(m, 10);
        vm.prank(SETTLER); m.settle(bytes32(uint256(10)), bytes32(uint256(10)));
        assertBatch(m, a, 0, 0, 0, PRICE);
        assertBatch(m, b, 0, 0, 0, PRICE);
        assert(m.liability() == 0 && MERCHANT.balance == 2 * PRICE);
    }
    function testPayerIntentDomainAndDuplicateRefund() public {
        bytes32 a = fund(m, PAYER, 1, 1);
        bytes32 b = fund(m, PAYER2, 1, 1);
        assert(a != b);
        uint256 beforeBalance = PAYER.balance;
        vm.expectRevert(MealForward.AlreadyProcessed.selector);
        fund(m, PAYER, 1, 1);
        assert(PAYER.balance == beforeBalance && m.totalFunded() == 2 * PRICE);
        assert(m.fundedBatch(PAYER, bytes32(uint256(1))) == a);
    }
    function testInvalidFundingAndCap() public {
        vm.expectRevert(MealForward.InvalidValue.selector);
        vm.prank(PAYER); m.fund{value: PRICE - 1}(bytes32(uint256(1)), 1, RULE);
        vm.expectRevert(MealForward.InvalidRule.selector);
        vm.prank(PAYER); m.fund{value: PRICE}(bytes32(uint256(1)), 1, bytes32(0));
        vm.expectRevert(MealForward.InvalidInput.selector); fund(m, PAYER, 0, 1);
        vm.expectRevert(MealForward.InvalidInput.selector); fund(m, PAYER, 1, 21);
        for (uint256 i = 1; i <= 5; ++i) fund(m, PAYER, i, 20);
        vm.expectRevert(MealForward.LimitExceeded.selector); fund(m, PAYER, 6, 1);
    }
    function testIssueAtomicDuplicatesAndBudget() public {
        bytes32 a = fund(m, PAYER, 1, 3);
        bytes32[] memory dup = ids(10, 3); dup[2] = dup[0];
        vm.expectRevert(MealForward.DuplicateId.selector);
        vm.prank(ISSUER); m.issue(bytes32(uint256(10)), a, dup);
        (,uint8 state,) = m.getVoucher(dup[0]); assert(state == 0);
        (bytes32 payload,) = m.getOperation(1, bytes32(uint256(10))); assert(payload == 0);
        assertBatch(m, a, 3 * PRICE, 0, 0, 0);
        vm.expectRevert(MealForward.LimitExceeded.selector); issue(m, a, 20, 4);
        issue(m, a, 10, 3);
        vm.expectRevert(MealForward.AlreadyProcessed.selector); issue(m, a, 10, 3);
        vm.expectRevert(MealForward.IntentConflict.selector); issue(m, a, 10, 2);
    }
    function testUniqueLockAndReplay() public {
        bytes32 a = fund(m, PAYER, 1, 2); issue(m, a, 10, 2);
        vm.prank(OPERATOR); m.lock(bytes32(uint256(1)), bytes32(uint256(10)), bytes32(uint256(100)));
        vm.expectRevert(MealForward.InvalidVoucherState.selector);
        vm.prank(OTHER_OPERATOR); m.lock(bytes32(uint256(2)), bytes32(uint256(10)), bytes32(uint256(101)));
        vm.expectRevert(MealForward.DuplicateId.selector);
        vm.prank(OPERATOR); m.lock(bytes32(uint256(3)), bytes32(uint256(11)), bytes32(uint256(100)));
        vm.expectRevert(MealForward.IntentConflict.selector);
        vm.prank(OPERATOR); m.lock(bytes32(uint256(1)), bytes32(uint256(11)), bytes32(uint256(102)));
        vm.expectRevert(MealForward.InvalidVoucherState.selector);
        vm.prank(OPERATOR); m.report(bytes32(uint256(4)), bytes32(uint256(10)), bytes32(uint256(999)));
        vm.prank(OPERATOR); m.report(bytes32(uint256(4)), bytes32(uint256(10)), bytes32(uint256(100)));
        vm.expectRevert(MealForward.AlreadyProcessed.selector);
        vm.prank(OPERATOR); m.report(bytes32(uint256(4)), bytes32(uint256(10)), bytes32(uint256(100)));
    }
    function testPauseBlocksNewOperationsButAllowsOldReport() public {
        bytes32 a = fund(m, PAYER, 1, 3); issue(m, a, 10, 2);
        vm.prank(OPERATOR); m.lock(bytes32(uint256(1)), bytes32(uint256(10)), bytes32(uint256(100)));
        m.setPaused(true);
        vm.expectRevert(MealForward.Paused.selector); fund(m, PAYER, 2, 1);
        vm.expectRevert(MealForward.Paused.selector); issue(m, a, 20, 1);
        vm.expectRevert(MealForward.Paused.selector);
        vm.prank(OPERATOR); m.lock(bytes32(uint256(2)), bytes32(uint256(11)), bytes32(uint256(101)));
        vm.prank(OPERATOR); m.report(bytes32(uint256(3)), bytes32(uint256(10)), bytes32(uint256(100)));
        vm.expectRevert(MealForward.Paused.selector);
        vm.prank(SETTLER); m.settle(bytes32(uint256(4)), bytes32(uint256(10)));
        assertBatch(m, a, PRICE, PRICE, PRICE, 0);
        m.setPaused(false);
        vm.prank(SETTLER); m.settle(bytes32(uint256(4)), bytes32(uint256(10)));
    }
    function testRolesAreIndependentAndRevocable() public {
        bytes32 a = fund(m, PAYER, 1, 1);
        vm.expectRevert(); vm.prank(OPERATOR); m.issue(bytes32(uint256(1)), a, ids(10, 1));
        issue(m, a, 10, 1); report(m, 10);
        vm.expectRevert(); vm.prank(OPERATOR); m.settle(bytes32(uint256(1)), bytes32(uint256(10)));
        vm.expectRevert(); vm.prank(ISSUER); m.setPaused(true);
        m.revokeRole(m.SETTLER_ROLE(), SETTLER);
        vm.expectRevert(); vm.prank(SETTLER); m.settle(bytes32(uint256(1)), bytes32(uint256(10)));
        vm.deal(address(999), PRICE);
        vm.expectRevert(); vm.prank(address(999)); m.fund{value: PRICE}(bytes32(uint256(2)), 1, RULE);
    }
    function testPaymentFailureRollsBackEverything() public {
        MealForward e = new MealForward(address(this), address(new RejectPayment())); grant(e);
        bytes32 a = fund(e, PAYER, 1, 1); issue(e, a, 10, 1); report(e, 10);
        vm.expectRevert(MealForward.PaymentFailed.selector);
        vm.prank(SETTLER); e.settle(bytes32(uint256(1)), bytes32(uint256(10)));
        assertBatch(e, a, 0, 0, PRICE, 0);
        (,uint8 state,) = e.getVoucher(bytes32(uint256(10))); assert(state == 3);
        (bytes32 payload,) = e.getOperation(4, bytes32(uint256(1))); assert(payload == 0);
    }
    function testMerchantCannotReenterEvenWithSettlerRole() public {
        ReenterMerchant receiver = new ReenterMerchant();
        MealForward e = new MealForward(address(this), address(receiver)); grant(e);
        e.grantRole(e.SETTLER_ROLE(), address(receiver));
        bytes32 a = fund(e, PAYER, 1, 1); issue(e, a, 10, 1); report(e, 10);
        receiver.configure(e, bytes32(uint256(10)));
        vm.prank(SETTLER); e.settle(bytes32(uint256(1)), bytes32(uint256(10)));
        assert(receiver.attempted() && !receiver.reentered());
        assertBatch(e, a, 0, 0, 0, PRICE);
    }
    function testExtraBalanceDoesNotCreateFunding() public {
        bytes32 a = fund(m, PAYER, 1, 1);
        new ForceValue{value: PRICE}(payable(address(m)));
        assert(m.unallocated() == PRICE && m.totalFunded() == PRICE);
        assertBatch(m, a, PRICE, 0, 0, 0);
        (bool ok,) = address(m).call{value: PRICE}(""); assert(!ok);
    }
    function testDeploymentRejectsPublicChain() public {
        vm.chainId(10143);
        vm.expectRevert(MealForward.LocalChainOnly.selector);
        new MealForward(address(this), MERCHANT);
    }
    function testFuzzPartialFlowConservesFunds(uint8 rawN, uint8 rawReported, uint8 rawSettled) public {
        uint256 n = uint256(rawN) % 20 + 1;
        uint256 r = uint256(rawReported) % (n + 1);
        uint256 s = uint256(rawSettled) % (r + 1);
        bytes32 a = fund(m, PAYER, 1, n); issue(m, a, 100, n);
        for (uint256 i; i < r; ++i) report(m, 100 + i);
        for (uint256 i; i < s; ++i) {
            vm.prank(SETTLER); m.settle(bytes32(i + 1), bytes32(100 + i));
        }
        assertBatch(m, a, 0, (n-r)*PRICE, (r-s)*PRICE, s*PRICE);
        assert(m.liability() == (n-s)*PRICE && MERCHANT.balance == s*PRICE);
    }
}
