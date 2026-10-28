import { parseSiweMessage } from "viem/siwe";
export const POLICIES = {
  owner: "0xc4f8a468f10d5f98dcff3282516125e97f26433b",
  donor: "0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952",
  issuer: "0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3",
};
const same = (a, b) =>
  typeof a === "string" && a.toLowerCase() === b?.toLowerCase();
export function validateChallenge(c, account, origin) {
  const m = parseSiweMessage(c.message);
  if (
    !same(m.address, account) ||
    m.domain !== new URL(origin).host ||
    m.uri !== origin ||
    m.chainId !== 10143 ||
    m.requestId !== c.challengeId ||
    !m.expirationTime ||
    m.expirationTime.getTime() <= Date.now() ||
    m.issuedAt?.getTime() > Date.now() + 30000
  )
    throw Error("INVALID_LOGIN_CHALLENGE");
}
export function validateQuote(t, state) {
  if (
    t?.domain?.chainId != 10143 ||
    !same(t.domain.verifyingContract, state.escrow) ||
    t.domain.name !== "MealForward C0 Funding" ||
    t.domain.version !== "1" ||
    t.primaryType !== "FundingQuote" ||
    !same(t.message?.payer, POLICIES.donor) ||
    String(t.message.quantity) !== "1" ||
    String(t.message.amount) !== "7000000" ||
    String(t.message.unitPrice) !== "7000000" ||
    Number(t.message.deadline) * 1000 <= Date.now()
  )
    throw Error("INVALID_FUNDING_QUOTE");
}
export function validateTransaction(tx, action, account, state) {
  const target = action === "approve" ? state.token : state.escrow;
  const creation = ["token", "escrow"].includes(action);
  if (
    !same(tx?.from, account) ||
    Number(tx.chainId) !== 10143 ||
    !/^0x[0-9a-f]{2,}$/i.test(tx.data || "") ||
    tx.data.length % 2 ||
    !/^0x[0-9a-f]+$/i.test(tx.nonce || "") ||
    BigInt(tx.value ?? 1) !== 0n ||
    (creation ? tx.to != null : !same(tx.to, target))
  )
    throw Error("INVALID_TRANSACTION");
}
export function captureFragment(view) {
  const token = view.location.hash.slice(1);
  if (view.location.hash)
    view.history.replaceState(
      null,
      "",
      view.location.pathname + view.location.search,
    );
  return token;
}
export function displayRemaining(display, now = Date.now()) {
  return (
    Math.max(0, Math.ceil((Number(display?.expiresAt) * 1000 - now) / 1000)) ||
    0
  );
}
