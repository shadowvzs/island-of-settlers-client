import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "../bench/browser";
import { exposeWeather } from "../bench/cloud-review-page";
import { centreOn, settleDecorations } from "../bench/decor-review-session";
import { type FlatIslandBuilding, openFixturePage, writeFlatIslandGame } from "../bench/flat-island-fixture";
import { HIDE_UI } from "../bench/parity-helpers";

/** Temporary diagnostics: expose the building scene and dump the material classes and lights. */
const exposeBuildingScene = (page: Page) => page.route(
  "**/src/renderers/three/buildings/three-buildings.ts*", async route => {
    const response = await route.fetch(), source = await response.text();
    const anchor = "const updateLights = createCrowdLights(scene);";
    assert(source.includes(anchor), "building scene anchor moved");
    await route.fulfill({ response,
      body: source.replace(anchor, `${anchor} globalThis.__buildingScene = scene;`) });
  });

const setHour = (page: Page, hour: number) => page.evaluate(hour => {
  const { controller } = (window as any).__weather;
  const saved = controller.saveState();
  controller.loadState({ ...saved, cycling: false, hour, rain: 0, snow: 0, targetHour: hour, targetRain: 0,
    targetSnow: 0 });
}, hour);

const dump = (page: Page) => page.evaluate(() => {
  const scene = (globalThis as any).__buildingScene;
  const sources: unknown[] = [], batches: unknown[] = [], lights: unknown[] = [];
  scene.traverse((object: any) => {
    if (object.isLight) lights.push({ type: object.type, intensity: object.intensity,
      color: object.color?.getHexString(), sh: object.sh ? Array.from(object.sh.coefficients ?? []).slice(0, 3)
        .map((coefficient: any) => [coefficient.x, coefficient.y, coefficient.z]) : undefined });
    if (object.isBatchedMesh) batches.push({ name: object.name, count: object.count,
      matType: object.material.type, isNode: object.material.isNodeMaterial === true,
      uuid: object.material.uuid, color: object.material.color?.getHexString(),
      emissive: object.material.emissive?.getHexString(), visible: object.visible });
    if (object.isMesh && object.userData.buildingSurface && !object.isBatchedMesh)
      sources.push({ surface: object.userData.buildingSurface, shape: object.userData.shape,
        matType: object.material.type, isNode: object.material.isNodeMaterial === true,
        uuid: object.material.uuid, color: object.material.color?.getHexString(),
        visible: object.visible, mask: object.layers.mask });
  });
  return { lights, batches, sources: sources.slice(0, 80) };
});

const main = async () => {
  const out = process.env.DIAG_OUT ?? "/tmp/opencode";
  const { server, url } = await startDevServer(), browser = await launchBrowser();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { height: 900, width: 1400 } });
    page.on("pageerror", error => console.log("PAGEERROR", error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript("window.__name = value => value;");
    await exposeWeather(page);
    await exposeBuildingScene(page);
    await openFixturePage(page, url);
    // The headquarters is the island's starting building; no other fixture buildings are needed.
    await writeFlatIslandGame(page, { buildings: [] as FlatIslandBuilding[], cells: 96, grassGround: true,
      name: "Persian dome dump", nation: "persian", settlers: 2, stockAll: 200 });
    const renderer = process.env.DIAG_RENDERER ?? "webgpu-gl";
    await page.goto(`${url}?quality=high&cache=0&skipLogin=1&time=day&reveal=1&renderer=${renderer}`);
    await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: 300_000 });
    await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 300_000 });
    await page.addStyleTag({ content: HIDE_UI });
    await setHour(page, 12);
    await centreOn(page, { x: 51, z: 52 }, 2.6, 2);
    await settleDecorations(page, 20);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/diag-${renderer}-day.png` });
    console.log(renderer, "DAY", JSON.stringify(await dump(page), null, 1));
    await setHour(page, 22);
    await centreOn(page, { x: 51, z: 52 }, 2.6, 2);
    await settleDecorations(page, 20);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/diag-${renderer}-night.png` });
    console.log(renderer, "NIGHT", JSON.stringify(await dump(page), null, 1));
    const raised = await page.evaluate(() => {
      const simulation = (window as any).__settlement.simulation, results = [];
      for (let step = 1; step < 5; step++)
        results.push(simulation.debugRaiseBuildingLevel(simulation.headquarters.uid));
      return results.map((result: { ok: boolean; reason?: string }) => result.ok ? "ok" : result.reason);
    });
    console.log(renderer, "RAISED", JSON.stringify(raised));
    await setHour(page, 12);
    await settleDecorations(page, 20);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/diag-${renderer}-l5-day.png` });
    await setHour(page, 22);
    await settleDecorations(page, 20);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/diag-${renderer}-l5-night.png` });
    console.log(renderer, "L5NIGHT", JSON.stringify(await dump(page), null, 1));
  } finally { await browser.close(); await server.close(); }
};
main().catch(error => { console.error(error); process.exitCode = 1; });
