// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {S0bBase, StoreEscrow} from "./S0bBase.sol";
import {ThreeStoreFactory} from "../contracts/ThreeStoreFactory.sol";

contract S0bGasTest is S0bBase {
    event log_named_uint(string key, uint256 value);

    function measured(string memory name, address caller, bytes memory data) private returns (bytes32 result) {
        vm.prank(caller);
        uint256 beforeGas = gasleft();
        (bool ok, bytes memory out) = address(s).call(data);
        uint256 used = beforeGas - gasleft();
        require(ok, "gas action rejected");
        emit log_named_uint(name, used);
        result = abi.decode(out, (bytes32));
    }

    function testS0bLifecycleGasAndEnforcedRuntimeInitcodeBounds() public {
        bytes32 b = fund(s, quote(PAYER, 1, 10, false));
        bytes32 h = referenceTerms(s, terms(MEAL_A, 2, PRICE_A, TERMS_A));
        bytes32 id = key();
        measured(
            "publish v3",
            s.catalogAuthority(),
            abi.encodeCall(StoreEscrow.publish, (id, uint256(0), terms(MEAL_A, 3, 7, TERMS_B)))
        );
        id = key();
        measured("unlist", s.catalogAuthority(), abi.encodeCall(StoreEscrow.setListed, (id, uint256(1), MEAL_A, false)));
        listed(s, MEAL_A, true);
        id = key();
        measured("pause", s.catalogAuthority(), abi.encodeCall(StoreEscrow.setPaused, (id, uint256(3), true)));
        paused(s, false);
        id = key();
        bytes memory data =
            abi.encodeCall(StoreEscrow.issue, (id, MEAL_A, uint8(0), uint256(1), h, block.timestamp + 600));
        bytes32 v = measured("issue first", s.issuerAuthority(), data);
        measured("issue lookup", s.issuerAuthority(), data);
        id = key();
        bytes32 l = measured(
            "lock", s.operatorAuthority(), abi.encodeCall(StoreEscrow.lock, (id, v, uint256(1), block.timestamp + 600))
        );
        id = key();
        bytes32 m = measured(
            "markHandover",
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.markHandover, (id, v, uint256(1), l, block.timestamp + 600))
        );
        id = key();
        measured("report", s.operatorAuthority(), abi.encodeCall(StoreEscrow.report, (id, v, uint256(1), l, m)));
        id = key();
        measured("settle", s.owner(), abi.encodeCall(StoreEscrow.settle, (id, v, uint256(1))));
        bytes32 safe = issueAt(s, MEAL_A, 1, 1, h);
        vm.warp(block.timestamp + 72 hours);
        id = key();
        measured("expire", s.issuerAuthority(), abi.encodeCall(StoreEscrow.expire, (id, safe, uint256(1))));
        id = key();
        data = abi.encodeCall(StoreEscrow.refundWithIntent, (id, b, uint16(510)));
        measured("refund intent 8 units", PAYER, data);
        measured("refund intent lookup", PAYER, data);
        id = key();
        measured(
            "issue seq9 scans10",
            s.issuerAuthority(),
            abi.encodeCall(StoreEscrow.issue, (id, MEAL_A, uint8(9), uint256(1), h, block.timestamp + 600))
        );
        id = key();
        measured("close", s.catalogAuthority(), abi.encodeCall(StoreEscrow.close, (id, s.controlRevision())));
        assertTrue(address(s).code.length <= 24576);
        assertTrue(address(factory).code.length <= 24576);
        bytes memory init = abi.encodePacked(
            type(StoreEscrow).creationCode,
            abi.encode(token, bytes32(uint256(1)), address(0x201), authority, roles(), catalog(PRICE_A))
        );
        bytes memory factoryInit =
            abi.encodePacked(type(ThreeStoreFactory).creationCode, abi.encode(token, authority, configs()));
        assertTrue(init.length <= 49152 && factoryInit.length <= 49152);
        emit log_named_uint("escrow deployed bytes", address(s).code.length);
        emit log_named_uint("factory deployed bytes", address(factory).code.length);
        emit log_named_uint("escrow init with fixture bytes", init.length);
        emit log_named_uint("factory init with fixture bytes", factoryInit.length);
    }

    function testS0bGasWorstTenSafeExpiriesNormalizedBeforeAllocation() public {
        fund(s, quote(PAYER, 1, 10, false));
        bytes32 h = referenceTerms(s, terms(MEAL_A, 2, PRICE_A, TERMS_A));
        for (uint8 i; i < 10; i++) {
            issueA(i);
        }
        vm.warp(block.timestamp + 72 hours);
        bytes32 id = key();
        measured(
            "issue normalize10 old R",
            s.issuerAuthority(),
            abi.encodeCall(StoreEscrow.issue, (id, MEAL_A, uint8(0), uint256(2), h, block.timestamp + 600))
        );
        assertEq(s.availableUnits(), 9);
        assertEq(s.bucketCount(StoreEscrow.Bucket.R), 1);
    }
}
