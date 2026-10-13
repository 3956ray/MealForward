// Short-lived collection display links only. No requests, storage, voucher actions or inferred expiry.
const alias = /^[A-Za-z0-9_-]{1,64}$/;
const shortDisplay = /^[A-Za-z0-9_-]{43}$/;
const fragmentFor = (store, display) => `#collection=v1&store=${store}&display=${display}`;

export function createCollectionLink(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'display,origin,store'
    || typeof input.origin !== 'string' || typeof input.store !== 'string'
    || typeof input.display !== 'string' || !alias.test(input.store) || !shortDisplay.test(input.display)) {
    throw TypeError('INVALID_COLLECTION_LINK');
  }
  let origin;
  try {
    origin = new URL(input.origin);
  } catch { throw TypeError('INVALID_COLLECTION_LINK'); }
  // Main supplies its current reviewed location.origin; do not accept paths, queries, credentials or fragments.
  if (origin.protocol !== 'https:' || origin.origin !== input.origin || origin.username || origin.password
    || origin.pathname !== '/' || origin.search || origin.hash) throw TypeError('INVALID_COLLECTION_LINK');
  return `${origin.origin}/${fragmentFor(input.store, input.display)}`;
}

export function consumeCollectionLink({ location, history } = {}) {
  const fragment = location?.hash;
  if (typeof fragment !== 'string' || !fragment) return null;
  // Detect the reserved namespace only, including malformed spelling/encoding; unrelated app hashes remain alone.
  const isTarget = /^#collection/i.test(fragment) || fragment.slice(1).split('&').some(part => {
    try { return decodeURIComponent(part.split('=', 1)[0]).toLowerCase() === 'collection'; }
    catch { return false; }
  });
  if (!isTarget) return null;
  const originalHref = location?.href;
  // Erase before validating any display/store/link contents. Invalid target links also lose their query.
  try {
    if (typeof originalHref !== 'string' || typeof history?.replaceState !== 'function') return null;
    history.replaceState(history.state, '', originalHref.split(/[?#]/, 1)[0]);
  } catch { return null; } // Never return display data if erasure failed; no navigation fallback.
  try {
    const url = new URL(originalHref);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search
      || url.hash !== fragment) return null;
    const parameters = new URLSearchParams(fragment.slice(1));
    const store = parameters.get('store'), display = parameters.get('display');
    if (parameters.get('collection') !== 'v1' || typeof store !== 'string' || !alias.test(store)
      || typeof display !== 'string' || !shortDisplay.test(display)
      || fragment !== fragmentFor(store, display)) return null;
    return { store, display };
  } catch { return null; }
}
