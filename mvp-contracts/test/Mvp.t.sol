// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {MvpStoreEscrow as E} from "../contracts/MvpStoreEscrow.sol";
import {MvpTestToken} from "../contracts/MvpTestToken.sol";
interface Vm {
 function addr(uint256) external returns(address);
 function sign(uint256,bytes32) external returns(uint8,bytes32,bytes32);
 function prank(address) external;
 function warp(uint256) external;
 function expectRevert(bytes4) external;
}
contract MvpTest {
 Vm constant vm=Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
 uint256 constant SYNTHETIC=0xabc123;
 address owner; address constant DONOR=address(0xd0); address constant ISSUER=address(0x15);
 bytes32 constant MEAL=keccak256("mvp-meal");
 MvpTestToken t; E e; bytes32 batch; bytes32 voucher; uint256 deadline;
 function setUp() public {
  vm.warp(1800000000); owner=vm.addr(SYNTHETIC);
  t=new MvpTestToken(DONOR);
  E.CatalogEntry[] memory entries=new E.CatalogEntry[](1);
  entries[0]=E.CatalogEntry(E.TermsInput(MEAL,1,7000000,keccak256("body"),keccak256("image"),1,0,1440,0,0),true);
  e=new E(t,keccak256("store"),owner,owner,E.Authorities(owner,ISSUER,owner),entries);
  E.FundingQuote memory q=E.FundingQuote(bytes32(uint256(1)),DONOR,MEAL,1,e.computeTermsHash(entries[0].terms),1,7000000,7000000,block.timestamp+600);
  (uint8 v,bytes32 r,bytes32 s)=vm.sign(SYNTHETIC,e.quoteDigest(q));
  vm.prank(DONOR); t.approve(address(e),7000000);
  vm.prank(DONOR); batch=e.fund(q,abi.encodePacked(r,s,v));
  deadline=block.timestamp+600;
 }
 function issue() internal {
  E.Candidate memory c=e.nextCandidate(MEAL);
  vm.prank(ISSUER); voucher=e.issue(bytes32(uint256(2)),MEAL,c.unitSeq,c.nextGeneration,c.termsHash,deadline);
 }
 function redeem() internal {vm.prank(owner); e.redeem(bytes32(uint256(3)),voucher,1,deadline);}
 function settle(bytes32 op) internal {vm.prank(owner); e.settle(op,voucher,1);}
 function accounting() internal view {
  E.Accounting memory a=e.getAccounting(); uint256 sum;
  for(uint i;i<5;i++) sum+=a.amounts[i];
  require(sum==a.fundedAmount,"conservation"); require(t.balanceOf(address(e))==a.liability,"liability");
 }
 function testAtomicBoundaryReplayAndSinglePayout() public {
  issue(); redeem(); uint256 ready=e.getVoucher(voucher).settlementAvailableAt;
  require(ready==block.timestamp+180,"delay");
  vm.warp(ready-1); vm.expectRevert(E.SettlementTooEarly.selector); settle(bytes32(uint256(4)));
  redeem(); require(e.getVoucher(voucher).settlementAvailableAt==ready,"replay reset");
  vm.prank(owner); vm.expectRevert(E.InvalidUnitState.selector); e.redeem(bytes32(uint256(5)),voucher,1,deadline);
  vm.prank(owner); vm.expectRevert(E.OperationConflict.selector); e.redeem(bytes32(uint256(3)),voucher,1,deadline+1);
  vm.warp(ready); settle(bytes32(uint256(4))); settle(bytes32(uint256(4))); redeem();
  require(t.balanceOf(owner)==7000000,"double pay");
  vm.expectRevert(E.InvalidUnitState.selector); settle(bytes32(uint256(6))); accounting();
 }
 function testLegacyReportAlsoDelaysAtHEntry() public {
  issue(); vm.prank(owner); e.lock(bytes32(uint256(10)),voucher,1,deadline);
  vm.prank(owner); e.markHandover(bytes32(uint256(11)),voucher,1,bytes32(uint256(10)),deadline);
  vm.warp(block.timestamp+200);
  vm.prank(owner); e.report(bytes32(uint256(12)),voucher,1,bytes32(uint256(10)),bytes32(uint256(11)));
  uint256 ready=e.getVoucher(voucher).settlementAvailableAt;
  require(ready==block.timestamp+180,"must use report time");
  vm.warp(ready-1); vm.expectRevert(E.SettlementTooEarly.selector); settle(bytes32(uint256(13)));
  vm.prank(owner); e.report(bytes32(uint256(12)),voucher,1,bytes32(uint256(10)),bytes32(uint256(11)));
  require(e.getVoucher(voucher).settlementAvailableAt==ready,"legacy replay reset");
  vm.warp(ready); settle(bytes32(uint256(13))); accounting();
 }
 function testUnauthorizedRoles() public {
  E.Candidate memory c=e.nextCandidate(MEAL);
  vm.expectRevert(E.UnauthorizedRole.selector); e.issue(bytes32(uint256(2)),MEAL,c.unitSeq,c.nextGeneration,c.termsHash,deadline);
  issue(); vm.expectRevert(E.UnauthorizedRole.selector); e.redeem(bytes32(uint256(3)),voucher,1,deadline);
  redeem(); vm.warp(block.timestamp+180);
  vm.expectRevert(E.UnauthorizedRole.selector); e.settle(bytes32(uint256(4)),voucher,1);
  vm.expectRevert(E.UnauthorizedRole.selector); e.setPaused(bytes32(uint256(5)),0,true);
  vm.expectRevert(E.UnauthorizedPayer.selector); e.refund(batch,1);
 }
 function testPauseCloseRefundCompatibility() public {
  vm.prank(owner); e.setPaused(bytes32(uint256(10)),0,true);
  require(!e.nextCandidate(MEAL).available,"paused issue");
  vm.prank(owner); e.close(bytes32(uint256(11)),1);
  vm.prank(DONOR); e.refundWithIntent(bytes32(uint256(12)),batch,1);
  vm.prank(DONOR); e.refundWithIntent(bytes32(uint256(12)),batch,1);
  require(t.balanceOf(DONOR)==7000000,"refund"); accounting();
 }
 function testPauseBlocksRedeemCloseAllowsExistingObligations() public {
  issue(); vm.prank(owner); e.setPaused(bytes32(uint256(10)),0,true);
  vm.expectRevert(E.OperatingDenied.selector); redeem();
  vm.prank(owner); e.setPaused(bytes32(uint256(11)),1,false);
  vm.prank(owner); e.close(bytes32(uint256(12)),2);
  redeem(); vm.prank(owner); e.setPaused(bytes32(uint256(13)),3,true);
  vm.warp(block.timestamp+180); settle(bytes32(uint256(14))); accounting();
 }
 function testExpiryReissuesNewGenerationAndRefundAfterExpiry() public {
  issue(); vm.warp(e.getVoucher(voucher).expiresAt);
  vm.expectRevert(E.TimeDenied.selector); redeem();
  vm.prank(ISSUER); e.expire(bytes32(uint256(10)),voucher,1);
  require(e.nextCandidate(MEAL).nextGeneration==2,"generation");
  vm.prank(DONOR); e.refund(batch,1); accounting();
 }
 function testLockedCannotAtomicRedeemOrExpire() public {
  issue(); vm.prank(owner); e.lock(bytes32(uint256(10)),voucher,1,deadline);
  vm.expectRevert(E.AlreadyLocked.selector); redeem();
  vm.warp(e.getVoucher(voucher).expiresAt);
  vm.prank(ISSUER); vm.expectRevert(E.InvalidUnitState.selector); e.expire(bytes32(uint256(11)),voucher,1);
 }
 function testTokenConstructorSupply() public {
  require(t.decimals()==6,"decimals");
  require(t.totalSupply()==7000000,"supply");
  require(t.donor()==DONOR,"donor");
 }
}
