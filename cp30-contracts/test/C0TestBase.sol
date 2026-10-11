// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StoreEscrow} from "../contracts/StoreEscrow.sol";
import {ThreeStoreFactory} from "../contracts/ThreeStoreFactory.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

interface VmC0 {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }
    function addr(uint256 publicSyntheticFixture) external returns (address);
    function sign(uint256 publicSyntheticFixture, bytes32 digest) external returns (uint8, bytes32, bytes32);
    function prank(address) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function chainId(uint256) external;
    function warp(uint256) external;
    function deal(address, uint256) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
    function roll(uint256) external;
    function writeLine(string calldata path, string calldata data) external;
}

abstract contract C0TestBase {
    VmC0 internal constant vm = VmC0(address(uint160(uint256(keccak256("hevm cheat code")))));
    // Public, deterministic test fixture. Not read from any key/profile/configuration or used on a network.
    uint256 internal constant SYNTHETIC_AUTHORITY_FIXTURE = 0xc030;
    address internal constant PAYER = address(0x101);
    address internal constant OTHER_PAYER = address(0x102);
    bytes32 internal constant MEAL_A = keccak256("synthetic meal A");
    bytes32 internal constant MEAL_B = keccak256("synthetic meal B");
    bytes32 internal constant TERMS_A = keccak256("synthetic A v2 immutable terms");
    bytes32 internal constant TERMS_B = keccak256("synthetic B v1 immutable terms");
    uint256 internal constant PRICE_A = 6_000_000;
    uint256 internal constant PRICE_B = 9_500_000;
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant QUOTE_TYPEHASH_REFERENCE = keccak256(
        "FundingQuote(bytes32 quoteId,address payer,bytes32 mealId,uint256 currentVersion,bytes32 termsHash,uint256 quantity,uint256 unitPrice,uint256 amount,uint256 deadline)"
    );

    MockERC20 internal token;
    ThreeStoreFactory internal factory;
    StoreEscrow[3] internal stores;
    address internal authority;

    function setUp() public virtual {
        vm.chainId(31337);
        vm.warp(1_800_000_000);
        authority = vm.addr(SYNTHETIC_AUTHORITY_FIXTURE);
        token = new MockERC20();
        factory = new ThreeStoreFactory(token, authority, configs());
        for (uint256 i; i < 3; ++i) {
            stores[i] = StoreEscrow(factory.escrows(i));
        }
        token.mint(PAYER, 1e30);
        token.mint(OTHER_PAYER, 1e30);
        for (uint256 i; i < 3; ++i) {
            vm.prank(PAYER);
            token.approve(address(stores[i]), type(uint256).max);
            vm.prank(OTHER_PAYER);
            token.approve(address(stores[i]), type(uint256).max);
        }
    }

    function roles() internal pure returns (StoreEscrow.Authorities memory) {
        return StoreEscrow.Authorities(address(0x401), address(0x402), address(0x403));
    }

    function terms(bytes32 meal, uint256 version, uint256 price, bytes32 body)
        internal
        pure
        returns (StoreEscrow.TermsInput memory)
    {
        return StoreEscrow.TermsInput(meal, version, price, body, keccak256("synthetic image"), 1, 0, 1440, 0, 0);
    }

    function referenceTerms(StoreEscrow escrow, StoreEscrow.TermsInput memory t) internal view returns (bytes32) {
        bytes32 schema = keccak256(
            "MealForwardTerms(uint256 schemaVersion,uint256 chainId,address escrow,bytes32 storeId,bytes32 mealId,uint256 version,address asset,uint256 unitPrice,bytes32 bodyDigest,bytes32 imageDigest,uint8 windowCount,uint16 startMinute0,uint16 endMinute0,uint16 startMinute1,uint16 endMinute1,uint16 utcOffsetMinutes)"
        );
        bytes memory first = abi.encode(
            schema,
            uint256(1),
            block.chainid,
            address(escrow),
            escrow.storeId(),
            t.mealId,
            t.version,
            address(escrow.asset())
        );
        bytes memory last = abi.encode(
            t.unitPrice,
            t.bodyDigest,
            t.imageDigest,
            t.windowCount,
            t.startMinute0,
            t.endMinute0,
            t.startMinute1,
            t.endMinute1,
            uint16(480)
        );
        return keccak256(bytes.concat(first, last));
    }

    function catalog(uint256 price) internal pure returns (StoreEscrow.CatalogEntry[] memory entries) {
        entries = new StoreEscrow.CatalogEntry[](3);
        entries[0] = StoreEscrow.CatalogEntry(terms(MEAL_A, 1, 4_000_000, keccak256("synthetic A v1")), false);
        entries[1] = StoreEscrow.CatalogEntry(terms(MEAL_A, 2, price, TERMS_A), true);
        entries[2] = StoreEscrow.CatalogEntry(terms(MEAL_B, 1, PRICE_B, TERMS_B), true);
    }

    function configs() internal pure returns (ThreeStoreFactory.StoreConfig[3] memory result) {
        for (uint256 i; i < 3; ++i) {
            result[i] = ThreeStoreFactory.StoreConfig(
                bytes32(i + 1),
                address(uint160(0x201 + i)),
                StoreEscrow.Authorities(
                    address(uint160(0x401 + i * 16)), address(uint160(0x402 + i * 16)), address(uint160(0x403 + i * 16))
                ),
                catalog(PRICE_A)
            );
        }
    }

    function quote(address payer, uint256 id, uint256 quantity, bool mealB)
        internal
        view
        returns (StoreEscrow.FundingQuote memory)
    {
        return quoteFor(stores[0], payer, id, quantity, mealB);
    }

    function quoteFor(StoreEscrow escrow, address payer, uint256 id, uint256 quantity, bool mealB)
        internal
        view
        returns (StoreEscrow.FundingQuote memory q)
    {
        StoreEscrow.TermsInput memory t =
            terms(mealB ? MEAL_B : MEAL_A, mealB ? 1 : 2, mealB ? PRICE_B : PRICE_A, mealB ? TERMS_B : TERMS_A);
        q = StoreEscrow.FundingQuote(
            bytes32(id),
            payer,
            t.mealId,
            t.version,
            referenceTerms(escrow, t),
            quantity,
            t.unitPrice,
            quantity * t.unitPrice,
            block.timestamp + 600
        );
    }

    function referenceDigest(StoreEscrow.FundingQuote memory q, uint256 chainId, address verifyingContract)
        internal
        pure
        returns (bytes32)
    {
        // Independently spells out fields to detect a contract-side struct encoding/schema error.
        bytes32 payload = keccak256(
            abi.encode(
                QUOTE_TYPEHASH_REFERENCE,
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
            abi.encode(DOMAIN_TYPEHASH, keccak256("MealForward C0 Funding"), keccak256("1"), chainId, verifyingContract)
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, payload));
    }

    function signature(StoreEscrow escrow, StoreEscrow.FundingQuote memory q) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(SYNTHETIC_AUTHORITY_FIXTURE, referenceDigest(q, block.chainid, address(escrow)));
        return abi.encodePacked(r, s, v);
    }

    function fund(StoreEscrow escrow, StoreEscrow.FundingQuote memory q) internal returns (bytes32) {
        bytes memory sig = signature(escrow, q);
        vm.prank(q.payer);
        return escrow.fund(q, sig);
    }

    function refund(StoreEscrow escrow, address payer, bytes32 batchId, uint16 mask) internal returns (uint256) {
        vm.prank(payer);
        return escrow.refund(batchId, mask);
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "uint mismatch");
    }

    function assertEq(address actual, address expected) internal pure {
        require(actual == expected, "address mismatch");
    }

    function assertEq(bytes32 actual, bytes32 expected) internal pure {
        require(actual == expected, "bytes32 mismatch");
    }

    function assertTrue(bool value) internal pure {
        require(value, "assertion false");
    }

    function countBits(uint16 mask) internal pure returns (uint256 count) {
        for (uint256 i; i < 10; ++i) {
            if (uint256(mask) & (1 << i) != 0) ++count;
        }
    }
}
