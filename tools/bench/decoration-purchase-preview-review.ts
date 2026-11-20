import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const output = resolve("../resources/project-reviews/decoration-purchase-preview-2026-11-05");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const errors: string[] = [], rows: unknown[] = [];
let passed = false;
try {
  for (const width of [1200, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/src/app/main.ts", route => route.fulfill({ contentType: "text/javascript", body: "" }));
    await page.goto(url);
    await page.evaluate(async () => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      await imp("/src/app/styles.css");
      await imp("/src/app/settlement-ui/styles.css");
      await imp("/src/app/settlement-ui/player-hud.css");
      document.body.replaceChildren();
      const { createGemShopWindow } = await imp("/src/app/settlement-ui/gem-shop/gem-shop-window.ts");
      const { createSettlementUiStore } = await imp("/src/app/settlement-ui/ui-store.ts");
      const { createPlayerProgress } = await imp("/src/shared/progression/player-progress.ts");
      const player = { ...createPlayerProgress(7), gems: 50 };
      const store = createSettlementUiStore({ player });
      const calls: string[] = [];
      const shop = createGemShopWindow(store, { onBuyGemOffer: (id: string) => { calls.push(id); return true; } });
      shop.root.classList.add("settlement-ui");
      document.body.append(shop.root); shop.open();
      (window as any).__previewTest = { calls, player, shop, store };
    });
    await page.getByRole("tab", { name: "Decorations", exact: true }).click();
    const select = page.locator('[data-offer-id="road-decoration-roman-rusticated-arch-limestone"] button');
    await select.click();
    const preview = page.locator(".gem-shop-preview-window");
    await preview.waitFor({ state: "visible" });
    await preview.locator("img").evaluate(async (image: HTMLImageElement) => image.decode());
    assert.equal(await page.evaluate(() => (window as any).__previewTest.calls.length), 0);
    const image = await preview.locator(".gem-shop-preview__image").boundingBox();
    assert(image && image.width >= 250 && image.height >= 250);
    const bounds = await preview.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    await page.screenshot({ path: resolve(output, `${width}-preview.png`) });
    await preview.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.evaluate(() => (window as any).__previewTest.calls.length), 0);
    await select.click();
    await preview.getByRole("button", { name: "Buy", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => (window as any).__previewTest.calls),
      ["road-decoration-roman-rusticated-arch-limestone"]);
    await select.click();
    await page.evaluate(() => {
      const { player, store } = (window as any).__previewTest;
      store.update({ player: { ...player, gems: 0 } });
    });
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>(".gem-shop-preview__actions button")?.disabled);
    assert.equal(await preview.getByRole("button", { name: "Buy", exact: true }).isDisabled(), true);
    await page.evaluate(() => (window as any).__previewTest.shop.close());
    assert.equal(await preview.isVisible(), false);
    await page.evaluate(() => (window as any).__previewTest.shop.dispose());
    assert.equal(await page.locator(".gem-shop-preview-window").count(), 0);
    rows.push({ width, selectionNoPurchase: true, cancelNoPurchase: true, buyExactlyOnce: true,
      liveAffordability: true, actualModelImage: true, boundedPanel: true, closeAndDispose: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
  passed = true;
} finally {
  await browser.close();
  await server.close();
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ passed, rows, errors,
    scope: "Real gem shop and shared preview frames on desktop/mobile; purchase callback boundary only, no online charge or full E2E." }, null, 2));
}
