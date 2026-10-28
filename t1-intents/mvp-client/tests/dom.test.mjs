import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createSiweMessage } from "viem/siwe";
import { POLICIES, validateQuote, validateTransaction } from "../guards.mjs";
import { captureFragment, displayRemaining } from "../recipient-state.mjs";
import { mkdtemp, rm } from "node:fs/promises";
const tmp = await mkdtemp(new URL("../.dom-test-", import.meta.url).pathname);
await build({
  entryPoints: [
    new URL("../app.jsx", import.meta.url).pathname,
    new URL("../recipient.jsx", import.meta.url).pathname,
  ],
  outdir: tmp,
  bundle: true,
  format: "esm",
  packages: "external",
  jsx: "transform",
});
const dom = new JSDOM('<div id="test"></div>', {
  url: "https://mvp.onrender.com/mvp/setup.html",
});
for (const name of [
  "window",
  "document",
  "location",
  "localStorage",
  "HTMLElement",
  "Event",
  "MouseEvent",
])
  globalThis[name] = dom.window[name];
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { App } = await import(tmp + "/app.js");
const { Recipient } = await import(tmp + "/recipient.js");
const account = POLICIES.owner;
let root;
async function mount(Component, props) {
  document.body.innerHTML = '<div id="test"></div>';
  root = createRoot(document.getElementById("test"));
  await act(async () => {
    root.render(React.createElement(Component, props));
    await new Promise((r) => setTimeout(r, 10));
  });
}
async function click(text) {
  const button = [...document.querySelectorAll("button")].find((x) =>
    x.textContent.includes(text),
  );
  assert.ok(button, text);
  assert.equal(button.disabled, false, text + " enabled");
  await act(async () => {
    button.click();
    await new Promise((r) => setTimeout(r, 10));
  });
}
async function unmount() {
  await act(async () => root.unmount());
}
function factory({ onChange }) {
  return {
    providers: () => [{ id: "test", name: "Test wallet" }],
    select() {
      onChange();
    },
    connect: async () => ({ account, chainId: 10143 }),
    inspect: async () => ({ account, chainId: 10143 }),
    signMessage: async (a, m, guard) => {
      guard();
      return "signature";
    },
    sendTransaction: async () => {
      throw Error("MUST_NOT_SEND");
    },
    dispose() {},
  };
}
const status = { enabled: true, writesEnabled: true };
const session = { wallet: account, role: "owner", csrf: "test" };
const setup = (phase = "EMPTY", operations = []) => ({
  state: { phase },
  operations,
  nextAction: "token",
  allowedAction: "token",
  quote: null,
});
test("synthetic DOM login immediately refreshes setup; confirmed phase enables next step", async () => {
  let logged = false,
    reads = 0;
  const api = async (path) => {
    if (path === "/status") return status;
    if (path === "/me") {
      if (!logged) throw Error("NO_SESSION");
      return session;
    }
    if (path === "/auth/pre-session") return { csrf: "pre" };
    if (path === "/identity/wallet/challenge")
      return {
        challengeId: "id",
        message: createSiweMessage({
          address: account,
          domain: location.host,
          uri: location.origin,
          chainId: 10143,
          nonce: "abcdef123456",
          version: "1",
          requestId: "id",
          issuedAt: new Date(),
          expirationTime: new Date(Date.now() + 180000),
        }),
      };
    if (path === "/identity/wallet/login") {
      logged = true;
      return { csrf: "test" };
    }
    if (path === "/setup") {
      reads++;
      return {
        ...setup("TOKEN_READY"),
        nextAction: "escrow",
        allowedAction: "escrow",
      };
    }
    throw Error(path);
  };
  await mount(App, { api, walletFactory: factory });
  await act(async () => {
    const select = document.querySelector("select");
    select.value = "test";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("连接钱包并签名登录");
  assert.ok(reads >= 1);
  assert.match(document.body.textContent, /准备部署餐券合约/);
  await unmount();
});
test("synthetic DOM reload PREPARED recovers transaction summary; UNKNOWN never offers resend", async () => {
  for (const state of ["PREPARED", "SEND_UNKNOWN"]) {
    const o = {
      id: "original",
      action: "token",
      state,
      transaction:
        state === "PREPARED"
          ? {
              from: account,
              data: "0x12",
              chainId: "0x279f",
              value: "0x0",
              nonce: "0x1",
            }
          : undefined,
    };
    const api = async (p) =>
      p === "/status" ? status : p === "/me" ? session : setup("EMPTY", [o]);
    await mount(App, { api, walletFactory: factory });
    assert.match(document.body.textContent, /original/);
    assert.equal(
      document.body.textContent.includes("本人打开钱包"),
      state === "PREPARED",
    );
    if (state === "SEND_UNKNOWN")
      assert.match(document.body.textContent, /绑定并核对原哈希/);
    await unmount();
  }
});
test("synthetic merchant handover waits for server eligibility before settle", async () => {
  let eligible = false;
  const api = async (p) =>
    p === "/status"
      ? status
      : p === "/me"
        ? session
        : {
            ...setup("HANDED_OVER"),
            state: {
              phase: "HANDED_OVER",
              settlementAvailableAt: Math.floor(Date.now() / 1000) + 180,
            },
            nextAction: "settle",
            allowedAction: "settle",
            settleEnabled: eligible,
          };
  await mount(App, { merchant: true, api, walletFactory: factory });
  let button = [...document.querySelectorAll("button")].find(
    (x) => x.textContent === "准备结算测试餐款",
  );
  assert.ok(button.disabled);
  eligible = true;
  await click("刷新已确认进度");
  button = [...document.querySelectorAll("button")].find(
    (x) => x.textContent === "准备结算测试餐款",
  );
  assert.equal(button.disabled, false);
  await unmount();
});
test("recipient scrubs fragment, exchanges only on click, expired QR remains hidden", async () => {
  const v = new JSDOM("", {
    url: "https://example.test/mvp/recipient.html#private",
  }).window;
  assert.equal(captureFragment(v), "private");
  assert.equal(v.location.hash, "");
  assert.equal(displayRemaining({ expiresAt: 1 }, 2000), 0);
  let exchanges = 0;
  const api = async (p) => {
    if (p === "/recipient/exchange") {
      exchanges++;
      return { csrf: "r" };
    }
    if (p === "/recipient/display")
      return { qrToken: "short-lived", code: "123456", expiresAt: 1 };
    return {
      state: "ISSUED",
      csrf: "r",
      expiresAt: Math.floor(Date.now() / 1000) + 1000,
    };
  };
  await mount(Recipient, { api, token: "private" });
  assert.equal(exchanges, 0);
  await click("查看餐券");
  assert.equal(exchanges, 1);
  await click("到店了");
  assert.equal(document.querySelector("svg"), null);
  assert.match(document.body.textContent, /已过期并隐藏/);
  await unmount();
});
test("transaction and quote reject wrong recipient, network, amounts", () => {
  const tx = {
    from: account,
    chainId: 10143,
    data: "0x12",
    value: "0x0",
    nonce: "0x0",
    to: POLICIES.donor,
  };
  assert.throws(() =>
    validateTransaction(tx, "fund", account, { escrow: account }),
  );
  assert.throws(() => validateQuote({ domain: { chainId: 1 } }, {}));
});
test("lost attempt response blocks resend and never invokes provider", async () => {
  let sends = 0,
    attempts = 0;
  const operation = {
    id: "original",
    action: "token",
    state: "PREPARED",
    transaction: {
      from: account,
      chainId: "0x279f",
      value: "0x0",
      nonce: "0x0",
      data: "0x12",
    },
  };
  const api = async (p) => {
    if (p === "/status") return status;
    if (p === "/me") return session;
    if (p.endsWith("/attempt")) {
      attempts++;
      throw Error("REQUEST_TIMEOUT");
    }
    return setup("EMPTY", [operation]);
  };
  const walletFactory = () => ({
    ...factory({ onChange() {} }),
    select() {},
    sendTransaction: async () => {
      sends++;
      return "0x" + "a".repeat(64);
    },
  });
  await mount(App, { api, walletFactory });
  await act(async () => {
    const select = document.querySelector("select");
    select.value = "test";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("本人打开钱包");
  assert.equal(attempts, 1);
  assert.equal(sends, 0);
  assert.equal(document.body.textContent.includes("本人打开钱包"), false);
  assert.match(document.body.textContent, /绑定并核对原哈希/);
  await unmount();
});
test("recipient unauthenticated landing is neutral and has no administrative navigation", async () => {
  await mount(Recipient, {
    token: "",
    api: async () => {
      throw Error("RECIPIENT_SESSION_REQUIRED");
    },
  });
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(document.querySelector("nav"), null);
  assert.match(document.body.textContent, /请从机构给你的私密链接进入/);
  await unmount();
});
test("camera preserves first-frame and busy-refresh scans; context changes discard queued checks", async () => {
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const oldRaf = globalThis.requestAnimationFrame,
    oldCancel = globalThis.cancelAnimationFrame;
  const videoProto = dom.window.HTMLVideoElement.prototype,
    canvasProto = dom.window.HTMLCanvasElement.prototype;
  const oldPlay = videoProto.play,
    oldContext = canvasProto.getContext;
  let frames = [],
    stops = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [
            {
              stop() {
                stops++;
              },
            },
          ],
        }),
      },
    },
  });
  globalThis.requestAnimationFrame = (fn) => {
    frames.push(fn);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = () => {};
  Object.defineProperty(videoProto, "readyState", {
    configurable: true,
    get: () => 2,
  });
  Object.defineProperty(videoProto, "videoWidth", {
    configurable: true,
    get: () => 2,
  });
  Object.defineProperty(videoProto, "videoHeight", {
    configurable: true,
    get: () => 2,
  });
  videoProto.play = async () => {};
  canvasProto.getContext = () => ({
    drawImage() {},
    getImageData: () => ({ data: new Uint8ClampedArray(16) }),
  });
  try {
    for (const scenario of ["first", "busy", "changed"]) {
      frames = [];
      stops = 0;
      let checks = 0,
        ready = scenario === "first",
        held = false,
        release,
        changed;
      const state = {
        ...setup("ISSUED"),
        nextAction: "redeem",
        allowedAction: "redeem",
      };
      const api = async (p) => {
        if (p === "/status") return status;
        if (p === "/me") return session;
        if (p === "/merchant/check") {
          checks++;
          return {
            checkToken: "check",
            expiresAt: Math.floor(Date.now() / 1000) + 120,
            meal: "测试餐",
          };
        }
        if (held)
          return new Promise((r) => {
            release = () => r(state);
          });
        return state;
      };
      const walletFactory = ({ onChange }) => {
        changed = onChange;
        return factory({ onChange });
      };
      await mount(App, {
        merchant: true,
        api,
        walletFactory,
        decodeQr: () => (ready ? { data: "short-qr" } : null),
      });
      await act(async () => {
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent === "开启相机扫码")
          .click();
      });
      assert.equal(frames.length, 1);
      await act(async () => {
        frames.shift()();
        await new Promise((r) => setTimeout(r, 0));
      });
      if (scenario !== "first") {
        assert.equal(checks, 0);
        held = true;
        await act(async () => {
          [...document.querySelectorAll("button")]
            .find((b) => b.textContent.includes("刷新已确认进度"))
            .click();
        });
        ready = true;
        await act(async () => {
          frames.shift()();
        });
        assert.equal(checks, 0, "check waits for busy refresh");
        if (scenario === "changed") await act(async () => changed());
        held = false;
        await act(async () => {
          release();
          await new Promise((r) => setTimeout(r, 0));
        });
      }
      assert.equal(checks, scenario === "changed" ? 0 : 1, scenario);
      assert.equal(stops, 1, "camera tracks stopped exactly once");
      await unmount();
    }
  } finally {
    if (oldNavigator)
      Object.defineProperty(globalThis, "navigator", oldNavigator);
    else delete globalThis.navigator;
    globalThis.requestAnimationFrame = oldRaf;
    globalThis.cancelAnimationFrame = oldCancel;
    videoProto.play = oldPlay;
    canvasProto.getContext = oldContext;
    for (const k of ["readyState", "videoWidth", "videoHeight"])
      delete videoProto[k];
  }
});
test.after(async () => {
  dom.window.close();
  await rm(tmp, { recursive: true, force: true });
});
