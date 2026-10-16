// Pure time calculation for the no-funds, browser-local experience sandbox.
// The real voucher model remains authoritative and enforces original service hours.
const MINUTE = 60_000;
const DAY = 86_400_000;
const SHANGHAI_OFFSET = 8 * 60 * MINUTE;

export function nextDemoServiceInstant(windows, now, originalExpiry) {
  if (!Array.isArray(windows) || !Number.isFinite(now) || !Number.isFinite(originalExpiry) || now >= originalExpiry) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit'})
      .formatToParts(new Date(now)).filter(part => ['year','month','day'].includes(part.type))
      .map(part => [part.type, Number(part.value)])
  );
  const todayStart = Date.UTC(parts.year, parts.month - 1, parts.day) - SHANGHAI_OFFSET;
  const sorted = [...windows].sort((a,b) => a[0]-b[0]);
  // Original voucher lifetime is 72 hours; four local calendar dates cover this window.
  for (let day = 0; day <= 3; day++) {
    for (const window of sorted) {
      if (!Array.isArray(window) || window.length !== 2) continue;
      const [start,end] = window;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > 1440) continue;
      const candidate = todayStart + day * DAY + start * MINUTE + 1000;
      if (candidate > now && candidate < originalExpiry && candidate < todayStart + day * DAY + end * MINUTE) return candidate;
    }
  }
  return null;
}
