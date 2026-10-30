// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ProductCatalog as C} from "../contracts/ProductCatalog.sol";
import {ProductFunding as F} from "../contracts/ProductFunding.sol";

interface ProductVm {
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function expectRevert() external;
}

contract ProductTestAsset is ERC20 {
    bool public chargeFee;
    constructor() ERC20("Synthetic local asset", "LOCAL") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function enableFee() external { chargeFee = true; }
    function _update(address from, address to, uint256 value) internal override {
        if (chargeFee && from != address(0) && to != address(0) && value != 0) {
            super._update(from, address(0), 1);
            super._update(from, to, value - 1);
        } else super._update(from, to, value);
    }
}

/// @dev Test-only local harness. NEVER ship/deploy this empty lifecycle implementation.
contract ProductFundingHarness is F {
    bool public enabled = true;
    error LifecycleNotReady();
    constructor(IERC20 token) F(token) {}
    function disableForTest() external { enabled = false; }
    function _requireLifecycleReady() internal view override {
        if (!enabled) revert LifecycleNotReady();
    }
}

contract ProductFundingTest {
    ProductVm constant vm = ProductVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant OWNER = address(0x101);
    address constant OWNER2 = address(0x102);
    address constant ALICE = address(0x201);
    address constant BOB = address(0x202);
    bytes32 constant STORE = keccak256("synthetic-store-one");
    bytes32 constant STORE2 = keccak256("synthetic-store-two");
    bytes32 constant MEAL = keccak256("synthetic-meal");
    uint256 constant PRICE = 7_000_000;
    uint256 constant START = 1_800_000_000;
    ProductTestAsset token;
    ProductFundingHarness product;

    function setUp() public {
        vm.warp(START);
        token = new ProductTestAsset();
        product = new ProductFundingHarness(token);
        token.mint(ALICE, 1e24);
        token.mint(BOB, 1e24);
        vm.prank(ALICE); token.approve(address(product), type(uint256).max);
        vm.prank(BOB); token.approve(address(product), type(uint256).max);
        vm.prank(OWNER); product.registerStore(bytes32(uint256(1)), STORE);
        vm.prank(OWNER2); product.registerStore(bytes32(uint256(1)), STORE2);
        _publish(OWNER, STORE, 2, 0, PRICE, 20);
    }

    function _terms(uint256 price) internal pure returns (C.TermsInput memory) {
        return C.TermsInput(price, keccak256("body"), keccak256("image"), 2, 660, 840, 1020, 1260);
    }

    function _publish(address owner, bytes32 store, uint256 id, uint256 previous, uint256 price, uint256 quantity)
        internal returns (uint256)
    {
        vm.prank(owner);
        return product.publish(bytes32(id), store, MEAL, previous, _terms(price), quantity, START + 1 days);
    }

    function _request(uint256 id, uint256 quantity) internal view returns (F.FundingRequest memory) {
        return F.FundingRequest(bytes32(id), STORE, MEAL, 1, product.getTerms(STORE, MEAL, 1).termsHash,
            quantity, quantity * PRICE, START + 1 hours);
    }

    function _fund(address payer, uint256 id, uint256 quantity) internal returns (bytes32) {
        F.FundingRequest memory request = _request(id, quantity);
        vm.prank(payer);
        return product.fund(request);
    }

    function _accounting(uint256 quantity, uint256 amount) internal view {
        require(product.totalFundedQuantity() == quantity, "quantity conservation");
        require(product.totalFundedAmount() == amount, "amount conservation");
        require(product.liability() == amount, "liability");
        require(token.balanceOf(address(product)) == amount, "balance conservation");
    }

    function testManyPortionsSupplementAndConcurrentPayers() public {
        bytes32 a = _fund(ALICE, 1, 13);
        bytes32 b = _fund(BOB, 1, 7);
        require(a != b, "payer namespace");
        require(product.availableQuantity(STORE, MEAL, 1) == 0, "initial stock consumed");
        vm.prank(OWNER); product.supplement(bytes32(uint256(3)), STORE, MEAL, 1, 20, START + 2 days);
        _fund(BOB, 2, 20);
        require(product.getOffer(STORE, MEAL, 1).offered == 40, "supplement is additive");
        require(product.getBatch(a).payer == ALICE && product.getBatch(b).payer == BOB, "original payers");
        _accounting(40, 40 * PRICE);
    }

    function testLastStockSerializesOnchainWithoutOverselling() public {
        _fund(ALICE, 1, 19);
        _fund(BOB, 1, 1);
        F.FundingRequest memory request = _request(2, 1);
        vm.prank(ALICE); vm.expectRevert(C.InsufficientInventory.selector); product.fund(request);
        require(!product.getRequest(ALICE, bytes32(uint256(2))).exists, "failed request unconsumed");
        _accounting(20, 20 * PRICE);
    }

    function testVersionChangePreservesOriginalBatchAndTimes() public {
        bytes32 batch = _fund(ALICE, 1, 3);
        C.TermsInput memory next = _terms(9_000_000);
        next.bodyDigest = keccak256("new description");
        next.startMinute0 = 630;
        vm.prank(OWNER); product.publish(bytes32(uint256(3)), STORE, MEAL, 1, next, 10, START + 1 days);
        F.Batch memory old = product.getBatch(batch);
        require(old.unitPrice == PRICE && old.amount == 3 * PRICE && old.version == 1, "old payment unchanged");
        require(product.getTerms(STORE, MEAL, 1).value.startMinute0 == 660, "old service window");
        require(old.termsHash == product.getTerms(STORE, MEAL, 1).termsHash, "old terms unchanged");
        F.FundingRequest memory request = _request(2, 1);
        vm.prank(BOB); vm.expectRevert(C.VersionMismatch.selector); product.fund(request);
        request.version = 2;
        request.termsHash = product.getTerms(STORE, MEAL, 2).termsHash;
        request.expectedAmount = 9_000_000;
        vm.prank(BOB); product.fund(request);
        _accounting(4, 3 * PRICE + 9_000_000);
    }

    function testFundingReplaySurvivesExpiryUnlistingAndVersionChange() public {
        F.FundingRequest memory request = _request(1, 2);
        vm.prank(ALICE); bytes32 first = product.fund(request);
        vm.prank(OWNER); product.setListed(bytes32(uint256(3)), STORE, MEAL, 1, false);
        _publish(OWNER, STORE, 4, 1, PRICE + 1, 30);
        vm.warp(START + 3 days);
        vm.prank(ALICE); bytes32 second = product.fund(request);
        require(first == second, "same result");
        _accounting(2, 2 * PRICE);
        request.quantity = 3;
        request.expectedAmount = 3 * PRICE;
        vm.prank(ALICE); vm.expectRevert(C.RequestConflict.selector); product.fund(request);
    }

    function testCatalogWritesReplayAndRejectChangedPayload() public {
        vm.prank(OWNER); product.registerStore(bytes32(uint256(1)), STORE);
        require(_publish(OWNER, STORE, 2, 0, PRICE, 20) == 1, "publish replay");
        vm.prank(OWNER); product.supplement(bytes32(uint256(3)), STORE, MEAL, 1, 21, START + 2 days);
        vm.prank(OWNER); product.supplement(bytes32(uint256(3)), STORE, MEAL, 1, 21, START + 2 days);
        require(product.getOffer(STORE, MEAL, 1).offered == 41, "no repeated supplement");
        vm.prank(OWNER); vm.expectRevert(C.RequestConflict.selector);
        product.supplement(bytes32(uint256(3)), STORE, MEAL, 1, 22, START + 2 days);
        vm.prank(OWNER); vm.expectRevert(C.RequestConflict.selector);
        product.setListed(bytes32(uint256(3)), STORE, MEAL, 1, false);
    }

    function testOwnershipIsolationAndNoStoreTakeover() public {
        vm.prank(BOB); vm.expectRevert(C.StoreExists.selector); product.registerStore(bytes32(uint256(1)), STORE);
        vm.prank(OWNER2); vm.expectRevert(C.UnauthorizedOwner.selector);
        product.supplement(bytes32(uint256(2)), STORE, MEAL, 1, 20, START + 2 days);
        vm.prank(BOB); vm.expectRevert(C.UnauthorizedOwner.selector);
        product.publish(bytes32(uint256(2)), STORE, MEAL, 1, _terms(PRICE), 10, START + 1 days);
        vm.prank(OWNER2); vm.expectRevert(C.UnauthorizedOwner.selector);
        product.setListed(bytes32(uint256(2)), STORE, MEAL, 1, false);
        _publish(OWNER2, STORE2, 2, 0, PRICE + 1, 5);
        require(product.currentVersion(STORE2, MEAL) == 1, "independent store versions");
        require(product.getTerms(STORE2, MEAL, 1).termsHash != product.getTerms(STORE, MEAL, 1).termsHash,
            "store-bound terms");
    }

    function testUnlistingOnlyChangesFutureFundingNotOriginalBatch() public {
        bytes32 batch = _fund(ALICE, 1, 2);
        vm.prank(OWNER); product.setListed(bytes32(uint256(3)), STORE, MEAL, 1, false);
        vm.prank(OWNER); product.supplement(bytes32(uint256(4)), STORE, MEAL, 1, 20, START + 2 days);
        require(!product.getOffer(STORE, MEAL, 1).listed, "supplement does not relist");
        F.FundingRequest memory request = _request(1, 1);
        vm.prank(BOB); vm.expectRevert(C.OfferUnavailable.selector); product.fund(request);
        require(product.getBatch(batch).quantity == 2, "funded obligations retained");
        vm.prank(OWNER); product.setListed(bytes32(uint256(5)), STORE, MEAL, 1, true);
        vm.prank(BOB); product.fund(request);
        _accounting(3, 3 * PRICE);
    }

    function testDeadlinesAtExactBoundary() public {
        F.FundingRequest memory request = _request(1, 1);
        vm.warp(request.deadline);
        vm.prank(ALICE); vm.expectRevert(F.PaymentExpired.selector); product.fund(request);
        request.deadline = START + 2 days;
        vm.warp(START + 1 days);
        vm.prank(ALICE); vm.expectRevert(C.OfferUnavailable.selector); product.fund(request);
        _accounting(0, 0);
    }

    function testPublicationPreservesUnlistingAndRetiresOldSales() public {
        vm.prank(OWNER); product.setListed(bytes32(uint256(3)), STORE, MEAL, 1, false);
        _publish(OWNER, STORE, 4, 1, PRICE, 5);
        require(!product.getOffer(STORE, MEAL, 2).listed, "publishing must not silently relist");
        F.FundingRequest memory request = _request(1, 1);
        request.version = 2;
        request.termsHash = product.getTerms(STORE, MEAL, 2).termsHash;
        vm.prank(ALICE); vm.expectRevert(C.OfferUnavailable.selector); product.fund(request);
        require(product.availableQuantity(STORE, MEAL, 2) == 5, "explicit replacement stock");
        vm.prank(OWNER); vm.expectRevert(C.VersionMismatch.selector);
        product.setListed(bytes32(uint256(5)), STORE, MEAL, 1, true);
    }

    function testMultiStoreFundingHasIndependentStockAndAggregateAccounting() public {
        _publish(OWNER2, STORE2, 2, 0, 2 * PRICE, 9);
        _fund(ALICE, 1, 4);
        F.FundingRequest memory request = _request(1, 3);
        request.storeId = STORE2;
        request.termsHash = product.getTerms(STORE2, MEAL, 1).termsHash;
        request.expectedAmount = 6 * PRICE;
        vm.prank(BOB); bytes32 batch = product.fund(request);
        require(product.getBatch(batch).storeId == STORE2, "batch store binding");
        require(product.availableQuantity(STORE, MEAL, 1) == 16, "first store stock");
        require(product.availableQuantity(STORE2, MEAL, 1) == 6, "second store stock");
        _accounting(7, 10 * PRICE);
    }

    function testWrongAmountTermsAndZeroQuantityNeverTransfer() public {
        F.FundingRequest memory request = _request(1, 1);
        request.expectedAmount++;
        vm.prank(ALICE); vm.expectRevert(F.AmountMismatch.selector); product.fund(request);
        request.expectedAmount = PRICE;
        request.termsHash = keccak256("wrong terms");
        vm.prank(ALICE); vm.expectRevert(F.TermsMismatch.selector); product.fund(request);
        request = _request(1, 0);
        vm.prank(ALICE); vm.expectRevert(F.AmountMismatch.selector); product.fund(request);
        _accounting(0, 0);
    }

    function testTransferFailureRollsBackInventoryAndRequest() public {
        vm.prank(ALICE); token.approve(address(product), 0);
        F.FundingRequest memory request = _request(1, 1);
        vm.prank(ALICE); vm.expectRevert(); product.fund(request);
        require(product.availableQuantity(STORE, MEAL, 1) == 20, "inventory restored atomically");
        require(!product.getRequest(ALICE, request.requestId).exists, "request not consumed");
        _accounting(0, 0);
        vm.prank(ALICE); token.approve(address(product), PRICE);
        vm.prank(ALICE); product.fund(request);
        _accounting(1, PRICE);
    }

    function testInexactTokenFailsAtomically() public {
        token.enableFee();
        F.FundingRequest memory request = _request(1, 1);
        vm.prank(ALICE); vm.expectRevert(F.InexactTransfer.selector); product.fund(request);
        require(product.availableQuantity(STORE, MEAL, 1) == 20, "fee failure stock unchanged");
        _accounting(0, 0);
    }

    function testUnspecifiedLifecycleCannotAcceptFunds() public {
        product.disableForTest();
        F.FundingRequest memory request = _request(1, 1);
        vm.prank(ALICE); vm.expectRevert(ProductFundingHarness.LifecycleNotReady.selector); product.fund(request);
        require(product.availableQuantity(STORE, MEAL, 1) == 20, "disabled lifecycle");
        _accounting(0, 0);
    }

    function testWindowValidationAndMidnightEnd() public {
        C.TermsInput memory value = _terms(PRICE);
        value.startMinute1 = 800;
        vm.prank(OWNER); vm.expectRevert(C.InvalidCatalog.selector);
        product.publish(bytes32(uint256(3)), STORE, MEAL, 1, value, 1, START + 1 days);
        value = C.TermsInput(PRICE, keccak256("body"), keccak256("image"), 1, 0, 1440, 0, 0);
        vm.prank(OWNER); product.publish(bytes32(uint256(3)), STORE, MEAL, 1, value, 1, START + 1 days);
        require(product.getTerms(STORE, MEAL, 2).value.endMinute0 == 1440, "legal midnight end");
        require(product.UTC_OFFSET_MINUTES() == 480, "Shanghai time offset");
    }

    function testStaleCatalogUpdatesAndInvalidIds() public {
        vm.prank(OWNER); vm.expectRevert(C.VersionMismatch.selector);
        product.publish(bytes32(uint256(3)), STORE, MEAL, 0, _terms(PRICE), 1, START + 1 days);
        vm.prank(OWNER); vm.expectRevert(C.InvalidOffer.selector);
        product.supplement(bytes32(uint256(3)), STORE, MEAL, 1, 0, START + 1 days);
        vm.prank(OWNER); vm.expectRevert(C.InvalidRequest.selector); product.registerStore(bytes32(0), keccak256("new"));
        F.FundingRequest memory request = _request(0, 1);
        vm.prank(ALICE); vm.expectRevert(C.InvalidRequest.selector); product.fund(request);
    }

    function testFuzzQuantityAndConservation(uint64 rawQuantity) public {
        uint256 quantity = uint256(rawQuantity) % 1_000_000 + 1;
        vm.prank(OWNER); product.supplement(bytes32(uint256(3)), STORE, MEAL, 1, quantity, START + 2 days);
        _fund(ALICE, 1, quantity);
        require(product.availableQuantity(STORE, MEAL, 1) == 20, "quantity never narrowed");
        _accounting(quantity, quantity * PRICE);
    }
}
