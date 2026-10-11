// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StoreEscrow} from "./StoreEscrow.sol";

/// @notice Constructor-controlled, atomic creation of exactly three fixed store escrows.
/// @dev No callable registration, fourth slot, administrator, upgrade, withdrawal or configuration setter.
contract ThreeStoreFactory {
    struct StoreConfig {
        bytes32 storeId;
        address owner;
        StoreEscrow.Authorities authorities;
        StoreEscrow.CatalogEntry[] catalog;
    }

    IERC20 public immutable asset;
    address public immutable quoteAuthority;
    address[3] public escrows;
    mapping(bytes32 storeId => address escrow) public escrowFor;

    error InvalidConfiguration();
    error DuplicateStore();

    event StoreCreated(uint256 indexed slot, bytes32 indexed storeId, address indexed escrow, address owner);

    constructor(IERC20 asset_, address quoteAuthority_, StoreConfig[3] memory configs) {
        if (address(asset_).code.length == 0 || quoteAuthority_ == address(0)) revert InvalidConfiguration();
        asset = asset_;
        quoteAuthority = quoteAuthority_;
        for (uint256 i; i < 3; ++i) {
            if (configs[i].storeId == bytes32(0) || configs[i].owner == address(0)) revert InvalidConfiguration();
            for (uint256 j; j < i; ++j) {
                if (configs[i].storeId == configs[j].storeId) revert DuplicateStore();
            }
        }
        for (uint256 i; i < 3; ++i) {
            address escrow = address(
                new StoreEscrow(
                    asset_,
                    configs[i].storeId,
                    configs[i].owner,
                    quoteAuthority_,
                    configs[i].authorities,
                    configs[i].catalog
                )
            );
            escrows[i] = escrow;
            escrowFor[configs[i].storeId] = escrow;
            emit StoreCreated(i, configs[i].storeId, escrow, configs[i].owner);
        }
    }
}
