import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Page } from "playwright-core";

import { PROP } from "../../src/shared/world/world-data";
import { launchBrowser, startDevServer } from "./browser";

/**
 * Map editor decoration palette review: the palette (categories, search), placing natural props and
 * decoration models through the visible palette with the renderer ghost, and the placed models at a
 * close and a normal view. Run: npx tsx --env-file=<file> tools/bench/decor-palette-review.ts
 * (OUTPUT_DIR, QUALITIES=high,minimal).
 */
const OUTPUT = process.env.OUTPUT_DIR ?? "/tmp/decor-palette-review";
const QUALITIES = (process.env.QUALITIES ?? "high,minimal").split(",");
const ARCH = "roadDecoration:roman-rusticated-arch:limestone";

interface Spot { x: number; z: number }

const exposeEditor = async (page: Page) => {
  await page.route("**/src/app/island-runtime.ts*", async route => {
    const response = await route.fetch(), source = await response.text();
    assert(source.includes("window.__islandReady = true"));
    await route.fulfill({ response, body: source.replace("window.__islandReady = true",
      "window.__editorReview={world,camera,renderer,mapEditor};window.__islandReady = true") });
  });
};

/** Fixture setup: an empty home scenario (the decoration models are authored scenario rows). */
const findSpots = (page: Page) => page.evaluate(async item => {
  const review = (window as any).__editorReview, world = review.world;
  const { createMapScenario } = await import(/* @vite-ignore */ String("/src/shared/world/map-scenario.ts"));
  const { createScenarioDecorationLayout } = await import(/* @vite-ignore */
    String("/src/shared/settlement/scenario-decoration-layout.ts"));
  world.scenario = createMapScenario();
  const layout = createScenarioDecorationLayout(world);
  const centre = { x: world.cellsX / 2, z: world.cellsZ / 2 };
  for (let radius = 0; radius < world.cellsX / 2; radius += 2)
    for (let angle = 0; angle < Math.PI * 2; angle += .3) {
      const x = Math.round(centre.x + Math.cos(angle) * radius) + .5;
      const z = Math.round(centre.z + Math.sin(angle) * radius) + .5;
      const around = [[0, 0], [3, 0], [-3, 0], [0, 3], [3, 3], [-3, 3]];
      if (around.every(([dx, dz]) => layout.plan(item, { x: x + dx!, z: z + dz! }, 0).ok))
        return { x, z };
    }
  throw new Error("No open decoration spot");
}, ARCH) as Promise<Spot>;

const focus = async (page: Page, spot: Spot, zoom: number) => {
  await page.evaluate(([point, value]) => Object.assign((window as any).__editorReview.camera,
    { centerX: point.x, centerZ: point.z, zoom: value }), [spot, zoom] as const);
  await page.waitForTimeout(500);
};

const screenPoint = (page: Page, spot: Spot) => page.evaluate(async point => {
  const { renderer, world } = (window as any).__editorReview;
  const { sampleSmooth } = await import(/* @vite-ignore */ String("/src/shared/world/grid-geometry.ts"));
  return renderer.projectToViewport(point.x, sampleSmooth(world, world.heights, point.x, point.z), point.z);
}, spot) as Promise<{ x: number; y: number }>;

const clickGround = async (page: Page, spot: Spot) => {
  await focus(page, spot, 2.4);
  const screen = await screenPoint(page, spot);
  await page.mouse.click(screen.x, screen.y);
  await page.waitForTimeout(400);
};

/** Picks a palette entry by its registry id (search cleared, all categories). */
const pickTile = async (page: Page, entry: string) => {
  await page.getByRole("searchbox", { name: "Search decorations", exact: true }).fill("");
  await page.getByRole("group", { name: "Decoration categories", exact: true })
    .getByRole("button", { name: "All", exact: true }).click();
  const tile = page.locator(`.map-editor__palette-grid [data-entry="${entry}"]`);
  if (await tile.getAttribute("aria-pressed") !== "true") await tile.click();
};

const hint = (page: Page) => page.locator(".map-editor__status").textContent();

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
    await exposeEditor(page);
    await page.goto(`${url}editor.html?quality=${quality}&size=256&seed=1234&rivers=2&forest=1&mountains=1` +
      "&cache=0&reveal=1&time=day");
    await page.waitForFunction(() => (window as any).__editorReady, null, { timeout: 240000 });
    await page.getByRole("tab", { name: "Plants and decorations", exact: true }).click();
    const panel = page.locator(".map-editor");
    await panel.screenshot({ path: resolve(output, "palette-all.png") });
    await page.getByRole("group", { name: "Decoration categories", exact: true })
      .getByRole("button", { name: "Trees", exact: true }).click();
    await panel.screenshot({ path: resolve(output, "palette-trees.png") });
    await page.getByRole("group", { name: "Decoration categories", exact: true })
      .getByRole("button", { name: "All", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search decorations", exact: true }).fill("lantern");
    await panel.screenshot({ path: resolve(output, "palette-search-lantern.png") });
    rows.push({ name: "tiles", all: await page.locator(".map-editor__palette-tile").count() });

    const spot = await findSpots(page);
    rows.push({ name: "spot", spot });
    await focus(page, spot, 2.4);
    await pickTile(page, "placed:roman-rusticated-arch");
    await page.getByRole("combobox", { name: "Decoration variant", exact: true })
      .selectOption({ label: "Marble" });
    const ghost = await screenPoint(page, spot);
    await page.mouse.move(ghost.x, ghost.y);
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(output, "ghost-valid.png") });
    await clickGround(page, spot);
    rows.push({ name: "place-arch", hint: await hint(page) });
    const blocked = await screenPoint(page, { x: spot.x + .3, z: spot.z });
    await page.mouse.move(blocked.x, blocked.y);
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(output, "ghost-refused.png") });
    await page.mouse.click(blocked.x, blocked.y);
    rows.push({ name: "refused-overlap", hint: await hint(page) });
    const placements: [string, Spot][] = [
      ["placed:japanese-stone-lantern", { x: spot.x + 3, z: spot.z }],
      ["placed:chinese-wooden-lantern", { x: spot.x - 3, z: spot.z }],
      ["placed:plant-red-maple-roadside-ground", { x: spot.x, z: spot.z + 3 }],
      ["placed:plant-lavender-roadside-pot", { x: spot.x + 3.5, z: spot.z - 2.5 }],
      [`ground:${PROP.fern}`, { x: spot.x - 3, z: spot.z + 3 }],
      [`ground:${PROP.waterLily}`, { x: spot.x - 3, z: spot.z - 3 }]
    ];
    for (const [name, point] of placements) {
      await pickTile(page, name);
      await clickGround(page, point);
      rows.push({ name: `place ${name}`, hint: await hint(page) });
    }
    await page.getByRole("button", { name: "Remove the decoration at a click", exact: true }).click();
    await clickGround(page, { x: spot.x - 3, z: spot.z });
    rows.push({ name: "remove chinese lantern", hint: await hint(page) });
    await page.getByRole("button", { name: "Remove the decoration at a click", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search decorations", exact: true }).fill("");
    await panel.screenshot({ path: resolve(output, "palette-selected.png") });
    // Owner 2026-11-10: authors may pack decorations down to half a tile between centres.
    const packed: [string, Spot][] = [
      ["placed:indigenous-flower-pot", { x: spot.x + 5, z: spot.z + 5 }], ["placed:indigenous-flower-pot", { x: spot.x + 5.55, z: spot.z + 5 }],
      ["placed:japanese-stone-lantern", { x: spot.x + 6.1, z: spot.z + 5 }],
      [`ground:${PROP.bush}`, { x: spot.x + 5, z: spot.z + 5.6 }], [`ground:${PROP.bush}`, { x: spot.x + 5.55, z: spot.z + 5.6 }],
      ["placed:indigenous-flower-pot", { x: spot.x + 5.3, z: spot.z + 5.3 }]
    ];
    for (const [name, point] of packed) {
      await pickTile(page, name);
      await clickGround(page, point);
      rows.push({ name: `packed ${name} ${point.x - spot.x},${point.z - spot.z}`, hint: await hint(page) });
    }
    await page.mouse.move(5, 500);
    await focus(page, { x: spot.x + 5.5, z: spot.z + 5.3 }, 3.2);
    await page.screenshot({ path: resolve(output, "packed-close.png") });
    rows.push({ name: "scenario", decorations: await page.evaluate(() =>
      (window as any).__editorReview.world.scenario.decorations) });
    await focus(page, { x: spot.x, z: spot.z + 1.5 }, 2.6);
    await page.screenshot({ path: resolve(output, "placed-close.png") });
    await focus(page, { x: spot.x, z: spot.z + 1.5 }, 1);
    await page.screenshot({ path: resolve(output, "placed-normal.png") });
    await page.getByRole("button", { name: "Undo (Ctrl+Z)", exact: true }).click();
    await page.waitForTimeout(500);
    rows.push({ name: "after-undo", count: await page.evaluate(() =>
      (window as any).__editorReview.world.scenario.decorations.length) });
    await page.getByRole("button", { name: "Redo (Ctrl+Y / Ctrl+Shift+Z)", exact: true }).click();
    await page.waitForTimeout(500);
  } finally {
    writeFileSync(resolve(output, "report.json"), JSON.stringify({ quality, rows, errors }, null, 2));
    console.log(JSON.stringify({ quality, rows, errors }));
    await browser.close();
    await server.close();
  }
};

for (const quality of QUALITIES) await review(quality);
