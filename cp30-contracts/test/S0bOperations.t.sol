// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {S0bBase, StoreEscrow} from "./S0bBase.sol";
import {AdversarialERC20} from "./mocks/AdversarialERC20.sol";

contract S0bOperationsTest is S0bBase {
    struct Saved {
        bytes32 id;
        address caller;
        bytes data;
        bytes32 result;
        uint8 kind;
    }
    Saved[11] private saved;

    function remember(uint256 slot, bytes32 id, address caller, bytes memory data, uint8 kind)
        private
        returns (bytes32 result)
    {
        vm.prank(caller);
        (bool ok, bytes memory out) = address(s).call(data);
        require(ok, "fresh operation failed");
        result = abi.decode(out, (bytes32));
        saved[slot] = Saved(id, caller, data, result, kind);
        StoreEscrow.Operation memory op = s.getOperation(id);
        assertEq(op.kind, kind);
        assertEq(op.caller, caller);
        assertEq(op.result, result);
        assertEq(op.executedAt, block.timestamp);
    }

    function testT10AllElevenSuccessfulLookupsAfterCloseExpiryInsolvencyBalanceFaultNoEffects() public {
        AdversarialERC20 bad = new AdversarialERC20();
        bad.mint(PAYER, 1e30);
        s = custom(bad, terms(MEAL_A, 1, 3, TERMS_A));
        bytes32 b = pay(s, terms(MEAL_A, 1, 3, TERMS_A), 3);
        bytes32 h = referenceTerms(s, terms(MEAL_A, 1, 3, TERMS_A));
        bytes32 id = key();
        remember(
            0,
            id,
            s.catalogAuthority(),
            abi.encodeCall(StoreEscrow.publish, (id, uint256(0), terms(MEAL_A, 2, 5, TERMS_B))),
            1
        );
        id = key();
        remember(1, id, s.catalogAuthority(), abi.encodeCall(StoreEscrow.setListed, (id, uint256(1), MEAL_A, false)), 2);
        listed(s, MEAL_A, true);
        id = key();
        remember(2, id, s.catalogAuthority(), abi.encodeCall(StoreEscrow.setPaused, (id, uint256(3), true)), 3);
        paused(s, false);
        id = key();
        bytes32 v = remember(
            4,
            id,
            s.issuerAuthority(),
            abi.encodeCall(StoreEscrow.issue, (id, MEAL_A, uint8(0), uint256(1), h, block.timestamp + 600)),
            5
        );
        id = key();
        bytes32 l = remember(
            5,
            id,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.lock, (id, v, uint256(1), block.timestamp + 600)),
            6
        );
        id = key();
        bytes32 m = remember(
            6,
            id,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.markHandover, (id, v, uint256(1), l, block.timestamp + 600)),
            7
        );
        id = key();
        remember(7, id, s.operatorAuthority(), abi.encodeCall(StoreEscrow.report, (id, v, uint256(1), l, m)), 8);
        id = key();
        remember(8, id, s.owner(), abi.encodeCall(StoreEscrow.settle, (id, v, uint256(1))), 9);
        bytes32 safe = issueAt(s, MEAL_A, 1, 1, h);
        vm.warp(block.timestamp + 72 hours);
        id = key();
        remember(9, id, s.issuerAuthority(), abi.encodeCall(StoreEscrow.expire, (id, safe, uint256(1))), 10);
        id = key();
        remember(10, id, PAYER, abi.encodeCall(StoreEscrow.refundWithIntent, (id, b, uint16(6))), 11);
        id = key();
        remember(3, id, s.catalogAuthority(), abi.encodeCall(StoreEscrow.close, (id, s.controlRevision())), 4);
        paused(s, true);
        listed(s, MEAL_A, false);
        bad.burn(address(s), bad.balanceOf(address(s)));
        bad.configureBalanceRead(true);
        vm.warp(block.timestamp + 90 days);
        bytes32 beforeState = keccak256(
            abi.encode(
                s.getAccounting(),
                s.getUnit(0),
                s.getUnit(1),
                s.getUnit(2),
                s.getVoucher(v),
                s.getVoucher(safe),
                s.controlRevision()
            )
        );
        vm.recordLogs();
        for (uint256 i; i < 11; i++) {
            Saved memory r = saved[i];
            StoreEscrow.Operation memory old = s.getOperation(r.id);
            vm.prank(r.caller);
            (bool ok, bytes memory out) = address(s).call(r.data);
            assertTrue(ok);
            assertEq(abi.decode(out, (bytes32)), r.result);
            assertEq(keccak256(abi.encode(s.getOperation(r.id))), keccak256(abi.encode(old)));
            reject(
                s,
                OTHER_PAYER,
                r.data,
                i == 10 ? StoreEscrow.UnauthorizedPayer.selector : StoreEscrow.UnauthorizedRole.selector
            );
            // Every complete 32-byte method parameter, including every static TermsInput member, participates.
            for (uint256 offset = 36; offset < r.data.length; offset += 32) {
                bytes memory changed = copy(r.data);
                changed[offset + 31] ^= bytes1(uint8(1));
                reject(s, r.caller, changed, StoreEscrow.OperationConflict.selector);
            }
            bytes memory zero = copy(r.data);
            for (uint256 j = 4; j < 36; j++) {
                zero[j] = 0;
            }
            reject(s, r.caller, zero, StoreEscrow.InvalidOperation.selector);
        }
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(bad.transferCalls(), 2);
        assertEq(bad.transferFromCalls(), 1);
        assertEq(
            keccak256(
                abi.encode(
                    s.getAccounting(),
                    s.getUnit(0),
                    s.getUnit(1),
                    s.getUnit(2),
                    s.getVoucher(v),
                    s.getVoucher(safe),
                    s.controlRevision()
                )
            ),
            beforeState
        );
        // Same authorized caller, different operation kind in one namespace conflicts before fresh checks.
        reject(
            s,
            s.catalogAuthority(),
            abi.encodeCall(StoreEscrow.close, (saved[0].id, s.controlRevision())),
            StoreEscrow.OperationConflict.selector
        );
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.report, (saved[5].id, v, uint256(1), l, m)),
            StoreEscrow.OperationConflict.selector
        );
    }

    function copy(bytes memory a) private pure returns (bytes memory b) {
        b = new bytes(a.length);
        for (uint256 i; i < a.length; i++) {
            b[i] = a[i];
        }
    }

    function testT10ZeroResultExpiryLookupAndQuoteNamespaceSeparate() public {
        fund(s, quote(PAYER, 1, 1, false));
        bytes32 v = issueA(0);
        vm.warp(block.timestamp + 72 hours);
        bytes32 id = bytes32(uint256(1));
        vm.prank(s.issuerAuthority());
        assertEq(s.expire(id, v, 1), 0);
        assertEq(s.getOperation(id).kind, 10);
        issueAt(s, MEAL_A, 0, 2, referenceTerms(s, terms(MEAL_A, 2, PRICE_A, TERMS_A)));
        vm.prank(s.issuerAuthority());
        assertEq(s.expire(id, v, 1), 0);
        assertEq(s.getUnit(0).generation, 2);
        reject(
            s,
            s.issuerAuthority(),
            abi.encodeCall(StoreEscrow.expire, (key(), v, uint256(1))),
            StoreEscrow.InvalidVoucher.selector
        );
    }

    function testT10IndependentPayloadHashesChainEscrowCallerKeyAndParameters() public view {
        bytes32 params = keccak256(abi.encode(MEAL_A, uint8(0), uint256(1), TERMS_A, uint256(1800000600)));
        bytes32 expect = keccak256(
            abi.encode(
                keccak256("MealForwardOperationV1"),
                uint256(1),
                uint256(31337),
                address(s),
                uint8(5),
                address(0x402),
                bytes32(uint256(7)),
                params
            )
        );
        assertEq(s.operationPayloadHash(5, address(0x402), bytes32(uint256(7)), params), expect);
        assertTrue(stores[1].operationPayloadHash(5, address(0x402), bytes32(uint256(7)), params) != expect);
        assertTrue(s.operationPayloadHash(6, address(0x402), bytes32(uint256(7)), params) != expect);
        assertTrue(s.operationPayloadHash(5, address(0x403), bytes32(uint256(7)), params) != expect);
    }

    function testInsolvencyFreshGuardButLawfulReportAndSafeExpiryRemainLiabilities() public {
        fund(s, quote(PAYER, 1, 3, false));
        bytes32 v = issueA(0);
        bytes32 l = locking(s, v, 1);
        bytes32 m = marking(s, v, 1, l);
        bytes32 safe = issueA(1);
        token.burn(address(s), 1);
        reject(
            s,
            s.issuerAuthority(),
            abi.encodeCall(
                StoreEscrow.issue,
                (
                    key(),
                    MEAL_A,
                    uint8(2),
                    uint256(1),
                    referenceTerms(s, terms(MEAL_A, 2, PRICE_A, TERMS_A)),
                    block.timestamp + 600
                )
            ),
            StoreEscrow.Insolvent.selector
        );
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.lock, (key(), safe, uint256(1), block.timestamp + 600)),
            StoreEscrow.Insolvent.selector
        );
        reject(
            s,
            s.operatorAuthority(),
            abi.encodeCall(StoreEscrow.markHandover, (key(), v, uint256(1), l, block.timestamp + 600)),
            StoreEscrow.Insolvent.selector
        );
        reporting(s, v, 1, l, m);
        vm.warp(block.timestamp + 72 hours);
        expiring(s, safe, 1);
        assertEq(s.liability(), 3 * PRICE_A);
        reject(s, s.owner(), abi.encodeCall(StoreEscrow.settle, (key(), v, uint256(1))), StoreEscrow.Insolvent.selector);
        assertEq(uint8(s.getUnit(0).bucket), 2);
        reject(
            s,
            PAYER,
            abi.encodeCall(StoreEscrow.refundWithIntent, (key(), s.getUnit(1).batchId, uint16(2))),
            StoreEscrow.Insolvent.selector
        );
    }
}
