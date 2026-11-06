// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ProductCatalog as C} from "../contracts/ProductCatalog.sol";
import {ProductFunding as F} from "../contracts/ProductFunding.sol";
import {ProductEscrow as E} from "../contracts/ProductEscrow.sol";

interface EscrowVm {
    function prank(address) external;
    function warp(uint256) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function expectRevert(bytes4) external;
    function expectRevert() external;
}

contract EscrowTestAsset is ERC20 {
    bool public rejectTransfer;
    bool public chargeFee;
    address private callbackTarget;
    bytes private callbackPayload;
    bool public callbackAttempted;
    bool public callbackSucceeded;
    bytes4 public callbackError;
    constructor() ERC20("Local lifecycle asset", "LOCAL") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function rejectForTest() external { rejectTransfer = true; }
    function acceptForTest() external { rejectTransfer = false; }
    function enableFeeForTest() external { chargeFee = true; }
    function setCallbackForTest(address target, bytes calldata payload) external {
        callbackTarget = target; callbackPayload = payload;
    }
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (rejectTransfer) return false;
        if (callbackTarget != address(0)) {
            callbackAttempted = true;
            (bool succeeded, bytes memory result) = callbackTarget.call(callbackPayload);
            callbackSucceeded = succeeded;
            if (result.length >= 4) callbackError = bytes4(result);
        }
        if (chargeFee && amount != 0) {
            _burn(msg.sender, 1);
            return super.transfer(to, amount - 1);
        }
        return super.transfer(to, amount);
    }
}

contract ProductEscrowTest {
    EscrowVm constant vm = EscrowVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant SYNTHETIC_VERIFIER = 0xbecafe;
    address constant PLATFORM = address(0x300);
    address constant OWNER = address(0x101);
    address constant OWNER2 = address(0x102);
    address constant DONOR = address(0x200);
    address constant ALICE = address(0x401);
    address constant BOB = address(0x402);
    bytes32 constant STORE = keccak256("escrow-store");
    bytes32 constant STORE2 = keccak256("escrow-store-two");
    bytes32 constant MEAL = keccak256("escrow-meal");
    uint256 constant PRICE = 7_000_000;
    // 11:00 Asia/Shanghai.
    uint256 constant START = 20_000 days + 3 hours;
    EscrowTestAsset token;
    E escrow;
    address verifier;
    bytes32 batch;

    function setUp() public {
        vm.warp(START);
        verifier = vm.addr(SYNTHETIC_VERIFIER);
        token = new EscrowTestAsset();
        escrow = new E(token, PLATFORM, verifier, 7200);
        token.mint(DONOR, 1e24);
        vm.prank(DONOR); token.approve(address(escrow), type(uint256).max);
        _store(OWNER, STORE, PRICE, 30);
        _store(OWNER2, STORE2, PRICE * 2, 30);
        batch = _fund(STORE, 1, 25, PRICE);
    }

    function _terms(uint256 price) private pure returns (C.TermsInput memory) {
        return C.TermsInput(price, keccak256("food"), keccak256("photo"), 2, 660, 840, 1020, 1260);
    }
    function _store(address owner, bytes32 store, uint256 price, uint256 quantity) private {
        vm.prank(owner); escrow.registerStore(bytes32(uint256(1)), store);
        vm.prank(owner); escrow.publish(bytes32(uint256(2)), store, MEAL, 0, _terms(price), quantity, START + 1 days);
    }
    function _fund(bytes32 store, uint256 id, uint256 quantity, uint256 price) private returns (bytes32) {
        F.FundingRequest memory request = F.FundingRequest(bytes32(id), store, MEAL, 1,
            escrow.getTerms(store, MEAL, 1).termsHash, quantity, quantity * price, START + 1 days);
        vm.prank(DONOR); return escrow.fund(request);
    }
    function _claim(uint256 requestId, bytes32 target, uint256 index, uint256 generation, address recipient)
        private returns (bytes32)
    {
        vm.prank(PLATFORM); return escrow.claim(bytes32(requestId), target, index, generation, recipient);
    }
    function _permit(bytes32 voucherId, address owner) private view returns (E.RedemptionPermit memory permit) {
        E.Voucher memory voucher = escrow.getVoucher(voucherId);
        uint256 deadline = block.timestamp + 120;
        if (deadline > voucher.expiresAt) deadline = voucher.expiresAt;
        return E.RedemptionPermit(voucherId, voucher.generation, owner, block.timestamp, deadline);
    }
    function _sign(E.RedemptionPermit memory permit) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SYNTHETIC_VERIFIER, escrow.redemptionDigest(permit));
        return abi.encodePacked(r, s, v);
    }
    function _redeem(bytes32 voucherId, address owner, uint256 requestId) private {
        E.RedemptionPermit memory permit = _permit(voucherId, owner);
        bytes memory signature = _sign(permit);
        vm.prank(owner); escrow.redeem(bytes32(requestId), voucherId, permit.generation, permit, signature);
    }
    function _settle(bytes32 voucherId, address owner, uint256 requestId) private {
        uint256 generation = escrow.getVoucher(voucherId).generation;
        vm.prank(owner); escrow.settle(bytes32(requestId), voucherId, generation);
    }
    function _conserved() private view {
        E.Accounting memory a = escrow.accounting();
        require(a.fundedQuantity == a.availableQuantity + a.claimedQuantity + a.handedOverQuantity + a.settledQuantity + a.refundPendingQuantity + a.refundedQuantity, "quantity");
        require(a.fundedAmount == a.availableAmount + a.claimedAmount + a.handedOverAmount + a.settledAmount + a.refundPendingAmount + a.refundedAmount, "amount");
        require(a.liability == a.availableAmount + a.claimedAmount + a.handedOverAmount + a.refundPendingAmount, "liability");
        require(token.balanceOf(address(escrow)) == a.liability, "asset conservation");
    }

    function testTwoHourCooldownIsGlobalAcrossStoresAndEarlyUse() public {
        bytes32 otherBatch = _fund(STORE2, 2, 1, 2 * PRICE);
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        _redeem(voucher, OWNER, 3);
        vm.warp(START + 180); _settle(voucher, OWNER, 4);
        require(escrow.nextEligibleAt(ALICE) == START + 7200, "early use preserves cooldown");
        vm.warp(START + 7199);
        vm.prank(PLATFORM); vm.expectRevert(E.ClaimCooldown.selector);
        escrow.claim(bytes32(uint256(2)), otherBatch, 0, 1, ALICE);
        vm.warp(START + 7200);
        bytes32 next = _claim(2, otherBatch, 0, 1, ALICE);
        require(escrow.getVoucher(next).expiresAt == START + 14400, "new expiry");
        _conserved();
    }

    function testFormalPolicyIsExactly72Hours() public {
        escrow = new E(token, PLATFORM, verifier, 259200);
        vm.prank(DONOR); token.approve(address(escrow), type(uint256).max);
        _store(OWNER, STORE, PRICE, 30);
        batch = _fund(STORE, 1, 2, PRICE);
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        require(escrow.getVoucher(voucher).expiresAt == START + 259200, "formal expiry");
        require(escrow.nextEligibleAt(ALICE) == START + 259200, "formal cooldown");
        vm.warp(START + 259199);
        vm.prank(PLATFORM); vm.expectRevert(E.ClaimCooldown.selector);
        escrow.claim(bytes32(uint256(2)), batch, 1, 1, ALICE);
        vm.warp(START + 259200); _claim(2, batch, 1, 1, ALICE);
        _conserved();
    }

    function testInvalidPolicyAndAuthoritiesRejected() public {
        vm.expectRevert(E.InvalidPolicy.selector); new E(token, PLATFORM, verifier, 3600);
        vm.expectRevert(E.InvalidPolicy.selector); new E(token, address(0), verifier, 7200);
        vm.expectRevert(E.InvalidPolicy.selector); new E(token, PLATFORM, address(0), 259200);
    }

    function testRejectedClaimsDoNotConsumeWalletEligibilityOrRequest() public {
        vm.prank(PLATFORM); vm.expectRevert(E.InvalidUnit.selector);
        escrow.claim(bytes32(uint256(1)), batch, 25, 1, ALICE);
        require(escrow.nextEligibleAt(ALICE) == 0, "failure consumed cooldown");
        require(!escrow.getRequest(PLATFORM, bytes32(uint256(1))).exists, "failure consumed request");
        vm.prank(PLATFORM); vm.expectRevert(E.GenerationMismatch.selector);
        escrow.claim(bytes32(uint256(1)), batch, 0, 2, ALICE);
        _claim(1, batch, 0, 1, ALICE);
        _conserved();
    }

    function testClaimAuthorityRecipientAndUniqueUnit() public {
        vm.prank(ALICE); vm.expectRevert(E.UnauthorizedAuthority.selector);
        escrow.claim(bytes32(uint256(1)), batch, 0, 1, ALICE);
        vm.prank(PLATFORM); vm.expectRevert(E.InvalidRecipient.selector);
        escrow.claim(bytes32(uint256(1)), batch, 0, 1, address(0));
        _claim(1, batch, 0, 1, ALICE);
        vm.prank(PLATFORM); vm.expectRevert(E.InvalidLifecycleState.selector);
        escrow.claim(bytes32(uint256(2)), batch, 0, 1, BOB);
        require(escrow.nextEligibleAt(BOB) == 0, "loser not charged");
        _conserved();
    }

    function testClaimReplayAndConflictingPayload() public {
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        require(_claim(1, batch, 0, 1, ALICE) == voucher, "replay bypass cooldown");
        vm.prank(PLATFORM); vm.expectRevert(C.RequestConflict.selector);
        escrow.claim(bytes32(uint256(1)), batch, 1, 1, ALICE);
        vm.warp(START + 8000); escrow.expire(voucher);
        require(_claim(1, batch, 0, 1, ALICE) == voucher, "replay does not revive expired voucher");
        require(escrow.getVoucher(voucher).status == E.Status.Expired, "expired remains expired");
        _conserved();
    }

    function testUnlistedClosedFundingAndOutsideHoursStillClaim() public {
        vm.prank(OWNER); escrow.setListed(bytes32(uint256(3)), STORE, MEAL, 1, false);
        vm.warp(START + 2 days + 11 hours); // 22:00, also after funding deadline.
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        E.RedemptionPermit memory permit = _permit(voucher, OWNER);
        bytes memory signature = _sign(permit);
        vm.prank(OWNER); vm.expectRevert(E.OutsideServiceWindow.selector);
        escrow.redeem(bytes32(uint256(4)), voucher, 1, permit, signature);
        _conserved();
    }

    function testLazyExpiryReturnsOriginalUnitWithNewGeneration() public {
        bytes32 oldVoucher = _claim(1, batch, 0, 1, ALICE);
        vm.warp(START + 7200);
        bytes32 replacement = _claim(2, batch, 0, 2, BOB);
        require(oldVoucher != replacement, "voucher never reused");
        require(escrow.getVoucher(oldVoucher).status == E.Status.Expired, "old voucher invalidated");
        require(escrow.getVoucher(replacement).termsHash == escrow.getBatch(batch).termsHash, "same original terms");
        E.Accounting memory a = escrow.accounting();
        require(a.claimedQuantity == 1 && a.availableQuantity == 24 && a.fundedQuantity == 25, "not new donation");
        E.RedemptionPermit memory oldPermit = E.RedemptionPermit(oldVoucher, 1, OWNER, START, START + 120);
        bytes memory oldSignature = _sign(oldPermit);
        vm.prank(OWNER); vm.expectRevert(E.GenerationMismatch.selector);
        escrow.redeem(bytes32(uint256(3)), oldVoucher, 1, oldPermit, oldSignature);
        _conserved();
    }

    function testExpiryBoundaryAndAnyoneMayExpire() public {
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        vm.warp(START + 7199); vm.expectRevert(E.VoucherNotExpired.selector); escrow.expire(voucher);
        vm.warp(START + 7200);
        E.RedemptionPermit memory permit = E.RedemptionPermit(voucher, 1, OWNER, START + 7100, START + 7200);
        bytes memory signature = _sign(permit);
        vm.prank(OWNER); vm.expectRevert(E.VoucherExpired.selector);
        escrow.redeem(bytes32(uint256(3)), voucher, 1, permit, signature);
        vm.prank(BOB); escrow.expire(voucher);
        vm.expectRevert(E.InvalidLifecycleState.selector); escrow.expire(voucher);
        _conserved();
    }

    function testWrongOwnerCannotUseValidPermit() public {
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        E.RedemptionPermit memory permit = _permit(voucher, OWNER);
        bytes memory signature = _sign(permit);
        vm.prank(OWNER2); vm.expectRevert(C.UnauthorizedOwner.selector);
        escrow.redeem(bytes32(uint256(3)), voucher, 1, permit, signature);
        _conserved();
    }

    function testMissingOrWrongAuthoritySignatureRejected() public {
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        E.RedemptionPermit memory permit = _permit(voucher, OWNER);
        vm.prank(OWNER); vm.expectRevert(); escrow.redeem(bytes32(uint256(3)), voucher, 1, permit, hex"");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xbad, escrow.redemptionDigest(permit));
        vm.prank(OWNER); vm.expectRevert(E.InvalidPermit.selector);
        escrow.redeem(bytes32(uint256(3)), voucher, 1, permit, abi.encodePacked(r, s, v));
    }

    function testPermitBindsOwnerVoucherAndGeneration() public {
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        E.RedemptionPermit memory permit = _permit(voucher, OWNER2);
        bytes memory signature = _sign(permit);
        vm.prank(OWNER); vm.expectRevert(E.InvalidPermit.selector);
        escrow.redeem(bytes32(uint256(3)), voucher, 1, permit, signature);
        permit.owner = OWNER; permit.generation = 2; signature = _sign(permit);
        vm.prank(OWNER); vm.expectRevert(E.InvalidPermit.selector);
        escrow.redeem(bytes32(uint256(3)), voucher, 1, permit, signature);
        permit.generation = 1; permit.voucherId = keccak256("not original"); signature = _sign(permit);
        vm.prank(OWNER); vm.expectRevert(E.InvalidPermit.selector);
        escrow.redeem(bytes32(uint256(3)), voucher, 1, permit, signature);
    }

    function testPermitLifetimeFutureIssuedAndExpiryBounds() public {
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        E.RedemptionPermit memory permit = _permit(voucher, OWNER);
        permit.deadline++; bytes memory signature = _sign(permit);
        vm.prank(OWNER); vm.expectRevert(E.InvalidPermit.selector);
        escrow.redeem(bytes32(uint256(3)), voucher, 1, permit, signature);
        permit = _permit(voucher, OWNER); permit.issuedAt++; signature = _sign(permit);
        vm.prank(OWNER); vm.expectRevert(E.InvalidPermit.selector);
        escrow.redeem(bytes32(uint256(3)), voucher, 1, permit, signature);
        vm.warp(START + 7190); permit = _permit(voucher, OWNER); permit.deadline++; signature = _sign(permit);
        vm.prank(OWNER); vm.expectRevert(E.InvalidPermit.selector);
        escrow.redeem(bytes32(uint256(3)), voucher, 1, permit, signature);
    }

    function testPermitAt120SecondsExpired() public {
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        E.RedemptionPermit memory permit = _permit(voucher, OWNER);
        bytes memory signature = _sign(permit);
        vm.warp(START + 120);
        vm.prank(OWNER); vm.expectRevert(E.InvalidPermit.selector);
        escrow.redeem(bytes32(uint256(3)), voucher, 1, permit, signature);
    }

    function testPermitMatchesCanonicalEIP712Encoding() public {
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        E.RedemptionPermit memory permit = _permit(voucher, OWNER);
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("MealForwardProductRedemption"), keccak256("2"), block.chainid, address(escrow)));
        bytes32 payload = keccak256(abi.encode(escrow.REDEMPTION_TYPEHASH(), permit.voucherId,
            permit.generation, permit.owner, permit.issuedAt, permit.deadline));
        bytes32 expected = keccak256(abi.encodePacked(hex"1901", domain, payload));
        require(escrow.redemptionDigest(permit) == expected, "typed data must match frontend encoder");
    }

    function testOriginalVersionWindowsAndPriceSurviveEdit() public {
        C.TermsInput memory changed = _terms(9_000_000);
        changed.startMinute0 = 720; // New window starts at noon, old at 11:00.
        vm.prank(OWNER); escrow.publish(bytes32(uint256(3)), STORE, MEAL, 1, changed, 10, START + 1 days);
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        _redeem(voucher, OWNER, 4); vm.warp(START + 180); _settle(voucher, OWNER, 5);
        require(token.balanceOf(OWNER) == PRICE, "old price payout");
        _conserved();
    }

    function testServiceWindowEndIsExclusive() public {
        vm.warp(START + 2 hours); // Claim at 13:00, expires at 15:00.
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        vm.warp(START + 3 hours); // 14:00 ends first window.
        E.RedemptionPermit memory permit = _permit(voucher, OWNER);
        bytes memory signature = _sign(permit);
        vm.prank(OWNER); vm.expectRevert(E.OutsideServiceWindow.selector);
        escrow.redeem(bytes32(uint256(3)), voucher, 1, permit, signature);
    }

    function testHandoverReplayAndSettlement180BoundarySinglePayout() public {
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        E.RedemptionPermit memory permit = _permit(voucher, OWNER);
        bytes memory signature = _sign(permit);
        vm.prank(OWNER); escrow.redeem(bytes32(uint256(3)), voucher, 1, permit, signature);
        vm.warp(START + 179);
        vm.prank(OWNER); escrow.redeem(bytes32(uint256(3)), voucher, 1, permit, signature);
        require(escrow.getVoucher(voucher).settlementAvailableAt == START + 180, "replay never resets delay");
        vm.prank(OWNER); vm.expectRevert(E.SettlementTooEarly.selector); escrow.settle(bytes32(uint256(4)), voucher, 1);
        vm.warp(START + 180); _settle(voucher, OWNER, 4); _settle(voucher, OWNER, 4);
        require(token.balanceOf(OWNER) == PRICE, "single payout");
        vm.prank(OWNER); vm.expectRevert(E.InvalidLifecycleState.selector); escrow.settle(bytes32(uint256(5)), voucher, 1);
        _conserved();
    }

    function testHandedOverCannotExpireReclaimOrUseAgain() public {
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        _redeem(voucher, OWNER, 3);
        vm.warp(START + 8000);
        vm.expectRevert(E.InvalidLifecycleState.selector); escrow.expire(voucher);
        vm.prank(PLATFORM); vm.expectRevert(E.InvalidLifecycleState.selector);
        escrow.claim(bytes32(uint256(2)), batch, 0, 2, BOB);
        vm.prank(OWNER2); vm.expectRevert(C.UnauthorizedOwner.selector); escrow.settle(bytes32(uint256(3)), voucher, 1);
        _settle(voucher, OWNER, 4); _conserved();
    }

    function testSettlementTransferFailureKeepsObligation() public {
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        _redeem(voucher, OWNER, 3); vm.warp(START + 180);
        token.rejectForTest();
        vm.prank(OWNER); vm.expectRevert(); escrow.settle(bytes32(uint256(4)), voucher, 1);
        require(escrow.getVoucher(voucher).status == E.Status.HandedOver, "settlement rollback");
        require(!escrow.getRequest(OWNER, bytes32(uint256(4))).exists, "request rollback");
        _conserved();
    }

    function testMultiStoreDifferentPricesSettleToCorrectOwners() public {
        bytes32 otherBatch = _fund(STORE2, 2, 1, 2 * PRICE);
        bytes32 a = _claim(1, batch, 0, 1, ALICE);
        bytes32 b = _claim(2, otherBatch, 0, 1, BOB);
        _redeem(a, OWNER, 3); _redeem(b, OWNER2, 3);
        vm.warp(START + 180); _settle(a, OWNER, 4); _settle(b, OWNER2, 4);
        require(token.balanceOf(OWNER) == PRICE && token.balanceOf(OWNER2) == 2 * PRICE, "owner original amount");
        _conserved();
    }

    function testFuzzLazyExpiryAndSettlementConservation(uint256 rawIndex, bool expireFirst) public {
        uint256 index = rawIndex % 25;
        bytes32 voucher = _claim(1, batch, index, 1, ALICE);
        if (expireFirst) {
            vm.warp(START + 7200);
            voucher = _claim(2, batch, index, 2, BOB);
        }
        _conserved(); _redeem(voucher, OWNER, 3); _conserved();
        vm.warp(block.timestamp + 180); _settle(voucher, OWNER, 4); _conserved();
        require(token.balanceOf(OWNER) == PRICE, "one original unit settled");
    }

    function _close(bytes32 store, address owner, uint256 requestId) private {
        vm.prank(owner); escrow.closeStore(bytes32(requestId), store);
    }

    function testClosureImmediatelyCancelsClaimAndUnclaimedUnitsWithoutReturningPool() public {
        bytes32 voucher = _claim(1, batch, 0, 1, ALICE);
        E.RedemptionPermit memory permit = _permit(voucher, OWNER);
        bytes memory signature = _sign(permit); // A prepared short-lived permit is not handover.
        _close(STORE, OWNER, 3);
        require(escrow.storeClosed(STORE), "permanent closed flag");
        require(escrow.getVoucher(voucher).status == E.Status.Cancelled, "held voucher cancelled immediately");
        require(escrow.getUnit(batch, 0).status == E.Status.Cancelled, "claimed unit cancelled");
        require(escrow.getUnit(batch, 24).status == E.Status.Cancelled, "unclaimed unit cancelled");
        require(escrow.nextEligibleAt(ALICE) == 0, "unused claim releases current cooldown");
        E.Accounting memory a = escrow.accounting();
        require(a.claimedQuantity == 0 && a.availableQuantity == 0 && a.refundPendingQuantity == 25, "all unused pending");
        require(a.refundPendingAmount == 25 * PRICE && a.liability == 25 * PRICE, "not yet refunded");
        vm.prank(OWNER); vm.expectRevert(C.StoreIsClosed.selector);
        escrow.redeem(bytes32(uint256(4)), voucher, 1, permit, signature);
        vm.prank(PLATFORM); vm.expectRevert(C.StoreIsClosed.selector);
        escrow.claim(bytes32(uint256(2)), batch, 1, 1, BOB);
        vm.warp(START + 7200); vm.expectRevert(C.StoreIsClosed.selector); escrow.expire(voucher);
        require(_claim(1, batch, 0, 1, ALICE) == voucher, "original claim lookup remains idempotent");
        require(escrow.getVoucher(voucher).status == E.Status.Cancelled, "replay cannot revive voucher");
        _conserved();
    }

    function testClosedStoreRejectsFundingPublicationSupplementAndRelisting() public {
        _close(STORE, OWNER, 3);
        C.TermsInput memory terms = _terms(PRICE);
        F.FundingRequest memory request = F.FundingRequest(bytes32(uint256(2)), STORE, MEAL, 1,
            escrow.getTerms(STORE, MEAL, 1).termsHash, 1, PRICE, START + 1 days);
        vm.prank(DONOR); vm.expectRevert(C.StoreIsClosed.selector); escrow.fund(request);
        vm.prank(OWNER); vm.expectRevert(C.StoreIsClosed.selector);
        escrow.publish(bytes32(uint256(4)), STORE, MEAL, 1, terms, 1, START + 1 days);
        vm.prank(OWNER); vm.expectRevert(C.StoreIsClosed.selector);
        escrow.supplement(bytes32(uint256(4)), STORE, MEAL, 1, 1, START + 1 days);
        vm.prank(OWNER); vm.expectRevert(C.StoreIsClosed.selector);
        escrow.setListed(bytes32(uint256(4)), STORE, MEAL, 1, true);
        require(escrow.availableQuantity(STORE, MEAL, 1) == 0 && !escrow.getOffer(STORE, MEAL, 1).listed, "closed public offer");
        require(escrow.getTerms(STORE, MEAL, 1).value.unitPrice == PRICE, "terms preserved");
        _conserved();
    }

    function testClosureOwnerRequestAndRepeatedClosureAreBound() public {
        vm.prank(DONOR); vm.expectRevert(C.UnauthorizedOwner.selector); escrow.closeStore(bytes32(uint256(2)), STORE);
        vm.prank(OWNER2); vm.expectRevert(C.UnauthorizedOwner.selector); escrow.closeStore(bytes32(uint256(3)), STORE);
        _close(STORE, OWNER, 3); _close(STORE, OWNER, 3); _close(STORE, OWNER, 4);
        require(escrow.accounting().refundPendingQuantity == 25, "closure counted once");
        vm.prank(OWNER); vm.expectRevert(C.RequestConflict.selector); escrow.closeStore(bytes32(uint256(3)), STORE2);
        _conserved();
    }

    function testClosureCannotClearLaterOtherStoreClaimCooldown() public {
        bytes32 other = _fund(STORE2, 2, 2, PRICE * 2);
        _claim(1, batch, 0, 1, ALICE);
        vm.warp(START + 7200);
        bytes32 later = _claim(2, other, 0, 1, ALICE);
        _close(STORE, OWNER, 3);
        require(escrow.nextEligibleAt(ALICE) == START + 14400, "later other store cooldown preserved");
        require(escrow.getVoucher(later).status == E.Status.Claimed, "other store voucher preserved");
        vm.prank(PLATFORM); vm.expectRevert(E.ClaimCooldown.selector);
        escrow.claim(bytes32(uint256(3)), other, 1, 1, ALICE);
        _conserved();
    }

    function testCancelledLatestVoucherAllowsImmediateClaimElsewhere() public {
        bytes32 other = _fund(STORE2, 2, 2, PRICE * 2);
        _claim(1, batch, 0, 1, ALICE);
        _close(STORE, OWNER, 3);
        _claim(2, other, 0, 1, ALICE);
        require(escrow.nextEligibleAt(ALICE) == START + 7200, "new eligibility belongs to other store");
        _close(STORE, OWNER, 4);
        require(escrow.nextEligibleAt(ALICE) == START + 7200, "repeated closure cannot erase new eligibility");
        _conserved();
    }

    function testRefundPreservesDeliveredAndSettledAndPaysOriginalPayerOnce() public {
        _fund(STORE2, 2, 2, PRICE * 2);
        bytes32 handed = _claim(1, batch, 0, 1, ALICE);
        bytes32 unused = _claim(2, batch, 1, 1, BOB);
        bytes32 settled = _claim(3, batch, 2, 1, address(0x403));
        _redeem(handed, OWNER, 3); _redeem(settled, OWNER, 4);
        vm.warp(START + 180); _settle(settled, OWNER, 5);
        _close(STORE, OWNER, 6);
        require(escrow.getVoucher(handed).status == E.Status.HandedOver, "handover survives");
        require(escrow.getVoucher(settled).status == E.Status.Settled, "settled survives");
        require(escrow.getVoucher(unused).status == E.Status.Cancelled, "unused cancelled");
        require(escrow.nextEligibleAt(ALICE) == START + 7200, "fulfilled cooldown preserved");
        require(escrow.accounting().refundPendingQuantity == 23, "only unused pending");
        uint256 payerBefore = token.balanceOf(DONOR);
        vm.prank(OWNER); uint256 amount = escrow.refundBatch(bytes32(uint256(7)), batch);
        require(amount == PRICE * 23 && token.balanceOf(DONOR) == payerBefore + amount, "exact original payer");
        require(token.balanceOf(OWNER) == PRICE, "refund not to merchant");
        _settle(handed, OWNER, 8);
        vm.prank(OWNER); require(escrow.refundBatch(bytes32(uint256(7)), batch) == amount, "request replay");
        vm.prank(DONOR); require(escrow.refundBatch(bytes32(uint256(3)), batch) == amount, "batch replay by payer");
        require(token.balanceOf(DONOR) == payerBefore + amount, "one refund only");
        require(token.balanceOf(OWNER) == 2 * PRICE, "closed merchant can settle original handover");
        E.Accounting memory a = escrow.accounting();
        require(a.refundPendingQuantity == 0 && a.refundedQuantity == 23 && a.availableQuantity == 2 && a.settledQuantity == 2, "separate destinations");
        E.BatchAccounting memory b = escrow.getBatchAccounting(batch);
        require(b.claimedQuantity == 0 && b.refundedQuantity == 23 && b.settledQuantity == 2, "batch counters");
        _close(STORE, OWNER, 9); // Repeating closure after payouts must not recreate a liability.
        _conserved();
    }

    function testRefundRequiresClosedStoreAndOwnerOrOriginalPayer() public {
        vm.prank(OWNER); vm.expectRevert(E.StoreNotClosed.selector); escrow.refundBatch(bytes32(uint256(3)), batch);
        _close(STORE, OWNER, 3);
        vm.prank(OWNER2); vm.expectRevert(E.UnauthorizedRefund.selector); escrow.refundBatch(bytes32(uint256(3)), batch);
        vm.prank(ALICE); vm.expectRevert(E.UnauthorizedRefund.selector); escrow.refundBatch(bytes32(uint256(3)), batch);
        vm.prank(DONOR); escrow.refundBatch(bytes32(uint256(2)), batch);
        require(escrow.batchRefunded(batch), "payer can trigger own refund");
        vm.prank(DONOR); vm.expectRevert(C.RequestConflict.selector);
        escrow.refundBatch(bytes32(uint256(2)), keccak256("different batch"));
        _conserved();
    }

    function testRefundFailureRollsBackThenOriginalRequestCanComplete() public {
        _claim(1, batch, 0, 1, ALICE);
        _close(STORE, OWNER, 3);
        token.rejectForTest();
        vm.prank(OWNER); vm.expectRevert(); escrow.refundBatch(bytes32(uint256(4)), batch);
        require(!escrow.batchRefunded(batch) && !escrow.getRequest(OWNER, bytes32(uint256(4))).exists, "refund rollback");
        require(escrow.accounting().refundPendingAmount == 25 * PRICE, "failed transfer retains obligation");
        require(escrow.getVoucher(escrow.getUnit(batch, 0).voucherId).status == E.Status.Cancelled, "failure does not reopen store");
        _conserved();
        token.acceptForTest(); vm.prank(OWNER); escrow.refundBatch(bytes32(uint256(4)), batch);
        _conserved();
    }

    function testInexactRefundRollsBackTokenAndAccounting() public {
        _close(STORE, OWNER, 3);
        uint256 beforePayer = token.balanceOf(DONOR);
        token.enableFeeForTest();
        vm.prank(OWNER); vm.expectRevert(F.InexactTransfer.selector); escrow.refundBatch(bytes32(uint256(4)), batch);
        require(token.balanceOf(DONOR) == beforePayer && !escrow.batchRefunded(batch), "inexact transfer rollback");
        require(!escrow.getRequest(OWNER, bytes32(uint256(4))).exists, "inexact request not consumed");
        _conserved();
    }

    function testRefundReentrancyCannotDoublePay() public {
        _close(STORE, OWNER, 3);
        token.setCallbackForTest(address(escrow), abi.encodeCall(E.refundBatch, (bytes32(uint256(99)), batch)));
        uint256 beforePayer = token.balanceOf(DONOR);
        vm.prank(OWNER); escrow.refundBatch(bytes32(uint256(4)), batch);
        require(token.callbackAttempted() && !token.callbackSucceeded(), "reentry blocked");
        require(token.callbackError() == bytes4(keccak256("ReentrancyGuardReentrantCall()")), "guard stops callback before authority logic");
        require(token.balanceOf(DONOR) == beforePayer + 25 * PRICE, "single exact refund");
        _conserved();
    }

    function testExpiredAndReclaimedGenerationCountersRemainConservedOnClosure() public {
        bytes32 old = _claim(1, batch, 0, 1, ALICE);
        vm.warp(START + 7200);
        bytes32 next = _claim(2, batch, 0, 2, BOB);
        require(escrow.getBatchAccounting(batch).claimedQuantity == 1, "lazy expire decremented batch");
        _close(STORE, OWNER, 3);
        require(escrow.getVoucher(old).status == E.Status.Expired, "old expiry history retained");
        require(escrow.getVoucher(next).status == E.Status.Cancelled, "new generation cancelled");
        require(escrow.getBatchAccounting(batch).refundPendingQuantity == 25, "not counted twice");
        vm.prank(DONOR); escrow.refundBatch(bytes32(uint256(2)), batch);
        _conserved();
    }

    function testClosureAndRefundAreConstantTimeForHugeBatch() public {
        uint256 huge = 1_000_000_000;
        vm.prank(OWNER); escrow.supplement(bytes32(uint256(3)), STORE, MEAL, 1, huge, START + 1 days);
        bytes32 large = _fund(STORE, 2, huge, PRICE);
        _claim(1, large, huge - 1, 1, ALICE);
        uint256 beforeGas = gasleft();
        _close(STORE, OWNER, 4);
        require(beforeGas - gasleft() < 300_000, "closure cannot loop batch quantity");
        beforeGas = gasleft();
        vm.prank(OWNER); escrow.refundBatch(bytes32(uint256(5)), large);
        require(beforeGas - gasleft() < 500_000, "refund cannot loop batch quantity");
        require(escrow.accounting().refundPendingQuantity == 25, "other batch remains pending");
        vm.prank(OWNER); escrow.refundBatch(bytes32(uint256(6)), batch);
        _conserved();
    }

    function testFuzzClosureRefundConservation(uint256 rawIndex, bool handover, bool settleFirst) public {
        bytes32 voucher = _claim(1, batch, rawIndex % 25, 1, ALICE);
        if (handover) {
            _redeem(voucher, OWNER, 3);
            if (settleFirst) { vm.warp(START + 180); _settle(voucher, OWNER, 4); }
        }
        _conserved(); _close(STORE, OWNER, 5); _conserved();
        vm.prank(OWNER); escrow.refundBatch(bytes32(uint256(6)), batch); _conserved();
        if (handover && !settleFirst) { vm.warp(START + 180); _settle(voucher, OWNER, 7); }
        _conserved();
        require(escrow.accounting().refundedQuantity == (handover ? 24 : 25), "refund exact unused portion count");
    }


    function testFullyDeliveredClosedBatchRefundsZeroAndStillSettles() public {
        bytes32 other = _fund(STORE2, 2, 1, PRICE * 2);
        bytes32 voucher = _claim(1, other, 0, 1, ALICE);
        _redeem(voucher, OWNER2, 3); _close(STORE2, OWNER2, 4);
        require(escrow.accounting().refundPendingAmount == 0, "no unused liability");
        token.rejectForTest(); // A zero refund must not require a token transfer.
        vm.prank(OWNER2); require(escrow.refundBatch(bytes32(uint256(5)), other) == 0, "zero refund");
        require(escrow.batchRefunded(other) && escrow.getBatchAccounting(other).handedOverQuantity == 1, "delivery untouched");
        token.acceptForTest(); vm.warp(START + 180); _settle(voucher, OWNER2, 6);
        require(token.balanceOf(OWNER2) == PRICE * 2, "pending delivery paid after zero refund");
        _conserved();
    }

    function testDifferentVersionsAndPayersRefundEachOriginalPriceAndAddress() public {
        address payer2 = address(0x202);
        token.mint(payer2, 1e12);
        vm.prank(payer2); token.approve(address(escrow), type(uint256).max);
        vm.prank(OWNER); escrow.publish(bytes32(uint256(3)), STORE, MEAL, 1, _terms(PRICE * 3), 5, START + 1 days);
        bytes32 hash = escrow.getTerms(STORE, MEAL, 2).termsHash;
        F.FundingRequest memory r = F.FundingRequest(bytes32(uint256(2)), STORE, MEAL, 2, hash, 2, 6 * PRICE, START + 1 days);
        vm.prank(DONOR); bytes32 newBatch = escrow.fund(r);
        r.requestId = bytes32(uint256(1)); r.quantity = 3; r.expectedAmount = 9 * PRICE;
        vm.prank(payer2); bytes32 thirdBatch = escrow.fund(r);
        bytes32 voucher = _claim(1, newBatch, 1, 1, ALICE);
        _redeem(voucher, OWNER, 4); _close(STORE, OWNER, 5);
        require(escrow.accounting().refundPendingAmount == 37 * PRICE, "original mixed prices");
        uint256 donorBefore = token.balanceOf(DONOR);
        uint256 payer2Before = token.balanceOf(payer2);
        vm.prank(OWNER); escrow.refundBatch(bytes32(uint256(6)), batch);
        require(escrow.accounting().refundPendingAmount == 12 * PRICE, "first batch only");
        vm.prank(DONOR); escrow.refundBatch(bytes32(uint256(3)), newBatch);
        vm.prank(OWNER); escrow.refundBatch(bytes32(uint256(7)), thirdBatch);
        require(token.balanceOf(DONOR) == donorBefore + 28 * PRICE, "original and new donor batches");
        require(token.balanceOf(payer2) == payer2Before + 9 * PRICE, "other original payer");
        vm.warp(START + 180); _settle(voucher, OWNER, 8);
        require(token.balanceOf(OWNER) == 3 * PRICE, "new version fulfilled original promise");
        E.Accounting memory a = escrow.accounting();
        require(a.fundedQuantity == 30 && a.refundedQuantity == 29 && a.settledQuantity == 1 && a.liability == 0, "all obligations fulfilled");
        _conserved();
    }

}
