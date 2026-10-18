// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Fresh, isolated Monad TESTNET E2E escrow for a human wallet smoke test.
/// @dev NOT a production MealForward contract. Anyone may claim one funded meal.
///      No issuer eligibility proof, no durable offchain Journal, no onchain proof
///      that physical food was served. Never deploy on mainnet or send real USDC.
interface ITestUSDC {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
}

contract MealForwardMonadTestOnly {
    uint256 public constant TEST_CHAIN_ID = 10143;
    ITestUSDC public constant ASSET = ITestUSDC(0x534b2f3A21130d7a60830c2Df862319e593943A3);
    uint256 public constant UNIT_PRICE = 7_000_000;
    uint256 public constant MAX_FUNDED_UNITS = 10;
    uint256 public constant MAX_UNITS_PER_FUND = 2;
    uint256 public constant REPORT_DELAY_SECONDS = 30;
    bytes32 public constant TEST_BUILD_ID = keccak256("MEALFORWARD_MONAD_E2E_TEST_ONLY_20261018");

    enum Stage { NONE, ISSUED, CHECKED, LOCKED, REPORTED, SETTLED }

    struct Voucher {
        address recipient;
        bytes32 secretHash;
        Stage stage;
        uint64 reportedAt;
    }

    address public owner;
    uint256 public totalFunded;
    uint256 public totalSettled;
    uint256 public available;
    uint256 public voucherCount;
    bool public paused;
    uint256 private _reentrancy = 1;

    mapping(uint256 => Voucher) public vouchers;
    mapping(address => uint256) public donorFundedUnits;
    mapping(address => bool) public hasClaimed;

    event Funded(address indexed donor, uint256 indexed quantity, uint256 amount);
    event VoucherClaimed(uint256 indexed voucherId, address indexed recipient, bytes32 secretHash);
    event VoucherChecked(uint256 indexed voucherId, address indexed merchant);
    event VoucherLocked(uint256 indexed voucherId, address indexed merchant);
    event HandoverReported(uint256 indexed voucherId, address indexed merchant, uint256 recordedAt);
    event Settled(uint256 indexed voucherId, address indexed merchant, uint256 amount);
    event PauseChanged(bool paused);

    error WrongChain();
    error Unauthorized();
    error BadInput();
    error WrongStage();
    error BadSecret();
    error NoMeals();
    error AlreadyClaimed();
    error Paused();
    error EarlySettlement();
    error TransferFailed();
    error Reentered();

    constructor() {
        if (block.chainid != TEST_CHAIN_ID) revert WrongChain();
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier active() {
        if (paused) revert Paused();
        _;
    }

    modifier nonReentrant() {
        if (_reentrancy != 1) revert Reentered();
        _reentrancy = 2;
        _;
        _reentrancy = 1;
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PauseChanged(value);
    }

    function fund(uint256 quantity) external nonReentrant active {
        if (quantity == 0 || quantity > MAX_UNITS_PER_FUND ||
            totalFunded + quantity > MAX_FUNDED_UNITS) revert BadInput();
        uint256 amount = quantity * UNIT_PRICE;
        uint256 balanceBefore = ASSET.balanceOf(address(this));
        uint256 donorBefore = ASSET.balanceOf(msg.sender);
        // The Circle Monad testnet USDC at the pinned address is expected to
        // behave as an exact-transfer 6-decimal ERC-20.
        if (!ASSET.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        if (ASSET.balanceOf(address(this)) != balanceBefore + amount ||
            donorBefore < amount ||
            ASSET.balanceOf(msg.sender) != donorBefore - amount) revert TransferFailed();

        totalFunded += quantity;
        available += quantity;
        donorFundedUnits[msg.sender] += quantity;
        emit Funded(msg.sender, quantity, amount);
    }

    /// @notice Open testnet-only self claim. NOT identity eligibility verification.
    /// @param secretHash keccak256 of a 32-byte random secret generated in the
    ///        beneficiary browser and privately handed to the merchant.
    function claim(bytes32 secretHash) external nonReentrant active returns (uint256 voucherId) {
        if (secretHash == bytes32(0)) revert BadInput();
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();
        if (available == 0) revert NoMeals();
        --available;
        hasClaimed[msg.sender] = true;
        voucherId = ++voucherCount;
        vouchers[voucherId] = Voucher(msg.sender, secretHash, Stage.ISSUED, 0);
        emit VoucherClaimed(voucherId, msg.sender, secretHash);
    }

    function checkVoucher(uint256 voucherId, bytes32 secret) external onlyOwner active {
        Voucher storage v = vouchers[voucherId];
        if (v.stage != Stage.ISSUED) revert WrongStage();
        if (keccak256(abi.encodePacked(secret)) != v.secretHash) revert BadSecret();
        v.stage = Stage.CHECKED;
        emit VoucherChecked(voucherId, msg.sender);
    }

    function lock(uint256 voucherId) external onlyOwner active {
        Voucher storage v = vouchers[voucherId];
        if (v.stage != Stage.CHECKED) revert WrongStage();
        v.stage = Stage.LOCKED;
        emit VoucherLocked(voucherId, msg.sender);
    }

    /// @notice Merchant assertion of handover; cannot prove real-world food service.
    function report(uint256 voucherId) external onlyOwner active {
        Voucher storage v = vouchers[voucherId];
        if (v.stage != Stage.LOCKED) revert WrongStage();
        v.stage = Stage.REPORTED;
        v.reportedAt = uint64(block.timestamp);
        emit HandoverReported(voucherId, msg.sender, block.timestamp);
    }

    function settle(uint256 voucherId) external onlyOwner nonReentrant returns (uint256 amount) {
        Voucher storage v = vouchers[voucherId];
        if (v.stage != Stage.REPORTED) revert WrongStage();
        if (block.timestamp < uint256(v.reportedAt) + REPORT_DELAY_SECONDS) revert EarlySettlement();
        amount = UNIT_PRICE;
        v.stage = Stage.SETTLED;
        ++totalSettled;
        uint256 escrowBefore = ASSET.balanceOf(address(this));
        uint256 merchantBefore = ASSET.balanceOf(owner);
        if (escrowBefore < amount || !ASSET.transfer(owner, amount)) revert TransferFailed();
        if (escrowBefore - ASSET.balanceOf(address(this)) != amount ||
            ASSET.balanceOf(owner) - merchantBefore != amount) revert TransferFailed();
        emit Settled(voucherId, msg.sender, amount);
    }

    function liability() external view returns (uint256) {
        return (totalFunded - totalSettled) * UNIT_PRICE;
    }
}
