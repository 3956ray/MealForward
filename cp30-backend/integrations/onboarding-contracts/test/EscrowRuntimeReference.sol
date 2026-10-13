// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Immutable locations from the same-build original StoreEscrow compiler artifact.
/// The offline runner checks these locations against the final artifact before reporting tests.
library EscrowRuntimeReference {
    function normalize(bytes memory runtime) internal pure returns (bytes memory) {
        uint16[43] memory starts = [uint16(1246), 1553, 1774, 1832, 1871, 1983, 2159, 2672, 2778, 3635, 4083, 5064, 5509, 6214, 6340, 7407, 7474, 7592, 7892, 8037, 8098, 8405, 9150, 9536, 9966, 10032, 10357, 11256, 11501, 11763, 13263, 15238, 15387, 15558, 15620, 15769, 16716, 16760, 17032, 17074, 17116, 17197, 17237];
        for (uint256 i; i < starts.length; ++i) {
            for (uint256 j; j < 32; ++j) runtime[uint256(starts[i]) + j] = bytes1(0);
        }
        return runtime;
    }
}
