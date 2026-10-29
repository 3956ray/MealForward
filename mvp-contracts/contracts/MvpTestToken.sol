// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
/// @notice TEST ONLY: freely issued demonstration tokens with no monetary value.
contract MvpTestToken is ERC20 {
    address public immutable donor;
    constructor(address donor_) ERC20("MealForward TEST ONLY", "MFTEST") {
        require(donor_ != address(0), "zero donor");
        donor = donor_;
        _mint(donor_, 7_000_000);
    }
    function decimals() public pure override returns (uint8) { return 6; }
}
