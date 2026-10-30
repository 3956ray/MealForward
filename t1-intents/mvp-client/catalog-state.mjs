export function integer(value, { positive = true } = {}) {
  const text = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(text) || (positive && text === '0') || BigInt(text) >= 2n ** 256n) throw Error('请输入有效的整数份数');
  return text;
}
export function amountFor(unitPrice, quantity) {
  const value = BigInt(integer(unitPrice)) * BigInt(integer(quantity));
  if (value >= 2n ** 256n) throw Error('金额超出范围');
  return value.toString();
}
export function priceInput(value, decimals = 6) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw Error('资产精度无效');
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(String(value));
  if (!match || (match[2]?.length || 0) > decimals) throw Error('请输入正确单价');
  return integer(BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt((match[2] || '').padEnd(decimals, '0') || '0'));
}
export function formatAmount(value, decimals = 6) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return '—';
  try {
    const text = integer(value, { positive: false }).padStart(decimals + 1, '0');
    return decimals ? text.slice(0, -decimals) + (text.slice(-decimals).replace(/0+$/, '') ? '.' + text.slice(-decimals).replace(/0+$/, '') : '') : text;
  } catch { return '—'; }
}
export function beijingInput(seconds) {
  return Number.isSafeInteger(Number(seconds)) && Number(seconds) > 0 ? new Date(Number(seconds) * 1000 + 8 * 3600000).toISOString().slice(0, 16) : '';
}
export function beijingSeconds(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw Error('请选择资助截止时间');
  const result = Date.parse(value + ':00+08:00') / 1000;
  if (!Number.isSafeInteger(result) || beijingInput(result) !== value) throw Error('截止时间无效');
  return result;
}
export function windowMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(value)) throw Error('用餐时间格式无效');
  const [h, m] = value.split(':').map(Number);
  if (h > 24 || m > 59 || (h === 24 && m)) throw Error('用餐时间无效');
  return h * 60 + m;
}
export const timeLabel = minute => String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
export function draftPayload(form, decimals, now = Date.now() / 1000) {
  const windows = form.windows.map(([a, b]) => [windowMinutes(a), windowMinutes(b)]);
  if (!windows.length || windows.length > 2 || windows.some(([a, b]) => a >= b) || (windows.length === 2 && windows[0][1] > windows[1][0])) throw Error('用餐时段不能重叠或倒置');
  const fundingDeadline = beijingSeconds(form.deadline);
  if (fundingDeadline <= now) throw Error('资助截止时间必须在未来');
  if (!form.name.trim() || form.name.trim().length > 100 || !form.description.trim() || form.description.length > 2000) throw Error('请填写餐品名称及合适长度的说明');
  return {name:form.name.trim(), description:form.description.trim(), unitPrice:priceInput(form.price, decimals), windows, quantity:integer(form.quantity), fundingDeadline};
}
export function supportPayload(meal, quantity, now = Date.now() / 1000) {
  const qty = integer(quantity);
  if (!meal.listed || Number(meal.fundingDeadline) <= now || BigInt(qty) > BigInt(integer(meal.remaining, {positive:false}))) throw Error('当前可资助数量或期限已变化，请刷新餐品');
  return {storeId:meal.storeId, mealId:meal.id, version:meal.version, quantity:qty};
}
export const intentLabel = state => ({CONFIRMED:'资助已确认', FINAL_SUCCEEDED:'资助已确认', PREPARED:'等待钱包付款', SEND_UNKNOWN:'付款结果待核对', HASH_BOUND:'原交易确认中', REVERTED:'原交易已失败'}[state] || '原请求处理中');
