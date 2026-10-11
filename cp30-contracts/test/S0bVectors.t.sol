// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {S0bBase, StoreEscrow} from "./S0bBase.sol";
import {S0bVectorConstants} from "./S0bVectorConstants.sol";

contract S0bVectorsTest is S0bBase, S0bVectorConstants {
    function testIndependentViemUTF8BodyImageCanonicalTermsVoucherAndAllAbiPayloadVectors() public {
        assertEq(
            BODY,
            keccak256(
                abi.encode(
                    keccak256("MealBodyV1(bytes32 nameDigest,bytes32 descriptionDigest)"),
                    keccak256(unicode"合成午餐"),
                    keccak256("synthetic\nexact LF")
                )
            )
        );
        assertEq(IMAGE, keccak256(hex"0001feff"));
        bytes memory first = abi.encode(
            s.TERMS_TYPEHASH(),
            uint256(1),
            uint256(31337),
            address(0x3000),
            bytes32(uint256(44)),
            MEAL_A,
            uint256(1),
            address(0x4000)
        );
        bytes memory last = abi.encode(
            uint256(3), BODY, IMAGE, uint8(2), uint16(540), uint16(600), uint16(780), uint16(1440), uint16(480)
        );
        assertEq(keccak256(bytes.concat(first, last)), HASH);
        assertEq(
            keccak256(
                abi.encode(keccak256("MealForwardVoucherV1"), uint256(31337), address(0x3000), uint8(0), uint256(1))
            ),
            VID
        );
        StoreEscrow.TermsInput memory t = StoreEscrow.TermsInput(MEAL_A, 1, 3, BODY, IMAGE, 2, 540, 600, 780, 1440);
        StoreEscrow e = custom(token, t);
        assertEq(e.getTerms(MEAL_A, 1).termsHash, referenceTerms(e, t));
        assertEq(e.computeTermsHash(t), referenceTerms(e, t));
        bytes32 id = bytes32(uint256(7));
        bytes32 v = bytes32(uint256(8));
        bytes32 l = bytes32(uint256(9));
        bytes32 m = bytes32(uint256(10));
        uint256 deadline = 1800000600;
        bytes[11] memory data;
        data[0] = abi.encodeCall(StoreEscrow.publish, (id, uint256(0), t));
        data[1] = abi.encodeCall(StoreEscrow.setListed, (id, uint256(0), MEAL_A, false));
        data[2] = abi.encodeCall(StoreEscrow.setPaused, (id, uint256(0), true));
        data[3] = abi.encodeCall(StoreEscrow.close, (id, uint256(0)));
        data[4] = abi.encodeCall(StoreEscrow.issue, (id, MEAL_A, uint8(0), uint256(1), HASH, deadline));
        data[5] = abi.encodeCall(StoreEscrow.lock, (id, v, uint256(1), deadline));
        data[6] = abi.encodeCall(StoreEscrow.markHandover, (id, v, uint256(1), l, deadline));
        data[7] = abi.encodeCall(StoreEscrow.report, (id, v, uint256(1), l, m));
        data[8] = abi.encodeCall(StoreEscrow.settle, (id, v, uint256(1)));
        data[9] = abi.encodeCall(StoreEscrow.expire, (id, v, uint256(1)));
        data[10] = abi.encodeCall(StoreEscrow.refundWithIntent, (id, bytes32(uint256(11)), uint16(3)));
        for (uint256 i; i < 11; i++) {
            assertEq(uint32(bytes4(data[i])), uint32(expectedSelector(i)));
            bytes memory params = new bytes(data[i].length - 36);
            for (uint256 j; j < params.length; j++) {
                params[j] = data[i][j + 36];
            }
            assertEq(
                keccak256(
                    abi.encode(
                        keccak256("MealForwardOperationV1"),
                        uint256(1),
                        uint256(31337),
                        address(0x3000),
                        uint8(i + 1),
                        address(0x402),
                        id,
                        keccak256(params)
                    )
                ),
                expectedPayload(i)
            );
        }
    }
}
