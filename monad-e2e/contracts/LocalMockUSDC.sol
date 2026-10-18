// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Strictly local-only ERC20 fake stamped into Circle's testnet address
///         by Hardhat RPC; NEVER deployed to public Monad Testnet.
contract LocalMockUSDC {
    string public constant name = "Local Mock USDC";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from,address indexed to,uint256 value);
    event Approval(address indexed owner,address indexed spender,uint256 value);
    function mint(address recipient,uint256 amount) external {
        balanceOf[recipient]+=amount;
        emit Transfer(address(0),recipient,amount);
    }
    function approve(address spender,uint256 amount) external returns(bool){
        allowance[msg.sender][spender]=amount;
        emit Approval(msg.sender,spender,amount);
        return true;
    }
    function transfer(address recipient,uint256 amount) external returns(bool){
        _move(msg.sender,recipient,amount);
        return true;
    }
    function transferFrom(address sender,address recipient,uint256 amount) external returns(bool){
        uint256 authorized=allowance[sender][msg.sender];
        require(authorized>=amount,"ALLOWANCE");
        allowance[sender][msg.sender]=authorized-amount;
        _move(sender,recipient,amount);
        return true;
    }
    function _move(address from,address to,uint256 amount) internal{
        require(balanceOf[from]>=amount,"FUNDS");
        balanceOf[from]-=amount;
        balanceOf[to]+=amount;
        emit Transfer(from,to,amount);
    }
}
