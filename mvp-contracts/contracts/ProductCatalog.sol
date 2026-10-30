// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Product catalog foundation. No deployment or migration of the legacy MVP.
/// @dev Terms are immutable. Publishing a new version replaces future sales only.
abstract contract ProductCatalog is ReentrancyGuard {
    uint256 public constant UTC_OFFSET_MINUTES = 480;
    bytes32 public constant TERMS_DOMAIN = keccak256("MealForwardProductTermsV2");
    bytes32 public constant REQUEST_DOMAIN = keccak256("MealForwardProductRequestV2");

    struct TermsInput {
        uint256 unitPrice;
        bytes32 bodyDigest;
        bytes32 imageDigest;
        uint8 windowCount;
        uint16 startMinute0;
        uint16 endMinute0;
        uint16 startMinute1;
        uint16 endMinute1;
    }
    struct Terms {
        TermsInput value;
        bytes32 termsHash;
    }
    struct Offer {
        uint256 offered;
        uint256 funded;
        uint256 fundingDeadline;
        bool listed;
    }
    struct RequestUse {
        bytes32 payloadHash;
        bytes32 result;
        bool exists;
    }

    IERC20 public immutable asset;
    mapping(bytes32 => address) public storeOwner;
    mapping(bytes32 => bool) public storeClosed;
    mapping(bytes32 => mapping(bytes32 => uint256)) public currentVersion;
    mapping(bytes32 => mapping(bytes32 => mapping(uint256 => Terms))) private _terms;
    mapping(bytes32 => mapping(bytes32 => mapping(uint256 => Offer))) internal _offers;
    mapping(bytes32 => RequestUse) private _requests;

    error InvalidAsset();
    error InvalidRequest();
    error RequestConflict();
    error UnauthorizedOwner();
    error StoreExists();
    error StoreIsClosed();
    error InvalidCatalog();
    error VersionMismatch();
    error InvalidOffer();
    error OfferUnavailable();
    error InsufficientInventory();

    event StoreRegistered(bytes32 indexed storeId, address indexed owner);
    event MealPublished(bytes32 indexed storeId, bytes32 indexed mealId, uint256 indexed version,
        bytes32 termsHash, uint256 quantity, uint256 fundingDeadline);
    event InventorySupplemented(bytes32 indexed storeId, bytes32 indexed mealId, uint256 indexed version,
        uint256 quantity, uint256 fundingDeadline);
    event ListingChanged(bytes32 indexed storeId, bytes32 indexed mealId, uint256 indexed version, bool listed);
    event RequestCompleted(bytes32 indexed requestKey, address indexed caller, bytes32 payloadHash, bytes32 result);

    constructor(IERC20 token) {
        if (address(token).code.length == 0) revert InvalidAsset();
        asset = token;
    }

    function requestKey(address caller, bytes32 requestId) public view returns (bytes32) {
        return keccak256(abi.encode(REQUEST_DOMAIN, block.chainid, address(this), caller, requestId));
    }

    function getRequest(address caller, bytes32 requestId) external view returns (RequestUse memory) {
        return _requests[requestKey(caller, requestId)];
    }

    function _original(bytes32 requestId, bytes32 payloadHash)
        internal view returns (bool exists, bytes32 result)
    {
        if (requestId == 0) revert InvalidRequest();
        RequestUse storage original = _requests[requestKey(msg.sender, requestId)];
        if (original.exists && original.payloadHash != payloadHash) revert RequestConflict();
        return (original.exists, original.result);
    }

    function _complete(bytes32 requestId, bytes32 payloadHash, bytes32 result) internal {
        bytes32 key = requestKey(msg.sender, requestId);
        _requests[key] = RequestUse(payloadHash, result, true);
        emit RequestCompleted(key, msg.sender, payloadHash, result);
    }

    function _owner(bytes32 storeId) internal view {
        if (storeOwner[storeId] != msg.sender) revert UnauthorizedOwner();
    }

    function _open(bytes32 storeId) internal view {
        if (storeClosed[storeId]) revert StoreIsClosed();
    }

    function registerStore(bytes32 requestId, bytes32 storeId) external nonReentrant {
        bytes32 payload = keccak256(abi.encode(this.registerStore.selector, storeId));
        (bool exists,) = _original(requestId, payload);
        if (exists) return;
        if (storeId == 0) revert InvalidCatalog();
        if (storeOwner[storeId] != address(0)) revert StoreExists();
        storeOwner[storeId] = msg.sender;
        _complete(requestId, payload, storeId);
        emit StoreRegistered(storeId, msg.sender);
    }

    function computeTermsHash(bytes32 storeId, bytes32 mealId, uint256 version, TermsInput memory value)
        public view returns (bytes32)
    {
        return keccak256(abi.encode(TERMS_DOMAIN, block.chainid, address(this), address(asset),
            storeId, mealId, version, UTC_OFFSET_MINUTES, value));
    }

    function getTerms(bytes32 storeId, bytes32 mealId, uint256 version) public view returns (Terms memory) {
        return _terms[storeId][mealId][version];
    }

    function getOffer(bytes32 storeId, bytes32 mealId, uint256 version) external view returns (Offer memory value) {
        value = _offers[storeId][mealId][version];
        if (storeClosed[storeId]) value.listed = false;
    }

    function availableQuantity(bytes32 storeId, bytes32 mealId, uint256 version) external view returns (uint256) {
        if (storeClosed[storeId]) return 0;
        Offer storage offer = _offers[storeId][mealId][version];
        return offer.offered - offer.funded;
    }

    function _validateTerms(TermsInput memory value) private pure {
        if (value.unitPrice == 0 || value.bodyDigest == 0 || value.imageDigest == 0
            || value.windowCount == 0 || value.windowCount > 2
            || value.startMinute0 >= value.endMinute0 || value.endMinute0 > 1440
            || (value.windowCount == 1 && (value.startMinute1 != 0 || value.endMinute1 != 0))
            || (value.windowCount == 2 && (value.startMinute1 >= value.endMinute1
                || value.endMinute1 > 1440 || value.endMinute0 > value.startMinute1))) {
            revert InvalidCatalog();
        }
    }

    function publish(bytes32 requestId, bytes32 storeId, bytes32 mealId, uint256 expectedVersion,
        TermsInput calldata value, uint256 quantity, uint256 fundingDeadline)
        external nonReentrant returns (uint256 version)
    {
        bytes32 payload = keccak256(abi.encode(this.publish.selector, storeId, mealId,
            expectedVersion, value, quantity, fundingDeadline));
        (bool exists, bytes32 original) = _original(requestId, payload);
        if (exists) return uint256(original);
        _owner(storeId);
        _open(storeId);
        if (mealId == 0) revert InvalidCatalog();
        if (currentVersion[storeId][mealId] != expectedVersion) revert VersionMismatch();
        if (quantity == 0 || fundingDeadline <= block.timestamp) revert InvalidOffer();
        _validateTerms(value);
        version = expectedVersion + 1;
        bytes32 termsHash = computeTermsHash(storeId, mealId, version, value);
        _terms[storeId][mealId][version] = Terms(value, termsHash);
        bool listed = expectedVersion == 0 || _offers[storeId][mealId][expectedVersion].listed;
        _offers[storeId][mealId][version] = Offer(quantity, 0, fundingDeadline, listed);
        currentVersion[storeId][mealId] = version;
        _complete(requestId, payload, bytes32(version));
        emit MealPublished(storeId, mealId, version, termsHash, quantity, fundingDeadline);
    }

    /// @dev Quantity is additional stock, not a replacement total. No implicit relisting.
    function supplement(bytes32 requestId, bytes32 storeId, bytes32 mealId, uint256 version,
        uint256 quantity, uint256 fundingDeadline) external nonReentrant
    {
        bytes32 payload = keccak256(abi.encode(this.supplement.selector, storeId, mealId,
            version, quantity, fundingDeadline));
        (bool exists,) = _original(requestId, payload);
        if (exists) return;
        _owner(storeId);
        _open(storeId);
        if (version == 0 || currentVersion[storeId][mealId] != version) revert VersionMismatch();
        if (quantity == 0 || fundingDeadline <= block.timestamp) revert InvalidOffer();
        Offer storage offer = _offers[storeId][mealId][version];
        offer.offered += quantity;
        offer.fundingDeadline = fundingDeadline;
        _complete(requestId, payload, bytes32(version));
        emit InventorySupplemented(storeId, mealId, version, quantity, fundingDeadline);
    }

    /// @dev Only affects NEW funding. Lifecycle eligibility must not reuse this flag.
    function setListed(bytes32 requestId, bytes32 storeId, bytes32 mealId, uint256 version, bool listed)
        external nonReentrant
    {
        bytes32 payload = keccak256(abi.encode(this.setListed.selector, storeId, mealId, version, listed));
        (bool exists,) = _original(requestId, payload);
        if (exists) return;
        _owner(storeId);
        _open(storeId);
        if (version == 0 || currentVersion[storeId][mealId] != version) revert VersionMismatch();
        _offers[storeId][mealId][version].listed = listed;
        _complete(requestId, payload, bytes32(version));
        emit ListingChanged(storeId, mealId, version, listed);
    }

    function _consumeInventory(bytes32 storeId, bytes32 mealId, uint256 version, uint256 quantity) internal {
        _open(storeId);
        if (version == 0 || currentVersion[storeId][mealId] != version) revert VersionMismatch();
        Offer storage offer = _offers[storeId][mealId][version];
        if (!offer.listed || block.timestamp >= offer.fundingDeadline) revert OfferUnavailable();
        if (quantity == 0 || quantity > offer.offered - offer.funded) revert InsufficientInventory();
        offer.funded += quantity;
    }
}
