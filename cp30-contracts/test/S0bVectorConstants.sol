// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

abstract contract S0bVectorConstants {
    bytes32 internal constant BODY = 0xde19804a67ac6aee8fec9f50913754262fe858da4cdc831c17cc1e2b06c1ddff;
    bytes32 internal constant IMAGE = 0xda21a391bb3b3167b89dbadce797f5b6137d48008a3de8705e597ff97cd52a48;
    bytes32 internal constant HASH = 0x054753af4fbf6d3b7200cfb427a94b9e0380de7211401091f5e4c76edcab9eac;
    bytes32 internal constant VID = 0x9cf2e929c263024c1a13b206d84bcea56c9c6b0164fd3232cda2e3e0f77bf40c;

    function expectedSelector(uint256 i) internal pure returns (bytes4) {
        bytes4[11] memory a = [
            bytes4(0x5e88339b),
            bytes4(0x55e80d27),
            bytes4(0x3c16e692),
            bytes4(0x77e283d0),
            bytes4(0x8c540688),
            bytes4(0xd62fcdde),
            bytes4(0x2debe5d7),
            bytes4(0x302897c2),
            bytes4(0x3daef73e),
            bytes4(0xcf9f0197),
            bytes4(0x1914528a)
        ];
        return a[i];
    }

    function expectedPayload(uint256 i) internal pure returns (bytes32) {
        bytes32[11] memory a = [
            bytes32(0x13ab08068d8705ab056749aadb9f3b3631827b14c444b1da20d5c2657cf53084),
            bytes32(0xa1fe72e10c100cb5d57caf42814e309cce68a58dde9f2c49e2f51bf56344e446),
            bytes32(0x07f182d053a4778fae089886d3c001fc1112a92d5a6a00e9ded893e7dd2ccedb),
            bytes32(0x753772b1ebaeaafee7166cb75ea3514862ce22e253e591c0519444101bdc7807),
            bytes32(0x0b64f7b8072e519a8d3133db08eb48683cde088e60e33504b1653276f6db3400),
            bytes32(0x61f76c80f6f8c81c817105314e4cf23b15876830e45ed045ce13dd131b15d770),
            bytes32(0xd29bf3e743b79d07f7810d5ea7943cb852b9446431a6470a6f2c7fde9634f087),
            bytes32(0x3f0dcd687fddd9484f687e6e13d6a82ee41a9e1a67b64312c5562d34e399bb90),
            bytes32(0x48ceca8f6e3f162626747dd025b0a11d2b0ee7e587c500876c28f11f7c9a76b4),
            bytes32(0xd7edf4ee7ab06f6eb83fc92e144adcb7a3fa457936b6681be487786f57c07bf1),
            bytes32(0x48b8554c7af6a9132969a67a00aef53c34795117cb9a8adb153061324cf40cf9)
        ];
        return a[i];
    }
}
