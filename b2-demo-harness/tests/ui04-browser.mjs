import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import * as M from "../src/model.ts";

const base = "http://127.0.0.1:15603/";
const evidence = "evidence/ui04";
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const results = [],
  errors = [],
  external = [],
  requests = [];
let lastPage;
const stateOf = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)), M.STORAGE_KEY);
async function fresh(width = 1440, state = M.initialState(), hash = "meals") {
  const context = await browser.newContext({
    viewport: { width, height: width < 768 ? 844 : 1024 },
  });
  const page = await context.newPage();
  lastPage = page;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    requests.push(request.url());
    if (!request.url().startsWith(base) && !request.url().startsWith("data:"))
      external.push(request.url());
  });
  await page.addInitScript(
    ({ key, state }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(state));
    },
    { key: M.STORAGE_KEY, state },
  );
  await page.goto(`${base}#/${hash}`);
  await page.locator("h1").waitFor();
  return { page, context };
}
async function navigate(page, hash) {
  await page.evaluate((hash) => {
    location.hash = `/${hash}`;
  }, hash);
  const heading = {
    meals: "Choose a kitchen",
    "kitchen/meadow": "Meadow Kitchen",
    "my/vouchers": "My meals",
    "my/orders": "My meals",
    owner: "Kitchen workspace",
    ledger: "Public meal ledger",
    claim: "Claim a meal",
  }[hash];
  await page.waitForFunction(
    ({ hash, heading }) => {
      if (
        location.hash !== `#/${hash}` ||
        document.querySelector("h1")?.textContent.trim() !== heading
      )
        return false;
      if (hash.startsWith("my/"))
        return (
          document.querySelector('.my-tabs [aria-current="page"]')
            ?.textContent ===
          (hash === "my/orders" ? "Support orders" : "My vouchers")
        );
      return true;
    },
    { hash, heading },
  );
}
async function overflow(page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "No horizontal viewport overflow",
  );
}
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
    console.log("PASS", name);
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
    if (lastPage && !lastPage.isClosed())
      await lastPage.screenshot({
        path: `${evidence}/ui04-failure.png`,
        fullPage: true,
      });
    throw error;
  }
}
try {
  await check(
    "First choice of any kitchen has no implicit cart to replace",
    async () => {
      for (const store of M.initialState().stores) {
        const { page, context } = await fresh(390);
        await page
          .getByRole("button", {
            name: `View kitchen · ${store.name}`,
            exact: true,
          })
          .click();
        await page
          .getByRole("heading", { name: store.name, exact: true })
          .waitFor();
        assert.equal(await page.locator("dialog[open]").count(), 0);
        assert.match(await page.locator(".cart-total").innerText(), /0 meals/);
        await context.close();
      }
    },
  );
  await check(
    "Direct store URLs refresh into the requested kitchen with unchanged paid terms",
    async () => {
      for (const id of ["meadow", "river", "lantern"]) {
        const { page, context } = await fresh(
          390,
          M.initialState(),
          `kitchen/${id}`,
        );
        const store = M.storeOf(M.initialState(), id);
        await page
          .getByRole("heading", { name: store.name, exact: true })
          .waitFor();
        await page.reload();
        await page
          .getByRole("heading", { name: store.name, exact: true })
          .waitFor();
        assert.match(
          await page.locator(".cart-store").innerText(),
          new RegExp(store.name),
        );
        assert.deepEqual((await stateOf(page)).units, M.initialState().units);
        assert.equal((await stateOf(page)).schema, 1);
        await overflow(page);
        await context.close();
      }
    },
  );
  await check(
    "Cart survives catalog, public-store selection and claim-store selection; hash changes ask Keep/Replace",
    async () => {
      const { page, context } = await fresh(
        1440,
        M.initialState(),
        "kitchen/meadow",
      );
      await page
        .getByRole("button", { name: "Increase Lunch quantity", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Increase Dinner quantity", exact: true })
        .click();
      await navigate(page, "ledger");
      await page
        .getByRole("button", { name: "River Table", exact: true })
        .click();
      await navigate(page, "claim");
      await page.getByLabel("Store", { exact: true }).selectOption("lantern");
      await navigate(page, "kitchen/meadow");
      await page
        .getByRole("heading", { name: "Meadow Kitchen", exact: true })
        .waitFor();
      assert.match(await page.locator(".cart-total").innerText(), /2 meals/);
      await page.evaluate(() => {
        location.hash = "/kitchen/river";
      });
      await page.getByRole("dialog", { name: "Replace your cart?" }).waitFor();
      assert.ok(page.url().endsWith("#/kitchen/meadow"));
      await page.keyboard.press("Escape");
      assert.match(await page.locator(".cart-total").innerText(), /2 meals/);
      await page.evaluate(() => {
        location.hash = "/kitchen/river";
      });
      await page
        .getByRole("button", { name: "Replace cart", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "River Table", exact: true })
        .waitFor();
      assert.match(await page.locator(".cart-total").innerText(), /0 meals/);
      await context.close();
    },
  );
  await check(
    "My meals separates original verified vouchers, recovery and original-payer orders",
    async () => {
      const { page, context } = await fresh(
        390,
        M.initialState(),
        "my/vouchers",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Open voucher", exact: true })
          .count(),
        0,
      );
      await page.getByLabel("Built-in email").selectOption(M.EMAILS[1]);
      await page
        .getByRole("button", {
          name: "Simulate email verification",
          exact: true,
        })
        .click();
      assert.equal(
        await page
          .getByRole("button", { name: "Open voucher", exact: true })
          .count(),
        1,
      );
      await page
        .getByRole("button", { name: "Open voucher", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "My voucher", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "My vouchers", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Support orders", exact: true })
        .click();
      assert.equal(await page.locator(".order").count(), 0);
      await page
        .getByRole("button", { name: "Connect demo wallet", exact: true })
        .click();
      assert.equal(await page.locator(".order").count(), 3);
      await page.reload();
      await page
        .getByRole("heading", { name: "Support orders", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "My vouchers", exact: true })
        .click();
      const before = (await stateOf(page)).vouchers.find(
        (v) => v.email === M.EMAILS[1],
      );
      await page
        .getByRole("button", { name: "Recover my voucher", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "Recover original demo voucher",
          exact: true,
        })
        .click();
      const after = (await stateOf(page)).vouchers.find(
        (v) => v.id === before.id,
      );
      assert.equal(after.expires, before.expires);
      assert.equal(after.unitId, before.unitId);
      await context.close();
    },
  );
  await check(
    "Owner without a current voucher opens check form; restored UNKNOWN keeps original query visible",
    async () => {
      const empty = M.initialState();
      empty.owner = "river";
      const { page, context } = await fresh(390, empty, "owner");
      await page
        .getByRole("heading", { name: "Check a voucher", exact: true })
        .waitFor();
      assert.ok(
        await page
          .getByLabel("Verification string", { exact: true })
          .isVisible(),
      );
      await context.close();
      const unknown = M.initialState();
      unknown.owner = "meadow";
      unknown.verified = M.EMAILS[1];
      unknown.outcome = "unknown";
      const voucher = unknown.vouchers.find((v) => v.email === M.EMAILS[1]);
      M.showCode(unknown, voucher.id);
      const id = M.lock(unknown, voucher.id, voucher.code.value);
      const held = await fresh(390, unknown, "owner");
      await held.page
        .getByRole("button", { name: "Check original operation", exact: true })
        .waitFor();
      await held.page.reload();
      assert.ok(
        await held.page
          .getByRole("button", {
            name: "Check original operation",
            exact: true,
          })
          .isVisible(),
      );
      assert.equal(
        (await stateOf(held.page)).ops.find((o) => o.id === id).status,
        "unknown",
      );
      await held.context.close();
    },
  );
  await check(
    "Ledger friendly amounts/counts, pause status and expanded conservation are one model projection",
    async () => {
      const fixture = M.initialState();
      fixture.stores[0].paused = true;
      const { page, context } = await fresh(1440, fixture, "ledger");
      const summary = await page.locator(".ledger-summary").innerText();
      assert.match(summary, /Meals supported\s+8 meals/);
      assert.match(summary, /Available to claim\s+3 meals/);
      assert.match(summary, /Claimed · awaiting handoff\s+2 meals/);
      assert.match(summary, /Handed over · demo reported\s+3 meals/);
      assert.match(summary, /Awaiting payment\s+6(?:\.00)? test USDC/);
      assert.match(summary, /Received\s+3(?:\.00)? test USDC/);
      assert.ok(await page.getByText(/balances retained/).isVisible());
      await page.locator(".accounting-details summary").click();
      assert.match(
        await page.locator(".accounting-details").innerText(),
        /F = A \+ R \+ H \+ S \+ X · 24(?:\.00)? test USDC/,
      );
      const publicText = await page.locator("main").innerText();
      assert.ok(M.EMAILS.every((email) => !publicText.includes(email)));
      assert.ok(!publicText.includes("mealforward:demo:"));
      await page.screenshot({
        path: `${evidence}/ledger-details-1440.png`,
        fullPage: true,
      });
      await context.close();
    },
  );
  await check(
    "UI04 responsive catalog/detail/My meals/owner/ledger and loaded local imagery",
    async () => {
      const fixture = M.initialState();
      fixture.owner = "meadow";
      fixture.verified = M.EMAILS[1];
      fixture.wallet = "demo-supporter-1";
      const { page, context } = await fresh(1440, fixture);
      for (const width of [320, 390, 768, 1024, 1440, 1600]) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 1024 });
        for (const hash of [
          "meals",
          "kitchen/meadow",
          "my/vouchers",
          "my/orders",
          "owner",
          "ledger",
        ]) {
          await navigate(page, hash);
          await page.locator("h1").waitFor();
          await overflow(page);
          await page
            .locator("img")
            .evaluateAll((imgs) => Promise.all(imgs.map((i) => i.decode())));
          if ([390, 1440].includes(width))
            await page.screenshot({
              path: `${evidence}/${hash.replaceAll("/", "-")}-${width}.png`,
              fullPage: true,
            });
        }
      }
      await context.close();
    },
  );
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  results.push({
    name: "All UI04 observed requests local; zero console/page errors",
    status: "PASS",
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    `${evidence}/ui04-results.json`,
    JSON.stringify(
      {
        results,
        errors,
        external,
        requestCount: requests.length,
        observedRequests: [...new Set(requests)],
      },
      null,
      2,
    ),
  );
  await browser.close();
}
