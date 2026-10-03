// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice CP19 testnet-only escrow. No identity/meal proof, refund, unlock or address recovery.
contract MealForwardTestnet is AccessControl, ReentrancyGuard {
    bytes32 public constant SUPPORTER_ROLE = keccak256("SUPPORTER_ROLE");
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    uint256 public constant priceWei = 1e15;
    uint256 public constant fundingCapWei = 1e16;
    uint256 public constant maxQuantity = 3;
    bytes32 public constant ruleVersion = keccak256("mealforward-cp19-testnet-v1");
    address public immutable merchant;
    bool public paused;
    uint256 public totalFunded;
    uint256 public liability;

    struct Batch { uint256 F; uint256 A; uint256 R; uint256 H; uint256 S; }
    struct Voucher { bytes32 batchId; uint8 status; bytes32 lockId; }
    struct Operation { bytes32 payloadHash; bytes32 resultId; }
    mapping(bytes32 => Batch) private batches;
    mapping(bytes32 => Voucher) private vouchers;
    mapping(address => mapping(bytes32 => bytes32)) public fundedBatch;
    mapping(bytes32 => Operation) private operations;
    mapping(bytes32 => bool) private usedLocks;

    error InvalidInput(); error InvalidValue(); error InvalidRule();
    error LimitExceeded(); error Paused(); error UnknownBatch();
    error InvalidVoucherState(); error DuplicateId();
    error AlreadyProcessed(); error IntentConflict(); error PaymentFailed();
    error TestnetOnly();
    event Funded(bytes32 indexed batchId, address indexed payer, bytes32 indexed intentId, uint256 amount);
    event Issued(bytes32 indexed operationId, bytes32 indexed batchId, bytes32[] voucherIds);
    event Locked(bytes32 indexed operationId, bytes32 indexed voucherId, bytes32 lockId);
    event Reported(bytes32 indexed operationId, bytes32 indexed voucherId, bytes32 lockId);
    event Settled(bytes32 indexed operationId, bytes32 indexed voucherId, address merchant, uint256 amount);
    event PauseChanged(bool paused);

    constructor(address admin, address merchant_) {
        if (block.chainid != 10143) revert TestnetOnly();
        if (admin == address(0) || merchant_ == address(0) || merchant_ == address(this)) revert InvalidInput();
        merchant = merchant_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function recoveryEnabled() external pure returns (bool) { return false; }

    function fund(bytes32 intentId, uint256 quantity, bytes32 version)
        external payable onlyRole(SUPPORTER_ROLE) nonReentrant returns (bytes32 batchId)
    {
        _active();
        if (intentId == 0 || quantity == 0 || quantity > maxQuantity) revert InvalidInput();
        if (version != ruleVersion) revert InvalidRule();
        if (msg.value != quantity * priceWei) revert InvalidValue();
        if (fundedBatch[msg.sender][intentId] != 0) revert AlreadyProcessed();
        if (totalFunded + msg.value > fundingCapWei) revert LimitExceeded();
        batchId = keccak256(abi.encode(block.chainid, address(this), msg.sender, intentId));
        fundedBatch[msg.sender][intentId] = batchId;
        batches[batchId] = Batch(msg.value, msg.value, 0, 0, 0);
        totalFunded += msg.value;
        liability += msg.value;
        emit Funded(batchId, msg.sender, intentId, msg.value);
    }

    function issue(bytes32 operationId, bytes32 batchId, bytes32[] calldata voucherIds)
        external onlyRole(ISSUER_ROLE) nonReentrant
    {
        _active();
        _record(1, operationId, keccak256(abi.encode(batchId, voucherIds)), batchId);
        Batch storage b = batches[batchId];
        if (b.F == 0) revert UnknownBatch();
        uint256 n = voucherIds.length;
        if (n == 0 || n > maxQuantity) revert InvalidInput();
        uint256 amount = n * priceWei;
        if (amount > b.A) revert LimitExceeded();
        for (uint256 i; i < n; ++i) {
            bytes32 id = voucherIds[i];
            if (id == 0) revert InvalidInput();
            if (vouchers[id].status != 0) revert DuplicateId();
            vouchers[id] = Voucher(batchId, 1, 0);
        }
        b.A -= amount;
        b.R += amount;
        emit Issued(operationId, batchId, voucherIds);
    }

    function lock(bytes32 operationId, bytes32 voucherId, bytes32 lockId)
        external onlyRole(OPERATOR_ROLE) nonReentrant
    {
        _active();
        _record(2, operationId, keccak256(abi.encode(voucherId, lockId)), voucherId);
        Voucher storage v = vouchers[voucherId];
        if (v.status != 1) revert InvalidVoucherState();
        if (lockId == 0) revert InvalidInput();
        if (usedLocks[lockId]) revert DuplicateId();
        usedLocks[lockId] = true;
        v.status = 2;
        v.lockId = lockId;
        emit Locked(operationId, voucherId, lockId);
    }

    /// @dev Allowed while paused for an existing lock; operator's statement, not physical proof.
    function report(bytes32 operationId, bytes32 voucherId, bytes32 lockId)
        external onlyRole(OPERATOR_ROLE) nonReentrant
    {
        _record(3, operationId, keccak256(abi.encode(voucherId, lockId)), voucherId);
        Voucher storage v = vouchers[voucherId];
        if (v.status != 2 || v.lockId != lockId) revert InvalidVoucherState();
        v.status = 3;
        Batch storage b = batches[v.batchId];
        b.R -= priceWei;
        b.H += priceWei;
        emit Reported(operationId, voucherId, lockId);
    }

    function settle(bytes32 operationId, bytes32 voucherId)
        external onlyRole(SETTLER_ROLE) nonReentrant
    {
        _active();
        _record(4, operationId, keccak256(abi.encode(voucherId)), voucherId);
        Voucher storage v = vouchers[voucherId];
        if (v.status != 3) revert InvalidVoucherState();
        v.status = 4;
        Batch storage b = batches[v.batchId];
        b.H -= priceWei;
        b.S += priceWei;
        liability -= priceWei;
        (bool paid,) = merchant.call{value: priceWei}("");
        if (!paid) revert PaymentFailed();
        emit Settled(operationId, voucherId, merchant, priceWei);
    }

    function setPaused(bool value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = value;
        emit PauseChanged(value);
    }

    function getBatch(bytes32 id) external view returns (
        uint256 F, uint256 A, uint256 R, uint256 H, uint256 S, uint256 X, uint256 L
    ) {
        Batch storage b = batches[id];
        return (b.F, b.A, b.R, b.H, b.S, 0, 0);
    }

    function getVoucher(bytes32 id) external view returns (bytes32 batchId, uint8 status, bytes32 lockId) {
        Voucher storage v = vouchers[id];
        return (v.batchId, v.status, v.lockId);
    }

    function getOperation(uint8 action, bytes32 id) external view returns (bytes32 payloadHash, bytes32 resultId) {
        Operation storage o = operations[keccak256(abi.encode(action, id))];
        return (o.payloadHash, o.resultId);
    }

    function unallocated() external view returns (uint256) { return address(this).balance - liability; }

    function _active() private view { if (paused) revert Paused(); }

    function _record(uint8 action, bytes32 id, bytes32 payloadHash, bytes32 resultId) private {
        if (id == 0) revert InvalidInput();
        bytes32 key = keccak256(abi.encode(action, id));
        Operation storage old = operations[key];
        if (old.payloadHash != 0) {
            if (old.payloadHash != payloadHash) revert IntentConflict();
            revert AlreadyProcessed();
        }
        operations[key] = Operation(payloadHash, resultId);
    }
}
