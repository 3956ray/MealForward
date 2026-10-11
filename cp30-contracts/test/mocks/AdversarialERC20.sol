// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockERC20} from "./MockERC20.sol";

contract AdversarialERC20 is MockERC20 {
    enum Behavior {
        Normal,
        FalseReturn,
        RevertAfterTransfer,
        Tax,
        ExtraDebit,
        ExtraCredit,
        Rebase,
        NoMove,
        CallbackCatch,
        CallbackBubble,
        MalformedReturn
    }
    Behavior public incoming;
    Behavior public outgoing;
    address public callbackTarget;
    bytes public callbackData;
    uint256 public callbackAttempts;
    bool public callbackSucceeded;
    bytes4 public callbackError;
    uint256 public transferFromCalls;
    uint256 public transferCalls;
    bool public failBalanceRead;
    bool public callbackExtraCredit;
    address public constant FEE_COLLECTOR = address(0xfeec);

    function configure(Behavior incoming_, Behavior outgoing_) external {
        incoming = incoming_;
        outgoing = outgoing_;
    }

    function configureCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function configureBalanceRead(bool fail) external {
        failBalanceRead = fail;
    }

    function configureCallbackExtraCredit(bool value) external {
        callbackExtraCredit = value;
    }

    function balanceOf(address account) public view override returns (uint256) {
        require(!failBalanceRead, "balance read rejected");
        return super.balanceOf(account);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        ++transferFromCalls;
        _spendAllowance(from, msg.sender, amount);
        return _act(from, to, amount, incoming);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        ++transferCalls;
        return _act(msg.sender, to, amount, outgoing);
    }

    function _act(address from, address to, uint256 amount, Behavior behavior) private returns (bool) {
        if (behavior != Behavior.NoMove) {
            if (behavior == Behavior.Tax) {
                _transfer(from, to, amount - 1);
                _transfer(from, FEE_COLLECTOR, 1);
            } else {
                _transfer(from, to, amount);
            }
        }
        if (behavior == Behavior.ExtraDebit) _transfer(from, FEE_COLLECTOR, 1);
        if (behavior == Behavior.ExtraCredit) _mint(to, 1);
        if (behavior == Behavior.Rebase) _mint(from, 1);
        if (behavior == Behavior.CallbackCatch || behavior == Behavior.CallbackBubble) {
            ++callbackAttempts;
            bytes memory result;
            (callbackSucceeded, result) = callbackTarget.call(callbackData);
            if (result.length >= 4) callbackError = bytes4(result);
            if (behavior == Behavior.CallbackBubble) require(callbackSucceeded, "callback rejected");
            if (callbackExtraCredit) _mint(to, 1);
        }
        if (behavior == Behavior.RevertAfterTransfer) revert("transfer rejected");
        if (behavior == Behavior.MalformedReturn) {
            assembly ("memory-safe") {
                mstore(0, 1)
                return(31, 1)
            }
        }
        return behavior != Behavior.FalseReturn;
    }
}

/// @dev ERC20-compatible legacy token intentionally omits transfer/approve return data.
contract NoReturnERC20 {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public noMove;

    function configureNoMove(bool value) external {
        noMove = value;
    }

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external {
        _move(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external {
        allowance[from][msg.sender] -= amount;
        _move(from, to, amount);
    }

    function _move(address from, address to, uint256 amount) private {
        if (!noMove) {
            balanceOf[from] -= amount;
            balanceOf[to] += amount;
        }
    }
}
