import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { appendLedger } from "../../../island-of-settlers-api/src/economy/ledger";
import { lockWallets, transaction } from "../../../island-of-settlers-api/src/economy/repository";
import { ROAD_DECORATION_ITEM_DEFINITIONS } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { PLANT_COMPLETION_ITEM_IDS, plantCompletionModelFamily } from "../../../island-of-settlers-shared/src/road-plant-completion";
import { createIdentityClient } from "../../src/app/account/identity-client";
import { createEconomyClient } from "../../src/app/cloud/economy-client";
import { launchBrowser, startDevServer } from "./browser";

const run = process.argv[2] ?? "account-a";
assert(/^[a-z0-9-]+$/.test(run));
const output = resolve("../resources/project-reviews/verification-completion-2026-11-05/decorations", run);
assert(!existsSync(resolve(output, "report.json")), "Preserve existing completed evidence");
mkdirSync(output, { recursive: true });
const representatives = [...new Map(PLANT_COMPLETION_ITEM_IDS.map(id =>
  [plantCompletionModelFamily(ROAD_DECORATION_ITEM_DEFINITIONS[id]!.plant!), id])).values()];
assert.equal(representatives.length, 8);
const { startAcceptanceStack } = await import(String("../../../island-of-settlers-local-dev/src/acceptance-stack.ts"));
const stack = await startAcceptanceStack("http://127.0.0.1:5296");
let dev: Awaited<ReturnType<typeof startDevServer>> | undefined;
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
const errors: string[] = [], rows: unknown[] = [];
let passed = false;
try {
  const identity = createIdentityClient({ identityUrl: stack.identityUrl, lock: run => run() });
  const suffix = randomBytes(5).toString("hex");
  const credentials = { displayName: `Decor${suffix}`, email: `decor-${suffix}@example.test`,
    nation: "roman" as const, password: randomBytes(24).toString("base64url") };
  const bootstrap = await identity.register({ ...credentials, displayName: `Bootstrap${suffix}`,
    email: `bootstrap-${suffix}@example.test` });
  assert(bootstrap.ok && bootstrap.account.role === "admin");
  const registered = await identity.register(credentials);
  assert(registered.ok && registered.account.role === "player", "Use ordinary authenticated account");
  const account = registered.account.id;
  await transaction(stack.pool, async db => {
    await lockWallets(db, [account]);
    await appendLedger(db, { account, gems: 10000, kind: "admin-grant", ref: randomUUID(), requestId: "private-fixture" });
  });
  const economy = createEconomyClient({ apiUrl: stack.apiUrl,
    getAccessToken: identity.accessToken, renewAccessToken: identity.renew });
  dev = await startDevServer({ host: "127.0.0.1", port: 5296, unlockAll: false });
  browser = await launchBrowser();
  let expectedGems = 10000;
  for (const width of [1200, 390]) {
    const page = await browser.newPage({ viewport: { height: 850, width } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/src/app/main.ts", route => route.fulfill({ body: "", contentType: "text/javascript" }));
    await page.goto(dev.url);
    const wallet = await economy.wallet();
    await page.evaluate(async ({ apiUrl, token, wallet }) => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      await imp("/src/app/styles.css");
      await imp("/src/app/settlement-ui/styles.css");
      await imp("/src/app/settlement-ui/player-hud.css");
      const { createEconomyClient } = await imp("/src/app/cloud/economy-client.ts");
      const { createGemShopWindow } = await imp("/src/app/settlement-ui/gem-shop/gem-shop-window.ts");
      const { createSettlementUiStore } = await imp("/src/app/settlement-ui/ui-store.ts");
      const { createPlayerProgress } = await imp("/src/shared/progression/player-progress.ts");
      document.body.replaceChildren();
      const player = { ...createPlayerProgress(7), gems: wallet.gems, inventory: wallet.items ?? {} };
      const store = createSettlementUiStore({ player });
      const economy = createEconomyClient({ apiUrl, getAccessToken: () => token });
      const purchases: any[] = [];
      const shop = createGemShopWindow(store, { onBuyGemOffer: async (offerId: string) => {
        const key = crypto.randomUUID(), receipt = await economy.buyGemOffer(offerId, key);
        if (!receipt.ok) return receipt.reason;
        const current = store.getSnapshot().player;
        store.update({ player: { ...current, gems: receipt.wallet.gems, inventory: receipt.wallet.items ?? {} } });
        purchases.push({ key, offerId, receipt });
        return true;
      } });
      shop.root.classList.add("settlement-ui"); document.body.append(shop.root); shop.open();
      (window as any).__decorAccount = { purchases, shop, store };
    }, { apiUrl: stack.apiUrl, token: await identity.accessToken(), wallet });
    await page.getByRole("tab", { exact: true, name: "Decorations" }).click();
    for (const [index, id] of representatives.entries()) {
      const item = ROAD_DECORATION_ITEM_DEFINITIONS[id]!;
      await page.getByRole("tab", { exact: true, name: item.category === "trees" ? "Trees" : "Plants" }).click();
      const select = page.locator(`[data-offer-id="${item.offerId}"] button`);
      await select.click();
      const preview = page.locator(".gem-shop-preview-window");
      await preview.waitFor({ state: "visible" });
      await preview.locator("img").evaluate(async (image: HTMLImageElement) => image.decode());
      assert.equal(await page.evaluate(() => (window as any).__decorAccount.purchases.length), index);
      await preview.getByRole("button", { exact: true, name: "Cancel" }).click();
      assert.equal(await page.evaluate(() => (window as any).__decorAccount.purchases.length), index);
      await select.click();
      if (index === 0) await page.screenshot({ path: resolve(output, `${width}-preview.png`) });
      // Two synchronous activations still consume one preview selection and produce one paid request.
      await preview.getByRole("button", { exact: true, name: "Buy" }).evaluate((button: HTMLButtonElement) => {
        button.click(); button.click();
      });
      await page.waitForFunction(count => (window as any).__decorAccount.purchases.length === count, index + 1);
      const receipt = await page.evaluate(index => (window as any).__decorAccount.purchases[index], index);
      assert.equal(receipt.receipt.wallet.items[id], width === 1200 ? 1 : 2);
      expectedGems -= item.price;
      assert.equal(receipt.receipt.wallet.gems, expectedGems);
      const repeated = await economy.buyGemOffer(item.offerId, receipt.key);
      assert(repeated.ok);
      assert.deepEqual(repeated.wallet, receipt.receipt.wallet, "Identical request is paid and granted once");
      rows.push({ width, item: id, category: item.category, cancelNoPurchase: true,
        doubleClickOnePurchase: true, serverInventory: receipt.receipt.wallet.items[id],
        gems: expectedGems, idempotentRetry: true });
    }
    await page.evaluate(() => (window as any).__decorAccount.shop.dispose());
    assert.equal(await page.locator(".gem-shop-preview-window").count(), 0);
    await page.close();
  }
  const ledger = await stack.pool.query(
    "SELECT gems FROM economy.ledger WHERE account_id=$1 AND kind='gem-shop' ORDER BY created_at", [account]);
  assert.equal(ledger.rows.length, 16);
  assert.equal((await economy.wallet()).gems, expectedGems);
  assert.deepEqual(errors, []);
  passed = true;
} finally {
  try { await browser?.close(); }
  finally { try { await dev?.server.close(); } finally { await stack.close(); } }
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ passed, rows, errors,
    scope: "Actual responsive gem-shop/preview UI, ordinary authenticated account, real HTTP and disposable PostgreSQL. " +
      "Eight new botanical families, desktop/mobile, cancel, double-click and idempotent retry. " +
      "The shop fixture is not a full authenticated world placement/save-verification journey. " +
      "Normal developer database and production were not used." }, null, 2));
}
