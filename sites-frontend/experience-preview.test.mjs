import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
const path = new URL('./preview-dist/', import.meta.url);
const original = readFileSync(new URL('./dist/app.js', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./preview-dist/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./preview-dist/index.html', import.meta.url), 'utf8');
const guide = readFileSync(new URL('./preview-dist/test-guide.html', import.meta.url), 'utf8');

test('preview uses the original Sites UI code with a single isolated mode switch', () => {
  assert.equal(original.includes('const LIVE_MODE=true;'), true);
  assert.equal(preview, original.replace('const LIVE_MODE=true;', 'const LIVE_MODE=false;'));
  assert.equal(original.includes('const LIVE_MODE=false;'), false);
});
test('test environment clearly discloses local simulations and contains its own Chinese guide', () => {
  assert.match(html, /产品体验测试版（模拟）/);
  assert.match(html, /非真实资金环境/);
  assert.match(html, /test-guide\.html/);
  assert.match(guide, /支持者/);
  assert.match(guide, /领取者/);
  assert.match(guide, /店主/);
  assert.match(guide, /UNKNOWN 不重发/);
});
test('preview cannot load CP30 API adapter or wallet transaction builder', () => {
  assert.equal(existsSync(new URL('./preview-dist/live-api.mjs', import.meta.url)), false);
  assert.equal(existsSync(new URL('./preview-dist/assets/live-wallet.mjs', import.meta.url)), false);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /src="https?:/);
});
test('no mutation of live source or wallet/login behavior in deploy output', () => {
  assert.match(original, /const LIVE_MODE=true;/);
  assert.doesNotMatch(html, /Kitchen registration · Test assets only/);
  assert.equal(preview.includes('function supportModal('), true);
  assert.equal(preview.includes('function claimModal('), true);
  assert.equal(preview.includes('function merchant('), true);
});
