// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice C0 financial foundation only: all funded units are A or X.
/// @dev The constructor catalog is synthetic and immutable; there is no publisher or fulfillment API.
contract StoreEscrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant LIFETIME_CAP = 10;
    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "FundingQuote(bytes32 quoteId,address payer,bytes32 mealId,uint256 currentVersion,bytes32 termsHash,uint256 quantity,uint256 unitPrice,uint256 amount,uint256 deadline)"
    );

    struct CatalogEntry {
        bytes32 mealId;
        uint256 version;
        uint256 unitPrice;
        bytes32 termsHash;
        bool current;
    }

    struct Terms {
        uint256 unitPrice;
        bytes32 termsHash;
    }

    struct FundingQuote {
        bytes32 quoteId;
        address payer;
        bytes32 mealId;
        uint256 currentVersion;
        bytes32 termsHash;
        uint256 quantity;
        uint256 unitPrice;
        uint256 amount;
        uint256 deadline;
    }

    struct Batch {
        address payer;
        bytes32 mealId;
        uint256 version;
        bytes32 termsHash;
        uint256 unitPrice;
        uint256 quantity;
        uint256 firstUnit;
        uint16 refundedMask;
    }

    struct QuoteUse {
        bytes32 payloadHash;
        bytes32 batchId;
    }

    IERC20 public immutable asset;
    bytes32 public immutable storeId;
    address public immutable owner;
    address public immutable receiver;
    address public immutable quoteAuthority;

    mapping(bytes32 mealId => mapping(uint256 version => Terms)) public catalog;
    mapping(bytes32 mealId => uint256 version) public currentVersion;
    mapping(bytes32 quoteId => QuoteUse) public quoteUses;
    mapping(bytes32 batchId => Batch) private _batches;

    uint256 public lifetimeFundedUnits;
    uint256 public refundedUnits;
    uint256 public totalFundedAmount;
    uint256 public availableAmount;
    uint256 public totalRefundedAmount;

    error InvalidConfiguration();
    error InvalidCatalog();
    error InvalidQuote();
    error UnauthorizedPayer();
    error UnauthorizedQuote();
    error QuoteConflict();
    error QuoteExpired();
    error TermsMismatch();
    error CapExceeded();
    error TransferDeltaMismatch();
    error Insolvent();
    error InvalidBatch();
    error InvalidRefundMask();
    error AlreadyRefunded();

    event Funded(
        bytes32 indexed quoteId,
        bytes32 indexed batchId,
        address indexed payer,
        bytes32 mealId,
        uint256 version,
        bytes32 termsHash,
        uint256 unitPrice,
        uint256 quantity,
        uint256 firstUnit,
        uint256 amount
    );
    event Refunded(bytes32 indexed batchId, address indexed payer, uint16 unitMask, uint256 quantity, uint256 amount);

    constructor(IERC20 asset_, bytes32 storeId_, address owner_, address quoteAuthority_, CatalogEntry[] memory entries)
        EIP712("MealForward C0 Funding", "1")
    {
        if (
            address(asset_).code.length == 0 || storeId_ == bytes32(0) || owner_ == address(0)
                || quoteAuthority_ == address(0)
        ) revert InvalidConfiguration();
        asset = asset_;
        storeId = storeId_;
        owner = owner_;
        receiver = owner_;
        quoteAuthority = quoteAuthority_;
        if (entries.length == 0) revert InvalidCatalog();
        // Constructor-only validation; no financial action scans the catalog.
        for (uint256 i; i < entries.length; ++i) {
            CatalogEntry memory entry = entries[i];
            if (
                entry.mealId == bytes32(0) || entry.version == 0 || entry.unitPrice == 0
                    || entry.termsHash == bytes32(0) || catalog[entry.mealId][entry.version].unitPrice != 0
            ) revert InvalidCatalog();
            catalog[entry.mealId][entry.version] = Terms(entry.unitPrice, entry.termsHash);
            if (entry.current) {
                if (currentVersion[entry.mealId] != 0) revert InvalidCatalog();
                currentVersion[entry.mealId] = entry.version;
            }
        }
        for (uint256 i; i < entries.length; ++i) {
            if (currentVersion[entries[i].mealId] == 0) revert InvalidCatalog();
        }
    }

    function quotePayloadHash(FundingQuote calldata quote) public pure returns (bytes32) {
        return keccak256(abi.encode(QUOTE_TYPEHASH, quote));
    }

    function quoteDigest(FundingQuote calldata quote) external view returns (bytes32) {
        return _hashTypedDataV4(quotePayloadHash(quote));
    }

    function fund(FundingQuote calldata quote, bytes calldata signature)
        external
        nonReentrant
        returns (bytes32 batchId)
    {
        if (quote.quoteId == bytes32(0) || quote.payer == address(0)) revert InvalidQuote();
        if (msg.sender != quote.payer) revert UnauthorizedPayer();
        bytes32 payloadHash = quotePayloadHash(quote);
        if (ECDSA.recover(_hashTypedDataV4(payloadHash), signature) != quoteAuthority) revert UnauthorizedQuote();
        QuoteUse memory used = quoteUses[quote.quoteId];
        if (used.batchId != bytes32(0)) {
            if (used.payloadHash != payloadHash) revert QuoteConflict();
            // A completed original operation remains readable after its deadline, without a second transfer.
            return used.batchId;
        }
        if (block.timestamp >= quote.deadline) revert QuoteExpired();
        if (quote.quantity == 0 || quote.quantity > LIFETIME_CAP) revert InvalidQuote();
        Terms memory terms = catalog[quote.mealId][quote.currentVersion];
        if (
            currentVersion[quote.mealId] != quote.currentVersion || terms.unitPrice == 0
                || terms.unitPrice != quote.unitPrice || terms.termsHash != quote.termsHash
        ) revert TermsMismatch();
        if (quote.amount != quote.quantity * quote.unitPrice) revert InvalidQuote();
        if (lifetimeFundedUnits + quote.quantity > LIFETIME_CAP) revert CapExceeded();

        uint256 escrowBefore = asset.balanceOf(address(this));
        uint256 payerBefore = asset.balanceOf(quote.payer);
        if (escrowBefore < availableAmount) revert Insolvent();
        uint256 firstUnit = lifetimeFundedUnits;
        batchId = keccak256(abi.encode(block.chainid, address(this), quote.quoteId));
        quoteUses[quote.quoteId] = QuoteUse(payloadHash, batchId);
        _batches[batchId] = Batch(
            quote.payer,
            quote.mealId,
            quote.currentVersion,
            quote.termsHash,
            quote.unitPrice,
            quote.quantity,
            firstUnit,
            0
        );
        lifetimeFundedUnits += quote.quantity;
        totalFundedAmount += quote.amount;
        availableAmount += quote.amount;
        asset.safeTransferFrom(quote.payer, address(this), quote.amount);
        uint256 escrowAfter = asset.balanceOf(address(this));
        uint256 payerAfter = asset.balanceOf(quote.payer);
        if (
            escrowAfter < escrowBefore || escrowAfter - escrowBefore != quote.amount || payerAfter > payerBefore
                || payerBefore - payerAfter != quote.amount
        ) revert TransferDeltaMismatch();
        _emitFunded(quote, batchId, firstUnit);
    }

    function _emitFunded(FundingQuote calldata quote, bytes32 batchId, uint256 firstUnit) private {
        emit Funded(
            quote.quoteId,
            batchId,
            quote.payer,
            quote.mealId,
            quote.currentVersion,
            quote.termsHash,
            quote.unitPrice,
            quote.quantity,
            firstUnit,
            quote.amount
        );
    }

    /// @notice Only the original payer refunds their original A units. There is no receiver override or service role.
    function refund(bytes32 batchId, uint16 unitMask) external nonReentrant returns (uint256 amount) {
        Batch storage batch = _batches[batchId];
        if (batch.payer == address(0)) revert InvalidBatch();
        if (msg.sender != batch.payer) revert UnauthorizedPayer();
        if (unitMask == 0 || uint256(unitMask) >= (uint256(1) << batch.quantity)) revert InvalidRefundMask();
        if (batch.refundedMask & unitMask != 0) revert AlreadyRefunded();
        uint256 quantity;
        for (uint256 i; i < batch.quantity; ++i) {
            if (uint256(unitMask) & (uint256(1) << i) != 0) ++quantity;
        }
        amount = quantity * batch.unitPrice;
        uint256 escrowBefore = asset.balanceOf(address(this));
        uint256 payerBefore = asset.balanceOf(batch.payer);
        if (escrowBefore < availableAmount) revert Insolvent();
        batch.refundedMask |= unitMask;
        refundedUnits += quantity;
        availableAmount -= amount;
        totalRefundedAmount += amount;
        asset.safeTransfer(batch.payer, amount);
        uint256 escrowAfter = asset.balanceOf(address(this));
        uint256 payerAfter = asset.balanceOf(batch.payer);
        if (
            escrowAfter > escrowBefore || escrowBefore - escrowAfter != amount || payerAfter < payerBefore
                || payerAfter - payerBefore != amount
        ) revert TransferDeltaMismatch();
        emit Refunded(batchId, batch.payer, unitMask, quantity, amount);
    }

    function getBatch(bytes32 batchId) external view returns (Batch memory) {
        return _batches[batchId];
    }

    function availableUnits() external view returns (uint256) {
        return lifetimeFundedUnits - refundedUnits;
    }

    function liability() external view returns (uint256) {
        return availableAmount;
    }

    function surplus() external view returns (uint256) {
        uint256 balance = asset.balanceOf(address(this));
        if (balance < availableAmount) revert Insolvent();
        return balance - availableAmount;
    }
}
