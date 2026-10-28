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
