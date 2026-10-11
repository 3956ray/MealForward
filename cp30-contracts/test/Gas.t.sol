// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {C0TestBase, StoreEscrow} from "./C0TestBase.sol";

/// @dev Call gas includes ABI/call overhead, excludes transaction intrinsic fees. No monetary or Monad estimate.
contract LocalGasTest is C0TestBase {
    event log_named_uint(string key, uint256 value);

    function testLocalEVMCallGasWithExplicitInputsAndStates() public {
        StoreEscrow.FundingQuote memory one = quote(PAYER, 1, 1, false);
        bytes memory sig = signature(stores[0], one);
        vm.prank(PAYER);
        uint256 beforeGas = gasleft();
        stores[0].fund(one, sig);
        emit log_named_uint("fresh fund qty1", beforeGas - gasleft());
        vm.prank(PAYER);
        beforeGas = gasleft();
        stores[0].fund(one, sig);
        emit log_named_uint("successful lookup qty1", beforeGas - gasleft());

        StoreEscrow.FundingQuote memory ten = quote(OTHER_PAYER, 1, 10, true);
        sig = signature(stores[1], ten);
        vm.prank(OTHER_PAYER);
        beforeGas = gasleft();
        bytes32 batch = stores[1].fund(ten, sig);
        emit log_named_uint("fresh fund qty10", beforeGas - gasleft());
        vm.prank(OTHER_PAYER);
        beforeGas = gasleft();
        stores[1].refund(batch, 512);
        emit log_named_uint("partial refund qty10 mask512", beforeGas - gasleft());
        vm.prank(OTHER_PAYER);
        beforeGas = gasleft();
        stores[1].refund(batch, 511);
        emit log_named_uint("remaining refund qty10 mask511", beforeGas - gasleft());

        StoreEscrow.FundingQuote memory extra = quote(OTHER_PAYER, 2, 1, false);
        bytes memory data = abi.encodeCall(StoreEscrow.fund, (extra, signature(stores[1], extra)));
        vm.prank(OTHER_PAYER);
        beforeGas = gasleft();
        (bool ok, bytes memory result) = address(stores[1]).call(data);
        uint256 used = beforeGas - gasleft();
        require(!ok && bytes4(result) == StoreEscrow.CapExceeded.selector, "cap gas case must reject");
        emit log_named_uint("reject cap after full refund qty1", used);
    }
}
