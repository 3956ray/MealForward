import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import * as M from "../src/model.ts";

// A fresh, isolated browser profile; no existing user tabs, extensions or login data.
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
const evidenceDir = process.env.UI04_EVIDENCE_DIR || "evidence/ui04";
await mkdir(evidenceDir, { recursive: true });
async function fresh(
  width = 1440,
  height = 1024,
  state = M.initialState(),
  catalog = false,
) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  lastPage = page;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("request", (r) => {
    requests.push(r.url());
    if (
      !r.url().startsWith("http://127.0.0.1:15603/") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  await page.addInitScript(
    ({ key, state }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(state));
    },
    { key: M.STORAGE_KEY, state },
  );
  await page.goto("http://127.0.0.1:15603/");
  await page
    .getByRole("heading", { name: "Choose a kitchen", exact: true })
    .waitFor();
  if (!catalog)
    await page
      .getByRole("button", {
        name: `View kitchen · ${state.stores[0].name}`,
        exact: true,
      })
      .click();
  if (!catalog)
    await page
      .getByRole("button", { name: "Increase Lunch quantity", exact: true })
      .click();
  return { page, context };
}
const stateOf = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)), M.STORAGE_KEY);
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
    console.log("PASS", name);
  } catch (e) {
    if (lastPage && !lastPage.isClosed()) {
      await lastPage.screenshot({
        path: `${evidenceDir}/browser-failure.png`,
        fullPage: true,
      });
      await writeFile(
        `${evidenceDir}/browser-failure.txt`,
        await lastPage.locator("body").innerText(),
      );
    }
    results.push({ name, status: "FAIL", error: e.message });
    throw e;
  }
}
const nav = (page, to) => page.goto(`http://127.0.0.1:15603/#/${to}`);
async function controls(page) {
  const d = page.locator(".demo-controls");
  if ((await d.getAttribute("open")) === null)
    await d.locator("summary").click();
}
async function outcome(page, value) {
  await controls(page);
  await page.getByLabel("Next operation result").selectOption(value);
}
async function complete(page) {
  await page
    .getByRole("button", { name: "Check original operation", exact: true })
    .last()
    .click();
}
async function noOverflow(page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Horizontal viewport overflow",
  );
}
try {
  await check(
    "390 recipient reference fixture with no display code",
    async () => {
      const fixture = M.initialState();
      fixture.verified = M.EMAILS[1];
      const { page, context } = await fresh(390, 844, fixture);
      await nav(page, "voucher");
      await page
        .getByRole("heading", { name: "My voucher", exact: true })
        .waitFor();
      await page.screenshot({
        path: `${evidenceDir}/recipient-390.png`,
        fullPage: false,
      });
      assert.equal(
        await page
          .getByRole("button", { name: "Copy verification string" })
          .count(),
        0,
      );
      await context.close();
    },
  );
  await check(
    "1440 kitchen-first catalog, detail and explicit cart guard",
    async () => {
      const { page, context } = await fresh(1440, 1024, M.initialState(), true);
      assert.equal(await page.locator(".kitchen-card").count(), 3);
      await page
        .locator(".kitchen-card img")
        .evaluateAll((imgs) => Promise.all(imgs.map((i) => i.decode())));
      assert.equal(
        await page
          .locator(".kitchen-card img")
          .evaluateAll(
            (imgs) =>
              imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
          ),
        3,
      );
      const css = await page.locator("h1").evaluate((el) => ({
        size: getComputedStyle(el).fontSize,
        spacing: getComputedStyle(el).letterSpacing,
      }));
      assert.equal(css.size, "32px");
      assert.ok(["0px", "normal"].includes(css.spacing));
      await noOverflow(page);
      await page.screenshot({
        path: `${evidenceDir}/catalog-1440.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", {
          name: "View kitchen · Meadow Kitchen",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Increase Lunch quantity", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Back to kitchens", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "View kitchen · River Table",
          exact: true,
        })
        .click();
      assert.equal(
        await page.evaluate(() => document.activeElement.textContent.trim()),
        "Keep current cart",
      );
      await page
        .getByRole("button", { name: "Keep current cart", exact: true })
        .click();
      assert.ok(page.url().endsWith("#/meals"));
      await page
        .getByRole("button", {
          name: "View kitchen · River Table",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Replace cart", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "River Table", exact: true })
        .waitFor();
      assert.match(await page.locator(".cart-total").innerText(), /0 meals/);
      await page
        .getByRole("button", { name: "Meal ledger", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Public meal ledger", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "My meals", exact: true }).click();
      await page
        .getByRole("heading", { name: "My meals", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Support orders", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Support orders", exact: true })
        .waitFor();
      await nav(page, "claim");
      await page
        .getByRole("heading", { name: "Claim a meal", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Kitchens", exact: true }).click();
      await page
        .getByRole("heading", { name: "Choose a kitchen", exact: true })
        .waitFor();
      await context.close();
    },
  );
  for (const width of [1440, 390])
    await check(
      `${width} complete payment → order → claim → code → owner lock/report → settle → public ledger`,
      async () => {
        const { page, context } = await fresh(
          width,
          width === 390 ? 844 : 1024,
        );
        await page
          .getByRole("button", { name: "Review support", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Connect demo wallet", exact: true })
          .last()
          .click();
        await page
          .getByRole("button", { name: "Approve exact amount · Demo" })
          .click();
        assert.equal(M.totals(await stateOf(page), "meadow").supported, 8);
        await page
          .getByRole("button", { name: "Confirm payment · Demo" })
          .click();
        assert.equal(M.totals(await stateOf(page), "meadow").supported, 8);
        await complete(page);
        assert.equal(M.totals(await stateOf(page), "meadow").supported, 9);
        await page.getByRole("button", { name: "View my orders" }).click();
        await page
          .getByRole("button", { name: "Simulate receiver failure" })
          .click();
        assert.equal((await stateOf(page)).orders.at(-1).nft, "incompatible");
        assert.equal(M.totals(await stateOf(page), "meadow").F, 27 * M.SCALE);
        await nav(page, "claim");
        await page.getByLabel("Built-in email").selectOption(M.EMAILS[2]);
        await page
          .getByRole("button", { name: "Simulate email verification" })
          .click();
        await page
          .getByRole("button", { name: "Claim one Lunch · Demo" })
          .click();
        await complete(page);
        await page
          .getByRole("button", { name: "Open original voucher" })
          .click();
        await page
          .getByRole("button", { name: "Show verification code" })
          .click();
        const code = await page.locator(".code-string").innerText();
        assert.ok(code.startsWith("mealforward:demo:"));
        await page
          .getByRole("button", { name: "Copy verification string" })
          .click();
        assert.equal(
          await page.evaluate(() => navigator.clipboard.readText()),
          code,
        );
        await page.screenshot({
          path: `${evidenceDir}/voucher-code-${width}.png`,
          fullPage: true,
        });
        await nav(page, "owner");
        await page
          .getByRole("button", { name: "Confirm demo owner identity" })
          .click();
        await page
          .getByText("Check another demo voucher", { exact: true })
          .click();
        await page
          .getByLabel("Verification string", { exact: true })
          .fill(code);
        await page
          .getByRole("button", { name: "Check demo verification string" })
          .click();
        const before = M.totals(await stateOf(page), "meadow");
        await page
          .getByRole("button", { name: "Obtain processing right · Demo" })
          .click();
        await complete(page);
        assert.equal(M.totals(await stateOf(page), "meadow").H, before.H);
        await page
          .getByRole("button", { name: "Confirm handoff & report" })
          .click();
        await complete(page);
        assert.equal(
          M.totals(await stateOf(page), "meadow").H,
          before.H + 3 * M.SCALE,
        );
        assert.equal(M.totals(await stateOf(page), "meadow").S, before.S);
        await nav(page, "settlements");
        await page
          .getByRole("button", { name: "Settle selected item · Demo wallet" })
          .last()
          .click();
        await complete(page);
        assert.equal(
          M.totals(await stateOf(page), "meadow").S,
          before.S + 3 * M.SCALE,
        );
        await nav(page, "ledger");
        await noOverflow(page);
        assert.ok(!(await page.locator("main").innerText()).includes("@"));
        assert.ok(
          !(await page.locator("main").innerText()).includes(
            "mealforward:demo:",
          ),
        );
        await page.screenshot({
          path: `${evidenceDir}/ledger-after-flow-${width}.png`,
          fullPage: true,
        });
        await context.close();
      },
    );
  await check(
    "UNKNOWN payment survives refresh and resolves only original intent",
    async () => {
      const { page, context } = await fresh();
      await outcome(page, "unknown");
      await page
        .getByRole("button", { name: "Review support", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Connect demo wallet", exact: true })
        .last()
        .click();
      await page
        .getByRole("button", { name: "Approve exact amount · Demo" })
        .click();
      await page
        .getByRole("button", { name: "Confirm payment · Demo" })
        .click();
      const original = (await stateOf(page)).ops.at(-1).id;
      await page.reload();
      await nav(page, "orders");
      assert.ok((await page.locator("main").innerText()).includes(original));
      assert.equal(
        await page
          .getByRole("button", { name: "Confirm payment · Demo" })
          .count(),
        0,
      );
      await outcome(page, "final");
      await complete(page);
      const s = await stateOf(page);
      assert.equal(s.ops.filter((o) => o.id === original).length, 1);
      assert.equal(M.totals(s, "meadow").supported, 9);
      await context.close();
    },
  );
  await check(
    "72h global email gate, original recovery and 120s display expiry in UI",
    async () => {
      const { page, context } = await fresh(390, 844);
      await nav(page, "claim");
      await page
        .getByRole("button", { name: "Simulate email verification" })
        .click();
      await page
        .getByRole("button", { name: /Open my original voucher/ })
        .click();
      await page
        .getByRole("button", { name: "Show verification code" })
        .click();
      const expiry = (await stateOf(page)).vouchers[1].expires,
        old = await page.locator(".code-string").innerText();
      await page
        .getByRole("button", { name: "Recover my voucher", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Recover original demo voucher" })
        .click();
      assert.equal((await stateOf(page)).vouchers[1].expires, expiry);
      assert.equal(
        await page
          .getByRole("button", { name: "Copy verification string" })
          .count(),
        0,
      );
      await page
        .getByRole("button", { name: "Show verification code" })
        .click();
      assert.notEqual(await page.locator(".code-string").innerText(), old);
      await controls(page);
      await page.getByRole("button", { name: "+ 121 seconds" }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "Copy verification string" })
          .count(),
        0,
      );
      await nav(page, "claim");
      await page.getByLabel("Store", { exact: true }).selectOption("river");
      await page
        .getByRole("button", { name: "Claim one Lunch · Demo" })
        .click();
      assert.match(await page.getByRole("alert").innerText(), /72 hours/);
      await controls(page);
      await page.getByRole("button", { name: "+ 72 hours" }).click();
      await nav(page, "recovery");
      await page
        .getByRole("button", { name: "Recover original demo voucher" })
        .click();
      assert.match(await page.getByRole("alert").innerText(), /expired/);
      await context.close();
    },
  );
  await check(
    "owner B2 fixtures and exact R→H→S transitions, records return focus",
    async () => {
      const { page, context } = await fresh(1440, 1024);
      await nav(page, "owner");
      await page
        .getByRole("button", { name: "Confirm demo owner identity" })
        .click();
      await page.screenshot({
        path: `${evidenceDir}/owner-1440.png`,
        fullPage: false,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await page
        .getByRole("heading", { name: "Kitchen workspace", exact: true })
        .waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      await noOverflow(page);
      const handoffBox = await page
        .getByRole("button", { name: "Confirm handoff & report" })
        .boundingBox();
      assert.ok(
        handoffBox && handoffBox.y + handoffBox.height <= 844,
        "Mobile handoff action must fit first viewport",
      );
      await page.screenshot({
        path: `${evidenceDir}/owner-390.png`,
        fullPage: false,
      });
      await page
        .getByRole("button", { name: "Confirm handoff & report" })
        .click();
      await complete(page);
      let t = M.totals(await stateOf(page), "meadow");
      assert.deepEqual(
        [t.R, t.H, t.S],
        [3, 9, 3].map((x) => x * M.SCALE),
      );
      await nav(page, "settlements");
      await page
        .getByRole("button", { name: "Settle selected item · Demo wallet" })
        .filter({ visible: true })
        .last()
        .click();
      await complete(page);
      t = M.totals(await stateOf(page), "meadow");
      assert.deepEqual(
        [t.H, t.S],
        [6, 6].map((x) => x * M.SCALE),
      );
      await nav(page, "records");
      await page.locator(".record-row").first().click();
      await page.getByRole("button", { name: "Back to records" }).click();
      await page.waitForFunction(() =>
        document.activeElement.id.startsWith("record-"),
      );
      await context.close();
    },
  );
  await check(
    "menu version edit/unlist and independent incident pause retain old price",
    async () => {
      const { page, context } = await fresh();
      await nav(page, "owner");
      await page
        .getByRole("button", { name: "Confirm demo owner identity" })
        .click();
      await nav(page, "menu");
      const editor = page.locator(".menu-editor").first();
      await editor.getByLabel("Future price · test USDC").fill("8");
      await editor.getByRole("button", { name: "Save draft" }).click();
      await page.reload();
      assert.equal(
        await page
          .locator(".menu-editor")
          .first()
          .getByLabel("Future price · test USDC")
          .inputValue(),
        "8",
      );
      assert.equal((await stateOf(page)).stores[0].menus[0].price, 3 * M.SCALE);
      await page
        .locator(".menu-editor")
        .first()
        .getByRole("button", { name: "Publish new version" })
        .click();
      let s = await stateOf(page);
      assert.equal(s.stores[0].menus[0].price, 8 * M.SCALE);
      assert.equal(s.units[2].terms.price, 3 * M.SCALE);
      await page
        .locator(".menu-editor")
        .first()
        .getByRole("button", { name: "Unlist meal" })
        .click();
      await nav(page, "settings");
      await page
        .getByRole("button", { name: "Pause store for an incident" })
        .click();
      s = await stateOf(page);
      assert.equal(s.stores[0].paused, true);
      assert.equal(M.totals(s, "meadow").R, 6 * M.SCALE);
      await context.close();
    },
  );
  await check(
    "rejected/insufficient/wrong-network/stale scenarios and original safe refund",
    async () => {
      const { page, context } = await fresh();
      await outcome(page, "rejected");
      await page
        .getByRole("button", { name: "Review support", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Connect demo wallet", exact: true })
        .last()
        .click();
      await page
        .getByRole("button", { name: "Approve exact amount · Demo" })
        .click();
      assert.equal(M.totals(await stateOf(page), "meadow").supported, 8);
      await outcome(page, "final");
      await page.getByLabel("Demo network is Monad Testnet").uncheck();
      await page
        .getByRole("button", { name: "Approve exact amount · Demo" })
        .click();
      assert.match(await page.getByRole("alert").innerText(), /network/);
      await page.getByLabel("Demo network is Monad Testnet").check();
      await page
        .getByRole("button", { name: "Approve exact amount · Demo" })
        .click();
      await page.getByLabel("Test USDC scenario").selectOption("empty");
      await page
        .getByRole("button", { name: "Confirm payment · Demo" })
        .click();
      assert.match(await page.getByRole("alert").innerText(), /Not enough/);
      await page.getByLabel("Test USDC scenario").selectOption("funded");
      await page
        .getByRole("button", { name: "Confirm payment · Demo" })
        .click();
      await complete(page);
      await nav(page, "orders");
      await page
        .getByRole("button", {
          name: "Refund 1 safe free meal · Demo",
          exact: true,
        })
        .click();
      await complete(page);
      assert.equal(M.totals(await stateOf(page), "meadow").supported, 9);
      assert.equal(M.totals(await stateOf(page), "meadow").X, 3 * M.SCALE);
      await controls(page);
      await page.getByLabel("Data source").selectOption("stale");
      assert.ok(
        await page
          .getByRole("button", { name: "Refresh demo source" })
          .isVisible(),
      );
      await page.getByRole("button", { name: "Refresh demo source" }).click();
      await context.close();
    },
  );
  await check(
    "schema incompatibility is blocked without silently replacing saved UNKNOWN data",
    async () => {
      const s = M.initialState();
      s.schema = 99;
      const context = await browser.newContext({
          viewport: { width: 390, height: 844 },
        }),
        page = await context.newPage();
      await page.addInitScript(
        ({ key, s }) => localStorage.setItem(key, JSON.stringify(s)),
        { key: M.STORAGE_KEY, s },
      );
      await page.goto("http://127.0.0.1:15603/");
      await page
        .getByRole("heading", { name: "Demo storage needs attention" })
        .waitFor();
      assert.equal((await stateOf(page)).schema, 99);
      await context.close();
    },
  );
  await check(
    "responsive 320/390/768/1024/1440/1600, 200% text, focus and reduced motion",
    async () => {
      const { page, context } = await fresh();
      for (const width of [320, 390, 768, 1024, 1440, 1600]) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 1024 });
        await nav(page, "meals");
        await noOverflow(page);
        await page.screenshot({
          path: `${evidenceDir}/meals-${width}.png`,
          fullPage: true,
        });
      }
      await nav(page, "kitchen/meadow");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await page
          .getByRole("button", { name: "Review support", exact: true })
          .evaluate((el) => getComputedStyle(el).transitionDuration),
        "0s",
      );
      await page
        .getByRole("heading", { name: "Meadow Kitchen", exact: true })
        .focus();
      await page.keyboard.press("Tab");
      assert.ok(
        await page.evaluate(() => document.activeElement.tagName === "BUTTON"),
      );
      const outline = await page.evaluate(
        () => getComputedStyle(document.activeElement).outlineStyle,
      );
      assert.notEqual(outline, "none");
      await page.addStyleTag({
        content:
          "body{font-size:32px} h1{font-size:48px;line-height:60px} h2{font-size:42px;line-height:56px} button,input,select,textarea,p,small,.secondary,label{font-size:28px!important;line-height:40px!important}",
      });
      await noOverflow(page);
      await page.screenshot({
        path: `${evidenceDir}/text-200-percent-390.png`,
        fullPage: true,
      });
      await context.close();
    },
  );
  await check(
    "UNKNOWN report and settlement retain original responsibility across reload",
    async () => {
      const { page, context } = await fresh(390, 844);
      await nav(page, "owner");
      await page
        .getByRole("button", { name: "Confirm demo owner identity" })
        .click();
      await outcome(page, "unknown");
      await page
        .getByRole("button", { name: "Confirm handoff & report" })
        .click();
      const report = (await stateOf(page)).ops.at(-1).id;
      await page.reload();
      await page
        .getByRole("button", { name: "Check original operation", exact: true })
        .waitFor();
      assert.deepEqual(
        [
          M.totals(await stateOf(page), "meadow").R,
          M.totals(await stateOf(page), "meadow").H,
        ],
        [6, 6].map((x) => x * M.SCALE),
      );
      await outcome(page, "final");
      await complete(page);
      assert.equal(
        (await stateOf(page)).ops.filter((o) => o.id === report).length,
        1,
      );
      await nav(page, "settlements");
      await outcome(page, "unknown");
      await page
        .getByRole("button", { name: "Settle selected item · Demo wallet" })
        .last()
        .click();
      const settle = (await stateOf(page)).ops.at(-1).id;
      await page.reload();
      await page
        .getByRole("button", { name: "Check original operation", exact: true })
        .waitFor();
      assert.equal(M.totals(await stateOf(page), "meadow").S, 3 * M.SCALE);
      await outcome(page, "final");
      await complete(page);
      assert.equal(
        (await stateOf(page)).ops.filter((o) => o.id === settle).length,
        1,
      );
      assert.equal(M.totals(await stateOf(page), "meadow").S, 6 * M.SCALE);
      await context.close();
    },
  );
  await check(
    "long content and high prices reflow, skip link preserves route",
    async () => {
      const fixture = M.initialState();
      fixture.stores[0].name =
        "Meadow Kitchen Community Counter With A Longer Store Name";
      fixture.stores[0].menus[0].name =
        "Mushroom chicken rice with seasonal vegetables and a very long descriptive meal name";
      fixture.stores[0].menus[0].price = 1000 * M.SCALE;
      const { page, context } = await fresh(320, 844, fixture);
      await noOverflow(page);
      await page.screenshot({
        path: `${evidenceDir}/long-content-320.png`,
        fullPage: true,
      });
      await page.locator(".skip").focus();
      await page.keyboard.press("Enter");
      assert.equal(
        await page.locator("h1").innerText(),
        fixture.stores[0].name,
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.tagName),
        "H1",
      );
      await context.close();
    },
  );
  await check(
    "accessible reset cancel/escape preserve UNKNOWN; confirmed reset changes only its namespace",
    async () => {
      const fixture = M.initialState();
      fixture.wallet = "demo-supporter-1";
      fixture.outcome = "unknown";
      const id = M.reviewFund(
        fixture,
        "meadow",
        { Lunch: 1, Dinner: 0 },
        false,
      );
      M.approve(fixture, id);
      M.submit(fixture, id);
      const { page, context } = await fresh(390, 844, fixture);
      await page.evaluate(() =>
        localStorage.setItem(
          "mealforward:cp29-ui03:test-sentinel",
          "preserved",
        ),
      );
      await controls(page);
      await page
        .getByRole("button", { name: "Reset this demo only", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Reset this demo?", exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(() => document.activeElement.textContent),
        "Keep demo data",
      );
      await page
        .getByRole("button", { name: "Keep demo data", exact: true })
        .click();
      assert.equal((await stateOf(page)).ops.at(-1).id, id);
      await page
        .getByRole("button", { name: "Reset this demo only", exact: true })
        .click();
      await page.keyboard.press("Escape");
      assert.equal((await stateOf(page)).ops.at(-1).status, "unknown");
      await page
        .getByRole("button", { name: "Reset this demo only", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirm demo-only reset", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Choose a kitchen", exact: true })
        .waitFor();
      assert.equal(M.totals(await stateOf(page), "meadow").supported, 8);
      assert.ok(!(await stateOf(page)).ops.some((o) => o.id === id));
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("mealforward:cp29-ui03:test-sentinel"),
        ),
        "preserved",
      );
      await context.close();
    },
  );
  await check(
    "pre-existing payment review cannot submit around UNKNOWN; corrupted restore stays blocked",
    async () => {
      const fixture = M.initialState();
      fixture.wallet = "demo-supporter-1";
      const first = M.reviewFund(
        fixture,
        "meadow",
        { Lunch: 1, Dinner: 0 },
        false,
      );
      const second = M.reviewFund(
        fixture,
        "river",
        { Lunch: 1, Dinner: 0 },
        false,
      );
      M.approve(fixture, first);
      fixture.outcome = "unknown";
      M.submit(fixture, first);
      fixture.outcome = "final";
      M.approve(fixture, second);
      const { page, context } = await fresh(390, 844, fixture);
      await nav(page, "payment");
      await page
        .getByRole("button", { name: "Confirm payment · Demo", exact: true })
        .click();
      assert.match(
        await page.getByRole("alert").innerText(),
        /original payment/,
      );
      assert.equal(
        (await stateOf(page)).ops.filter(
          (o) => o.kind === "fund" && M.isOpen(o),
        ).length,
        1,
      );
      await context.close();
      for (const defect of ["status", "cooldown", "reference"]) {
        const bad = M.initialState();
        if (defect === "status") bad.ops[0].status = "UNKNOWN";
        if (defect === "cooldown") delete bad.cooldowns[M.EMAILS[1]];
        if (defect === "reference")
          bad.ops[0].unitIds = ["missing-original-unit"];
        const damaged = await browser.newContext({
            viewport: { width: 390, height: 844 },
          }),
          p = await damaged.newPage();
        await p.addInitScript(
          ({ key, bad }) => {
            if (!localStorage.getItem(key))
              localStorage.setItem(key, JSON.stringify(bad));
          },
          { key: M.STORAGE_KEY, bad },
        );
        await p.goto("http://127.0.0.1:15603/");
        await p
          .getByRole("heading", {
            name: "Demo storage needs attention",
            exact: true,
          })
          .waitFor();
        const stored = await stateOf(p);
        await p.reload();
        assert.deepEqual(await stateOf(p), stored);
        assert.equal(
          await p
            .getByRole("button", {
              name: "Confirm payment · Demo",
              exact: true,
            })
            .count(),
          0,
        );
        await damaged.close();
      }
    },
  );
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  results.push({
    name: "All observed browser requests local; no console/page errors",
    status: "PASS",
    requests: requests.length,
  });
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await writeFile(
    `${evidenceDir}/browser-results.json`,
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
