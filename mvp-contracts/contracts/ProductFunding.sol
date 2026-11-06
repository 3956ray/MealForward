// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ProductCatalog} from "./ProductCatalog.sol";

/// @notice NON-DEPLOYABLE funding foundation: a complete lifecycle is still required.
/// @dev There is deliberately no production subclass. Do not implement the hook as a
/// no-op in production: Claim/fulfillment/refund authority and accounting must first be specified.
abstract contract ProductFunding is ProductCatalog {
    using SafeERC20 for IERC20;

    struct FundingRequest {
        bytes32 requestId;
        bytes32 storeId;
        bytes32 mealId;
        uint256 version;
        bytes32 termsHash;
        uint256 quantity;
        uint256 expectedAmount;
        uint256 deadline;
    }
    struct Batch {
        address payer;
        bytes32 storeId;
        bytes32 mealId;
        uint256 version;
        bytes32 termsHash;
        uint256 quantity;
        uint256 unitPrice;
        uint256 amount;
        uint256 fundedAt;
    }

    struct StoreFunding { uint256 quantity; uint256 amount; }
    mapping(bytes32 => StoreFunding) internal _storeFunding;
    mapping(bytes32 => Batch) private _batches;
    uint256 public totalFundedQuantity;
    uint256 public totalFundedAmount;
    uint256 internal _outstandingAmount;

    error PaymentExpired();
    error TermsMismatch();
    error AmountMismatch();
    error InexactTransfer();
    error Insolvent();

    event Funded(bytes32 indexed batchId, bytes32 indexed storeId, address indexed payer,
        bytes32 mealId, uint256 version, bytes32 termsHash, uint256 quantity, uint256 unitPrice, uint256 amount);

    constructor(IERC20 token) ProductCatalog(token) {}

    function _requireLifecycleReady() internal view virtual;

    function getBatch(bytes32 batchId) public view returns (Batch memory) {
        return _batches[batchId];
    }

    function liability() public view returns (uint256) {
        return _outstandingAmount;
    }

    /// @dev One payer-scoped request corresponds to one immutable batch; no per-owner quote.
    /// Inventory and token transfer revert together. No loops over quantity or historical batches.
    function fund(FundingRequest calldata request) external nonReentrant returns (bytes32 batchId) {
        bytes32 payload = keccak256(abi.encode(this.fund.selector, request));
        (bool exists, bytes32 original) = _original(request.requestId, payload);
        if (exists) return original;
        _requireLifecycleReady();
        if (block.timestamp >= request.deadline) revert PaymentExpired();
        Terms memory terms = getTerms(request.storeId, request.mealId, request.version);
        if (terms.termsHash == 0 || terms.termsHash != request.termsHash) revert TermsMismatch();
        uint256 amount = request.quantity * terms.value.unitPrice;
        if (request.quantity == 0 || amount != request.expectedAmount) revert AmountMismatch();
        _consumeInventory(request.storeId, request.mealId, request.version, request.quantity);
        uint256 beforeEscrow = asset.balanceOf(address(this));
        uint256 beforePayer = asset.balanceOf(msg.sender);
        if (beforeEscrow < _outstandingAmount) revert Insolvent();
        batchId = requestKey(msg.sender, request.requestId);
        _batches[batchId] = Batch(msg.sender, request.storeId, request.mealId, request.version,
            request.termsHash, request.quantity, terms.value.unitPrice, amount, block.timestamp);
        _storeFunding[request.storeId].quantity += request.quantity;
        _storeFunding[request.storeId].amount += amount;
        totalFundedQuantity += request.quantity;
        totalFundedAmount += amount;
        _outstandingAmount += amount;
        _complete(request.requestId, payload, batchId);
        asset.safeTransferFrom(msg.sender, address(this), amount);
        if (asset.balanceOf(address(this)) != beforeEscrow + amount
            || beforePayer < amount || asset.balanceOf(msg.sender) != beforePayer - amount) revert InexactTransfer();
        emit Funded(batchId, request.storeId, msg.sender, request.mealId, request.version,
            request.termsHash, request.quantity, terms.value.unitPrice, amount);
    }
}
