// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {C0TestBase, StoreEscrow} from "./C0TestBase.sol";

contract VectorsTest is C0TestBase {
    function testFixedViemQuotePayloadDomainDigestAndBatchVectors() public {
        StoreEscrow.FundingQuote memory q = quote(PAYER, 1, 3, false);
        q.deadline = 1_800_000_600;
        assertEq(stores[0].QUOTE_TYPEHASH(), 0x3c5c2a259cfd290637ab46e80ed773b838eeb00b20020cc5f0f9670053e0de81);
        assertEq(stores[0].quotePayloadHash(q), 0xe0d9492523d6166c100fed2b71ca466aa44512d4b2687e876346739a2ad1cb23);
        bytes32 domain = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256("MealForward C0 Funding"), keccak256("1"), uint256(31337), address(0x3000)
            )
        );
        assertEq(domain, 0xcf4924823a2a69bbaa6298ebd36de151de28c742d0bcaa6c9a01ee41ad6ed9e2);
        assertEq(
            referenceDigest(q, 31337, address(0x3000)),
            0x1c35a57cf1fc0e1194d5abe8bf1d34329dbacaa58363add2e72dd2ed332f51e0
        );
        assertEq(
            keccak256(abi.encode(uint256(31337), address(0x3000), q.quoteId)),
            0x57b56315ba5ce61adef6d6158f30986dc073adf98ba42420d0fee62606f6ca44
        );
    }

    function testActualEscrowEIP712DomainExposesExactNameVersionChainAndAddress() public view {
        (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        ) = stores[0].eip712Domain();
        assertEq(uint8(fields), 15);
        assertEq(keccak256(bytes(name)), keccak256("MealForward C0 Funding"));
        assertEq(keccak256(bytes(version)), keccak256("1"));
        assertEq(chainId, 31337);
        assertEq(verifyingContract, address(stores[0]));
        assertEq(salt, bytes32(0));
        assertEq(extensions.length, 0);
    }
}
