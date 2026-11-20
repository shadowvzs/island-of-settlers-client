import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const pouchOnly = process.argv.includes("--pouch-only");
const reviewFolder = pouchOnly ? "inventory-pouch-icon-2026-11-05" : "inventory-quickbar-context-2026-11-05";
const output = resolve(`../resources/project-reviews/${reviewFolder}`);
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const errors: string[] = [], rows: unknown[] = [];
let passed = false;
try {
  for (const width of (pouchOnly ? [390, 320] : [1200, 390, 320])) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/src/app/main.ts", route => route.fulfill({ contentType: "text/javascript", body: "" }));
    await page.goto(url);
    await page.evaluate(async () => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      await imp("/src/app/styles.css");
      const { createSettlementUi } = await imp("/src/app/settlement-ui/index.ts");
      const { createPlayerInventoryControls } = await imp("/src/app/player-inventory/inventory-controls.ts");
      const { inventoryMapKind } = await imp("/src/app/player-inventory/map-context.ts");
      const { bindPlayerInventorySession } = await imp("/src/app/player-inventory/store.ts");
      const { createMainSelectionShortcuts } = await imp("/src/app/settings/window-shortcut.ts");
      document.body.replaceChildren();
      const viewport = document.createElement("div"); viewport.id = "viewport";
      viewport.style.cssText = "position:fixed;inset:0"; document.body.append(viewport);
      const metadata: { scenarioKind: "home" | "colony" | "adventure" } = { scenarioKind: "home" };
      const original = { chooseNation: 1, commanderRecovery: 1,
        "roadDecoration:roman-rusticated-arch:limestone": 2 };
      const stopInventory = bindPlayerInventorySession({ progress: () => ({ inventory: original }),
        subscribeInventory: () => () => undefined });
      const shortcuts = createMainSelectionShortcuts(viewport, "roman", undefined, async () => undefined);
      const inventory = createPlayerInventoryControls({ container: viewport,
        mapKind: () => inventoryMapKind(metadata), setNation: async () => undefined,
        recovery: { use: async () => true, status: () => null } });
      const ui = createSettlementUi({ mount: viewport, menuShortcuts: shortcuts,
        onOpenInventory: inventory.open, onMinimap: () => undefined, onSelectBuilding: () => undefined,
        onRotate: () => undefined, onRoadMode: () => undefined, onSettings: () => undefined });
      ui.onIslandShown();
      (window as any).__inventoryReview = { inventory, metadata, original, shortcuts, stopInventory, ui };
    });
    const quick = page.locator(".settlement-ui__bar [data-launcher-id]");
    await quick.first().waitFor();
    assert.deepEqual(await quick.evaluateAll(elements => elements.map(e => e.getAttribute("data-launcher-id"))),
      ["build", "inventory", "map", "menu", "news"]);
    const quickBounds = await page.locator(".settlement-ui__bar").boundingBox();
    assert(quickBounds && quickBounds.x >= 0 && quickBounds.x + quickBounds.width <= width + 1);
    if (pouchOnly) {
      const source = await page.locator('[data-launcher-id="inventory"] svg image').getAttribute("href");
      assert(source?.includes("inventory.webp"));
      await page.evaluate(async src => { const image = new Image(); image.src = src!; await image.decode(); }, source);
      await page.locator(".settlement-ui__bar").screenshot({ path: resolve(output, `${width}-quickbar.png`) });
      const iconBounds = await page.locator('[data-launcher-id="inventory"] svg').boundingBox();
      assert(iconBounds && iconBounds.width >= 32 && iconBounds.width <= 48);
      await page.evaluate(() => {
        const state = (window as any).__inventoryReview;
        state.ui.dispose(); state.inventory.dispose(); state.stopInventory();
        for (const shortcut of state.shortcuts) shortcut.dispose?.();
      });
      rows.push({ width, source, iconWidth: iconBounds.width, fiveQuickActionsInOrder: true, disposed: true });
      await page.close();
      continue;
    }
    await page.locator('[data-launcher-id="menu"]').click();
    await page.getByRole("button", { name: "Customization", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Inventory", exact: true }).count(), 1);
    const inventoryButton = page.locator('[data-launcher-id="inventory"]');
    await inventoryButton.click();
    const inventory = page.locator(".player-inventory-window");
    await inventory.getByRole("tab", { name: "Battle", exact: true }).waitFor();
    assert.equal(await inventory.getByRole("tab").count(), 3);
    assert.equal(await inventory.locator('[data-item-id="commanderRecovery"]').count(), 1);
    await inventory.getByRole("tab", { name: "Decoration", exact: true }).click();
    assert.equal(await inventory.locator('[data-item-id^="roadDecoration:"]').count(), 1);
    await inventory.getByRole("tab", { name: "Decoration", exact: true }).press("ArrowRight");
    assert.equal(await inventory.getByRole("tab", { name: "Misc", exact: true }).getAttribute("aria-selected"), "true");
    assert.equal(await inventory.locator('[data-item-id="chooseNation"]').count(), 1);
    await inventory.locator("img").evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
    await page.screenshot({ path: resolve(output, `${width}-home-misc.png`) });
    // A context change before the view refreshes cannot run a stale home-only item action.
    await page.evaluate(() => { (window as any).__inventoryReview.metadata.scenarioKind = "adventure"; });
    await inventory.locator('[data-item-id="chooseNation"]').click();
    assert.equal(await page.locator(".nation-chooser-window:not([hidden])").count(), 0);
    for (const kind of ["adventure", "colony"] as const) {
      await page.evaluate(kind => {
        const state = (window as any).__inventoryReview;
        state.metadata.scenarioKind = kind;
        state.ui.update({ buildingMenuBlocked: true });
      }, kind);
      await inventoryButton.click();
      const battle = inventory.getByRole("tab", { name: "Battle", exact: true });
      await page.waitForFunction(() => document.querySelector('#player-inventory-tab-battle')?.getAttribute("aria-selected") === "true");
      for (const name of ["Decoration", "Misc"]) {
        const tab = inventory.getByRole("tab", { name, exact: true });
        assert.equal(await tab.isVisible(), true); assert.equal(await tab.isDisabled(), true);
        assert.equal(await tab.getAttribute("aria-disabled"), "true");
        assert.equal(await tab.getAttribute("tabindex"), "-1");
      }
      await battle.focus(); await battle.press("End"); await battle.press("ArrowRight");
      assert.equal(await battle.evaluate(e => document.activeElement === e), true);
      assert.equal(await inventory.locator('[data-item-id="commanderRecovery"]').count(), 1);
      assert.equal(await inventory.locator('[data-item-id="chooseNation"], [data-item-id^="roadDecoration:"]').count(), 0);
      await inventory.locator("img").evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
      await page.screenshot({ path: resolve(output, `${width}-${kind}-battle.png`) });
    }
    // Close/Escape returns focus to the direct quick button, not a removed menu shortcut.
    await inventory.locator(".settlement-ui__drag-handle").press("Escape");
    assert.equal(await inventory.isVisible(), false);
    assert.equal(await inventoryButton.evaluate(e => document.activeElement === e), true);
    await page.evaluate(() => {
      const state = (window as any).__inventoryReview;
      state.metadata.scenarioKind = "home"; state.ui.update({ buildingMenuBlocked: false });
    });
    await inventoryButton.click();
    assert.equal(await inventory.getByRole("tab", { name: "Misc", exact: true }).isDisabled(), false);
    await inventory.getByRole("tab", { name: "Misc", exact: true }).click();
    await inventory.locator(".settlement-ui__drag-handle").press("Escape");
    await inventoryButton.click();
    assert.equal(await inventory.getByRole("tab", { name: "Misc", exact: true }).getAttribute("aria-selected"), "true");
    await inventory.locator(".settlement-ui__drag-handle").press("Escape");
    const held = await page.evaluate(() => (window as any).__inventoryReview.original);
    assert.deepEqual(held, { chooseNation: 1, commanderRecovery: 1,
      "roadDecoration:roman-rusticated-arch:limestone": 2 });
    await page.evaluate(() => {
      const state = (window as any).__inventoryReview;
      state.ui.dispose(); state.inventory.dispose(); state.stopInventory();
      for (const shortcut of state.shortcuts) shortcut.dispose?.();
    });
    assert.equal(await page.locator(".player-inventory-window").count(), 0);
    rows.push({ width, fiveQuickActionsInOrder: true, noInventoryMenuShortcut: true,
      homeTabs: true, disabledAbroadTabs: true, automaticBattle: true, keyboardRoving: true,
      staleActionGuard: true, closeFocus: true, homeDraftPreserved: true, unchangedCustody: true,
      disposed: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
  passed = true;
} finally {
  await browser.close(); await server.close();
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ passed, rows, errors,
    pouchOnly, scope: "Real settlement HUD, main menu, inventory controls/shared frames; authoritative-kind UI fixture, no generated world/online purchase/full E2E." }, null, 2));
}
