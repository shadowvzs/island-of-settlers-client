import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { launchBrowser, startDevServer } from "./browser";
import { openDevelopmentAction } from "./development-ui-helpers";

const output = resolve("../resources/settlement-previews/four-launchers");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript(() => {
      (window as any).__name = (value: unknown) => value;
    });
    await page.goto(`${url}?quality=${quality}&seed=123&reveal=1&cache=0`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement), null,
      { timeout: 120000 });
    assert.deepEqual(await page.locator(".settlement-ui__actions > button").evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label"))), ["Build", "Map", "Menu", "News"]);
    assert.equal((await page.locator(".settlement-ui__bar").textContent())?.trim(), "");
    assert.equal(await page.locator(".settlement-ui__bar svg").count(), 5);
    assert.equal(await page.locator(".settlement-ui__bar .settlement-ui__summary").count(), 0);
    assert.equal(await page.locator(".stats-overlay").isVisible(), false);
    assert.equal(await page.locator(".map-editor").isVisible(), false);
    assert.equal(await page.locator(".minimap").isVisible(), false);
    await page.locator(".settlement-ui__bar").getByRole("button", { name: "Map", exact: true }).click();
    assert.equal(await page.locator(".minimap").isVisible(), true);
    await page.screenshot({ path: resolve(output, `${quality}-papyrus-minimap.png`) });
    await page.locator(".settlement-ui__bar").getByRole("button", { name: "Map", exact: true }).click();
    assert.equal(await page.locator(".minimap").isVisible(), false);
    await page.screenshot({ path: resolve(output, `${quality}-icon-toolbar.png`) });
    await page.getByRole("button", { name: "News", exact: true }).click();
    await page.screenshot({ path: resolve(output, `${quality}-papyrus-news.png`) });
    await page.getByRole("button", { name: "Close settlement window", exact: true }).click();
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    assert.equal(await page.locator(".settings-panel:not([hidden])").isVisible(), true);
    await page.screenshot({ path: resolve(output, `${quality}-papyrus-settings.png`) });
    await page.getByRole("button", { name: "Close settings panel", exact: true }).click();
    const paper = await page.locator(".settlement-ui__bar").evaluate(element => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor, texture: style.backgroundImage };
    });
    assert.equal(paper.color, "rgb(69, 48, 31)");
    assert.equal(paper.background, "rgba(230, 211, 163, 0.9)");
    assert(paper.texture.includes("feTurbulence"), "Toolbar must reuse the original paper grain");

    const headquarters = await page.evaluate(() => {
      const live = (window as any).__settlement, building = live.simulation.headquarters;
      return { uid: building.uid, inventory: { ...building.inventory },
        screen: live.projectGround(building.x, building.z) };
    });
    const canvasBounds = await page.locator("canvas").first().boundingBox();
    assert(canvasBounds);
    await page.mouse.click(canvasBounds.x + headquarters.screen.x, canvasBounds.y + headquarters.screen.y);
    assert.equal(await page.getByRole("dialog", { name: "Headquarters", exact: true }).isVisible(), true);
    // The headquarters cannot be demolished, so it shows no Demolish button at all.
    assert.equal(await page.locator(`[data-demolish-building="${headquarters.uid}"]`).count(), 0);
    const inventory = page.locator(`[data-building-inventory="${headquarters.uid}"]`);
    const visibleStock = await inventory.locator("[data-ware]").evaluateAll(tiles =>
      Object.fromEntries(tiles.map(tile => [(tile as HTMLElement).dataset.ware,
        Number((tile as HTMLElement).dataset.count)])));
    // The panel lists every ware, empty ones at 0; the simulation keeps only stocked wares.
    const stocked = (stock: Record<string, number>) =>
      Object.fromEntries(Object.entries(stock).filter(([, count]) => count > 0));
    assert.deepEqual(stocked(visibleStock), stocked(headquarters.inventory));
    const renderedIcons = inventory.locator("[data-ware] img");
    assert.equal(await renderedIcons.count(), Object.keys(visibleStock).length);
    await renderedIcons.evaluateAll(async images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
    await page.screenshot({ path: resolve(output, `${quality}-headquarters-inventory.png`) });
    await page.getByRole("button", { name: "Close building details window", exact: true }).click();
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    assert.equal(await page.locator(".settlement-ui__menu .settlement-ui__summary").count(), 0);
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    assert.equal(await page.getByRole("dialog", { name: "Settlement overview", exact: true }).isVisible(), true);
    await page.screenshot({ path: resolve(output, `${quality}-parchment-overview.png`) });
    await page.getByRole("button", { name: "Close settlement overview window", exact: true }).click();
    await page.getByRole("button", { name: "Build", exact: true }).click();
    assert.equal(await page.locator('[data-building="0"]').count(), 0);
    assert.equal(await page.getByRole("tab", { name: "Headquarters", exact: true }).count(), 0);
    const [width, depth] = getBuildingDefinition(17).gridFootprint;
    assert.equal(await page.locator('[data-building="17"] small').textContent(), `${width} × ${depth}`);
    await page.locator('[data-building="17"]').click();
    await page.getByRole("button", { name: "Rotate selected building", exact: true }).click();
    await page.getByRole("button", { name: "Close settlement window", exact: true }).click();
    const plot = await page.evaluate(({ depth, width }) => {
      const live = (window as any).__settlement;
      const hq = live.simulation.headquarters;
      const canvas = document.querySelector("canvas")!.getBoundingClientRect();
      const candidates: any[] = [];
      for (let dz = -20; dz <= 20; dz++) for (let dx = -20; dx <= 20; dx++) {
        const x = Math.floor(hq.x) + dx + (depth % 2 ? 0.5 : 0);
        const z = Math.floor(hq.z) + dz + (width % 2 ? 0.5 : 0);
        if (live.simulation.validatePlacement(17, x, z, 1)) continue;
        const projected = (window as any).__worker.projectGround(x, z);
        if (!projected) continue;
        const px = projected.x + canvas.x, py = projected.y + canvas.y;
        if (px < 40 || px > innerWidth - 40 || py < 90 || py > innerHeight - 150) continue;
        candidates.push({ x, z, px, py, distance: Math.hypot(x - hq.x, z - hq.z) });
      }
      candidates.sort((a, b) => a.distance - b.distance);
      return candidates[0];
    }, { width, depth });
    assert(plot, `${quality}: no visible valid calculated woodcutter plot`);
    await page.mouse.move(plot.px, plot.py);
    await page.screenshot({ path: resolve(output, `${quality}-calculated-preview.png`) });
    await page.mouse.click(plot.px, plot.py);
    await page.waitForTimeout(300);
    const placed = await page.evaluate(() => (window as any).__settlement.simulation.buildings()
      .find((building: any) => building.typeId === 17));
    assert(placed, `${quality}: actual pointer click did not place building`);
    await page.evaluate(() => (window as any).__settlement.update(.5));
    assert.equal(placed.width, depth);
    assert.equal(placed.depth, width);
    assert.equal(placed.rotation, 1);
    await page.getByRole("button", { name: "Cancel placement or road tool", exact: true }).click();
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Buildings", exact: true }).click();
    const register = page.getByRole("dialog", { name: "Building overview", exact: true });
    assert.equal(await register.isVisible(), true);
    // The register's React content loads on its first open.
    await register.locator("[data-building-type]").first().waitFor();
    assert.equal(await register.locator("[data-building-type] img").count(), 40); // 39 originals + the Tavern
    const hqCard = register.locator('[data-building-type="0"]');
    const woodCard = register.locator('[data-building-type="17"]');
    assert.equal(await hqCard.getAttribute("data-completed"), "1");
    await page.waitForFunction(() => document.querySelector('[data-building-type="17"]')
      ?.getAttribute("data-sites") === "1");
    assert.equal(await woodCard.getAttribute("data-completed"), "0");
    assert.equal(await woodCard.getAttribute("data-sites"), "1");
    await page.screenshot({ path: resolve(output, `${quality}-building-register.png`) });
    await page.evaluate(uid => {
      const live = (window as any).__settlement;
      const building = live.simulation.buildings().find((entry: any) => entry.uid === uid);
      building.construction = 1; building.required = {};
      live.update(.5);
    }, placed.uid);
    assert.equal(await woodCard.getAttribute("data-completed"), "1");
    assert.equal(await woodCard.getAttribute("data-sites"), "0");
    await woodCard.click();
    assert.equal(await page.getByRole("dialog", { name: "Woodcutter", exact: true }).isVisible(), true);
    await page.screenshot({ path: resolve(output, `${quality}-completed-demolition-action.png`) });
    await page.locator(`[data-demolish-building="${placed.uid}"]`).click();
    await page.screenshot({ path: resolve(output, `${quality}-completed-demolition-confirm.png`) });
    await page.locator(`[data-demolish-confirm-yes="${placed.uid}"]`).click();
    assert.equal(await page.getByRole("dialog", { name: "Woodcutter", exact: true }).isVisible(), false);
    // A completed building keeps burning on screen for a while; the simulation drops it at once.
    assert.equal(await page.evaluate(uid => (window as any).__settlement.simulation.buildings()
      .some((building: any) => building.uid === uid), placed.uid), false);
    const freshPlan=await page.evaluate(placed=>{
      const live=(window as any).__settlement;
      const result=live.simulation.placeBuilding(17,placed.x,placed.z,placed.rotation);
      live.update(.5);return result.building;
    },placed);
    assert(freshPlan, "Freed plot must accept a new plan");
    await page.getByRole("button", {name:"Close settlement window",exact:true}).click();
    const registerClose=page.getByRole("button", {name:"Close building overview window",exact:true});
    if(await registerClose.isVisible())await registerClose.click();
    const planPoint=await page.evaluate(plan=>(window as any).__settlement.projectGround(plan.x,plan.z),freshPlan);
    await page.mouse.click(canvasBounds.x+planPoint.x,canvasBounds.y+planPoint.y);
    assert.equal(await page.getByRole("dialog",{name:"Woodcutter",exact:true}).isVisible(),true);
    await page.screenshot({path:resolve(output,`${quality}-construction-plan-demolition.png`)});
    await page.locator(`[data-demolish-building="${freshPlan.uid}"]`).click();
    await page.locator(`[data-demolish-confirm-yes="${freshPlan.uid}"]`).click();
    assert.equal(await page.evaluate(uid=>{const live=(window as any).__settlement;return live.update(.5).buildings.some((b:any)=>b.id===`settlement-${uid}`);},freshPlan.uid),false);
    assert.equal(await page.locator(".settlement-ui__status").isVisible(),true);
    await page.waitForTimeout(10_100);
    assert.equal(await page.locator(".settlement-ui__status").isVisible(),false);
    await page.getByRole("button",{name:"Menu",exact:true}).click();
    await page.screenshot({ path: resolve(output, `${quality}-main-selection.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Close settlement window", exact: true }).click();
    const bar = await page.locator(".settlement-ui__bar").boundingBox();
    assert(bar && bar.x >= 0 && bar.x + bar.width <= 390, "Mobile toolbar must fit");
    await page.screenshot({ path: resolve(output, `${quality}-mobile-toolbar.png`) });
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      const mainPanel = page.locator('[aria-labelledby="settlement-panel-title"]');
      if (await mainPanel.isVisible()) await page.getByRole("button", { name: "Close settlement window", exact: true }).click();
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page.getByRole("button", { name: "Buildings", exact: true }).click();
      await page.getByRole("dialog", { name: "Building overview", exact: true })
        .locator('[data-building-type="0"]').click();
      const details = page.getByRole("dialog", { name: "Headquarters", exact: true });
      const geometry = await details.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const header = element.querySelector("header")!.getBoundingClientRect();
        const content = element.querySelector(".settlement-ui__overview")!;
        return { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom,
          headerHeight: header.height, contentHeight: content.clientHeight,
          overflow: getComputedStyle(content).overflowY };
      });
      assert(geometry.x >= 0 && geometry.right <= viewport.width);
      assert(geometry.y >= 0 && geometry.bottom <= viewport.height);
      assert(geometry.headerHeight <= 48, "Compact touch header must stay at or below 48px");
      assert(geometry.contentHeight >= 100, "Short mobile screen must retain usable inventory space");
      assert.equal(geometry.overflow, "auto");
      await details.locator("img").evaluateAll(async images =>
        Promise.all(images.map(image => (image as HTMLImageElement).decode())));
      await page.screenshot({ path: resolve(output, `${quality}-mobile-inventory-${viewport.width}.png`) });
      await page.getByRole("button", { name: "Close building details window", exact: true }).click();
      await page.getByRole("button", { name: "Close settlement window", exact: true }).click();
      await page.locator(".settlement-ui__bar").getByRole("button", { name: "Map", exact: true }).click();
      const mapBounds = await page.locator(".minimap").boundingBox();
      assert(mapBounds && mapBounds.x >= 0 && mapBounds.y >= 0 &&
        mapBounds.x + mapBounds.width <= viewport.width && mapBounds.y + mapBounds.height <= viewport.height);
      await page.screenshot({ path: resolve(output, `${quality}-papyrus-minimap-${viewport.width}.png`) });
      await page.locator(".settlement-ui__bar").getByRole("button", { name: "Map", exact: true }).click();
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const settingsBounds = await page.locator(".settings-panel:not([hidden])").boundingBox();
      assert(settingsBounds && settingsBounds.x >= 0 && settingsBounds.y >= 0 &&
        settingsBounds.x + settingsBounds.width <= viewport.width && settingsBounds.y + settingsBounds.height <= viewport.height);
      const toolbarBounds = await page.locator(".settlement-ui__bar").boundingBox();
      assert(toolbarBounds);
      if (settingsBounds.x < toolbarBounds.x + toolbarBounds.width &&
        settingsBounds.x + settingsBounds.width > toolbarBounds.x)
        assert(settingsBounds.y + settingsBounds.height <= toolbarBounds.y,
          "Settings must leave the four-launcher toolbar unobstructed");
      await page.screenshot({ path: resolve(output, `${quality}-papyrus-settings-${viewport.width}.png`) });
      await page.getByRole("button", { name: "Close settings panel", exact: true }).click();
      await page.getByRole("button", { name: "News", exact: true }).click();
      const newsBounds = await mainPanel.boundingBox();
      assert(newsBounds && newsBounds.x >= 0 && newsBounds.y >= 0 &&
        newsBounds.x + newsBounds.width <= viewport.width && newsBounds.y + newsBounds.height <= viewport.height);
      await page.screenshot({ path: resolve(output, `${quality}-papyrus-news-${viewport.width}.png`) });
      await page.getByRole("button", { name: "Menu", exact: true }).click();
    }
    if (quality === "minimal") {
      // The Map editor lives in the Development tools menu.
      await (await openDevelopmentAction(page, "Map editor")).click();
      assert.equal(await page.locator(".map-editor").isVisible(), true);
      await page.reload();
      await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement), null,
        { timeout: 120000 });
      assert.equal(await page.locator(".map-editor").isVisible(), false);
      // The button sits in the closed Development tools menu, so read it without a visibility check.
      assert.equal(await page.locator("button[aria-label='Map editor']").getAttribute("aria-pressed"), "false");
    }
    assert.deepEqual(errors, []);
    reports.push({ quality, launchers: 4, placed: { width: placed.width, depth: placed.depth, rotation: placed.rotation }, errors });
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports));
} finally {
  await browser.close();
  await server.close();
}
