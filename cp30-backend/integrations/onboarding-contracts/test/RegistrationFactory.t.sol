// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RegistrationFactory} from "../contracts/RegistrationFactory.sol";
import {StoreEscrow} from "accepted-escrow/StoreEscrow.sol";
import {EscrowRuntimeReference} from "./EscrowRuntimeReference.sol";

interface VmRegistration {
    struct Log { bytes32[] topics; bytes data; address emitter; }
    function addr(uint256 publicSyntheticFixture) external returns (address);
    function sign(uint256 publicSyntheticFixture, bytes32 digest) external returns (uint8, bytes32, bytes32);
    function prank(address) external;
    function expectRevert(bytes4 selector) external;
    function warp(uint256 timestamp) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
    function getNonce(address account) external returns (uint64);
    function getCode(string calldata artifactPath) external returns (bytes memory);
    function getDeployedCode(string calldata artifactPath) external returns (bytes memory);
}

// Constructor only checks deployed asset code. No external token calls are made by these registration cases.
contract SyntheticAsset {}

/// @dev Public synthetic fixtures on the in-process EVM only.
contract RegistrationFactoryTest {
    VmRegistration internal constant vm = VmRegistration(address(uint160(uint256(keccak256("hevm cheat code")))));
    // Public in-process fixture only; never loaded from any wallet, profile or secret file.
    uint256 internal constant OWNER_FIXTURE = 0xc03001;
    uint256 internal constant OTHER_FIXTURE = 0xc03002;
    address internal constant REGISTRAR = address(0x401);
    RegistrationFactory internal factory;
    address internal owner;
    IERC20 internal asset;
    bytes internal escrowCreationCode;

    function setUp() public {
        owner = vm.addr(OWNER_FIXTURE);
        asset = IERC20(address(new SyntheticAsset()));
        bytes memory initcode = bytes.concat(vm.getCode("RegistrationFactory.sol:RegistrationFactory"),
            abi.encode(asset, REGISTRAR, address(0x402), address(0x403), address(0x404), address(0x405)));
        address created;
        assembly ("memory-safe") { created := create(0, add(initcode, 32), mload(initcode)) }
        require(created != address(0), "factory fits standard EIP170/EIP3860");
        factory = RegistrationFactory(created);
        escrowCreationCode = vm.getCode("StoreEscrow.sol:StoreEscrow");
        require(factory.escrowCreationCodeHash() == keccak256(escrowCreationCode), "fixed original code hash");
    }

    function catalog() internal pure returns (StoreEscrow.CatalogEntry[] memory c) {
        c = new StoreEscrow.CatalogEntry[](1);
        c[0] = StoreEscrow.CatalogEntry(
            StoreEscrow.TermsInput(keccak256("public synthetic first-meal draft"), 1, 1,
                keccak256("synthetic body"), keccak256("synthetic image"), 1, 0, 1440, 0, 0), true
        );
    }

    function registration(uint256 id, uint256 store, StoreEscrow.CatalogEntry[] memory c)
        internal view returns (RegistrationFactory.Registration memory r)
    {
        r = RegistrationFactory.Registration(bytes32(id), bytes32(store), owner,
            factory.computeConfigHash(bytes32(store), owner, c), block.timestamp + 600);
    }

    function signature(RegistrationFactory.Registration memory r, uint256 fixture)
        internal returns (bytes memory)
    {
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(fixture, factory.registrationDigest(r));
        return abi.encodePacked(rs, ss, v);
    }

    function create(RegistrationFactory.Registration memory r, StoreEscrow.CatalogEntry[] memory c)
        internal returns (address)
    {
        bytes memory sig = signature(r, OWNER_FIXTURE);
        vm.prank(REGISTRAR);
        return factory.createStore(r, c, sig, escrowCreationCode);
    }

    function testExactReplayAfterExpiryCreatesNothingAndEmitsNothing() public {
        StoreEscrow.CatalogEntry[] memory c = catalog();
        RegistrationFactory.Registration memory r = registration(1, 1, c);
        address escrow = create(r, c);
        uint64 nonce = vm.getNonce(address(factory));
        vm.warp(r.deadline);
        vm.recordLogs();
        vm.prank(REGISTRAR);
        require(factory.createStore(r, c, hex"", escrowCreationCode) == escrow, "original result");
        require(factory.storeCount() == 1 && vm.getNonce(address(factory)) == nonce, "no second CREATE");
        require(vm.getRecordedLogs().length == 0, "no second creation event");
    }

    function testConflictingDeadlineOwnerStoreAndCatalogReject() public {
        StoreEscrow.CatalogEntry[] memory c = catalog();
        RegistrationFactory.Registration memory original = registration(1, 1, c);
        create(original, c);
        RegistrationFactory.Registration memory r = registration(1, 1, c);
        r.deadline += 1;
        vm.expectRevert(RegistrationFactory.RegistrationConflict.selector);
        vm.prank(REGISTRAR); factory.createStore(r, c, hex"", escrowCreationCode);
        r = registration(1, 2, c);
        vm.expectRevert(RegistrationFactory.RegistrationConflict.selector);
        vm.prank(REGISTRAR); factory.createStore(r, c, hex"", escrowCreationCode);
        r = registration(1, 1, c);
        r.owner = vm.addr(OTHER_FIXTURE);
        r.configHash = factory.computeConfigHash(r.storeId, r.owner, c);
        vm.expectRevert(RegistrationFactory.RegistrationConflict.selector);
        vm.prank(REGISTRAR); factory.createStore(r, c, hex"", escrowCreationCode);
        c[0].terms.unitPrice = 2;
        r = registration(1, 1, c);
        vm.expectRevert(RegistrationFactory.RegistrationConflict.selector);
        vm.prank(REGISTRAR); factory.createStore(r, c, hex"", escrowCreationCode);
        require(factory.storeCount() == 1, "conflicts preserve slot");
    }

    function testRegistrarRequiredForCreationAndReplay() public {
        StoreEscrow.CatalogEntry[] memory c = catalog();
        RegistrationFactory.Registration memory r = registration(1, 1, c);
        bytes memory sig = signature(r, OWNER_FIXTURE);
        vm.expectRevert(RegistrationFactory.UnauthorizedRegistrar.selector);
        factory.createStore(r, c, sig, escrowCreationCode);
        create(r, c);
        vm.expectRevert(RegistrationFactory.UnauthorizedRegistrar.selector);
        factory.createStore(r, c, sig, escrowCreationCode);
    }

    function testWrongOwnerSignatureAndWrongFactoryDomainReject() public {
        StoreEscrow.CatalogEntry[] memory c = catalog();
        RegistrationFactory.Registration memory r = registration(1, 1, c);
        bytes memory wrongOwner = signature(r, OTHER_FIXTURE);
        vm.expectRevert(RegistrationFactory.UnauthorizedOwner.selector);
        vm.prank(REGISTRAR); factory.createStore(r, c, wrongOwner, escrowCreationCode);
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("MealForward Store Registration"), keccak256("1"), block.chainid, address(0x999)
        ));
        bytes32 structHash = keccak256(abi.encode(factory.REGISTRATION_TYPEHASH(), r));
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(OWNER_FIXTURE,
            keccak256(abi.encodePacked(hex"1901", domain, structHash)));
        vm.expectRevert(RegistrationFactory.UnauthorizedOwner.selector);
        vm.prank(REGISTRAR); factory.createStore(r, c, abi.encodePacked(rs, ss, v), escrowCreationCode);
        require(factory.storeCount() == 0, "no unauthorized slot");
    }

    function testThreeDistinctEscrowsDuplicateStoreAndFourthReject() public {
        StoreEscrow.CatalogEntry[] memory c = catalog();
        address first;
        for (uint256 i = 1; i <= 3; ++i) {
            address escrow = create(registration(i, i, c), c);
            if (i == 1) first = escrow;
            else require(first != escrow, "separate escrow");
            StoreEscrow s = StoreEscrow(escrow);
            require(s.storeId() == bytes32(i) && s.owner() == owner && s.receiver() == owner, "immutable store/receiver");
            require(address(s.asset()) == address(asset) && s.catalogAuthority() == address(0x403)
                && s.issuerAuthority() == address(0x404) && s.operatorAuthority() == address(0x405)
                && s.quoteAuthority() == address(0x402), "immutable authorities");
            require(keccak256(EscrowRuntimeReference.normalize(escrow.code))
                == keccak256(vm.getDeployedCode("StoreEscrow.sol:StoreEscrow")), "original independent runtime template");
            require(factory.escrows(i - 1) == escrow && factory.escrowFor(bytes32(i)) == escrow, "indexed result");
        }
        RegistrationFactory.Registration memory r = registration(4, 1, c);
        bytes memory sig = signature(r, OWNER_FIXTURE);
        vm.expectRevert(RegistrationFactory.DuplicateStore.selector);
        vm.prank(REGISTRAR); factory.createStore(r, c, sig, escrowCreationCode);
        r = registration(4, 4, c); sig = signature(r, OWNER_FIXTURE);
        vm.expectRevert(RegistrationFactory.StoreCapExceeded.selector);
        vm.prank(REGISTRAR); factory.createStore(r, c, sig, escrowCreationCode);
        require(factory.storeCount() == 3, "three maximum");
    }

    function testExpiredAndInvalidCatalogDoNotReserveRegistrationOrStore() public {
        StoreEscrow.CatalogEntry[] memory c = catalog();
        RegistrationFactory.Registration memory r = registration(1, 1, c);
        r.deadline = block.timestamp;
        bytes memory sig = signature(r, OWNER_FIXTURE);
        vm.expectRevert(RegistrationFactory.RegistrationExpired.selector);
        vm.prank(REGISTRAR); factory.createStore(r, c, sig, escrowCreationCode);
        c[0].terms.unitPrice = 0;
        r = registration(1, 1, c); sig = signature(r, OWNER_FIXTURE);
        vm.expectRevert(StoreEscrow.InvalidCatalog.selector);
        vm.prank(REGISTRAR); factory.createStore(r, c, sig, escrowCreationCode);
        (, address used) = factory.registrationUses(bytes32(uint256(1)));
        require(factory.storeCount() == 0 && used == address(0)
            && factory.escrowFor(bytes32(uint256(1))) == address(0), "failure does not occupy");
        c = catalog();
        require(create(registration(1, 1, c), c) != address(0), "retry same ids after failed constructor");
    }

    function testWrongBytecodeEmptyAlteredOrAppendedRejectsEvenSuccessfulReplay() public {
        StoreEscrow.CatalogEntry[] memory c = catalog();
        RegistrationFactory.Registration memory r = registration(1, 1, c);
        bytes memory sig = signature(r, OWNER_FIXTURE);
        bytes memory altered = vm.getCode("StoreEscrow.sol:StoreEscrow");
        altered[0] = bytes1(uint8(altered[0]) ^ 1);
        vm.expectRevert(RegistrationFactory.InvalidEscrowCreationCode.selector);
        vm.prank(REGISTRAR); factory.createStore(r, c, sig, altered);
        vm.expectRevert(RegistrationFactory.InvalidEscrowCreationCode.selector);
        vm.prank(REGISTRAR); factory.createStore(r, c, sig, hex"");
        bytes memory appended = bytes.concat(escrowCreationCode, abi.encode(address(0x999)));
        vm.expectRevert(RegistrationFactory.InvalidEscrowCreationCode.selector);
        vm.prank(REGISTRAR); factory.createStore(r, c, sig, appended);
        require(factory.storeCount() == 0, "bad code never occupies slot");
        create(r, c);
        vm.warp(r.deadline);
        vm.expectRevert(RegistrationFactory.InvalidEscrowCreationCode.selector);
        vm.prank(REGISTRAR); factory.createStore(r, c, hex"", appended);
        vm.expectRevert(RegistrationFactory.UnauthorizedRegistrar.selector);
        factory.createStore(r, c, hex"", escrowCreationCode);
        address original = factory.escrowFor(r.storeId);
        vm.prank(REGISTRAR);
        require(factory.createStore(r, c, hex"", escrowCreationCode) == original, "exact replay succeeds");
    }

    function testIndependentConfigHashAndRegistrationDomainReference() public {
        StoreEscrow.CatalogEntry[] memory c = catalog();
        RegistrationFactory.Registration memory r = registration(1, 1, c);
        bytes32 config = keccak256(abi.encode(asset, address(0x402), address(0x403), address(0x404),
            address(0x405), bytes32(uint256(1)), owner, c));
        require(r.configHash == config, "complete immutable parameters/catalog hash");
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("MealForward Store Registration"), keccak256("1"), block.chainid, address(factory)
        ));
        bytes32 payload = keccak256(abi.encode(
            keccak256("Registration(bytes32 registrationId,bytes32 storeId,address owner,bytes32 configHash,uint256 deadline)"),
            r.registrationId, r.storeId, r.owner, r.configHash, r.deadline
        ));
        require(factory.registrationDigest(r) == keccak256(abi.encodePacked(hex"1901", domain, payload)), "independent EIP712 digest");
    }
}
