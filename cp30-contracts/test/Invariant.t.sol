// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {C0TestBase, StoreEscrow, MockERC20, VmC0} from "./C0TestBase.sol";

/// @dev Independent chosen-unit/payment reference model; never derives successful-action expectations from escrow getters.
contract FinancialHandler {
    VmC0 private constant vm = VmC0(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SYNTHETIC_AUTHORITY_FIXTURE = 0xc030;
    uint256 public constant INITIAL_BALANCE = 1e24;
    bytes32 private constant MEAL_A = keccak256("synthetic meal A");
    bytes32 private constant MEAL_B = keccak256("synthetic meal B");
    bytes32 private constant TERMS_A = keccak256("synthetic A v2 immutable terms");
    bytes32 private constant TERMS_B = keccak256("synthetic B v1 immutable terms");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant QUOTE_TYPEHASH = keccak256(
        "FundingQuote(bytes32 quoteId,address payer,bytes32 mealId,uint256 currentVersion,bytes32 termsHash,uint256 quantity,uint256 unitPrice,uint256 amount,uint256 deadline)"
    );

    struct ModelBatch {
        bytes32 id;
        StoreEscrow.FundingQuote quote;
        uint256 firstUnit;
        uint16 refundedMask;
    }

    MockERC20 public immutable token;
    StoreEscrow[3] private _stores;
    address[4] public payers;
    ModelBatch[10][3] private _model;
    uint256[3] public batchCounts;
    uint256[3] public fundedUnits;
    uint256[3] public refundedUnits;
    uint256[3] public paidAmount;
    uint256[3] public refundedAmount;
    uint256[3] public donations;
    mapping(address => uint256) public payerPaid;
    mapping(address => uint256) public payerRefund;
    mapping(address => uint256) public payerDonation;
    uint256 private _nextQuote;

    uint256 public successfulFunds;
    uint256 public successfulRefunds;
    uint256 public successfulDonations;
    uint256 public successfulReplays;
    uint256 public rejectedTampering;
    uint256 public rejectedForeignRefunds;
    uint256 public rejectedCap;
    uint256 public refundNoops;
    uint256 public mealAFunds;
    uint256 public mealBFunds;

    constructor(MockERC20 token_, StoreEscrow[3] memory stores_) {
        token = token_;
        _stores = stores_;
        for (uint256 i; i < 4; ++i) {
            address payer = address(uint160(0x301 + i));
            payers[i] = payer;
            token_.mint(payer, INITIAL_BALANCE);
            for (uint256 j; j < 3; ++j) {
                vm.prank(payer);
                token_.approve(address(stores_[j]), type(uint256).max);
            }
        }
    }

    function bootstrap() external {
        require(successfulFunds == 0, "bootstrap once");
        for (uint8 i; i < 3; ++i) {
            fundAction(i, i, 1, false); // Two original A units per store.
            refundAction(i, 0, 1); // One X and one remaining A.
            donateAction(i, i, 0);
        }
    }

    function _quote(StoreEscrow escrow, uint256 payerIndex, uint256 quantity, bool mealB)
        private
        returns (StoreEscrow.FundingQuote memory q)
    {
        uint256 price = mealB ? 9_500_000 : 6_000_000;
        q = StoreEscrow.FundingQuote(
            bytes32(++_nextQuote),
            payers[payerIndex],
            mealB ? MEAL_B : MEAL_A,
            mealB ? 1 : 2,
            referenceTerms(escrow, mealB, price),
            quantity,
            price,
            quantity * price,
            block.timestamp + 600
        );
    }

    function referenceTerms(StoreEscrow escrow, bool mealB, uint256 price) private view returns (bytes32) {
        bytes32 schema = keccak256(
            "MealForwardTerms(uint256 schemaVersion,uint256 chainId,address escrow,bytes32 storeId,bytes32 mealId,uint256 version,address asset,uint256 unitPrice,bytes32 bodyDigest,bytes32 imageDigest,uint8 windowCount,uint16 startMinute0,uint16 endMinute0,uint16 startMinute1,uint16 endMinute1,uint16 utcOffsetMinutes)"
        );
        return keccak256(
            bytes.concat(
                abi.encode(
                    schema,
                    uint256(1),
                    block.chainid,
                    address(escrow),
                    escrow.storeId(),
                    mealB ? MEAL_B : MEAL_A,
                    uint256(mealB ? 1 : 2),
                    address(token)
                ),
                abi.encode(
                    price,
                    mealB ? TERMS_B : TERMS_A,
                    keccak256("synthetic image"),
                    uint8(1),
                    uint16(0),
                    uint16(1440),
                    uint16(0),
                    uint16(0),
                    uint16(480)
                )
            )
        );
    }

    function _signature(StoreEscrow escrow, StoreEscrow.FundingQuote memory q) private returns (bytes memory) {
        bytes32 payload = keccak256(
            abi.encode(
                QUOTE_TYPEHASH,
                q.quoteId,
                q.payer,
                q.mealId,
                q.currentVersion,
                q.termsHash,
                q.quantity,
                q.unitPrice,
                q.amount,
                q.deadline
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256("MealForward C0 Funding"), keccak256("1"), block.chainid, address(escrow)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(SYNTHETIC_AUTHORITY_FIXTURE, keccak256(abi.encodePacked("\x19\x01", domain, payload)));
        return abi.encodePacked(r, s, v);
    }

    function fundAction(uint8 storeSeed, uint8 payerSeed, uint8 quantitySeed, bool mealB) public {
        uint256 store = uint256(storeSeed) % 3;
        StoreEscrow escrow = _stores[store];
        uint256 remaining = 10 - fundedUnits[store];
        uint256 maxQuantity = remaining < 3 ? remaining : 3;
        uint256 quantity = remaining == 0 ? 1 : uint256(quantitySeed) % maxQuantity + 1;
        StoreEscrow.FundingQuote memory q = _quote(escrow, uint256(payerSeed) % 4, quantity, mealB);
        bytes memory sig = _signature(escrow, q);
        vm.prank(q.payer);
        if (remaining == 0) {
            (bool ok, bytes memory errorData) = address(escrow).call(abi.encodeCall(StoreEscrow.fund, (q, sig)));
            require(!ok && bytes4(errorData) == StoreEscrow.CapExceeded.selector, "cap not rejected");
            ++rejectedCap;
            return;
        }
        bytes32 id = escrow.fund(q, sig);
        require(id == keccak256(abi.encode(block.chainid, address(escrow), q.quoteId)), "wrong batch domain");
        _model[store][batchCounts[store]++] = ModelBatch(id, q, fundedUnits[store], 0);
        fundedUnits[store] += quantity;
        paidAmount[store] += q.amount;
        payerPaid[q.payer] += q.amount;
        ++successfulFunds;
        if (mealB) ++mealBFunds;
        else ++mealAFunds;
    }

    function refundAction(uint8 storeSeed, uint8 batchSeed, uint16 maskSeed) public {
        uint256 store = uint256(storeSeed) % 3;
        ModelBatch storage batch = _model[store][uint256(batchSeed) % batchCounts[store]];
        uint16 remaining = uint16((1 << batch.quote.quantity) - 1) ^ batch.refundedMask;
        if (remaining == 0) {
            ++refundNoops;
            return;
        }
        uint16 mask = maskSeed & remaining;
        if (mask == 0) mask = remaining & (~remaining + 1);
        uint256 quantity = _count(mask);
        uint256 expectedAmount = quantity * batch.quote.unitPrice;
        vm.prank(batch.quote.payer);
        require(_stores[store].refund(batch.id, mask) == expectedAmount, "refund not original price");
        batch.refundedMask |= mask;
        refundedUnits[store] += quantity;
        refundedAmount[store] += expectedAmount;
        payerRefund[batch.quote.payer] += expectedAmount;
        ++successfulRefunds;
    }

    function donateAction(uint8 storeSeed, uint8 payerSeed, uint32 amountSeed) public {
        uint256 store = uint256(storeSeed) % 3;
        address payer = payers[uint256(payerSeed) % 4];
        uint256 amount = uint256(amountSeed) + 1;
        vm.prank(payer);
        require(token.transfer(address(_stores[store]), amount), "donation transfer");
        donations[store] += amount;
        payerDonation[payer] += amount;
        ++successfulDonations;
    }

    function replayAction(uint8 storeSeed, uint8 batchSeed) external {
        uint256 store = uint256(storeSeed) % 3;
        ModelBatch memory batch = _model[store][uint256(batchSeed) % batchCounts[store]];
        StoreEscrow escrow = _stores[store];
        bytes memory sig = _signature(escrow, batch.quote);
        uint256 payerBefore = token.balanceOf(batch.quote.payer);
        uint256 escrowBefore = token.balanceOf(address(escrow));
        vm.prank(batch.quote.payer);
        require(escrow.fund(batch.quote, sig) == batch.id, "replay changed result");
        require(
            token.balanceOf(batch.quote.payer) == payerBefore && token.balanceOf(address(escrow)) == escrowBefore,
            "replay transferred funds"
        );
        ++successfulReplays;
    }

    function tamperAction(uint8 storeSeed, uint8 payerSeed) external {
        uint256 store = uint256(storeSeed) % 3;
        StoreEscrow escrow = _stores[store];
        StoreEscrow.FundingQuote memory q = _quote(escrow, uint256(payerSeed) % 4, 1, false);
        bytes memory sig = _signature(escrow, q);
        ++q.amount;
        vm.prank(q.payer);
        (bool ok, bytes memory errorData) = address(escrow).call(abi.encodeCall(StoreEscrow.fund, (q, sig)));
        require(!ok && bytes4(errorData) == StoreEscrow.UnauthorizedQuote.selector, "tamper accepted");
        ++rejectedTampering;
    }

    function foreignRefundAction(uint8 storeSeed, uint8 batchSeed, bool crossStore) external {
        uint256 store = uint256(storeSeed) % 3;
        ModelBatch memory batch = _model[store][uint256(batchSeed) % batchCounts[store]];
        StoreEscrow escrow = _stores[crossStore ? (store + 1) % 3 : store];
        address wrongPayer = batch.quote.payer == payers[0] ? payers[1] : payers[0];
        vm.prank(crossStore ? batch.quote.payer : wrongPayer);
        (bool ok, bytes memory errorData) =
            address(escrow).call(abi.encodeCall(StoreEscrow.refund, (batch.id, uint16(1))));
        bytes4 expected = crossStore ? StoreEscrow.InvalidBatch.selector : StoreEscrow.UnauthorizedPayer.selector;
        require(!ok && bytes4(errorData) == expected, "foreign refund accepted");
        ++rejectedForeignRefunds;
    }

    function _count(uint16 mask) private pure returns (uint256 count) {
        for (uint256 i; i < 10; ++i) {
            if (uint256(mask) & (uint256(1) << i) != 0) ++count;
        }
    }

    function assertReferencePartition() external view {
        for (uint256 store; store < 3; ++store) {
            StoreEscrow escrow = _stores[store];
            uint256 originalSequence;
            uint256 a;
            uint256 x;
            uint256 xCount;
            for (uint256 j; j < batchCounts[store]; ++j) {
                ModelBatch memory expected = _model[store][j];
                StoreEscrow.Batch memory actual = escrow.getBatch(expected.id);
                require(
                    actual.payer == expected.quote.payer && actual.mealId == expected.quote.mealId
                        && actual.version == expected.quote.currentVersion
                        && actual.termsHash == expected.quote.termsHash,
                    "original binding changed"
                );
                require(
                    actual.unitPrice == expected.quote.unitPrice && actual.quantity == expected.quote.quantity
                        && actual.firstUnit == originalSequence && actual.refundedMask == expected.refundedMask,
                    "unit partition changed"
                );
                require(uint256(actual.refundedMask) < (1 << actual.quantity), "foreign unit bit");
                uint256 returnedCount = _count(expected.refundedMask);
                originalSequence += expected.quote.quantity;
                xCount += returnedCount;
                x += returnedCount * expected.quote.unitPrice;
                a += (expected.quote.quantity - returnedCount) * expected.quote.unitPrice;
            }
            require(originalSequence == fundedUnits[store] && originalSequence <= 10, "lifetime sequence/cap");
            require(
                escrow.lifetimeFundedUnits() == originalSequence && escrow.refundedUnits() == xCount
                    && escrow.availableUnits() == originalSequence - xCount,
                "unit counts"
            );
            require(x == refundedAmount[store] && a + x == paidAmount[store], "reference amount partition");
            require(
                escrow.totalFundedAmount() == paidAmount[store] && escrow.availableAmount() == a
                    && escrow.totalRefundedAmount() == x && escrow.liability() == a,
                "financial bucket mismatch"
            );
            require(
                token.balanceOf(address(escrow)) == a + donations[store] && escrow.surplus() == donations[store],
                "custody/surplus mismatch"
            );
        }
        for (uint256 i; i < 4; ++i) {
            address payer = payers[i];
            require(
                token.balanceOf(payer)
                    == INITIAL_BALANCE - payerPaid[payer] + payerRefund[payer] - payerDonation[payer],
                "payer actual debit/credit mismatch"
            );
        }
    }
}

contract FinancialInvariantTest is C0TestBase {
    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    struct FuzzArtifactSelector {
        string artifact;
        bytes4[] selectors;
    }

    struct FuzzInterface {
        address addr;
        string[] artifacts;
    }
    FinancialHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new FinancialHandler(token, stores);
        handler.bootstrap();
    }

    function targetContracts() external view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function targetSelectors() external view returns (FuzzSelector[] memory targets) {
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = FinancialHandler.fundAction.selector;
        selectors[1] = FinancialHandler.refundAction.selector;
        selectors[2] = FinancialHandler.donateAction.selector;
        selectors[3] = FinancialHandler.replayAction.selector;
        selectors[4] = FinancialHandler.tamperAction.selector;
        selectors[5] = FinancialHandler.foreignRefundAction.selector;
        targets = new FuzzSelector[](1);
        targets[0] = FuzzSelector(address(handler), selectors);
    }

    // Empty optional discovery lists keep the installed runner's target selection explicit.
    function targetArtifactSelectors() external pure returns (FuzzArtifactSelector[] memory) {
        return new FuzzArtifactSelector[](0);
    }

    function targetArtifacts() external pure returns (string[] memory) {
        return new string[](0);
    }

    function excludeArtifacts() external pure returns (string[] memory) {
        return new string[](0);
    }

    function targetSenders() external pure returns (address[] memory) {
        return new address[](0);
    }

    function excludeSenders() external pure returns (address[] memory) {
        return new address[](0);
    }

    function excludeContracts() external pure returns (address[] memory) {
        return new address[](0);
    }

    function targetInterfaces() external pure returns (FuzzInterface[] memory) {
        return new FuzzInterface[](0);
    }

    function excludeSelectors() external pure returns (FuzzSelector[] memory) {
        return new FuzzSelector[](0);
    }

    function invariantIndependentOriginalUnitAndPayerReference() public view {
        handler.assertReferencePartition();
    }

    function afterInvariant() public {
        // Bootstrap provides a deterministic A/X/surplus floor; random actions must also exercise every selector path.
        assertTrue(
            handler.successfulFunds() > 3 && handler.successfulRefunds() > 3 && handler.successfulDonations() > 3
        );
        assertTrue(
            handler.successfulReplays() > 0 && handler.rejectedTampering() > 0 && handler.rejectedForeignRefunds() > 0
                && handler.rejectedCap() > 0
        );
        // Evidence-only file permission, no FFI or credential/network access. One row per completed random run.
        string memory row = string.concat(
            '{"funds":',
            decimal(handler.successfulFunds()),
            ',"refunds":',
            decimal(handler.successfulRefunds()),
            ',"donations":',
            decimal(handler.successfulDonations()),
            ',"replays":',
            decimal(handler.successfulReplays())
        );
        row = string.concat(
            row,
            ',"rejectedTamper":',
            decimal(handler.rejectedTampering()),
            ',"rejectedForeign":',
            decimal(handler.rejectedForeignRefunds()),
            ',"rejectedCap":',
            decimal(handler.rejectedCap()),
            ',"refundNoops":',
            decimal(handler.refundNoops())
        );
        row = string.concat(
            row,
            ',"mealAFunds":',
            decimal(handler.mealAFunds()),
            ',"mealBFunds":',
            decimal(handler.mealBFunds()),
            ',"storeFundedUnits":['
        );
        for (uint256 i; i < 3; ++i) {
            row = string.concat(row, i == 0 ? "" : ",", decimal(handler.fundedUnits(i)));
        }
        row = string.concat(row, '],"storeRefundedUnits":[');
        for (uint256 i; i < 3; ++i) {
            row = string.concat(row, i == 0 ? "" : ",", decimal(handler.refundedUnits(i)));
        }
        vm.writeLine("evidence/s0b/c0-invariant-actions.jsonl", string.concat(row, "]}"));
    }

    function decimal(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 n = value;
        uint256 digits;
        while (n != 0) {
            ++digits;
            n /= 10;
        }
        bytes memory result = new bytes(digits);
        while (value != 0) {
            result[--digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(result);
    }

    function testHandlerReachabilityAndOriginalPayerReference() public {
        for (uint8 i; i < 3; ++i) {
            handler.fundAction(i, 3, 2, true);
            handler.refundAction(i, 1, 5);
            handler.replayAction(i, 1);
            handler.tamperAction(i, 0);
            handler.foreignRefundAction(i, 1, false);
            handler.foreignRefundAction(i, 1, true);
            handler.fundAction(i, 1, 2, false);
            handler.fundAction(i, 2, 1, true);
            handler.fundAction(i, 2, 0, true);
        }
        handler.assertReferencePartition();
        assertEq(handler.successfulFunds(), 12);
        assertEq(handler.successfulRefunds(), 6);
        assertEq(handler.successfulDonations(), 3);
        assertEq(handler.successfulReplays(), 3);
        assertEq(handler.rejectedTampering(), 3);
        assertEq(handler.rejectedForeignRefunds(), 6);
        assertEq(handler.rejectedCap(), 3);
    }
}
