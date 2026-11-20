import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Locator, Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

const output = resolve("../resources/settlement-previews/building-demolition");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
const isStanding = (page: Page, uid: number) => page.evaluate((id: number) =>
  (window as any).__settlement.simulation.buildings().some((building: any) => building.uid === id), uid);

/**
 * Demolish asks first in its own window: Escape, a press elsewhere, the close button and Keep
 * keep the building; Demolish confirms.
 */
const reviewDemolishConfirmation = async (page: Page, panel: Locator, quality: string) => {
  const demolish = panel.locator("[data-demolish-building]");
  const uid = Number(await demolish.getAttribute("data-demolish-building"));
  const confirmWindow = page.locator(".settlement-ui__demolish-window");
  const expectKept = async (step: string) => {
    assert(await confirmWindow.isHidden(), `${step} closes the question`);
    assert(await panel.isVisible(), `${step} keeps the building window`);
    assert(await isStanding(page, uid), `${step} keeps the building`);
  };
  await demolish.click();
  await confirmWindow.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.activeElement?.hasAttribute("data-demolish-confirm-no"),
    null, { timeout: 2000 });
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".settlement-ui img")]
    .filter(image => image.checkVisibility()).every(image => image.complete), null, { timeout: 10000 });
  await page.screenshot({ path: resolve(output, `${quality}-confirm-light.png`) });
  await page.keyboard.press("Escape");
  await expectKept("Escape");
  await demolish.click();
  await panel.click({ position: { x: 12, y: 60 } });
  await expectKept("A press elsewhere");
  await demolish.click();
  await confirmWindow.getByRole("button", { name: "Close demolish building window" }).click();
  await expectKept("The close button");
  await demolish.click();
  await page.locator("[data-demolish-confirm-no]").click();
  await expectKept("Keep");
  await demolish.click();
  await page.evaluate(() => { document.documentElement.dataset.hudTheme = "dark"; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(output, `${quality}-confirm-dark.png`) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, `${quality}-confirm-phone-dark.png`) });
  await page.evaluate(() => { document.documentElement.dataset.hudTheme = "light"; });
  await page.screenshot({ path: resolve(output, `${quality}-confirm-phone-light.png`) });
  await page.setViewportSize({ width: 1200, height: 850 });
  await page.locator("[data-demolish-confirm-yes]").click();
};
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/demolition-fixture.html", route => route.fulfill({
      contentType: "text/html", body: "<body></body>"
    }));
    await page.goto(`${url}demolition-fixture.html`);
    const fixture = await page.evaluate(async () => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const { DEFAULT_WORLD_OPTIONS, generateWorld } = await imp("/src/shared/world/generation/generate-world.ts");
      const { createSettlementSimulation } = await imp("/src/shared/settlement/settlement-simulation.ts");
      const { createRoadNetwork } = await imp("/src/shared/settlement/road-network.ts");
      const { createGameSave } = await imp("/src/shared/settlement/game-save.ts");
      const { openLocalSaveStore } = await imp("/src/app/save-store/local-save-store.ts");
      const { settingsStorage } = await imp("/src/app/settings/graphics-settings.ts");
      settingsStorage.writeFog(false);
      const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96,
        erosionDroplets: 100, seed: 1234 });
      world.heights.fill(1); world.blocking.fill(0); world.walkCost.fill(10);
      world.buildClass.fill(4); world.buildCap.fill(4); world.slopeClass.fill(0);
      world.start = { x: 48.5, z: 48.5 }; world.props.count = 0;
      let simulation: any;
      const roads = createRoadNetwork(world, { isBlocked: (x: number, z: number) => simulation?.isOccupied(x, z) ?? false });
      simulation = createSettlementSimulation({ world, roads, initialSettlers: 40,
        initialStock: { planks: 100, stone: 100, rollingPin: 8, flour: 6, water: 18 } });
      const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
      const [width, depth] = getBuildingDefinition(32).gridFootprint;
      const result = simulation.placeBuilding(32, 38 + width % 2 / 2, 61 + depth % 2 / 2);
      if (!result.ok) throw new Error(result.reason);
      const building = result.building;
      building.construction = 1; building.foundationProgress = 1; building.required = {};
      simulation.connectRoads(simulation.headquarters.access, building.access);
      for (let tick = 0; tick < 2000; tick++) simulation.update(.05);
      const saved = await createGameSave(world, simulation.saveState(),
        { name: "Demolition review", source: "generated", savedAt: 123, animals: [] });
      await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(saved));
      return { uid: building.uid, x: building.x, z: building.z };
    });
    await page.route("**/src/app/main.ts", async route => {
      const response = await route.fetch(), source = await response.text();
      await route.fulfill({ response, body: source.replace("window.__islandReady = true",
        "window.__burnReview = { camera, detail: graphics.detail }; window.__islandReady = true") });
    });
    await page.goto(`${url}?quality=${quality}`);
    await page.waitForFunction(() => Boolean((window as any).__burnReview), null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => (window as any).__burnReview.detail), quality);
    await page.evaluate(({ x, z }) => Object.assign((window as any).__burnReview.camera,
      { centerX: x, centerZ: z, zoom: 1.5, yaw: 0, tilt: 0 }), fixture);
    await page.waitForTimeout(250);
    const point = await page.evaluate(({ x, z }) => (window as any).__settlement.project(x, 2, z), fixture);
    await page.mouse.click(point.x, point.y);
    const panel = page.locator(".settlement-ui__building-details-window");
    await panel.waitFor({ state: "visible" });
    await reviewDemolishConfirmation(page, panel, quality);
    const started = Date.now();
    const ages: unknown[] = [];
    for (const seconds of [1, 5, 13, 16, 27, 31]) {
      await page.waitForTimeout(Math.max(0, started + seconds * 1000 - Date.now()));
      const state = await page.evaluate((uid: number) => {
        const app = (window as any).__settlement, frame = app.update(0).buildings.find((f: any) => f.id === `settlement-${uid}`);
        return { age: frame?.demolitionAge ?? null,
          real: app.simulation.buildings().some((building: any) => building.uid === uid),
          workers: app.workerFrames.map((worker: any) => ({ action: worker.action, x: worker.x, z: worker.z })) };
      }, fixture.uid);
      assert.equal(state.real, false);
      if (seconds < 30) assert(state.age !== null && Math.abs(state.age - seconds) < 1);
      else assert.equal(state.age, null);
      await page.screenshot({ path: resolve(output, `${quality}-${seconds}s.png`) });
      ages.push({ seconds, ...state });
    }
    assert.deepEqual(errors, []); reports.push({ quality, ages, errors }); await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  console.log("Actual game burn, collapse, ruins and cleanup passed High/Minimal", reports);
} finally { await browser.close(); await server.close(); }
