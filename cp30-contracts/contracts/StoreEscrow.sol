// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Local S0b: immutable original units, staged lawful declaration and fixed-owner settlement.
/// @dev Neither these roles nor a block-time marker prove private identity, physical delivery or finality.
contract StoreEscrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant LIFETIME_CAP = 10;
    uint256 public constant VOUCHER_LIFETIME = 259200;
    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "FundingQuote(bytes32 quoteId,address payer,bytes32 mealId,uint256 currentVersion,bytes32 termsHash,uint256 quantity,uint256 unitPrice,uint256 amount,uint256 deadline)"
    );
    bytes32 public constant TERMS_TYPEHASH = keccak256(
        "MealForwardTerms(uint256 schemaVersion,uint256 chainId,address escrow,bytes32 storeId,bytes32 mealId,uint256 version,address asset,uint256 unitPrice,bytes32 bodyDigest,bytes32 imageDigest,uint8 windowCount,uint16 startMinute0,uint16 endMinute0,uint16 startMinute1,uint16 endMinute1,uint16 utcOffsetMinutes)"
    );
    bytes32 public constant OP_DOMAIN = keccak256("MealForwardOperationV1");
    bytes32 public constant VOUCHER_DOMAIN = keccak256("MealForwardVoucherV1");
    uint256 private constant OFFSET = 8 hours;
    uint256 private constant DAY = 1 days;

    enum Bucket {
        A,
        R,
        H,
        S,
        X
    }

    struct Authorities {
        address catalog;
        address issuer;
        address operator;
    }

    struct TermsInput {
        bytes32 mealId;
        uint256 version;
        uint256 unitPrice;
        bytes32 bodyDigest;
        bytes32 imageDigest;
        uint8 windowCount;
        uint16 startMinute0;
        uint16 endMinute0;
        uint16 startMinute1;
        uint16 endMinute1;
    }

    struct CatalogEntry {
        TermsInput terms;
        bool current;
    }

    struct Terms {
        uint256 unitPrice;
        bytes32 termsHash;
        bytes32 bodyDigest;
        bytes32 imageDigest;
        uint8 windowCount;
        uint16 startMinute0;
        uint16 endMinute0;
        uint16 startMinute1;
        uint16 endMinute1;
    }

    // Static ABI tuple, equivalent to the frozen separately spelled-out fields without an offset.
    struct TermsCommitment {
        uint256 schemaVersion;
        uint256 chainId;
        address escrow;
        bytes32 store;
        bytes32 meal;
        uint256 version;
        address token;
        uint256 price;
        bytes32 body;
        bytes32 image;
        uint8 count;
        uint16 start0;
        uint16 end0;
        uint16 start1;
        uint16 end1;
        uint16 offset;
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

    struct Unit {
        bytes32 batchId;
        uint8 localIndex;
        address payer;
        bytes32 mealId;
        uint256 version;
        bytes32 termsHash;
        uint256 unitPrice;
        Bucket bucket;
        uint256 generation;
        bytes32 voucherId;
    }

    struct Voucher {
        uint8 unitSeq;
        uint256 generation;
        bytes32 termsHash;
        uint256 issuedAt;
        uint256 expiresAt;
        address issuer;
        bytes32 lockId;
        uint256 lockedAt;
        address operator;
        address processor;
        bytes32 markerId;
        uint256 handoverRecordedAt;
        uint256 handoverBlock;
        bytes32 reportId;
        bytes32 settleId;
        bool expired;
    }

    struct Candidate {
        bool available;
        uint8 unitSeq;
        uint256 nextGeneration;
        bytes32 termsHash;
        bool needsExpiry;
    }

    struct Operation {
        uint8 kind;
        address caller;
        bytes32 payloadHash;
        bytes32 result;
        uint256 executedAt;
    }

    struct Accounting {
        uint256 fundedUnits;
        uint256 fundedAmount;
        uint256[5] counts;
        uint256[5] amounts;
        uint256 liability;
    }

    IERC20 public immutable asset;
    bytes32 public immutable storeId;
    address public immutable owner;
    address public immutable receiver;
    address public immutable quoteAuthority;
    address public immutable catalogAuthority;
    address public immutable issuerAuthority;
    address public immutable operatorAuthority;
    mapping(bytes32 => mapping(uint256 => Terms)) private _terms;
    mapping(bytes32 => uint256) public currentVersion;
    mapping(bytes32 => bool) public listed;
    mapping(bytes32 => QuoteUse) public quoteUses;
    mapping(bytes32 => Batch) private _batches;
    Unit[10] private _units;
    mapping(bytes32 => Voucher) private _vouchers;
    mapping(bytes32 => Operation) private _operations;
    uint256[5] private _amounts;
    uint256[5] private _counts;
    uint256 public lifetimeFundedUnits;
    uint256 public totalFundedAmount;
    uint256 public controlRevision;
    bool public paused;
    bool public closed;

    error InvalidConfiguration();
    error InvalidCatalog();
    error InvalidQuote();
    error UnauthorizedPayer();
    error UnauthorizedQuote();
    error UnauthorizedRole();
    error QuoteConflict();
    error QuoteExpired();
    error TermsMismatch();
    error CapExceeded();
    error TransferDeltaMismatch();
    error Insolvent();
    error InvalidBatch();
    error InvalidRefundMask();
    error AlreadyRefunded();
    error InvalidUnitState();
    error OperationConflict();
    error InvalidOperation();
    error StaleRevision();
    error NoChange();
    error OperatingDenied();
    error CandidateUnavailable();
    error CandidateMismatch();
    error InvalidVoucher();
    error AlreadyLocked();
    error InvalidLock();
    error InvalidMarker();
    error TimeDenied();
    error NotExpired();

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
    event Published(bytes32 indexed mealId, uint256 version, bytes32 termsHash, uint256 revision);
    event ControlChanged(uint8 kind, bytes32 mealId, bool value, uint256 revision);
    event Issued(
        bytes32 indexed voucherId,
        uint8 unitSeq,
        uint256 generation,
        bytes32 termsHash,
        uint256 issuedAt,
        uint256 expiresAt
    );
    event Locked(
        bytes32 indexed voucherId, bytes32 lockId, uint256 generation, uint256 at, address operator, address processor
    );
    event HandoverMarked(
        bytes32 indexed voucherId, bytes32 markerId, bytes32 lockId, uint256 generation, uint256 at, uint256 blockNumber
    );
    event Reported(bytes32 indexed voucherId, bytes32 resultId, bytes32 markerId, uint256 amount);
    event Settled(bytes32 indexed voucherId, bytes32 opId, address indexed receiver, uint256 amount);
    event Expired(bytes32 indexed voucherId, uint8 unitSeq, uint256 generation);
    event OperationExecuted(bytes32 indexed opId, uint8 kind, address caller, bytes32 payloadHash, bytes32 result);

    constructor(
        IERC20 asset_,
        bytes32 storeId_,
        address owner_,
        address quoteAuthority_,
        Authorities memory authorities_,
        CatalogEntry[] memory entries
    ) EIP712("MealForward C0 Funding", "1") {
        if (
            address(asset_).code.length == 0 || storeId_ == 0 || owner_ == address(0) || quoteAuthority_ == address(0)
                || authorities_.catalog == address(0) || authorities_.issuer == address(0)
                || authorities_.operator == address(0)
        ) revert InvalidConfiguration();
        asset = asset_;
        storeId = storeId_;
        owner = owner_;
        receiver = owner_;
        quoteAuthority = quoteAuthority_;
        catalogAuthority = authorities_.catalog;
        issuerAuthority = authorities_.issuer;
        operatorAuthority = authorities_.operator;
        if (entries.length == 0) revert InvalidCatalog();
        // Constructor-only catalog loops; financial allocation never scans menu/history.
        for (uint256 i; i < entries.length; ++i) {
            TermsInput memory input = entries[i].terms;
            _appendTerms(input);
            if (entries[i].current) {
                if (currentVersion[input.mealId] != 0) revert InvalidCatalog();
                currentVersion[input.mealId] = input.version;
                listed[input.mealId] = true;
            }
        }
        for (uint256 i; i < entries.length; ++i) {
            if (currentVersion[entries[i].terms.mealId] < entries[i].terms.version) revert InvalidCatalog();
        }
    }

    function catalog(bytes32 mealId, uint256 version) external view returns (uint256 unitPrice, bytes32 termsHash) {
        Terms storage t = _terms[mealId][version];
        return (t.unitPrice, t.termsHash);
    }

    function getTerms(bytes32 mealId, uint256 version) external view returns (Terms memory) {
        return _terms[mealId][version];
    }

    function computeTermsHash(TermsInput memory input) public view returns (bytes32) {
        TermsCommitment memory c;
        c.schemaVersion = 1;
        c.chainId = block.chainid;
        c.escrow = address(this);
        c.store = storeId;
        c.meal = input.mealId;
        c.version = input.version;
        c.token = address(asset);
        c.price = input.unitPrice;
        c.body = input.bodyDigest;
        c.image = input.imageDigest;
        c.count = input.windowCount;
        c.start0 = input.startMinute0;
        c.end0 = input.endMinute0;
        c.start1 = input.startMinute1;
        c.end1 = input.endMinute1;
        c.offset = 480;
        return keccak256(abi.encode(TERMS_TYPEHASH, c));
    }

    function _appendTerms(TermsInput memory input) private returns (bytes32 hash) {
        if (
            input.mealId == 0 || input.version == 0 || input.unitPrice == 0 || input.bodyDigest == 0
                || input.imageDigest == 0 || _terms[input.mealId][input.version].unitPrice != 0
                || input.windowCount == 0 || input.windowCount > 2 || input.startMinute0 >= input.endMinute0
                || input.endMinute0 > 1440
                || (input.windowCount == 1 && (input.startMinute1 != 0 || input.endMinute1 != 0))
                || (input.windowCount == 2
                    && (input.startMinute1 >= input.endMinute1
                        || input.endMinute1 > 1440
                        || input.endMinute0 > input.startMinute1))
        ) revert InvalidCatalog();
        hash = computeTermsHash(input);
        _terms[input.mealId][input.version] = Terms(
            input.unitPrice,
            hash,
            input.bodyDigest,
            input.imageDigest,
            input.windowCount,
            input.startMinute0,
            input.endMinute0,
            input.startMinute1,
            input.endMinute1
        );
    }

    function _auth(address expected) private view {
        if (msg.sender != expected) revert UnauthorizedRole();
    }

    function operationPayloadHash(uint8 kind, address caller, bytes32 opId, bytes32 parametersHash)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(OP_DOMAIN, uint256(1), block.chainid, address(this), kind, caller, opId, parametersHash)
        );
    }

    function _begin(uint8 kind, bytes32 opId, bytes32 parametersHash)
        private
        view
        returns (bool found, bytes32 result, bytes32 payload)
    {
        if (opId == 0) revert InvalidOperation();
        payload = operationPayloadHash(kind, msg.sender, opId, parametersHash);
        Operation storage previous = _operations[opId];
        // A legitimate Expire(unit0) result is zero. Presence is determined by nonzero kind.
        if (previous.kind != 0) {
            if (previous.kind != kind || previous.caller != msg.sender || previous.payloadHash != payload) {
                revert OperationConflict();
            }
            return (true, previous.result, payload);
        }
    }

    function _finish(uint8 kind, bytes32 opId, bytes32 payload, bytes32 result) private {
        _operations[opId] = Operation(kind, msg.sender, payload, result, block.timestamp);
        emit OperationExecuted(opId, kind, msg.sender, payload, result);
    }

    function getOperation(bytes32 opId) external view returns (Operation memory) {
        return _operations[opId];
    }

    function _revision(uint256 expected) private view {
        if (expected != controlRevision) revert StaleRevision();
    }

    function publish(bytes32 opId, uint256 expectedControlRevision, TermsInput calldata input)
        external
        nonReentrant
        returns (bytes32 hash)
    {
        _auth(catalogAuthority);
        (bool found, bytes32 result, bytes32 payload) =
            _begin(1, opId, keccak256(abi.encode(expectedControlRevision, input)));
        if (found) return result;
        _revision(expectedControlRevision);
        if (input.version != currentVersion[input.mealId] + 1) revert InvalidCatalog();
        hash = _appendTerms(input);
        currentVersion[input.mealId] = input.version;
        ++controlRevision;
        emit Published(input.mealId, input.version, hash, controlRevision);
        _finish(1, opId, payload, hash);
    }

    function setListed(bytes32 opId, uint256 expectedControlRevision, bytes32 mealId, bool value)
        external
        nonReentrant
        returns (uint256)
    {
        _auth(catalogAuthority);
        (bool found, bytes32 result, bytes32 payload) =
            _begin(2, opId, keccak256(abi.encode(expectedControlRevision, mealId, value)));
        if (found) return uint256(result);
        _revision(expectedControlRevision);
        if (currentVersion[mealId] == 0) revert InvalidCatalog();
        if (listed[mealId] == value) revert NoChange();
        listed[mealId] = value;
        ++controlRevision;
        emit ControlChanged(2, mealId, value, controlRevision);
        _finish(2, opId, payload, bytes32(controlRevision));
        return controlRevision;
    }

    function setPaused(bytes32 opId, uint256 expectedControlRevision, bool value)
        external
        nonReentrant
        returns (uint256)
    {
        _auth(catalogAuthority);
        (bool found, bytes32 result, bytes32 payload) =
            _begin(3, opId, keccak256(abi.encode(expectedControlRevision, value)));
        if (found) return uint256(result);
        _revision(expectedControlRevision);
        if (paused == value) revert NoChange();
        paused = value;
        ++controlRevision;
        emit ControlChanged(3, 0, value, controlRevision);
        _finish(3, opId, payload, bytes32(controlRevision));
        return controlRevision;
    }

    function close(bytes32 opId, uint256 expectedControlRevision) external nonReentrant returns (uint256) {
        _auth(catalogAuthority);
        (bool found, bytes32 result, bytes32 payload) = _begin(4, opId, keccak256(abi.encode(expectedControlRevision)));
        if (found) return uint256(result);
        _revision(expectedControlRevision);
        if (closed) revert NoChange();
        closed = true;
        ++controlRevision;
        emit ControlChanged(4, 0, true, controlRevision);
        _finish(4, opId, payload, bytes32(controlRevision));
        return controlRevision;
    }

    function quotePayloadHash(FundingQuote calldata quote) public pure returns (bytes32) {
        return keccak256(abi.encode(QUOTE_TYPEHASH, quote));
    }

    function quoteDigest(FundingQuote calldata quote) external view returns (bytes32) {
        return _hashTypedDataV4(quotePayloadHash(quote));
    }

    function _open(bytes32 mealId) private view {
        if (closed || paused || !listed[mealId]) revert OperatingDenied();
    }

    function fund(FundingQuote calldata quote, bytes calldata signature)
        external
        nonReentrant
        returns (bytes32 batchId)
    {
        if (quote.quoteId == 0 || quote.payer == address(0)) revert InvalidQuote();
        if (msg.sender != quote.payer) revert UnauthorizedPayer();
        bytes32 payload = quotePayloadHash(quote);
        if (ECDSA.recover(_hashTypedDataV4(payload), signature) != quoteAuthority) revert UnauthorizedQuote();
        QuoteUse memory used = quoteUses[quote.quoteId];
        if (used.batchId != 0) {
            if (used.payloadHash != payload) revert QuoteConflict();
            return used.batchId;
        }
        if (block.timestamp >= quote.deadline) revert QuoteExpired();
        if (quote.quantity == 0 || quote.quantity > LIFETIME_CAP) revert InvalidQuote();
        Terms memory terms = _terms[quote.mealId][quote.currentVersion];
        if (
            currentVersion[quote.mealId] != quote.currentVersion || terms.unitPrice == 0
                || terms.unitPrice != quote.unitPrice || terms.termsHash != quote.termsHash
        ) revert TermsMismatch();
        _open(quote.mealId);
        if (quote.amount != quote.quantity * quote.unitPrice) revert InvalidQuote();
        if (lifetimeFundedUnits + quote.quantity > LIFETIME_CAP) revert CapExceeded();
        uint256 escrowBefore = asset.balanceOf(address(this));
        uint256 payerBefore = asset.balanceOf(quote.payer);
        if (escrowBefore < liability()) revert Insolvent();
        uint256 firstUnit = lifetimeFundedUnits;
        batchId = keccak256(abi.encode(block.chainid, address(this), quote.quoteId));
        quoteUses[quote.quoteId] = QuoteUse(payload, batchId);
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
        for (uint256 i; i < quote.quantity; ++i) {
            _units[firstUnit + i] = Unit(
                batchId,
                uint8(i),
                quote.payer,
                quote.mealId,
                quote.currentVersion,
                quote.termsHash,
                quote.unitPrice,
                Bucket.A,
                0,
                0
            );
        }
        lifetimeFundedUnits += quote.quantity;
        totalFundedAmount += quote.amount;
        _amounts[0] += quote.amount;
        _counts[0] += quote.quantity;
        asset.safeTransferFrom(quote.payer, address(this), quote.amount);
        uint256 escrowAfter = asset.balanceOf(address(this));
        uint256 payerAfter = asset.balanceOf(quote.payer);
        if (
            escrowAfter < escrowBefore || escrowAfter - escrowBefore != quote.amount || payerAfter > payerBefore
                || payerBefore - payerAfter != quote.amount
        ) revert TransferDeltaMismatch();
        _emitFunded(quote, batchId, firstUnit);
    }

    function _emitFunded(FundingQuote calldata q, bytes32 batchId, uint256 firstUnit) private {
        emit Funded(
            q.quoteId,
            batchId,
            q.payer,
            q.mealId,
            q.currentVersion,
            q.termsHash,
            q.unitPrice,
            q.quantity,
            firstUnit,
            q.amount
        );
    }

    function _inWindow(Terms storage t, uint256 timestamp) private view returns (bool) {
        uint256 second = (timestamp + OFFSET) % DAY;
        return (second >= uint256(t.startMinute0) * 60 && second < uint256(t.endMinute0) * 60)
            || (t.windowCount == 2 && second >= uint256(t.startMinute1) * 60 && second < uint256(t.endMinute1) * 60);
    }

    function _intersects(Terms storage t, uint256 from, uint256 until) private view returns (bool) {
        uint256 localFrom = from + OFFSET;
        uint256 localUntil = until + OFFSET;
        uint256 base = localFrom / DAY * DAY;
        for (uint256 day; day < 4; ++day) {
            uint256 start = base + day * DAY;
            if (start + uint256(t.startMinute0) * 60 < localUntil && start + uint256(t.endMinute0) * 60 > localFrom) {
                return true;
            }
            if (
                t.windowCount == 2 && start + uint256(t.startMinute1) * 60 < localUntil
                    && start + uint256(t.endMinute1) * 60 > localFrom
            ) return true;
        }
        return false;
    }

    function _safeExpired(Unit storage unit) private view returns (bool) {
        if (unit.bucket != Bucket.R) return false;
        Voucher storage v = _vouchers[unit.voucherId];
        return !v.expired && block.timestamp >= v.expiresAt && v.lockId == 0 && v.markerId == 0;
    }

    function nextCandidate(bytes32 mealId) public view returns (Candidate memory candidate) {
        if (closed || paused || !listed[mealId]) return candidate;
        uint256 expiry = block.timestamp + VOUCHER_LIFETIME;
        for (uint256 i; i < lifetimeFundedUnits; ++i) {
            Unit storage unit = _units[i];
            bool expired = _safeExpired(unit);
            if (
                unit.mealId == mealId && (unit.bucket == Bucket.A || expired)
                    && _intersects(_terms[unit.mealId][unit.version], block.timestamp, expiry)
            ) {
                return Candidate(true, uint8(i), unit.generation + 1, unit.termsHash, expired);
            }
        }
    }

    function _move(Unit storage unit, Bucket from, Bucket to) private {
        if (unit.bucket != from) revert InvalidUnitState();
        --_counts[uint8(from)];
        ++_counts[uint8(to)];
        _amounts[uint8(from)] -= unit.unitPrice;
        _amounts[uint8(to)] += unit.unitPrice;
        unit.bucket = to;
    }

    function _expireUnit(uint8 seq) private {
        Unit storage unit = _units[seq];
        Voucher storage v = _vouchers[unit.voucherId];
        v.expired = true;
        _move(unit, Bucket.R, Bucket.A);
        emit Expired(unit.voucherId, seq, unit.generation);
    }

    function _checkSolvent() private view {
        if (asset.balanceOf(address(this)) < liability()) revert Insolvent();
    }

    function issue(
        bytes32 opId,
        bytes32 mealId,
        uint8 expectedUnitSeq,
        uint256 expectedNextGeneration,
        bytes32 expectedTermsHash,
        uint256 deadline
    ) external nonReentrant returns (bytes32 voucherId) {
        _auth(issuerAuthority);
        (bool found, bytes32 result, bytes32 payload) = _begin(
            5, opId, keccak256(abi.encode(mealId, expectedUnitSeq, expectedNextGeneration, expectedTermsHash, deadline))
        );
        if (found) return result;
        if (block.timestamp >= deadline) revert TimeDenied();
        _open(mealId);
        _checkSolvent();
        for (uint256 i; i < lifetimeFundedUnits; ++i) {
            if (_safeExpired(_units[i])) _expireUnit(uint8(i));
        }
        Candidate memory candidate = nextCandidate(mealId);
        if (!candidate.available) revert CandidateUnavailable();
        if (
            candidate.unitSeq != expectedUnitSeq || candidate.nextGeneration != expectedNextGeneration
                || candidate.termsHash != expectedTermsHash
        ) revert CandidateMismatch();
        Unit storage unit = _units[candidate.unitSeq];
        _move(unit, Bucket.A, Bucket.R);
        unit.generation = expectedNextGeneration;
        voucherId = keccak256(
            abi.encode(VOUCHER_DOMAIN, block.chainid, address(this), candidate.unitSeq, expectedNextGeneration)
        );
        unit.voucherId = voucherId;
        Voucher storage v = _vouchers[voucherId];
        v.unitSeq = candidate.unitSeq;
        v.generation = expectedNextGeneration;
        v.termsHash = unit.termsHash;
        v.issuedAt = block.timestamp;
        v.expiresAt = block.timestamp + VOUCHER_LIFETIME;
        v.issuer = msg.sender;
        emit Issued(voucherId, candidate.unitSeq, expectedNextGeneration, unit.termsHash, v.issuedAt, v.expiresAt);
        _finish(5, opId, payload, voucherId);
    }

    function _active(bytes32 voucherId, uint256 generation, Bucket bucket)
        private
        view
        returns (Voucher storage v, Unit storage unit)
    {
        v = _vouchers[voucherId];
        if (generation == 0 || v.generation != generation || v.expired) revert InvalidVoucher();
        unit = _units[v.unitSeq];
        if (unit.generation != generation || unit.voucherId != voucherId || unit.termsHash != v.termsHash) {
            revert InvalidVoucher();
        }
        if (unit.bucket != bucket) revert InvalidUnitState();
    }

    function _liveTime(Voucher storage v, Unit storage unit, uint256 deadline) private view {
        if (
            block.timestamp >= deadline || block.timestamp >= v.expiresAt
                || !_inWindow(_terms[unit.mealId][unit.version], block.timestamp)
        ) revert TimeDenied();
    }

    function lock(bytes32 opId, bytes32 voucherId, uint256 generation, uint256 deadline)
        external
        nonReentrant
        returns (bytes32 lockId)
    {
        _auth(operatorAuthority);
        (bool found, bytes32 result, bytes32 payload) =
            _begin(6, opId, keccak256(abi.encode(voucherId, generation, deadline)));
        if (found) return result;
        if (paused) revert OperatingDenied();
        _checkSolvent();
        (Voucher storage v, Unit storage unit) = _active(voucherId, generation, Bucket.R);
        if (v.lockId != 0) revert AlreadyLocked();
        _liveTime(v, unit, deadline);
        lockId = opId;
        v.lockId = lockId;
        v.lockedAt = block.timestamp;
        v.operator = msg.sender;
        v.processor = owner;
        emit Locked(voucherId, lockId, generation, block.timestamp, msg.sender, owner);
        _finish(6, opId, payload, lockId);
    }

    function markHandover(bytes32 opId, bytes32 voucherId, uint256 generation, bytes32 lockId, uint256 deadline)
        external
        nonReentrant
        returns (bytes32 markerId)
    {
        _auth(operatorAuthority);
        (bool found, bytes32 result, bytes32 payload) =
            _begin(7, opId, keccak256(abi.encode(voucherId, generation, lockId, deadline)));
        if (found) return result;
        if (paused) revert OperatingDenied();
        _checkSolvent();
        (Voucher storage v, Unit storage unit) = _active(voucherId, generation, Bucket.R);
        if (lockId == 0 || v.lockId != lockId || v.operator != msg.sender) revert InvalidLock();
        if (v.markerId != 0) revert InvalidMarker();
        _liveTime(v, unit, deadline);
        markerId = opId;
        v.markerId = markerId;
        v.handoverRecordedAt = block.timestamp;
        v.handoverBlock = block.number;
        emit HandoverMarked(voucherId, markerId, lockId, generation, block.timestamp, block.number);
        _finish(7, opId, payload, markerId);
    }

    function report(bytes32 opId, bytes32 voucherId, uint256 generation, bytes32 lockId, bytes32 markerId)
        external
        nonReentrant
        returns (bytes32 resultId)
    {
        _auth(operatorAuthority);
        (bool found, bytes32 result, bytes32 payload) =
            _begin(8, opId, keccak256(abi.encode(voucherId, generation, lockId, markerId)));
        if (found) return result;
        (Voucher storage v, Unit storage unit) = _active(voucherId, generation, Bucket.R);
        if (lockId == 0 || v.lockId != lockId || v.operator != msg.sender) revert InvalidLock();
        if (
            markerId == 0 || v.markerId != markerId || v.handoverRecordedAt < v.issuedAt
                || v.handoverRecordedAt >= v.expiresAt
                || !_inWindow(_terms[unit.mealId][unit.version], v.handoverRecordedAt)
        ) revert InvalidMarker();
        _move(unit, Bucket.R, Bucket.H);
        resultId = opId;
        v.reportId = resultId;
        emit Reported(voucherId, resultId, markerId, unit.unitPrice);
        _finish(8, opId, payload, resultId);
    }

    function expire(bytes32 opId, bytes32 voucherId, uint256 generation) external nonReentrant returns (uint8 unitSeq) {
        _auth(issuerAuthority);
        (bool found, bytes32 result, bytes32 payload) = _begin(10, opId, keccak256(abi.encode(voucherId, generation)));
        if (found) return uint8(uint256(result));
        (Voucher storage v,) = _active(voucherId, generation, Bucket.R);
        if (block.timestamp < v.expiresAt) revert NotExpired();
        if (v.lockId != 0 || v.markerId != 0) revert InvalidUnitState();
        unitSeq = v.unitSeq;
        _expireUnit(unitSeq);
        _finish(10, opId, payload, bytes32(uint256(unitSeq)));
    }

    function _payout(address recipient, uint256 amount) private {
        uint256 escrowBefore = asset.balanceOf(address(this));
        uint256 recipientBefore = asset.balanceOf(recipient);
        // Called after CEI: adding the payment restores the pre-transition liability.
        if (escrowBefore < liability() + amount) revert Insolvent();
        asset.safeTransfer(recipient, amount);
        uint256 escrowAfter = asset.balanceOf(address(this));
        uint256 recipientAfter = asset.balanceOf(recipient);
        if (
            escrowAfter > escrowBefore || escrowBefore - escrowAfter != amount || recipientAfter < recipientBefore
                || recipientAfter - recipientBefore != amount
        ) revert TransferDeltaMismatch();
    }

    function settle(bytes32 opId, bytes32 voucherId, uint256 generation)
        external
        nonReentrant
        returns (uint256 amount)
    {
        _auth(owner);
        (bool found, bytes32 result, bytes32 payload) = _begin(9, opId, keccak256(abi.encode(voucherId, generation)));
        if (found) return uint256(result);
        (Voucher storage v, Unit storage unit) = _active(voucherId, generation, Bucket.H);
        amount = unit.unitPrice;
        _move(unit, Bucket.H, Bucket.S);
        v.settleId = opId;
        _payout(receiver, amount);
        emit Settled(voucherId, opId, receiver, amount);
        _finish(9, opId, payload, bytes32(amount));
    }

    function _payer(bytes32 batchId) private view {
        if (_batches[batchId].payer == address(0)) revert InvalidBatch();
        if (msg.sender != _batches[batchId].payer) revert UnauthorizedPayer();
    }

    function refund(bytes32 batchId, uint16 unitMask) external nonReentrant returns (uint256) {
        _payer(batchId);
        return _refund(batchId, unitMask);
    }

    function refundWithIntent(bytes32 opId, bytes32 batchId, uint16 unitMask)
        external
        nonReentrant
        returns (uint256 amount)
    {
        Operation storage previous = _operations[opId];
        // Authenticate the original successful refund caller before testing changed batch parameters.
        if (previous.kind == 11) {
            if (msg.sender != previous.caller) revert UnauthorizedPayer();
        } else {
            _payer(batchId);
        }
        (bool found, bytes32 result, bytes32 payload) = _begin(11, opId, keccak256(abi.encode(batchId, unitMask)));
        if (found) return uint256(result);
        amount = _refund(batchId, unitMask);
        _finish(11, opId, payload, bytes32(amount));
    }

    function _refund(bytes32 batchId, uint16 unitMask) private returns (uint256 amount) {
        Batch storage batch = _batches[batchId];
        if (unitMask == 0 || uint256(unitMask) >= (uint256(1) << batch.quantity)) revert InvalidRefundMask();
        if (batch.refundedMask & unitMask != 0) revert AlreadyRefunded();
        uint256 quantity;
        for (uint256 i; i < batch.quantity; ++i) {
            if (uint256(unitMask) & (uint256(1) << i) != 0) {
                if (_units[batch.firstUnit + i].bucket != Bucket.A) revert InvalidUnitState();
                ++quantity;
            }
        }
        amount = quantity * batch.unitPrice;
        batch.refundedMask |= unitMask;
        for (uint256 i; i < batch.quantity; ++i) {
            if (uint256(unitMask) & (uint256(1) << i) != 0) _move(_units[batch.firstUnit + i], Bucket.A, Bucket.X);
        }
        _payout(batch.payer, amount);
        emit Refunded(batchId, batch.payer, unitMask, quantity, amount);
    }

    function getBatch(bytes32 batchId) external view returns (Batch memory) {
        return _batches[batchId];
    }

    function getUnit(uint8 seq) external view returns (Unit memory) {
        if (seq >= lifetimeFundedUnits) revert InvalidUnitState();
        return _units[seq];
    }

    function getVoucher(bytes32 voucherId) external view returns (Voucher memory) {
        return _vouchers[voucherId];
    }

    function bucketCount(Bucket bucket) external view returns (uint256) {
        return _counts[uint8(bucket)];
    }

    function bucketAmount(Bucket bucket) external view returns (uint256) {
        return _amounts[uint8(bucket)];
    }

    function availableAmount() external view returns (uint256) {
        return _amounts[0];
    }

    function availableUnits() external view returns (uint256) {
        return _counts[0];
    }

    function refundedUnits() external view returns (uint256) {
        return _counts[4];
    }

    function totalRefundedAmount() external view returns (uint256) {
        return _amounts[4];
    }

    function liability() public view returns (uint256) {
        return _amounts[0] + _amounts[1] + _amounts[2];
    }

    function getAccounting() external view returns (Accounting memory) {
        return Accounting(lifetimeFundedUnits, totalFundedAmount, _counts, _amounts, liability());
    }

    function surplus() external view returns (uint256) {
        uint256 balance = asset.balanceOf(address(this));
        if (balance < liability()) revert Insolvent();
        return balance - liability();
    }
}
