// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ProductCatalog as C} from "../contracts/ProductCatalog.sol";
import {ProductFunding as F} from "../contracts/ProductFunding.sol";
import {ProductEscrow as E} from "../contracts/ProductEscrow.sol";

interface ReviewVm {
    function prank(address) external;
    function warp(uint256) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function expectRevert(bytes4) external;
}

/// Independent adversarial fixture: the token itself can be the authorized payer.
contract ClosureReviewToken is ERC20 {
    address public attackTarget;
    bytes public attackPayload;
    bool public attackAttempted;
    bool public attackSucceeded;
    bytes4 public attackError;
    uint256 public mode;
    constructor() ERC20("Review only", "REVIEW") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function configure(uint256 value, address target, bytes calldata payload) external {
        mode = value; attackTarget = target; attackPayload = payload;
    }
    function fundSelf(E escrow, F.FundingRequest calldata request) external returns (bytes32) {
        _mint(address(this), request.expectedAmount);
        _approve(address(this), address(escrow), request.expectedAmount);
        return escrow.fund(request);
    }
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (mode == 1) return false;
        if (mode == 2 && amount != 0) {
            _burn(msg.sender, 1);
            return super.transfer(to, amount - 1);
        }
        if (attackTarget != address(0)) {
            attackAttempted = true;
            (bool ok, bytes memory result) = attackTarget.call(attackPayload);
            attackSucceeded = ok;
            if (result.length >= 4) attackError = bytes4(result);
        }
        return super.transfer(to, amount);
    }
}

/// Bounded local candidate review; this is not a deployment audit.
contract ProductClosureReviewTest {
    ReviewVm constant vm = ReviewVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant PLATFORM = address(0x5050);
    uint256 constant VERIFIER_KEY = 0x9191;
    bytes32 constant MEAL = keccak256("review-meal");
    ClosureReviewToken token;
    E escrow;
    bytes32[] batches;
    bytes32[] stores;
    bytes32[] vouchers;
    uint256 sequence;

    function setUp() public {
        vm.warp(20000 days + 3 hours);
        token = new ClosureReviewToken();
        escrow = new E(token, PLATFORM, vm.addr(VERIFIER_KEY), 7200);
        for (uint256 i; i < 3; ++i) {
            bytes32 store = keccak256(abi.encode("review-store", i));
            stores.push(store);
            _publish(store, address(uint160(0x6000 + i)), 0, i + 3, 12);
            batches.push(_fund(store, 1, address(uint160(0x7000 + i)), 12, i + 3));
        }
        // Another immutable price at the first store, with a different payer.
        _publish(stores[0], address(0x6000), 1, 17, 12);
        batches.push(_fund(stores[0], 2, address(0x7010), 12, 17));
    }

    function _id() private returns (bytes32) { return bytes32(++sequence); }
    function _publish(bytes32 store, address owner, uint256 previous, uint256 price, uint256 quantity) private {
        if (previous == 0) { bytes32 registrationId = _id(); vm.prank(owner); escrow.registerStore(registrationId, store); }
        C.TermsInput memory t = C.TermsInput(price, keccak256("description"), keccak256("image"), 1, 0, 1440, 0, 0);
        bytes32 id = _id(); vm.prank(owner);
        escrow.publish(id, store, MEAL, previous, t, quantity, block.timestamp + 100 days);
    }
    function _fund(bytes32 store, uint256 version, address payer, uint256 quantity, uint256 price) private returns (bytes32) {
        token.mint(payer, quantity * price);
        vm.prank(payer); token.approve(address(escrow), quantity * price);
        F.FundingRequest memory r = F.FundingRequest(_id(), store, MEAL, version, escrow.getTerms(store, MEAL, version).termsHash, quantity, quantity * price, block.timestamp + 100 days);
        vm.prank(payer); return escrow.fund(r);
    }
    function _call(address sender, bytes memory data) private returns (bool ok, bytes memory result) {
        vm.prank(sender); (ok, result) = address(escrow).call(data);
    }
    function _redeem(bytes32 id) private {
        E.Voucher memory v = escrow.getVoucher(id);
        F.Batch memory batch = escrow.getBatch(v.batchId);
        address owner = escrow.storeOwner(batch.storeId);
        uint256 deadline = block.timestamp + 120;
        if (deadline > v.expiresAt) deadline = v.expiresAt;
        E.RedemptionPermit memory p = E.RedemptionPermit(id, v.generation, owner, block.timestamp, deadline);
        (uint8 signV, bytes32 r, bytes32 s) = vm.sign(VERIFIER_KEY, escrow.redemptionDigest(p));
        _call(owner, abi.encodeCall(E.redeem, (_id(), id, v.generation, p, abi.encodePacked(r, s, signV))));
    }
    function _claimRandom(bytes32 batchId, uint256 seed) private {
        uint256 index = (seed >> 16) % escrow.getBatch(batchId).quantity;
        uint256 generation = escrow.getUnit(batchId, index).generation + 1;
        address recipient = address(uint160(0x8000 + (seed >> 24) % 8));
        (bool ok, bytes memory out) = _call(PLATFORM, abi.encodeCall(E.claim, (_id(), batchId, index, generation, recipient)));
        if (ok) vouchers.push(abi.decode(out, (bytes32)));
    }
    function _assertAll(uint256 extra) private view {
        uint256[6] memory q;
        uint256[6] memory amount;
        for (uint256 i; i < batches.length; ++i) {
            F.Batch memory b = escrow.getBatch(batches[i]);
            uint256[6] memory local;
            for (uint256 j; j < b.quantity; ++j) {
                E.Status status = escrow.getUnit(batches[i], j).status;
                uint256 bucket = uint256(status);
                if (status == E.Status.Cancelled) bucket = escrow.batchRefunded(batches[i]) ? 5 : 4;
                require(status != E.Status.Expired, "unit cannot be historical Expired");
                ++local[bucket]; ++q[bucket]; amount[bucket] += b.unitPrice;
            }
            E.BatchAccounting memory bc = escrow.getBatchAccounting(batches[i]);
            require(bc.claimedQuantity == local[1] && bc.handedOverQuantity == local[2] && bc.settledQuantity == local[3], "batch live buckets");
            require(bc.refundPendingQuantity == local[4] && bc.refundedQuantity == local[5], "batch refund buckets");
            require(bc.claimedAmount == local[1] * b.unitPrice && bc.handedOverAmount == local[2] * b.unitPrice && bc.settledAmount == local[3] * b.unitPrice, "batch price");
            require(bc.refundPendingAmount == local[4] * b.unitPrice && bc.refundedAmount == local[5] * b.unitPrice, "batch refund price");
        }
        E.Accounting memory a = escrow.accounting();
        require(a.availableQuantity == q[0] && a.claimedQuantity == q[1] && a.handedOverQuantity == q[2] && a.settledQuantity == q[3] && a.refundPendingQuantity == q[4] && a.refundedQuantity == q[5], "global quantities");
        require(a.availableAmount == amount[0] && a.claimedAmount == amount[1] && a.handedOverAmount == amount[2] && a.settledAmount == amount[3] && a.refundPendingAmount == amount[4] && a.refundedAmount == amount[5], "global amounts");
        require(a.fundedQuantity == q[0] + q[1] + q[2] + q[3] + q[4] + q[5], "quantity conservation");
        require(a.fundedAmount == amount[0] + amount[1] + amount[2] + amount[3] + amount[4] + amount[5], "amount conservation");
        require(a.liability == amount[0] + amount[1] + amount[2] + amount[4], "liability");
        require(token.balanceOf(address(escrow)) == a.liability + extra, "asset balance");
    }

    function testFuzzInterleavedGenerationsClosuresRefundsAndSettlements(uint256 seed) public {
        for (uint256 step; step < 64; ++step) {
            seed = uint256(keccak256(abi.encode(seed, step)));
            bytes32 batchId = batches[(seed >> 8) % batches.length];
            F.Batch memory b = escrow.getBatch(batchId);
            uint256 action = seed % 7;
            if (action == 0) {
                _claimRandom(batchId, seed);
            } else if (action == 1 && vouchers.length != 0) {
                _call(address(0x9000), abi.encodeCall(E.expire, (vouchers[(seed >> 32) % vouchers.length])));
            } else if (action == 2 && vouchers.length != 0) {
                _redeem(vouchers[(seed >> 32) % vouchers.length]);
            } else if (action == 3 && vouchers.length != 0) {
                bytes32 id = vouchers[(seed >> 32) % vouchers.length];
                E.Voucher memory v = escrow.getVoucher(id);
                address owner = escrow.storeOwner(escrow.getBatch(v.batchId).storeId);
                _call(owner, abi.encodeCall(E.settle, (_id(), id, v.generation)));
            } else if (action == 4 && step > 30) {
                _call(escrow.storeOwner(b.storeId), abi.encodeCall(E.closeStore, (_id(), b.storeId)));
            } else if (action == 5) {
                _call(seed & 0x100 == 0 ? b.payer : escrow.storeOwner(b.storeId), abi.encodeCall(E.refundBatch, (_id(), batchId)));
            } else if (action == 6) vm.warp(block.timestamp + (seed & 0x100 == 0 ? 180 : 7201));
            _assertAll(0);
        }
        for (uint256 i; i < stores.length; ++i) _call(escrow.storeOwner(stores[i]), abi.encodeCall(E.closeStore, (_id(), stores[i])));
        for (uint256 i; i < batches.length; ++i) _call(escrow.getBatch(batches[i]).payer, abi.encodeCall(E.refundBatch, (_id(), batches[i])));
        vm.warp(block.timestamp + 180);
        for (uint256 i; i < vouchers.length; ++i) {
            E.Voucher memory v = escrow.getVoucher(vouchers[i]);
            _call(escrow.storeOwner(escrow.getBatch(v.batchId).storeId), abi.encodeCall(E.settle, (_id(), vouchers[i], v.generation)));
        }
        _assertAll(0);
        require(escrow.liability() == 0, "all obligations can exit");
    }

    function testAuthorizedPayerReentryAndInexactAssetCannotConsumeRefundResponsibility() public {
        bytes32 store = stores[2]; address owner = escrow.storeOwner(store);
        bytes32 supplementId = _id(); vm.prank(owner); escrow.supplement(supplementId, store, MEAL, 1, 5, block.timestamp + 1 days);
        F.FundingRequest memory r = F.FundingRequest(_id(), store, MEAL, 1, escrow.getTerms(store, MEAL, 1).termsHash, 5, 25, block.timestamp + 1 days);
        bytes32 batch = token.fundSelf(escrow, r); batches.push(batch);
        _call(owner, abi.encodeCall(E.closeStore, (_id(), store)));
        bytes32 refundId = _id(); uint256 balance = token.balanceOf(address(token));
        token.configure(1, address(0), "");
        (bool failed,) = _call(owner, abi.encodeCall(E.refundBatch, (refundId, batch)));
        require(!failed && !escrow.batchRefunded(batch) && !escrow.getRequest(owner, refundId).exists, "false return must roll back");
        token.configure(2, address(0), "");
        (failed,) = _call(owner, abi.encodeCall(E.refundBatch, (refundId, batch)));
        require(!failed && token.balanceOf(address(token)) == balance && !escrow.batchRefunded(batch), "fee must roll back");
        token.configure(0, address(escrow), abi.encodeCall(E.refundBatch, (_id(), batch)));
        (bool ok,) = _call(owner, abi.encodeCall(E.refundBatch, (refundId, batch)));
        require(ok && token.attackAttempted() && !token.attackSucceeded(), "authorized payer reentry blocked");
        require(token.attackError() == bytes4(keccak256("ReentrancyGuardReentrantCall()")), "guard rather than authorization blocked callback");
        require(token.balanceOf(address(token)) == balance + 25, "one exact payment");
        _call(address(token), abi.encodeCall(E.refundBatch, (_id(), batch)));
        require(token.balanceOf(address(token)) == balance + 25, "new request cannot pay twice");
        _assertAll(0);
    }

    function _claimExact(bytes32 batchId, uint256 generation, address recipient) private returns (bytes32) {
        bytes32 id = _id(); vm.prank(PLATFORM); return escrow.claim(id, batchId, 0, generation, recipient);
    }
    function testThreeGenerationsAndClosingOldStoreCannotClearNewDeliveredCooldown() public {
        address recipient = address(0xA001);
        bytes32 first = _claimExact(batches[0], 1, recipient);
        vm.warp(escrow.getVoucher(first).expiresAt); escrow.expire(first);
        bytes32 second = _claimExact(batches[0], 2, recipient);
        vm.warp(escrow.getVoucher(second).expiresAt);
        bytes32 third = _claimExact(batches[0], 3, address(0xA002));
        bytes32 latest = _claimExact(batches[1], 1, recipient);
        uint256 eligible = escrow.nextEligibleAt(recipient);
        _redeem(latest);
        _call(escrow.storeOwner(stores[0]), abi.encodeCall(E.closeStore, (_id(), stores[0])));
        require(escrow.getVoucher(first).status == E.Status.Expired && escrow.getVoucher(second).status == E.Status.Expired, "historical generations preserved");
        require(escrow.getVoucher(third).status == E.Status.Cancelled && escrow.nextEligibleAt(address(0xA002)) == 0, "only current unused claim cancelled");
        require(escrow.nextEligibleAt(recipient) == eligible, "other-store handover cooldown kept");
        vm.warp(block.timestamp + 180);
        _call(escrow.storeOwner(stores[1]), abi.encodeCall(E.settle, (_id(), latest, 1)));
        _call(escrow.storeOwner(stores[1]), abi.encodeCall(E.closeStore, (_id(), stores[1])));
        _call(escrow.getBatch(batches[0]).payer, abi.encodeCall(E.refundBatch, (_id(), batches[0])));
        require(escrow.nextEligibleAt(recipient) == eligible && block.timestamp < eligible, "even own store closure cannot clear settled cooldown");
        _assertAll(0);
    }

    function testUntrackedDonationCannotBeSweptByClosureOrRepeatedRefund() public {
        token.mint(address(escrow), 123);
        for (uint256 i; i < stores.length; ++i) _call(escrow.storeOwner(stores[i]), abi.encodeCall(E.closeStore, (_id(), stores[i])));
        for (uint256 i; i < batches.length; ++i) {
            F.Batch memory b = escrow.getBatch(batches[i]); uint256 beforeBalance = token.balanceOf(b.payer);
            _call(b.payer, abi.encodeCall(E.refundBatch, (_id(), batches[i])));
            _call(escrow.storeOwner(b.storeId), abi.encodeCall(E.refundBatch, (_id(), batches[i])));
            require(token.balanceOf(b.payer) == beforeBalance + b.amount, "only originally funded amount returned");
        }
        _assertAll(123);require(escrow.liability() == 0, "donation is not a refund liability");
    }
}
