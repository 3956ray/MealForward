import assert from 'node:assert/strict';
import test from 'node:test';
import { createCollectionLink, consumeCollectionLink } from '../../consumer/collection-link.mjs';

const origin = 'https://public-synthetic.example.test:8443';
const store = 'synthetic-store_1';
const display = 'A'.repeat(43); // Fictional short display fixture, no server validity is claimed.
const valid = `${origin}/#collection=v1&store=${store}&display=${display}`;

function surfaces(href, fail = false) {
  const location = new URL(href);
  const calls = [];
  const state = { publicTest: true };
  const history = { state, replaceState(nextState, title, url) {
    if (fail) throw Error('Synthetic history failure');
    calls.push({ nextState, title, url });
    location.href = url;
  } };
  return { location, history, calls, state };
}

test('canonical HTTPS root link contains only a short store/display fragment', () => {
  assert.equal(createCollectionLink({ origin, store, display }), valid);
  for (const input of [
    { origin: 'http://public-synthetic.example.test', store, display },
    { origin: `${origin}/other`, store, display }, { origin: `${origin}?secret=x`, store, display },
    { origin: `${origin}#access=x`, store, display }, { origin: 'https://user:pass@example.test', store, display },
    { origin, store: 'bad/store', display }, { origin, store: '0x' + '1'.repeat(64), display },
    { origin, store, display: 'A'.repeat(42) }, { origin, store, display, access: 'forbidden' },
    { origin, store, display, voucherId: 'forbidden' },
  ]) assert.throws(() => createCollectionLink(input), /INVALID_COLLECTION_LINK/);
});

test('consumption erases synchronously before returning and replay has no fragment', () => {
  const view = surfaces(valid);
  const result = consumeCollectionLink(view);
  assert.equal(view.calls.length, 1);
  assert.equal(view.location.hash, '');
  assert.equal(view.calls[0].url, `${origin}/`);
  assert.equal(view.calls[0].nextState, view.state);
  assert.deepEqual(result, { store, display });
  assert.equal(consumeCollectionLink(view), null);
});

test('malformed target fragments and query/path/HTTP links are erased and rejected', () => {
  for (const href of [
    `${valid}&access=forbidden`, `${valid}&voucherId=forbidden`, `${valid}&store=duplicate`,
    `${origin}/#collection=v2&store=${store}&display=${display}`,
    `${origin}/#collection=v1&display=${display}&store=${store}`,
    `${origin}/#collection=v1&store=bad%2Fstore&display=${display}`,
    `${origin}/#%63ollection=v1&store=${store}&display=${display}`,
    `${origin}/#Collection=v1&store=${store}&display=${display}`,
    `${origin}/#collection=v1&store=${store}&display=short`,
    `${origin}/?access=forbidden#collection=v1&store=${store}&display=${display}`,
    `${origin}/other#collection=v1&store=${store}&display=${display}`,
    `http://public-synthetic.example.test/#collection=v1&store=${store}&display=${display}`,
  ]) {
    const view = surfaces(href);
    assert.equal(consumeCollectionLink(view), null);
    assert.equal(view.calls.length, 1);
    assert.equal(view.location.hash, '');
    assert.equal(view.location.search, '');
  }
});

test('unrelated fragments remain unchanged and failed erasure never yields a display', () => {
  const other = surfaces(`${origin}/#ordinary-navigation`);
  assert.equal(consumeCollectionLink(other), null);
  assert.equal(other.calls.length, 0);
  assert.equal(other.location.hash, '#ordinary-navigation');
  assert.equal(consumeCollectionLink(surfaces(valid, true)), null);
  assert.equal(consumeCollectionLink({ location: new URL(valid), history: {} }), null);
});
