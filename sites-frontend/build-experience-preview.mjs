// Build a no-wallet, no-network product experience sandbox from the frozen Sites UI.
// This generator only writes to sites-frontend/preview-dist. Never run against CP30.
import {cp, copyFile, readFile, writeFile, rm, stat} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, 'dist');
const output = join(here, 'preview-dist');
const appPath = join(output, 'app.js');
const htmlPath = join(output, 'index.html');
const cssPath = join(output, 'styles.css');

if (resolve(output) === resolve(source)) throw Error('Refusing to overwrite the live frontend.');
await stat(join(source, 'app.js'));
await rm(output, {recursive: true, force: true});
await cp(source, output, {recursive: true, force: false});

const original = await readFile(appPath, 'utf8');
const token = 'const LIVE_MODE=true;';
if (original.split(token).length !== 2) throw Error('Expected one exact live mode constant; STOP.');
await writeFile(appPath, original.replace(token, 'const LIVE_MODE=false;'));

let html = await readFile(htmlPath, 'utf8');
for (const [before, after] of [
  ['<title>MealForward · A warm meal. A kinder day.</title>', '<title>留膳 MealForward · 产品体验测试版（模拟）</title>'],
  ["connect-src 'self'", "connect-src 'none'"],
  ['<div class="demo-bar"><span class="demo-dot"></span>Monad Testnet <span class="bar-separator">/</span> Kitchen registration · Test assets only <a href="#about">About MealForward</a></div>',
   '<div class="demo-bar"><span class="demo-dot"></span> EXPERIENCE SANDBOX <span class="bar-separator">/</span> Simulated meals · No wallet or real USDC <a href="/test-guide.html">中文测试指南</a></div>'],
  ['<small>Monad Testnet · Test assets have no real dollar value</small>',
   '<small>Experience sandbox · All meals, wallets, vouchers and payouts are simulated</small>']
]) {
  if (!html.includes(before)) throw Error('Preview HTML source changed; expected: ' + before.slice(0, 70));
  html = html.replace(before, after);
}
const notice = '<section class="sandbox-disclosure" role="note" aria-label="测试环境说明" lang="zh-CN">' +
  '<div><span class="sandbox-tag">INTERACTIVE DEMO · 非真实资金环境</span>' +
  '<p><strong>你正在体验留膳的产品流程</strong><span>本测试站使用虚拟餐馆、虚拟资金与本地餐券。不会连接真实钱包、链上合约或 CP30 数据库。</span></p></div>' +
  '<a href="/test-guide.html" aria-label="阅读中文测试步骤">查看测试步骤 <span aria-hidden="true">↗</span></a></section>';
if (!html.includes('<main id="main"')) throw Error('Missing main application landmark.');
html = html.replace('<main id="main"', notice + '\n  <main id="main"');
await writeFile(htmlPath, html);
const css = [
  '/* Sandboxed experience preview: unmistakable and mobile-friendly. */',
  '.sandbox-disclosure{max-width:1236px;margin:4px auto 18px;padding:17px 22px;border:1px solid #d6ddcc;border-left:4px solid #d86b3f;border-radius:12px;background:#f2f2e9;display:flex;align-items:center;justify-content:space-between;gap:22px;color:#253c32}',
  '.sandbox-disclosure p{margin:5px 0 0;display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;font-size:14px;line-height:1.6}',
  '.sandbox-disclosure p strong{font-weight:650;font-size:16px}.sandbox-disclosure p span{color:#596a5b}',
  '.sandbox-tag{font-size:11px;letter-spacing:.08em;font-weight:700;color:#8c4d2f}',
  '.sandbox-disclosure>a{font-size:14px;font-weight:600;color:#234c3d;text-decoration:underline;text-underline-offset:4px;white-space:nowrap}',
  '@media(max-width:780px){.sandbox-disclosure{margin:0 18px 20px;padding:14px 16px;flex-direction:column;align-items:flex-start;gap:10px}.sandbox-disclosure p{display:block}.sandbox-disclosure p span{display:block}.demo-bar{font-size:11px;gap:6px;flex-wrap:wrap;height:auto;min-height:34px;padding:6px 10px}.demo-bar a{margin-left:2px}}'
].join('\n');
await writeFile(cssPath, (await readFile(cssPath, 'utf8')) + '\n' + css + '\n');
await copyFile(join(here, 'experience-guide.html'), join(output, 'test-guide.html'));
// Defense in depth: the real CP30 API adapter and onchain wallet transaction builder
// must not exist in this deployment, even though demo branches never import them.
await rm(join(output, 'live-api.mjs'), {force: true});
await rm(join(output, 'assets', 'live-wallet.mjs'), {force: true});
console.log('SANDBOX_BUILD: PASS');
console.log('MODE: BROWSER_LOCAL_SIMULATION');
console.log('WALLET_TRANSACTION_BUILDER: ABSENT');
console.log('LIVE_API_ADAPTER: ABSENT');
console.log('BACKEND/CP30: UNTOUCHED');
