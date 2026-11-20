import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Map editor check: drives the editor panel like a player (tools, brush size, left drags on the
 * map), then one screenshot plus the rebuild timings. VIEW = x,z,zoom of an open meadow
 * (default island); OUT_DIR as in shots.
 */
const VIEW = process.env.VIEW ?? "165,206,1.6";
const outDir = process.env.OUT_DIR ?? "../docs/terrain-benchmarks/map-editor-2026-10-06";

/** Ground tiles in a 3 x 3 grid of patches on screen (mine gravel last: it gets the ore). */
const GROUND_TILES = [
  "Grass",
  "Lush grass",
  "Forest floor",
  "Dirt",
  "Sand",
  "Rock",
  "Snow",
  "Gravel",
  "Mine gravel"
];

type WorldPoint = [number, number];

/** Screen point (page pixels) of a ground point, with the renderer's own projection. */
const toScreen = (page: Page, [x, z]: WorldPoint) =>
  page.evaluate(([px, pz]) => window.__worker!.projectGround(px!, pz!), [x, z]);

const toolCategory = (name: string) => {
  if (GROUND_TILES.includes(name)) return "Tiles and biomes";
  if (["Iron", "Gold"].includes(name)) return "Stone, marble and mine deposits";
  return name === "Deer" ? "Animals and habitats" : "Trees and forestry";
};

const pickTool = async (page: Page, name: string) => {
  const category = toolCategory(name);
  await page.getByRole("tab", { name: category, exact: true }).click();
  await page.getByRole("tabpanel", { name: category, exact: true })
    .getByRole("button", { exact: true, name }).click();
};

/** Brush radius in cells (the slider's levels start at 1). */
const setBrushSize = (page: Page, cells: number) =>
  page.getByRole("slider", { name: /^Brush size:/ }).fill(String(cells - 1));

/** A left drag through the ground points (one press, moves, release). */
const drag = async (page: Page, points: WorldPoint[]) => {
  const screen = await Promise.all(points.map((point) => toScreen(page, point)));
  await page.mouse.move(screen[0]!.x, screen[0]!.y);
  await page.mouse.down();
  for (const point of screen.slice(1)) await page.mouse.move(point.x, point.y, { steps: 8 });
  await page.mouse.up();
};

const click = async (page: Page, point: WorldPoint) => drag(page, [point]);

/** World point `across` cells to the screen right and `down` cells down from the centre. */
const onScreen = ([cx, cz]: WorldPoint, across: number, down: number): WorldPoint => [
  cx + (across + down) / 2,
  cz + (down - across) / 2
];

/** Every tool once around the view centre: tile patches, ore on the mine gravel, trees, a deer. */
const editIsland = async (page: Page, centre: WorldPoint) => {
  // A dirt strip under the first row, so the green tiles show against it.
  await setBrushSize(page, 4);
  await pickTool(page, "Dirt");
  await drag(page, [onScreen(centre, -4, -10), onScreen(centre, 12, -10)]);
  await setBrushSize(page, 2);
  for (const [index, tile] of GROUND_TILES.entries()) {
    await pickTool(page, tile);
    const across = -3 + (index % 3) * 7;
    const down = -10 + Math.floor(index / 3) * 5;
    await drag(page, [onScreen(centre, across - 1.5, down), onScreen(centre, across + 1.5, down)]);
  }
  // Mine gravel is still picked (the last tile): picking it again would put it away.
  await setBrushSize(page, 3);
  await drag(page, [onScreen(centre, -3, 7), onScreen(centre, 4, 7)]);
  await pickTool(page, "Iron");
  await click(page, onScreen(centre, -2, 7));
  await pickTool(page, "Gold");
  await click(page, onScreen(centre, 3, 7));
  for (const [index, tree] of ["Oak", "Conifer", "Birch", "Palm", "Sapling"].entries()) {
    await pickTool(page, tree);
    await click(page, onScreen(centre, 8 + index * 2, 2 + (index % 2) * 2));
  }
  await pickTool(page, "Deer");
  await click(page, onScreen(centre, 9, 9));
  await pickTool(page, "Sand");
  const hover = await toScreen(page, onScreen(centre, 6, 12));
  await page.mouse.move(hover.x, hover.y);
};

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { height: 900, width: 1500 } });
  page.on("pageerror", (error) => console.log("[pageerror]", error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.log("[browser]", message.text().slice(0, 600));
  });
  const [x, z] = VIEW.split(",").map(Number) as [number, number];
  await page.goto(`${url}?reveal=1&view=${VIEW}`);
  await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 120_000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const overlay = document.querySelector<HTMLElement>(".stats-overlay");
    if (overlay) overlay.hidden = true;
  });
  await editIsland(page, [x, z]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, "map-editor.png") });
  console.log(JSON.stringify(await page.evaluate(() => window.__mapEditorStats)));
  await browser.close();
  await server.close();
};

await main();
