import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Played-map scenery review: an authored map whose scenario holds decoration models (arches, lanterns,
 * ornamental trees) is played through the editor's Play button; the capture checks the fixed scenery in
 * the live game (spawned, not owned, not pickable) and shoots close/normal views on each quality.
 * Run: npx tsx --env-file=<file> tools/bench/map-scenery-review.ts (OUTPUT_DIR, QUALITIES=high,minimal).
 */
const OUTPUT = process.env.OUTPUT_DIR ?? "/tmp/map-scenery-review";
const QUALITIES = (process.env.QUALITIES ?? "high,minimal").split(",");
const ITEMS = [
  "roadDecoration:roman-rusticated-arch:marble", "roadDecoration:roman-ceremonial-arch:limestone",
  "roadDecoration:japanese-stone-lantern:granite", "roadDecoration:chinese-wooden-lantern:native",
  "roadDecoration:plant-red-maple-standalone-ground-0:native", "roadDecoration:plant-cherry-blossom-standalone-ground-1:native",
  "roadDecoration:japanese-timber-torii:native", "roadDecoration:wisteria-tree-0:native"
];

const exposeRuntime = async (page: Page) => {
  await page.route("**/src/app/island-runtime.ts*", async route => {
    const response = await route.fetch(), source = await response.text();
    assert(source.includes("window.__islandReady = true"));
    await route.fulfill({ response, body: source.replace("window.__islandReady = true",
      "window.__editorReview={world,camera,renderer,mapEditor};window.__islandReady = true") });
  });
};

/** Fixture: a peaceful home scenario with a valid headquarters and the decoration rows around it. */
const authorScenario = (page: Page) => page.evaluate(async items => {
  const { world } = (window as any).__editorReview;
  const { createMapScenario } = await import(/* @vite-ignore */ String("/src/shared/world/map-scenario.ts"));
  const { validateMapScenario } = await import(/* @vite-ignore */ String("/src/shared/settlement/settlement-map-scenario.ts"));
  const { createScenarioDecorationLayout } = await import(/* @vite-ignore */
    String("/src/shared/settlement/scenario-decoration-layout.ts"));
  const start = { x: Math.round(world.start.x), z: Math.round(world.start.z) };
  let lastProblem = "";
  for (let radius = 0; radius < 30 && !world.scenario?.headquarters; radius++)
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++)
      for (const offset of [0, .5]) {
        if (world.scenario?.headquarters || Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        world.scenario = { ...createMapScenario(),
          headquarters: { rotation: 0, x: start.x + dx + offset, z: start.z + dz + offset } };
        const problems = validateMapScenario(world);
        if (problems.length) { lastProblem = problems.join("; "); world.scenario = undefined; }
      }
  if (!world.scenario) throw new Error(`No headquarters site: ${lastProblem}`);
  const hq = world.scenario.headquarters, decorations: unknown[] = [];
  for (const item of items) for (let attempt = 0; attempt < 400; attempt++) {
    const angle = attempt * 2.399, radius = 7 + attempt * .04;
    const point = { x: hq.x + Math.cos(angle) * radius, z: hq.z + Math.sin(angle) * radius };
    world.scenario = { ...world.scenario, decorations: [...decorations, { item, x: point.x, yaw: angle % 6, z: point.z }] };
    const layout = createScenarioDecorationLayout(world);
    if (layout.blocked().length === 0) { decorations.push(world.scenario.decorations.at(-1)); break; }
  }
  world.scenario = { ...world.scenario, decorations };
  return { decorations: world.scenario.decorations, headquarters: hq };
}, ITEMS);

const review = async (quality: string) => {
  const output = resolve(OUTPUT, quality);
  mkdirSync(output, { recursive: true });
  const { server, url } = await startDevServer(), browser = await launchBrowser();
  const rows: Record<string, unknown>[] = [], errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    await exposeRuntime(page);
    await page.goto(`${url}editor.html?quality=${quality}&size=192&seed=1234&rivers=1&forest=1&mountains=1` +
      "&cache=0&reveal=1&time=day");
    await page.waitForFunction(() => (window as any).__editorReady, null, { timeout: 240000 });
    const authored = await authorScenario(page);
    rows.push({ name: "authored", ...authored });
    await page.getByRole("tab", { name: "Map, headquarters and scenario", exact: true }).click();
    // Save the authored map in a browser slot and start the game on it (`?map=`), as Load does.
    await page.getByRole("button", { name: "Save in the browser (new slot)", exact: true }).click();
    await page.waitForTimeout(1500);
    const slot = await page.evaluate(async () => {
      const { openMapStorage } = await import(/* @vite-ignore */ String("/src/app/map-editor/map-storage.ts"));
      const storage = await openMapStorage();
      try { return (await storage.list())[0]?.id as string | undefined; } finally { storage.close(); }
    });
    assert(slot, "The authored map was not saved");
    await page.goto(`${url}?map=${slot}&quality=${quality}&reveal=1&time=day`);
    await page.waitForFunction(() => (window as any).__settlement?.simulation, null, { timeout: 240000 });
    await page.waitForTimeout(3000);
    const state = await page.evaluate(() => {
      const simulation = (window as any).__settlement.simulation;
      const world = (window as any).__editorReview?.world;
      return { url: location.href, scenarioRows: world?.scenario?.decorations?.length ?? null,
        hq: world?.scenario?.headquarters ?? null, size: world && [world.cellsX, world.cellsZ],
        frames: simulation.roadDecorations().map((frame: any) => ({ item: frame.item, uid: frame.uid,
        x: frame.position[0], z: frame.position[2] })), save: simulation.saveState().roadDecorationScenery?.length,
      owned: simulation.saveState().roadDecorations ?? null };
    });
    rows.push({ name: "spawned", ...state });
    const hq = authored.headquarters as { x: number; z: number };
    for (const [name, zoom] of [["close", 2.2], ["normal", 1]] as const) {
      await page.evaluate(([x, z, value]) => (window as any).__settlement.focusGround(x, z, value), [hq.x, hq.z, zoom]);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: resolve(output, `played-${name}.png`) });
    }
    const target = state.frames[0];
    if (target) {
      await page.evaluate(([x, z]) => (window as any).__settlement.focusGround(x, z, 2.2), [target.x, target.z]);
      await page.waitForTimeout(1500);
      const screen = await page.evaluate(([x, z]) => (window as any).__settlement.projectGround(x, z), [target.x, target.z]);
      const picked = await page.evaluate(([x, y]) => (window as any).__editorReview.renderer.pickRoadDecoration(x, y - 40),
        [screen.x, screen.y]);
      await page.mouse.click(screen.x, screen.y - 40);
      await page.waitForTimeout(800);
      await page.screenshot({ path: resolve(output, "clicked-scenery.png") });
      rows.push({ name: "pick-scenery", picked, panel: await page.locator(".road-decoration-window, [data-window='road-decoration']")
        .count() });
    }
  } finally {
    writeFileSync(resolve(output, "report.json"), JSON.stringify({ quality, rows, errors }, null, 2));
    console.log(JSON.stringify({ quality, rows, errors }));
    await browser.close();
    await server.close();
  }
};

for (const quality of QUALITIES) await review(quality);
