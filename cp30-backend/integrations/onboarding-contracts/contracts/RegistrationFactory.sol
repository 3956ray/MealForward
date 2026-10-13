// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {StoreEscrow} from "accepted-escrow/StoreEscrow.sol";

/// @notice Candidate registrar-controlled onboarding; owner authorizes each immutable store.
/// @dev Original escrow is imported unchanged. Product publication/readiness is an external gate.
contract RegistrationFactory is EIP712, ReentrancyGuard {
    uint256 public constant MAX_STORES = 3;
    bytes32 public constant REGISTRATION_TYPEHASH = keccak256(
        "Registration(bytes32 registrationId,bytes32 storeId,address owner,bytes32 configHash,uint256 deadline)"
    );

    struct Registration {
        bytes32 registrationId;
        bytes32 storeId;
        address owner;
        bytes32 configHash;
        uint256 deadline;
    }

    struct RegistrationUse {
        bytes32 digest;
        address escrow;
    }

    IERC20 public immutable asset;
    address public immutable registrar;
    address public immutable quoteAuthority;
    address public immutable catalogAuthority;
    address public immutable issuerAuthority;
    address public immutable operatorAuthority;
    bytes32 public immutable escrowCreationCodeHash;
    uint256 public storeCount;
    address[3] public escrows;
    mapping(bytes32 storeId => address escrow) public escrowFor;
    mapping(bytes32 registrationId => RegistrationUse use) public registrationUses;

    error InvalidConfiguration();
    error UnauthorizedRegistrar();
    error InvalidRegistration();
    error ConfigMismatch();
    error RegistrationConflict();
    error RegistrationExpired();
    error UnauthorizedOwner();
    error DuplicateStore();
    error StoreCapExceeded();
    error InvalidEscrowCreationCode();
    error EscrowCreationFailed();

    event StoreCreated(
        bytes32 indexed registrationId,
        bytes32 indexed storeId,
        address indexed escrow,
        address owner,
        bytes32 configHash,
        uint256 slot
    );

    constructor(
        IERC20 asset_,
        address registrar_,
        address quoteAuthority_,
        address catalogAuthority_,
        address issuerAuthority_,
        address operatorAuthority_
    ) EIP712("MealForward Store Registration", "1") {
        if (
            address(asset_).code.length == 0 || registrar_ == address(0) || quoteAuthority_ == address(0)
                || catalogAuthority_ == address(0) || issuerAuthority_ == address(0) || operatorAuthority_ == address(0)
        ) revert InvalidConfiguration();
        asset = asset_;
        registrar = registrar_;
        quoteAuthority = quoteAuthority_;
        catalogAuthority = catalogAuthority_;
        issuerAuthority = issuerAuthority_;
        operatorAuthority = operatorAuthority_;
        // Constructor only: the accepted creation code is not embedded in factory runtime.
        escrowCreationCodeHash = keccak256(type(StoreEscrow).creationCode);
    }

    function computeConfigHash(bytes32 storeId, address owner, StoreEscrow.CatalogEntry[] calldata catalog)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(asset, quoteAuthority, catalogAuthority, issuerAuthority, operatorAuthority, storeId, owner, catalog)
        );
    }

    function registrationDigest(Registration calldata registration) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    REGISTRATION_TYPEHASH,
                    registration.registrationId,
                    registration.storeId,
                    registration.owner,
                    registration.configHash,
                    registration.deadline
                )
            )
        );
    }

    function createStore(
        Registration calldata registration,
        StoreEscrow.CatalogEntry[] calldata catalog,
        bytes calldata ownerSignature,
        bytes calldata escrowCreationCode
    ) external nonReentrant returns (address escrow) {
        if (msg.sender != registrar) revert UnauthorizedRegistrar();
        if (registration.registrationId == 0 || registration.storeId == 0 || registration.owner == address(0)) {
            revert InvalidRegistration();
        }
        if (registration.configHash != computeConfigHash(registration.storeId, registration.owner, catalog)) {
            revert ConfigMismatch();
        }
        if (keccak256(escrowCreationCode) != escrowCreationCodeHash) revert InvalidEscrowCreationCode();
        bytes32 digest = registrationDigest(registration);
        RegistrationUse storage original = registrationUses[registration.registrationId];
        if (original.escrow != address(0)) {
            if (original.digest != digest) revert RegistrationConflict();
            // Successful original authorization is retained: lookup need not re-sign after deadline/revocation.
            return original.escrow;
        }
        if (block.timestamp >= registration.deadline) revert RegistrationExpired();
        if (escrowFor[registration.storeId] != address(0)) revert DuplicateStore();
        if (storeCount == MAX_STORES) revert StoreCapExceeded();
        if (!SignatureChecker.isValidSignatureNow(registration.owner, digest, ownerSignature)) {
            revert UnauthorizedOwner();
        }
        escrow = _createEscrow(registration, catalog, escrowCreationCode);
        uint256 slot = storeCount;
        escrows[slot] = escrow;
        escrowFor[registration.storeId] = escrow;
        registrationUses[registration.registrationId] = RegistrationUse(digest, escrow);
        storeCount = slot + 1;
        emit StoreCreated(
            registration.registrationId, registration.storeId, escrow, registration.owner, registration.configHash, slot
        );
    }

    function _createEscrow(
        Registration calldata registration,
        StoreEscrow.CatalogEntry[] calldata catalog,
        bytes calldata escrowCreationCode
    ) private returns (address escrow) {
        // Caller supplies only hash-pinned original code. The factory builds every constructor argument
        // from the owner-authorized configuration; caller-supplied constructor tails cannot pass the hash.
        bytes memory initcode = bytes.concat(
            escrowCreationCode,
            abi.encode(
                asset,
                registration.storeId,
                registration.owner,
                quoteAuthority,
                StoreEscrow.Authorities(catalogAuthority, issuerAuthority, operatorAuthority),
                catalog
            )
        );
        assembly ("memory-safe") {
            escrow := create(0, add(initcode, 32), mload(initcode))
        }
        if (escrow == address(0)) {
            // Preserve original escrow validation errors; a failed CREATE reserves no registration/slot.
            uint256 size;
            assembly ("memory-safe") { size := returndatasize() }
            if (size == 0) revert EscrowCreationFailed();
            assembly ("memory-safe") {
                let data := mload(0x40)
                returndatacopy(data, 0, size)
                revert(data, size)
            }
        }
    }

}
