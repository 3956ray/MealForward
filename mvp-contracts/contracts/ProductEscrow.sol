// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ProductFunding} from "./ProductFunding.sol";

/// @notice Local development candidate; NOT approved for production deployment.
/// @dev Shared escrow enforces platform-wide wallet cooldown. Platform authorizes
/// claims after backend wallet login/explicit consent and pays gas; wallet addresses
/// are visible onchain. Permanent closure cancels unused portions; refunds return
/// each original funding batch to its original payer through an explicit transaction.
contract ProductEscrow is ProductFunding, EIP712 {
    using SafeERC20 for IERC20;

    uint256 public constant SETTLEMENT_DELAY = 180;
    uint256 public constant DISPLAY_LIFETIME = 120;
    bytes32 public constant VOUCHER_DOMAIN = keccak256("MealForwardProductVoucherV2");
    bytes32 public constant REDEMPTION_TYPEHASH = keccak256(
        "RedemptionPermit(bytes32 voucherId,uint256 generation,address owner,uint256 issuedAt,uint256 deadline)"
    );
    address public immutable claimAuthority;
    address public immutable redemptionAuthority;
    uint256 public immutable policySeconds;
    mapping(address => uint256) private _nextEligibleAt;
    mapping(address => bytes32) private _latestVoucher;

    enum Status { Available, Claimed, HandedOver, Settled, Expired, Cancelled }
    struct Unit {
        uint256 generation;
        bytes32 voucherId;
        Status status;
    }
    struct Voucher {
        bytes32 batchId;
        uint256 unitIndex;
        uint256 generation;
        address recipient;
        bytes32 termsHash;
        uint256 claimedAt;
        uint256 expiresAt;
        uint256 settlementAvailableAt;
        Status status;
    }
    struct RedemptionPermit {
        bytes32 voucherId;
        uint256 generation;
        address owner;
        uint256 issuedAt;
        uint256 deadline;
    }
    struct Accounting {
        uint256 fundedQuantity;
        uint256 availableQuantity;
        uint256 claimedQuantity;
        uint256 handedOverQuantity;
        uint256 settledQuantity;
        uint256 fundedAmount;
        uint256 availableAmount;
        uint256 claimedAmount;
        uint256 handedOverAmount;
        uint256 settledAmount;
        uint256 liability;
        uint256 refundPendingQuantity;
        uint256 refundPendingAmount;
        uint256 refundedQuantity;
        uint256 refundedAmount;
    }
    struct StoreLifecycle {
        uint256 claimedQuantity;
        uint256 claimedAmount;
        uint256 deliveredQuantity;
        uint256 deliveredAmount;
        uint256 settledQuantity;
        uint256 settledAmount;
        uint256 refundedQuantity;
        uint256 refundedAmount;
    }
    struct BatchLifecycle {
        uint256 claimedQuantity;
        uint256 handedOverQuantity;
        uint256 settledQuantity;
    }
    struct BatchAccounting {
        uint256 claimedQuantity;
        uint256 claimedAmount;
        uint256 handedOverQuantity;
        uint256 handedOverAmount;
        uint256 settledQuantity;
        uint256 settledAmount;
        uint256 refundPendingQuantity;
        uint256 refundPendingAmount;
        uint256 refundedQuantity;
        uint256 refundedAmount;
    }
    mapping(bytes32 => StoreLifecycle) private _storeLifecycle;
    mapping(bytes32 => BatchLifecycle) private _batchLifecycle;
    mapping(bytes32 => bool) public batchRefunded;
    uint256 private _refundPendingQuantity;
    uint256 private _refundPendingAmount;
    uint256 private _refundedQuantity;
    uint256 private _refundedAmount;
    mapping(bytes32 => Unit) private _units;
    mapping(bytes32 => Voucher) private _vouchers;
    uint256 private _claimedQuantity;
    uint256 private _handedOverQuantity;
    uint256 private _settledQuantity;
    uint256 private _claimedAmount;
    uint256 private _handedOverAmount;
    uint256 private _settledAmount;

    error InvalidPolicy();
    error UnauthorizedAuthority();
    error InvalidRecipient();
    error ClaimCooldown();
    error InvalidUnit();
    error GenerationMismatch();
    error InvalidVoucher();
    error InvalidLifecycleState();
    error VoucherExpired();
    error VoucherNotExpired();
    error OutsideServiceWindow();
    error InvalidPermit();
    error SettlementTooEarly();
    error StoreNotClosed();
    error UnauthorizedRefund();

    event StoreClosed(bytes32 indexed storeId, address indexed owner,
        uint256 refundPendingQuantity, uint256 refundPendingAmount);
    event BatchRefunded(bytes32 indexed batchId, bytes32 indexed storeId, address indexed payer,
        uint256 quantity, uint256 amount);
    event Claimed(bytes32 indexed voucherId, bytes32 indexed batchId, address indexed recipient,
        uint256 unitIndex, uint256 generation, bytes32 termsHash, uint256 expiresAt);
    event VoucherExpiredToPool(bytes32 indexed voucherId, bytes32 indexed batchId, uint256 unitIndex, uint256 generation);
    event HandedOver(bytes32 indexed voucherId, address indexed owner, uint256 settlementAvailableAt);
    event Settled(bytes32 indexed voucherId, address indexed owner, uint256 amount);

    constructor(IERC20 token, address issuer, address verifier, uint256 duration)
        ProductFunding(token) EIP712("MealForwardProductRedemption", "2")
    {
        if (issuer == address(0) || verifier == address(0) || (duration != 7200 && duration != 259200)) {
            revert InvalidPolicy();
        }
        claimAuthority = issuer;
        redemptionAuthority = verifier;
        policySeconds = duration;
    }

    function _requireLifecycleReady() internal view override {
        // Authorities/policy are constructor-validated and this concrete class
        // implements Claim, expiry, authorized handover and owner settlement.
        if (claimAuthority == address(0) || redemptionAuthority == address(0)) revert InvalidPolicy();
    }

    function _unitKey(bytes32 batchId, uint256 unitIndex) private pure returns (bytes32) {
        return keccak256(abi.encode(batchId, unitIndex));
    }

    function _batch(bytes32 batchId, uint256 unitIndex) private view returns (Batch memory batch) {
        batch = getBatch(batchId);
        if (batch.payer == address(0) || unitIndex >= batch.quantity) revert InvalidUnit();
    }

    function getUnit(bytes32 batchId, uint256 unitIndex) external view returns (Unit memory value) {
        Batch memory batch = _batch(batchId, unitIndex);
        value = _units[_unitKey(batchId, unitIndex)];
        if (storeClosed[batch.storeId] && (value.status == Status.Available || value.status == Status.Claimed)) {
            value.status = Status.Cancelled;
        }
    }

    function getVoucher(bytes32 voucherId) external view returns (Voucher memory value) {
        value = _vouchers[voucherId];
        if (value.status == Status.Claimed && storeClosed[getBatch(value.batchId).storeId]) {
            value.status = Status.Cancelled;
        }
    }

    /// @dev Only the latest unused voucher can release its wallet's current cooldown.
    /// Closing an older store cannot erase a subsequent claim at another store.
    function nextEligibleAt(address recipient) public view returns (uint256) {
        Voucher storage latest = _vouchers[_latestVoucher[recipient]];
        if (latest.status == Status.Claimed && storeClosed[getBatch(latest.batchId).storeId]) return 0;
        return _nextEligibleAt[recipient];
    }

    function getBatchAccounting(bytes32 batchId) public view returns (BatchAccounting memory value) {
        Batch memory batch = getBatch(batchId);
        if (batch.payer == address(0)) revert InvalidUnit();
        BatchLifecycle storage counters = _batchLifecycle[batchId];
        value.handedOverQuantity = counters.handedOverQuantity;
        value.settledQuantity = counters.settledQuantity;
        if (storeClosed[batch.storeId]) {
            uint256 unfulfilled = batch.quantity - value.handedOverQuantity - value.settledQuantity;
            if (batchRefunded[batchId]) value.refundedQuantity = unfulfilled;
            else value.refundPendingQuantity = unfulfilled;
        } else value.claimedQuantity = counters.claimedQuantity;
        value.claimedAmount = value.claimedQuantity * batch.unitPrice;
        value.handedOverAmount = value.handedOverQuantity * batch.unitPrice;
        value.settledAmount = value.settledQuantity * batch.unitPrice;
        value.refundPendingAmount = value.refundPendingQuantity * batch.unitPrice;
        value.refundedAmount = value.refundedQuantity * batch.unitPrice;
    }

    /// @notice Permanent, owner-authorized closure, independent of today's rest setting.
    /// Aggregates make closure constant-time even for arbitrarily large batches.
    function closeStore(bytes32 requestId, bytes32 storeId) external nonReentrant {
        bytes32 payload = keccak256(abi.encode(this.closeStore.selector, storeId));
        (bool exists,) = _original(requestId, payload);
        if (exists) return;
        _owner(storeId);
        StoreLifecycle storage counters = _storeLifecycle[storeId];
        if (!storeClosed[storeId]) {
            storeClosed[storeId] = true;
            _refundPendingQuantity += _storeFunding[storeId].quantity - counters.deliveredQuantity;
            _refundPendingAmount += _storeFunding[storeId].amount - counters.deliveredAmount;
            _claimedQuantity -= counters.claimedQuantity;
            _claimedAmount -= counters.claimedAmount;
            counters.claimedQuantity = 0;
            counters.claimedAmount = 0;
        }
        _complete(requestId, payload, storeId);
        emit StoreClosed(storeId, msg.sender,
            _storeFunding[storeId].quantity - counters.deliveredQuantity - counters.refundedQuantity,
            _storeFunding[storeId].amount - counters.deliveredAmount - counters.refundedAmount);
    }

    /// @notice Refund every unused portion of one closed-store batch to its original payer.
    /// Repeating a completed batch, including with a different request/caller, never transfers twice.
    function refundBatch(bytes32 requestId, bytes32 batchId) external nonReentrant returns (uint256 amount) {
        bytes32 payload = keccak256(abi.encode(this.refundBatch.selector, batchId));
        (bool exists, bytes32 original) = _original(requestId, payload);
        if (exists) return uint256(original);
        Batch memory batch = getBatch(batchId);
        if (batch.payer == address(0)) revert InvalidUnit();
        if (msg.sender != batch.payer && msg.sender != storeOwner[batch.storeId]) revert UnauthorizedRefund();
        if (!storeClosed[batch.storeId]) revert StoreNotClosed();
        BatchLifecycle storage counters = _batchLifecycle[batchId];
        uint256 quantity = batch.quantity - counters.handedOverQuantity - counters.settledQuantity;
        amount = quantity * batch.unitPrice;
        if (batchRefunded[batchId]) {
            _complete(requestId, payload, bytes32(amount));
            return amount;
        }
        uint256 beforeEscrow = asset.balanceOf(address(this));
        uint256 beforePayer = asset.balanceOf(batch.payer);
        if (beforeEscrow < liability()) revert Insolvent();
        batchRefunded[batchId] = true;
        _refundPendingQuantity -= quantity;
        _refundPendingAmount -= amount;
        _refundedQuantity += quantity;
        _refundedAmount += amount;
        _storeLifecycle[batch.storeId].refundedQuantity += quantity;
        _storeLifecycle[batch.storeId].refundedAmount += amount;
        _outstandingAmount -= amount;
        _complete(requestId, payload, bytes32(amount));
        if (amount != 0) {
            asset.safeTransfer(batch.payer, amount);
            if (asset.balanceOf(address(this)) != beforeEscrow - amount
                || asset.balanceOf(batch.payer) != beforePayer + amount) revert InexactTransfer();
        }
        emit BatchRefunded(batchId, batch.storeId, batch.payer, quantity, amount);
    }

    function accounting() external view returns (Accounting memory value) {
        value.fundedQuantity = totalFundedQuantity;
        value.availableQuantity = totalFundedQuantity - _claimedQuantity - _handedOverQuantity - _settledQuantity - _refundPendingQuantity - _refundedQuantity;
        value.claimedQuantity = _claimedQuantity;
        value.handedOverQuantity = _handedOverQuantity;
        value.settledQuantity = _settledQuantity;
        value.fundedAmount = totalFundedAmount;
        value.availableAmount = totalFundedAmount - _claimedAmount - _handedOverAmount - _settledAmount - _refundPendingAmount - _refundedAmount;
        value.claimedAmount = _claimedAmount;
        value.handedOverAmount = _handedOverAmount;
        value.settledAmount = _settledAmount;
        value.liability = liability();
        value.refundPendingQuantity = _refundPendingQuantity;
        value.refundPendingAmount = _refundPendingAmount;
        value.refundedQuantity = _refundedQuantity;
        value.refundedAmount = _refundedAmount;
    }

    /// @notice Constant-time accounting for one store, independent of unrelated stores.
    /// @dev Same ABI layout and conservation rules as accounting(). Unknown stores return zero.
    function getStoreAccounting(bytes32 storeId) external view returns (Accounting memory value) {
        StoreFunding storage funded = _storeFunding[storeId];
        StoreLifecycle storage counters = _storeLifecycle[storeId];
        value.fundedQuantity = funded.quantity;
        value.fundedAmount = funded.amount;
        value.claimedQuantity = counters.claimedQuantity;
        value.claimedAmount = counters.claimedAmount;
        value.handedOverQuantity = counters.deliveredQuantity - counters.settledQuantity;
        value.handedOverAmount = counters.deliveredAmount - counters.settledAmount;
        value.settledQuantity = counters.settledQuantity;
        value.settledAmount = counters.settledAmount;
        value.refundedQuantity = counters.refundedQuantity;
        value.refundedAmount = counters.refundedAmount;
        if (storeClosed[storeId]) {
            value.refundPendingQuantity = funded.quantity - counters.deliveredQuantity - counters.refundedQuantity;
            value.refundPendingAmount = funded.amount - counters.deliveredAmount - counters.refundedAmount;
        }
        value.availableQuantity = funded.quantity - counters.claimedQuantity - counters.deliveredQuantity
            - value.refundPendingQuantity - counters.refundedQuantity;
        value.availableAmount = funded.amount - counters.claimedAmount - counters.deliveredAmount
            - value.refundPendingAmount - counters.refundedAmount;
        value.liability = funded.amount - counters.settledAmount - counters.refundedAmount;
    }

    function claim(bytes32 requestId, bytes32 batchId, uint256 unitIndex, uint256 expectedGeneration, address recipient)
        external nonReentrant returns (bytes32 voucherId)
    {
        if (msg.sender != claimAuthority) revert UnauthorizedAuthority();
        bytes32 payload = keccak256(abi.encode(this.claim.selector, batchId, unitIndex, expectedGeneration, recipient));
        (bool exists, bytes32 original) = _original(requestId, payload);
        if (exists) return original;
        if (recipient == address(0)) revert InvalidRecipient();
        if (block.timestamp < nextEligibleAt(recipient)) revert ClaimCooldown();
        Batch memory batch = _batch(batchId, unitIndex);
        _open(batch.storeId);
        bytes32 key = _unitKey(batchId, unitIndex);
        Unit storage unit = _units[key];
        if (unit.status == Status.Claimed && block.timestamp >= _vouchers[unit.voucherId].expiresAt) {
            _expire(unit.voucherId);
        }
        if (unit.status != Status.Available) revert InvalidLifecycleState();
        if (expectedGeneration != unit.generation + 1) revert GenerationMismatch();
        voucherId = keccak256(abi.encode(VOUCHER_DOMAIN, block.chainid, address(this), key, expectedGeneration));
        _units[key] = Unit(expectedGeneration, voucherId, Status.Claimed);
        _vouchers[voucherId] = Voucher(batchId, unitIndex, expectedGeneration, recipient, batch.termsHash,
            block.timestamp, block.timestamp + policySeconds, 0, Status.Claimed);
        _nextEligibleAt[recipient] = block.timestamp + policySeconds;
        _latestVoucher[recipient] = voucherId;
        ++_batchLifecycle[batchId].claimedQuantity;
        ++_storeLifecycle[batch.storeId].claimedQuantity;
        _storeLifecycle[batch.storeId].claimedAmount += batch.unitPrice;
        ++_claimedQuantity;
        _claimedAmount += batch.unitPrice;
        _complete(requestId, payload, voucherId);
        emit Claimed(voucherId, batchId, recipient, unitIndex, expectedGeneration, batch.termsHash,
            block.timestamp + policySeconds);
    }

    /// @notice Returns an expired, unhanded-over unit to its original funded pool.
    function expire(bytes32 voucherId) external nonReentrant {
        _expire(voucherId);
    }

    function _expire(bytes32 voucherId) private {
        Voucher storage voucher = _vouchers[voucherId];
        if (voucher.recipient == address(0)) revert InvalidVoucher();
        if (voucher.status != Status.Claimed) revert InvalidLifecycleState();
        Batch memory batch = getBatch(voucher.batchId);
        _open(batch.storeId);
        if (block.timestamp < voucher.expiresAt) revert VoucherNotExpired();
        Unit storage unit = _units[_unitKey(voucher.batchId, voucher.unitIndex)];
        if (unit.voucherId != voucherId || unit.generation != voucher.generation) revert GenerationMismatch();
        voucher.status = Status.Expired;
        unit.status = Status.Available;
        --_claimedQuantity;
        _claimedAmount -= batch.unitPrice;
        --_batchLifecycle[voucher.batchId].claimedQuantity;
        --_storeLifecycle[batch.storeId].claimedQuantity;
        _storeLifecycle[batch.storeId].claimedAmount -= batch.unitPrice;
        emit VoucherExpiredToPool(voucherId, voucher.batchId, voucher.unitIndex, voucher.generation);
    }

    function redemptionDigest(RedemptionPermit memory permit) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(REDEMPTION_TYPEHASH, permit)));
    }

    function _active(bytes32 voucherId, uint256 generation, Status status) private view returns (Batch memory batch) {
        Voucher storage voucher = _vouchers[voucherId];
        if (voucher.recipient == address(0)) revert InvalidVoucher();
        if (voucher.generation != generation) revert GenerationMismatch();
        Unit storage unit = _units[_unitKey(voucher.batchId, voucher.unitIndex)];
        if (unit.voucherId != voucherId || unit.generation != generation) revert GenerationMismatch();
        if (unit.status != status || voucher.status != status) revert InvalidLifecycleState();
        batch = getBatch(voucher.batchId);
        if (status == Status.Claimed) _open(batch.storeId);
        _owner(batch.storeId);
    }

    function _inWindow(Batch memory batch) private view returns (bool) {
        TermsInput memory terms = getTerms(batch.storeId, batch.mealId, batch.version).value;
        uint256 minute = ((block.timestamp + UTC_OFFSET_MINUTES * 60) % 1 days) / 60;
        return (minute >= terms.startMinute0 && minute < terms.endMinute0)
            || (terms.windowCount == 2 && minute >= terms.startMinute1 && minute < terms.endMinute1);
    }

    function redeem(bytes32 requestId, bytes32 voucherId, uint256 generation,
        RedemptionPermit calldata permit, bytes calldata signature) external nonReentrant
    {
        bytes32 payload = keccak256(abi.encode(this.redeem.selector, voucherId, generation, permit));
        (bool exists,) = _original(requestId, payload);
        if (exists) return;
        Batch memory batch = _active(voucherId, generation, Status.Claimed);
        Voucher storage voucher = _vouchers[voucherId];
        if (block.timestamp >= voucher.expiresAt) revert VoucherExpired();
        if (!_inWindow(batch)) revert OutsideServiceWindow();
        if (permit.voucherId != voucherId || permit.generation != generation || permit.owner != msg.sender
            || permit.issuedAt < voucher.claimedAt || permit.issuedAt > block.timestamp
            || permit.deadline <= permit.issuedAt || permit.deadline > permit.issuedAt + DISPLAY_LIFETIME
            || block.timestamp >= permit.deadline || permit.deadline > voucher.expiresAt
            || ECDSA.recover(redemptionDigest(permit), signature) != redemptionAuthority) revert InvalidPermit();
        voucher.status = Status.HandedOver;
        voucher.settlementAvailableAt = block.timestamp + SETTLEMENT_DELAY;
        _units[_unitKey(voucher.batchId, voucher.unitIndex)].status = Status.HandedOver;
        --_batchLifecycle[voucher.batchId].claimedQuantity;
        ++_batchLifecycle[voucher.batchId].handedOverQuantity;
        --_storeLifecycle[batch.storeId].claimedQuantity;
        _storeLifecycle[batch.storeId].claimedAmount -= batch.unitPrice;
        ++_storeLifecycle[batch.storeId].deliveredQuantity;
        _storeLifecycle[batch.storeId].deliveredAmount += batch.unitPrice;
        --_claimedQuantity; ++_handedOverQuantity;
        _claimedAmount -= batch.unitPrice; _handedOverAmount += batch.unitPrice;
        _complete(requestId, payload, voucherId);
        emit HandedOver(voucherId, msg.sender, voucher.settlementAvailableAt);
    }

    function settle(bytes32 requestId, bytes32 voucherId, uint256 generation) external nonReentrant {
        bytes32 payload = keccak256(abi.encode(this.settle.selector, voucherId, generation));
        (bool exists,) = _original(requestId, payload);
        if (exists) return;
        Batch memory batch = _active(voucherId, generation, Status.HandedOver);
        Voucher storage voucher = _vouchers[voucherId];
        if (block.timestamp < voucher.settlementAvailableAt) revert SettlementTooEarly();
        uint256 beforeEscrow = asset.balanceOf(address(this));
        uint256 beforeOwner = asset.balanceOf(msg.sender);
        if (beforeEscrow < liability()) revert Insolvent();
        voucher.status = Status.Settled;
        _units[_unitKey(voucher.batchId, voucher.unitIndex)].status = Status.Settled;
        --_batchLifecycle[voucher.batchId].handedOverQuantity;
        ++_batchLifecycle[voucher.batchId].settledQuantity;
        ++_storeLifecycle[batch.storeId].settledQuantity;
        _storeLifecycle[batch.storeId].settledAmount += batch.unitPrice;
        --_handedOverQuantity; ++_settledQuantity;
        _handedOverAmount -= batch.unitPrice; _settledAmount += batch.unitPrice;
        _outstandingAmount -= batch.unitPrice;
        _complete(requestId, payload, voucherId);
        asset.safeTransfer(msg.sender, batch.unitPrice);
        if (asset.balanceOf(address(this)) != beforeEscrow - batch.unitPrice
            || asset.balanceOf(msg.sender) != beforeOwner + batch.unitPrice) revert InexactTransfer();
        emit Settled(voucherId, msg.sender, batch.unitPrice);
    }
}
