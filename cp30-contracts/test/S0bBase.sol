// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {C0TestBase, StoreEscrow, IERC20, VmC0, MockERC20} from "./C0TestBase.sol";

abstract contract S0bBase is C0TestBase {
    StoreEscrow internal s;
    uint256 internal serial = 100;

    function setUp() public virtual override {
        super.setUp();
        s = stores[0];
    }

    function key() internal returns (bytes32) {
        return bytes32(++serial);
    }

    function custom(IERC20 asset_, StoreEscrow.TermsInput memory t) internal returns (StoreEscrow e) {
        StoreEscrow.CatalogEntry[] memory cs = new StoreEscrow.CatalogEntry[](1);
        cs[0] = StoreEscrow.CatalogEntry(t, true);
        e = new StoreEscrow(asset_, bytes32(uint256(44)), address(0x201), authority, roles(), cs);
    }

    function pay(StoreEscrow e, StoreEscrow.TermsInput memory t, uint256 qty) internal returns (bytes32) {
        IERC20 asset_ = e.asset();
        vm.prank(PAYER);
        (bool ok, bytes memory result) =
            address(asset_).call(abi.encodeCall(IERC20.approve, (address(e), type(uint256).max)));
        require(ok && (result.length == 0 || abi.decode(result, (bool))), "fixture approval");
        StoreEscrow.FundingQuote memory q = StoreEscrow.FundingQuote(
            key(),
            PAYER,
            t.mealId,
            t.version,
            referenceTerms(e, t),
            qty,
            t.unitPrice,
            qty * t.unitPrice,
            block.timestamp + 600
        );
        return fund(e, q);
    }

    function publish(StoreEscrow e, StoreEscrow.TermsInput memory t) internal returns (bytes32) {
        bytes32 id = key();
        uint256 rev = e.controlRevision();
        vm.prank(e.catalogAuthority());
        return e.publish(id, rev, t);
    }

    function paused(StoreEscrow e, bool value) internal {
        bytes32 id = key();
        uint256 rev = e.controlRevision();
        vm.prank(e.catalogAuthority());
        e.setPaused(id, rev, value);
    }

    function listed(StoreEscrow e, bytes32 meal, bool value) internal {
        bytes32 id = key();
        uint256 rev = e.controlRevision();
        vm.prank(e.catalogAuthority());
        e.setListed(id, rev, meal, value);
    }

    function closed(StoreEscrow e) internal {
        bytes32 id = key();
        uint256 rev = e.controlRevision();
        vm.prank(e.catalogAuthority());
        e.close(id, rev);
    }

    function issueAt(StoreEscrow e, bytes32 meal, uint8 seq, uint256 gen, bytes32 hash) internal returns (bytes32) {
        bytes32 id = key();
        vm.prank(e.issuerAuthority());
        return e.issue(id, meal, seq, gen, hash, block.timestamp + 600);
    }

    function issueA(uint8 seq) internal returns (bytes32) {
        return issueAt(s, MEAL_A, seq, 1, referenceTerms(s, terms(MEAL_A, 2, PRICE_A, TERMS_A)));
    }

    function locking(StoreEscrow e, bytes32 v, uint256 gen) internal returns (bytes32) {
        bytes32 id = key();
        vm.prank(e.operatorAuthority());
        return e.lock(id, v, gen, block.timestamp + 600);
    }

    function marking(StoreEscrow e, bytes32 v, uint256 gen, bytes32 l) internal returns (bytes32) {
        bytes32 id = key();
        vm.prank(e.operatorAuthority());
        return e.markHandover(id, v, gen, l, block.timestamp + 600);
    }

    function reporting(StoreEscrow e, bytes32 v, uint256 gen, bytes32 l, bytes32 m) internal {
        bytes32 id = key();
        vm.prank(e.operatorAuthority());
        e.report(id, v, gen, l, m);
    }

    function deliver(StoreEscrow e, bytes32 v, uint256 gen) internal {
        bytes32 l = locking(e, v, gen);
        bytes32 m = marking(e, v, gen, l);
        reporting(e, v, gen, l, m);
    }

    function settling(StoreEscrow e, bytes32 v, uint256 gen) internal returns (uint256) {
        bytes32 id = key();
        vm.prank(e.owner());
        return e.settle(id, v, gen);
    }

    function expiring(StoreEscrow e, bytes32 v, uint256 gen) internal returns (uint8) {
        bytes32 id = key();
        vm.prank(e.issuerAuthority());
        return e.expire(id, v, gen);
    }

    function reject(StoreEscrow e, address caller, bytes memory data, bytes4 err) internal {
        vm.prank(caller);
        (bool ok, bytes memory result) = address(e).call(data);
        require(!ok && (err == bytes4(0) || bytes4(result) == err), "wrong rejection");
    }

    function partition(StoreEscrow e, uint256 a, uint256 r, uint256 h, uint256 settled, uint256 x, uint256 donation)
        internal
        view
    {
        StoreEscrow.Accounting memory z = e.getAccounting();
        assertEq(z.fundedAmount, a + r + h + settled + x);
        assertEq(z.liability, a + r + h);
        assertEq(z.amounts[0], a);
        assertEq(z.amounts[1], r);
        assertEq(z.amounts[2], h);
        assertEq(z.amounts[3], settled);
        assertEq(z.amounts[4], x);
        assertEq(z.counts[0] + z.counts[1] + z.counts[2] + z.counts[3] + z.counts[4], z.fundedUnits);
        assertEq(e.asset().balanceOf(address(e)), a + r + h + donation);
        assertEq(e.surplus(), donation);
    }
}
