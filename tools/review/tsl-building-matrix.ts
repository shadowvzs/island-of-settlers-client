import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { launchBrowser, startDevServer } from "../bench/browser";
import { exposeWeather } from "../bench/cloud-review-page";
import { centreOn, type LiveWindow, settleDecorations } from "../bench/decor-review-session";
import { type FlatIslandBuilding, openFixturePage, writeFlatIslandGame } from "../bench/flat-island-fixture";
import { HIDE_UI } from "../bench/parity-helpers";

/**
 * TSL-9 building matrix: every nation's representative buildings at level 1 and max level on one
 * flat island, captured in the real game through WebGL and the `webgpu-gl` node renderer, iso close
 * and normal distance, day and night (window glow). Also the per-building road signposts.
 *
 *   MATRIX_NATIONS=roman,.. MATRIX_RENDERERS=webgl,webgpu-gl \
 *     <captures>/browser-slot.sh npx tsx tools/review/tsl-building-matrix.ts
 */
const CAPTURES = process.env.CAPTURES ??
  "/media/shadowvzs/a3016bc8-b7d7-4116-b510-dad892792829/home/shadowvzs/worktree/captures";
const OUT = resolve(process.env.OUTPUT_DIR ?? resolve(CAPTURES, "tsl-buildings", "matrix"));
const NATIONS = (process.env.MATRIX_NATIONS ?? "roman,viking,japanese,nubian,chinese,persian,maya,indigenous")
  .split(",").filter(Boolean);
const RENDERERS = (process.env.MATRIX_RENDERERS ?? "webgl,webgpu-gl").split(",").filter(Boolean);
const VIEWPORT = { height: 900, width: 1400 };
const CELLS = 96;
const SEA_WIDTH = 18;
/**
 * Representative catalog types. The headquarters is the island's own starting building (the menu
 * cannot place a second one); the monument is limited to one per island.
 */
const TYPES = [
  { id: 7, key: "monument" }, { id: 29, key: "storehouse" }, { id: 57, key: "residence" },
  { id: 17, key: "workshop" }, { id: 37, key: "farm" }, { id: 1, key: "barracks" },
  { id: 39, key: "harbour" }
] as const;
/** Kept inside the headquarters' 48-tile territory (the start is the island centre): the monument is 9 wide. */
const ROW_X = [12, 22, 31, 40, 49, 58, 69];
const LEVEL_LOW_Z = 38, LEVEL_TOP_Z = 64;
const MAX_LEVEL = 5;
/** MATRIX_CONSTRUCTION=1 adds a half-built Roman wall and monument (the construction clips). */
const CONSTRUCTION = process.env.MATRIX_CONSTRUCTION === "1";
/** MATRIX_DIAGNOSE=1 records the window-insert material state per time of day. */
const DIAGNOSE = process.env.MATRIX_DIAGNOSE === "1";
/** MATRIX_CLOTH=1 adds a Nubian hanging-cloth motion strip (the TSL cloth-wind path). */
const CLOTH_MOTION = process.env.MATRIX_CLOTH === "1";
/** MATRIX_CLOTH_ONLY=1 skips the standard views and captures only the cloth strip. */
const CLOTH_ONLY = process.env.MATRIX_CLOTH_ONLY === "1";
const CLOTH_VIEW = {
  x: Number(process.env.MATRIX_CLOTH_X ?? 22),
  z: Number(process.env.MATRIX_CLOTH_Z ?? 38),
  zoom: Number(process.env.MATRIX_CLOTH_ZOOM ?? 4)
};
const HOURS = [{ hour: 12, key: "day" }, { hour: 22, key: "night" }];
interface View { lift: number; name: string; x: number; z: number; zoom: number }
const VIEWS: readonly View[] = [
  { lift: 2, name: "normal", x: 42, z: 52, zoom: 0.45 },
  { lift: 2, name: "close-l1-west", x: 25, z: LEVEL_LOW_Z, zoom: 2.2 },
  { lift: 2, name: "close-l1-east", x: 59, z: LEVEL_LOW_Z, zoom: 2.4 },
  { lift: 2, name: "close-l5-west", x: 36, z: LEVEL_TOP_Z, zoom: 2.2 },
  { lift: 2, name: "close-l5-east", x: 64, z: LEVEL_TOP_Z, zoom: 2.4 },
  { lift: 2, name: "hq-close", x: 51, z: 52, zoom: 2.6 },
  // The harbour on the carved shore, then the workshop's tablet sign close enough to read.
  { lift: 1.5, name: "harbour-l1", x: 73, z: LEVEL_LOW_Z + 2, zoom: 3 },
  { lift: 1.5, name: "harbour-l5", x: 73, z: LEVEL_TOP_Z + 2, zoom: 3 },
  { lift: 1.2, name: "signpost-l1", x: 42, z: LEVEL_LOW_Z + 2, zoom: 3.6 },
  { lift: 1.2, name: "signpost-l5", x: 42, z: LEVEL_TOP_Z + 2, zoom: 3.6 }
];

/** Each type keeps its column, so the level-5 row skips the single monument without shifting the rest. */
const row = (level: number, rotation: number, z: number): FlatIslandBuilding[] => TYPES
  .map((type, index) => ({ index, type }))
  .filter(({ type }) => level === 1 || type.key !== "monument")
  .map(({ index, type }) => ({ level, rotation, typeId: type.id, x: ROW_X[index]!, z }));

/** The harbour needs a reachable shore; the other types place at any rotation. */
const writeIsland = async (page: Page, nation: string, name: string) => {
  let lastError: unknown;
  for (const rotation of [Math.PI / 2, 0, Math.PI, -Math.PI / 2]) {
    try {
      return await writeFlatIslandGame(page, {
        buildings: [...row(1, rotation, LEVEL_LOW_Z), ...row(5, rotation, LEVEL_TOP_Z)],
        cells: CELLS,
        grassGround: true,
        name,
        nation,
        sea: { depth: 3, width: SEA_WIDTH },
        settlers: 30,
        stockAll: 200
      });
    } catch (error) { lastError = error; }
  }
  throw lastError;
};

/** Every finished fixture building counts as occupied, so the night window-glow path is exercised. */
const forceOccupiedWindows = (page: Page) => page.route("**/src/app/settlement/settlement-render-frames.ts*",
  async route => {
    const response = await route.fetch(), source = await response.text();
    const patched = source.replace(
      /frame\.windowLit = building\.construction >= 1 &&\s*\(building\.working \|\| building\.worker !== undefined\);/,
      "frame.windowLit = building.construction >= 1;");
    assert.notEqual(patched, source, "windowLit hook moved");
    await route.fulfill({ body: patched, response });
  });

const setHour = (page: Page, hour: number) => page.evaluate(hour => {
  const { controller } = (window as LiveWindow).__weather;
  const saved = controller.saveState();
  controller.loadState({ ...saved, cycling: false, hour, rain: 0, snow: 0, targetHour: hour, targetRain: 0,
    targetSnow: 0 });
}, hour);

/** Exposes every building root that owns window inserts (diagnostics only). */
const exposeWindowRoots = (page: Page) => page.route("**/src/renderers/three/buildings/three-buildings.ts*",
  async route => {
    const response = await route.fetch(), source = await response.text();
    // Vite serves the transformed module: type assertions and redundant parentheses are stripped.
    const anchor = "const meshes = root.userData.windowMeshes ??= windowMeshesOf(root);";
    assert(source.includes(anchor), "window root hook moved");
    const body = source.replace(anchor, "globalThis.__windowRoots = globalThis.__windowRoots ?? []; " +
      `if (!globalThis.__windowRoots.includes(root)) globalThis.__windowRoots.push(root); ${anchor}`);
    await route.fulfill({ body, response });
  });

const windowDiagnostics = (page: Page) => page.evaluate(() => {
  const roots = (globalThis as unknown as { __windowRoots?: { traverse(fn: (object: any) => void): void }[] })
    .__windowRoots ?? [];
  const windows: unknown[] = [];
  for (const root of roots) root.traverse(object => {
    if (!(object.userData.windowShadow === true || object.userData.openingShadow === true)) return;
    const material = object.material;
    windows.push({ color: material?.color?.getHexString?.(), material: material?.name ?? null,
      opacity: material?.opacity, transparent: material?.transparent, type: material?.type,
      windowLit: object.userData.windowLit,
      windowBase: object.userData.windowBaseMaterial?.name ?? null });
  });
  return windows.slice(0, 12);
});

const openGame = async (browser: Browser, url: string, nation: string,
  renderer: string, errors: string[]): Promise<Page> => {
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: VIEWPORT });
  page.on("pageerror", error => errors.push(`${nation}/${renderer} pageerror ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error" && /shader|tsl|webgpu|THREE/i.test(message.text()))
      errors.push(`${nation}/${renderer} ${message.text().slice(0, 300)}`);
  });
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name = value => value;");
  await exposeWeather(page);
  await forceOccupiedWindows(page);
  if (DIAGNOSE) await exposeWindowRoots(page);
  console.log(`[matrix] ${nation}/${renderer}: fixture island`);
  await openFixturePage(page, url);
  await writeIsland(page, nation, `TSL-9 matrix ${nation}`);
  console.log(`[matrix] ${nation}/${renderer}: loading the game`);
  await page.goto(`${url}?quality=high&cache=0&skipLogin=1&time=day&reveal=1&renderer=${renderer}`);
  await page.waitForFunction(() => (window as LiveWindow).__islandReady === true, null, { timeout: 300_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 300_000 });
  console.log(`[matrix] ${nation}/${renderer}: ready`);
  await page.addStyleTag({ content: HIDE_UI });
  if (renderer !== "webgl") {
    const mode = await page.evaluate(() => (window as LiveWindow).__webgpuSpike?.stats().mode);
    assert.equal(mode, renderer, `${renderer} is not active; the page fell back to WebGL2`);
  }
  return page;
};

const captureView = async (page: Page, folder: string, nation: string, renderer: string, name: string,
  view: { x: number; z: number; zoom: number }, lift: number, time: string, rows: unknown[]) => {
  await centreOn(page, { x: view.x, z: view.z }, view.zoom, lift);
  await settleDecorations(page, 20);
  await page.waitForTimeout(300);
  const file = `${renderer}-${name}-${time}.png`;
  await page.screenshot({ path: resolve(folder, file) });
  rows.push({ file: `${nation}/${file}`, renderer, time, view: name });
};

/** The island's own headquarters is the only one; raise it live for the max-level art. */
const raiseHeadquarters = (page: Page) => page.evaluate(maxLevel => {
  const simulation = (window as LiveWindow).__settlement.simulation;
  const results = [];
  for (let step = 1; step < maxLevel; step++)
    results.push(simulation.debugRaiseBuildingLevel(simulation.headquarters.uid));
  return results.map((result: { ok: boolean; reason?: string }) => result.ok ? "ok" : result.reason);
}, MAX_LEVEL);

/** Review-only: draws a finished fixture building part way through construction. */
const setBuildingConstruction = (page: Page, typeId: number, construction: number) =>
  page.evaluate(({ construction, typeId }) => {
    const buildings = (window as LiveWindow).__settlement.simulation.buildings() as
      { construction: number; typeId: number; uid: number }[];
    const target = buildings.find(building => building.typeId === typeId && building.construction === 1);
    if (target === undefined) return null;
    target.construction = construction;
    return target.uid;
  }, { construction, typeId });

const captureConstruction = async (page: Page, folder: string, nation: string, renderer: string,
  rows: unknown[]) => {
  await setHour(page, 12);
  const workshop = await setBuildingConstruction(page, 17, .55);
  const monument = await setBuildingConstruction(page, 7, .6);
  rows.push({ nation, renderer, construction: { monument, workshop } });
  if (workshop !== null)
    await captureView(page, folder, nation, renderer, "construction-workshop",
      { x: 42, z: 40, zoom: 2.8 }, 2, "day", rows);
  if (monument !== null)
    await captureView(page, folder, nation, renderer, "construction-monument",
      { x: 13, z: 38, zoom: 2.2 }, 4, "day", rows);
};

/** The Nubian residence's front-wall hangings: four frames over a second, same camera. */
const captureClothMotion = async (page: Page, folder: string, nation: string, renderer: string,
  rows: unknown[]) => {
  await setHour(page, 12);
  await centreOn(page, { x: CLOTH_VIEW.x, z: CLOTH_VIEW.z }, CLOTH_VIEW.zoom, 2);
  await settleDecorations(page, 20);
  for (let frame = 0; frame < 4; frame += 1) {
    await page.waitForTimeout(260);
    const file = `${renderer}-cloth-motion-${frame}.png`;
    await page.screenshot({ path: resolve(folder, file) });
    rows.push({ file: `${nation}/${file}`, frame, renderer, time: "day", view: "cloth-motion" });
  }
};

const captureNation = async (browser: Browser, url: string, nation: string,
  renderer: string, errors: string[], rows: unknown[]) => {
  const page = await openGame(browser, url, nation, renderer, errors);
  const folder = resolve(OUT, nation);
  try {
    if (CLOTH_ONLY) {
      await captureClothMotion(page, folder, nation, renderer, rows);
      return;
    }
    for (const { hour, key: time } of HOURS) {
      console.log(`[matrix] ${nation}/${renderer}: ${time} views`);
      await setHour(page, hour);
      for (const view of VIEWS)
        await captureView(page, folder, nation, renderer, view.name, view, view.lift, time, rows);
      if (DIAGNOSE) rows.push({ nation, renderer, time, windows: await windowDiagnostics(page) });
    }
    if (CLOTH_MOTION && nation === "nubian")
      await captureClothMotion(page, folder, nation, renderer, rows);
    const raised = await raiseHeadquarters(page);
    rows.push({ nation, renderer, headquartersLevels: raised });
    for (const { hour, key: time } of HOURS) {
      await setHour(page, hour);
      await captureView(page, folder, nation, renderer, "hq-max", { x: 51, z: 52, zoom: 2.6 }, 2, time, rows);
    }
    if (CONSTRUCTION) await captureConstruction(page, folder, nation, renderer, rows);
    if (renderer !== "webgl") {
      const stats = await page.evaluate(() => (window as LiveWindow).__webgpuSpike?.stats());
      rows.push({ nation, renderer, substitutions: stats?.substitutions, triangles: stats?.triangles });
    }
  } finally {
    await page.close();
  }
};

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const errors: string[] = [], rows: unknown[] = [];
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  try {
    for (const nation of NATIONS) {
      mkdirSync(resolve(OUT, nation), { recursive: true });
      for (const renderer of RENDERERS) {
        try {
          await captureNation(browser, url, nation, renderer, errors, rows);
        } catch (error) {
          errors.push(`${nation}/${renderer}: ${(error as Error).message}`);
        }
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  writeFileSync(resolve(OUT, `matrix-${RENDERERS.join("-")}.json`), JSON.stringify({
    errors, generatedAt: new Date().toISOString(), rows, types: TYPES, views: VIEWS.map(view => view.name)
  }, null, 2));
  console.log(JSON.stringify({ errors: errors.length, out: OUT }));
  if (errors.length) process.exitCode = 1;
};

main().catch(error => {
  console.error((error as Error).stack ?? error);
  process.exitCode = 1;
});
