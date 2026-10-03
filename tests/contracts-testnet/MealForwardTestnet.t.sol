// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {MealForwardTestnet} from "../../contracts/MealForwardTestnet.sol";
import {MealForward} from "../../contracts/MealForward.sol";
interface VmCP19 {
    function deal(address, uint256) external;
    function prank(address) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
    function chainId(uint256) external;
}
contract MealForwardTestnetTest {
    VmCP19 constant vm = VmCP19(address(uint160(uint256(keccak256("hevm cheat code")))));
    MealForwardTestnet m;
    address constant SUPPORTER=address(101);
    address constant OPERATOR=address(102);
    address constant OWNER=address(103);
    bytes32 constant RULE=keccak256("mealforward-cp19-testnet-v1");
    bytes32 constant V=bytes32(uint256(1));
    function setUp() public {
        vm.chainId(10143);m=new MealForwardTestnet(address(this),OWNER);
        m.grantRole(m.SUPPORTER_ROLE(),SUPPORTER);m.grantRole(m.ISSUER_ROLE(),OPERATOR);
        m.grantRole(m.OPERATOR_ROLE(),OPERATOR);m.grantRole(m.SETTLER_ROLE(),OWNER);
        vm.deal(SUPPORTER,1 ether);
    }
    function funded(uint256 id) private returns(bytes32) {
        vm.prank(SUPPORTER);return m.fund{value:1e15}(bytes32(id),1,RULE);
    }
    function issued() private returns(bytes32 b) {
        b=funded(1);bytes32[] memory vs=new bytes32[](1);vs[0]=V;
        vm.prank(OPERATOR);m.issue(V,b,vs);
    }
    function locked() private returns(bytes32 b) {
        b=issued();vm.prank(OPERATOR);m.lock(V,V,V);
    }
    function reported() private returns(bytes32 b) {
        b=locked();vm.prank(OPERATOR);m.report(V,V,V);
    }
    function testOneVoucherAndOwnerOnlyGrant() public {
        bytes32 b=reported();vm.expectRevert();vm.prank(OPERATOR);m.settle(V,V);
        vm.expectRevert();m.settle(V,V);
        vm.prank(OWNER);m.settle(V,V);
        (uint256 f,uint256 a,uint256 r,uint256 h,uint256 s,,)=m.getBatch(b);
        assert(f==1e15&&a==0&&r==0&&h==0&&s==1e15&&m.liability()==0);
        assert(address(m).balance==0&&OWNER.balance==1e15);
        (,uint8 status,)=m.getVoucher(V);assert(status==4);
        vm.expectRevert(MealForwardTestnet.AlreadyProcessed.selector);vm.prank(OWNER);m.settle(V,V);
        vm.expectRevert(MealForwardTestnet.IntentConflict.selector);vm.prank(OWNER);m.settle(V,bytes32(uint256(2)));
    }
    function testChainGuardAndOldContractUnchanged() public {
        vm.chainId(143);vm.expectRevert(MealForwardTestnet.TestnetOnly.selector);new MealForwardTestnet(address(this),OWNER);
        vm.chainId(31337);vm.expectRevert(MealForwardTestnet.TestnetOnly.selector);new MealForwardTestnet(address(this),OWNER);
        MealForward old=new MealForward(address(this),OWNER);assert(old.priceWei()==1e15);
        vm.chainId(10143);vm.expectRevert(MealForward.LocalChainOnly.selector);new MealForward(address(this),OWNER);
    }
    function testPauseAllowsExistingReportOnly() public {
        locked();m.setPaused(true);
        vm.expectRevert(MealForwardTestnet.Paused.selector);vm.prank(SUPPORTER);m.fund{value:1e15}(bytes32(uint256(2)),1,RULE);
        bytes32[] memory vs=new bytes32[](1);vs[0]=bytes32(uint256(2));
        vm.expectRevert(MealForwardTestnet.Paused.selector);vm.prank(OPERATOR);m.issue(V,V,vs);
        vm.expectRevert(MealForwardTestnet.Paused.selector);vm.prank(OPERATOR);m.lock(bytes32(uint256(2)),V,V);
        vm.prank(OPERATOR);m.report(V,V,V);
        vm.expectRevert(MealForwardTestnet.Paused.selector);vm.prank(OWNER);m.settle(V,V);
        m.setPaused(false);vm.prank(OWNER);m.settle(V,V);
    }
    function testPriceCapQuantityAndIntent() public {
        assert(m.fundingCapWei()==1e16&&m.maxQuantity()==3&&m.ruleVersion()==RULE);
        vm.expectRevert(MealForwardTestnet.InvalidValue.selector);vm.prank(SUPPORTER);m.fund{value:2e15}(V,1,RULE);
        vm.expectRevert(MealForwardTestnet.InvalidInput.selector);vm.prank(SUPPORTER);m.fund{value:4e15}(V,4,RULE);
        vm.expectRevert(MealForwardTestnet.InvalidRule.selector);vm.prank(SUPPORTER);m.fund{value:1e15}(V,1,bytes32(0));
        funded(1);vm.expectRevert(MealForwardTestnet.AlreadyProcessed.selector);funded(1);
        for(uint256 i=2;i<=10;i++)funded(i);
        vm.expectRevert(MealForwardTestnet.LimitExceeded.selector);funded(11);
    }
}
