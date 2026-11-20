import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { GEM_SHOP_OFFER_LIST } from "../../src/shared/progression/gem-shop";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";
import { resumeSavedGame, saveFromMenu } from "./save-helpers";

const output = resourcesPath("project-reviews", "acceptance-2026-10-28", "storage-native");
await mkdir(output, { recursive: true });
const source = JSON.parse(await readFile(resolve(output, "initial.json"), "utf8"));
const materialIds = GEM_SHOP_OFFER_LIST.filter(offer => offer.resourceTier !== undefined).map(offer => offer.id);
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript(epoch => {
      const root = window as any;
      root.__name = (value: unknown) => value;
      Date.now = () => epoch;
      Object.defineProperty(window, "__settlement", { configurable: true,
        get: () => root.__storageSettlement,
        set: value => {
          root.__storageSettlement = value;
          root.__storageTick = value.simulation.update;
          value.simulation.update = () => {};
        }
      });
    }, source.savedAt);
    await page.route("**/storage-start.html", route => route.fulfill({
      contentType: "text/html", body: "<body></body>"
    }));
    await page.goto(`${url}storage-start.html`);
    await page.evaluate(async value => {
      const { openLocalSaveStore } = await import(
        /* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
      await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(value));
    }, source);
    await page.goto(`${url}?quality=${quality}&cache=0&reveal=1&time=day`);
    const ready = async () => {
      await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: 180_000 });
      await page.locator("#loading-screen").waitFor({ state: "detached" });
    };
    await ready();
    const initialTraffic = await page.evaluate(() => {
      const sim = (window as any).__settlement.simulation;
      return { loadedLand: sim.frames().filter((actor: any) => actor.ware).length,
        sailing: sim.ships().filter((ship: any) => ship.phase === "sailing").length };
    });
    assert(initialTraffic.loadedLand > 0 && initialTraffic.sailing > 0);
    await page.getByRole("button", { name: "Gems: open the gem shop", exact: true }).click();
    const shop = page.getByRole("dialog", { name: "Gem shop", exact: true });
    await shop.waitFor({ state: "visible" });
    await shop.getByRole("tab", { name: "Resources", exact: true }).click();
    await shop.locator('[data-offer-id="logs-100"]').waitFor();
    const ids = await shop.locator("[data-offer-id]").evaluateAll(rows =>
      rows.map(row => row.getAttribute("data-offer-id")));
    assert(materialIds.every(id => ids.includes(id)), "All construction material tiers remain visible at level 1");
    const buy = shop.locator('[data-offer-id="logs-100"] button');
    const snapshot = async () => {
      await saveFromMenu(page);
      return page.evaluate(async () => {
        const { openLocalSaveStore } = await import(
          /* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
        const save = await (await openLocalSaveStore()).readSavedGame();
        return { gems: save.player.gems, experience: save.player.experience,
          logs: (window as any).__settlement.simulation.headquarters.inventory.logs };
      });
    };
    const before = await snapshot();
    await buy.click();
    await shop.getByRole("status").filter({ hasText: /capacity/i }).waitFor();
    assert.deepEqual(await snapshot(), before, "A full-storage UI refusal spends neither goods nor gems");
    const upgradeTicks = await page.evaluate(() => {
      const root = window as any, sim = root.__settlement.simulation;
      for (let tick = 0; tick < 16000; tick++) {
        root.__storageTick(.05);
        if (sim.headquarters.workshopUpgrade?.level === 1) return tick + 1;
      }
      throw new Error("Paid capacity upgrade did not finish");
    });
    const expanded = await snapshot();
    for (let purchase = 0; purchase < 3; purchase++) {
      await buy.click();
      await page.waitForFunction(expected =>
        (window as any).__settlement.simulation.headquarters.inventory.logs === expected,
      before.logs + (purchase + 1) * 100);
    }
    const purchased = await snapshot();
    assert.equal(purchased.gems, before.gems - 30);
    assert.equal(purchased.logs, before.logs + 300);
    assert.equal(purchased.experience, expanded.experience, "Gem purchases award no levelling experience");
    await buy.click();
    await shop.getByRole("status").filter({ hasText: /capacity/i }).waitFor();
    assert.deepEqual(await snapshot(), purchased);
    await page.screenshot({ path: resolve(output, `${quality}-shop-traffic.png`) });
    await resumeSavedGame(page);
    await ready();
    assert.deepEqual(await snapshot(), purchased, "Actual app reload preserves purchased stock and gem balance");
    assert.deepEqual(errors, []);
    reports.push({ errors, initialTraffic, materialIds, purchased, quality, upgradeTicks });
    await writeFile(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(resolve(output, "review.json"));
