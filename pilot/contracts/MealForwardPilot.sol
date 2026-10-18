// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice Completely disposable MONAD TESTNET-ONLY credit. NOT real USDC.
///         Anyone can mint once. It is intentionally worthless.
contract PilotMealCredit is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 100_000_000;
    mapping(address => bool) public hasMinted;
    error FaucetAlreadyUsed();
    error WrongChain();

    constructor() ERC20("MealForward TEST Credits (NO VALUE)", "mMEAL") {
        if (block.chainid != 10143) revert WrongChain();
    }

    function decimals() public pure override returns (uint8) { return 6; }

    function faucet() external {
        if (hasMinted[msg.sender]) revert FaucetAlreadyUsed();
        hasMinted[msg.sender] = true;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}

/**
 * @title MealForwardPilot
 * @notice NEW isolated wallet-direct prototype, not the deployed CP30 escrow.
 * @dev Monad Testnet 10143 only, new worthless credit deployed per instance.
 *      Not an attestation of real food delivery. No upgrade/admin/signer keys.
 *      Voucher is reserved only with a recipient-signed, 120s, merchant-bound
 *      EIP-191 permit. Merchant explicitly records handover and settlement.
 */
contract MealForwardPilot is ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes32 private constant PERMIT_DOMAIN = keccak256("MealForward.Pilot.Redeem.V1");
    uint256 public constant SETTLEMENT_DELAY = 30 seconds;
    uint256 public constant MAX_KITCHENS = 12;
    uint256 public constant MAX_FUND_QUANTITY = 5;
    PilotMealCredit public immutable credit;

    enum VoucherStatus { None, Claimed, Reserved, HandedOver, Settled }

    struct Kitchen {
        address owner;
        string name;
        uint256 unitPrice;
        uint256 available;
        uint256 issued;
        uint256 reserved;
        uint256 handedOver;
        uint256 settled;
        uint256 totalFunded;
        uint256 totalPaid;
    }
    struct Voucher {
        uint256 kitchenId;
        address recipient;
        VoucherStatus status;
        uint256 nonce;
        uint256 reservedAt;
        uint256 handedOverAt;
    }

    uint256 public kitchenCount;
    uint256 public voucherCounter;
    mapping(uint256 => Kitchen) private _kitchens;
    mapping(bytes32 => Voucher) private _vouchers;
    mapping(uint256 => mapping(address => uint256)) public contributions;
    mapping(uint256 => mapping(address => bytes32)) public voucherOf;

    error WrongChain();
    error InvalidInput();
    error UnknownKitchen();
    error NotKitchenOwner();
    error NoAvailableMeal();
    error AlreadyClaimed();
    error InvalidVoucher();
    error InvalidStatus();
    error InvalidDeadline();
    error NotRecipient();
    error TooEarly();
    error PaymentFailed();

    event KitchenRegistered(uint256 indexed kitchenId, address indexed owner, string name, uint256 unitPrice);
    event Funded(uint256 indexed kitchenId, address indexed donor, uint256 quantity, uint256 amount);
    event Claimed(bytes32 indexed voucherId, uint256 indexed kitchenId, address indexed recipient);
    event Reserved(bytes32 indexed voucherId, address indexed merchant, uint256 reservedAt);
    event HandoverConfirmed(bytes32 indexed voucherId, address indexed merchant, uint256 handedOverAt);
    event Settled(bytes32 indexed voucherId, address indexed merchant, uint256 amount);

    constructor() {
        if (block.chainid != 10143) revert WrongChain();
        credit = new PilotMealCredit();
    }

    function getKitchen(uint256 kitchenId) external view returns (Kitchen memory) {
        if (kitchenId == 0 || kitchenId > kitchenCount) revert UnknownKitchen();
        return _kitchens[kitchenId];
    }

    function getVoucher(bytes32 voucherId) external view returns (Voucher memory) {
        return _vouchers[voucherId];
    }

    function registerKitchen(string calldata name, uint256 unitPrice) external returns (uint256 kitchenId) {
        if (kitchenCount >= MAX_KITCHENS || bytes(name).length < 2 || bytes(name).length > 64 ||
            unitPrice < 1_000_000 || unitPrice > 20_000_000) revert InvalidInput();
        kitchenId = ++kitchenCount;
        Kitchen storage kitchen = _kitchens[kitchenId];
        kitchen.owner = msg.sender;
        kitchen.name = name;
        kitchen.unitPrice = unitPrice;
        emit KitchenRegistered(kitchenId, msg.sender, name, unitPrice);
    }

    function fund(uint256 kitchenId, uint256 quantity) external nonReentrant {
        Kitchen storage kitchen = _kitchen(kitchenId);
        if (quantity == 0 || quantity > MAX_FUND_QUANTITY) revert InvalidInput();
        uint256 cost = quantity * kitchen.unitPrice;
        bool paid = credit.transferFrom(msg.sender, address(this), cost);
        if (!paid) revert PaymentFailed();
        kitchen.available += quantity;
        kitchen.totalFunded += cost;
        contributions[kitchenId][msg.sender] += cost;
        emit Funded(kitchenId, msg.sender, quantity, cost);
    }

    /// @dev One claim per recipient wallet/kitchen for this MVP.
    function claim(uint256 kitchenId) external returns (bytes32 voucherId) {
        Kitchen storage kitchen = _kitchen(kitchenId);
        if (kitchen.available == 0) revert NoAvailableMeal();
        if (voucherOf[kitchenId][msg.sender] != bytes32(0)) revert AlreadyClaimed();
        voucherId = keccak256(abi.encode(block.chainid, address(this), kitchenId, msg.sender, ++voucherCounter));
        if (voucherId == bytes32(0)) revert InvalidVoucher();
        _vouchers[voucherId] = Voucher(kitchenId, msg.sender, VoucherStatus.Claimed, 1, 0, 0);
        voucherOf[kitchenId][msg.sender] = voucherId;
        kitchen.available -= 1;
        kitchen.issued += 1;
        emit Claimed(voucherId, kitchenId, msg.sender);
    }

    /// @notice Digest which recipient signs as a 32-byte RAW personal message.
    ///         Includes immutable chain, escrow, voucher, nonce, deadline and
    ///         original merchant owner so another contract/store cannot reuse.
    function credentialDigest(bytes32 voucherId, uint256 deadline) public view returns (bytes32) {
        Voucher storage voucher = _vouchers[voucherId];
        if (voucher.recipient == address(0)) revert InvalidVoucher();
        return keccak256(abi.encode(PERMIT_DOMAIN, block.chainid, address(this),
            voucherId, voucher.nonce, deadline, _kitchens[voucher.kitchenId].owner));
    }

    /// @notice Checking signature is NOT proof of physical handover.
    function reserve(bytes32 voucherId, uint256 deadline, bytes calldata recipientSignature) external {
        Voucher storage voucher = _voucher(voucherId);
        Kitchen storage kitchen = _kitchen(voucher.kitchenId);
        if (msg.sender != kitchen.owner) revert NotKitchenOwner();
        if (voucher.status != VoucherStatus.Claimed) revert InvalidStatus();
        if (deadline <= block.timestamp || deadline > block.timestamp + 120 seconds) revert InvalidDeadline();
        bytes32 digest = credentialDigest(voucherId, deadline).toEthSignedMessageHash();
        if (digest.recover(recipientSignature) != voucher.recipient) revert NotRecipient();
        voucher.status = VoucherStatus.Reserved;
        voucher.reservedAt = block.timestamp;
        kitchen.reserved += 1;
        emit Reserved(voucherId, msg.sender, block.timestamp);
    }

    function confirmHandover(bytes32 voucherId) external {
        Voucher storage voucher = _voucher(voucherId);
        Kitchen storage kitchen = _kitchen(voucher.kitchenId);
        if (msg.sender != kitchen.owner) revert NotKitchenOwner();
        if (voucher.status != VoucherStatus.Reserved) revert InvalidStatus();
        voucher.status = VoucherStatus.HandedOver;
        voucher.handedOverAt = block.timestamp;
        kitchen.reserved -= 1;
        kitchen.handedOver += 1;
        emit HandoverConfirmed(voucherId, msg.sender, block.timestamp);
    }

    function settle(bytes32 voucherId) external nonReentrant {
        Voucher storage voucher = _voucher(voucherId);
        Kitchen storage kitchen = _kitchen(voucher.kitchenId);
        if (msg.sender != kitchen.owner) revert NotKitchenOwner();
        if (voucher.status != VoucherStatus.HandedOver) revert InvalidStatus();
        if (block.timestamp < voucher.handedOverAt + SETTLEMENT_DELAY) revert TooEarly();
        voucher.status = VoucherStatus.Settled;
        kitchen.handedOver -= 1;
        kitchen.settled += 1;
        kitchen.totalPaid += kitchen.unitPrice;
        bool paid = credit.transfer(kitchen.owner, kitchen.unitPrice);
        if (!paid) revert PaymentFailed();
        emit Settled(voucherId, msg.sender, kitchen.unitPrice);
    }

    function _kitchen(uint256 kitchenId) internal view returns (Kitchen storage kitchen) {
        if (kitchenId == 0 || kitchenId > kitchenCount) revert UnknownKitchen();
        return _kitchens[kitchenId];
    }

    function _voucher(bytes32 voucherId) internal view returns (Voucher storage voucher) {
        voucher = _vouchers[voucherId];
        if (voucher.recipient == address(0)) revert InvalidVoucher();
    }
}
