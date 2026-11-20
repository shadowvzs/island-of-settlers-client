import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { WorkerNation } from "../../src/render-common/workers/worker-unit";
import { launchBrowser, startDevServer } from "./browser";

/** Actual game: garrisoned soldiers show on archer posts and at windows of each military building. */
const MILITARY = [1, 2, 4, 9];
const ALL_NATIONS = ["roman", "viking", "nubian", "japanese", "chinese", "persian", "maya", "indigenous"];
const NATIONS = process.env.NATIONS?.split(",") ?? ALL_NATIONS;
/** Screenshot file prefix: `before` captures run this tool from a checkout of the previous commit. */
const PREFIX = process.env.PREFIX ?? "after";
/** Rank of every received troop (0 recruit, 1 soldier, 2 centurion); 2 shows the crest exceptions. */
const TROOP_RANK = Number(process.env.RANK ?? 1);
/** Normal iso view of every plot; each garrisoned window also gets a horizontal front view. */
const ISO_VIEW = { name: "iso", tilt: 0, yaw: 0, zoom: 2.2 } as const;
/** Garrison stand-ins load their bodies asynchronously after the camera arrives. */
const SETTLE_MS = 2000;
/** Later camera angles keep the loaded bodies; only the view moves. */
const VIEW_MS = 250;
/** Horizontal distance in front of the window (2–4 m, per the owner's review request). */
const FRONT_DISTANCE = 2.6;
const FRONT_FOV = 32;
/** Oblique front-camera offset in degrees (0 = straight on; used to inspect depth in review). */
const FRONT_OFFSET = Number(process.env.FRONT_YAW ?? 0) * Math.PI / 180;
const output = resolve(process.env.OUT ?? "../resources/settlement-previews/garrison-view");
mkdirSync(output, { recursive: true });
type Page = Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>;

interface Plot { rotation: number; type: number; uid: number; x: number; y: number; z: number }
interface WindowShot {
  index: number; position: [number, number, number]; target: [number, number, number]; type: number;
}
/** Horizontal review camera: the game camera rig is replaced while `__reviewCamera` is set. */
const REVIEW_CAMERA_MARKER = "const update = (state) => {";
const reviewCameraSource = (source: string) => {
  assert(source.includes(REVIEW_CAMERA_MARKER), "three-camera rig hook");
  return source.replace(REVIEW_CAMERA_MARKER, `${REVIEW_CAMERA_MARKER}
    const review = globalThis.__reviewCamera;
    if (review) {
      cinematic.fov = review.fov ?? ${FRONT_FOV};
      cinematic.aspect = state.viewportWidth / state.viewportHeight;
      cinematic.position.set(review.position[0], review.position[1], review.position[2]);
      cinematic.lookAt(review.target[0], review.target[1], review.target[2]);
      cinematic.near = .05; cinematic.far = 500;
      cinematic.updateProjectionMatrix(); cinematic.updateMatrixWorld(true);
      return cinematic;
    }`);
};

const routeSource = async (page: Page, path: string, transform: (source: string) => string) => {
  await page.route(`**/${path}*`, async route => {
    const response = await route.fetch(), source = await response.text();
    await route.fulfill({ response, body: transform(source) });
  });
};

const installReviewCamera = (page: Page) =>
  routeSource(page, "src/renderers/three/three-camera.ts", reviewCameraSource);

/** Windows whose slots are actually manned, with the review camera pose in front of each. */
const buildFixture = async (page: Page, nation: string, detailed: boolean) => {
  return await page.evaluate(async ({ buildings, detailed, distance, frontOffset, nation, rank }) => {
    const imp = (path: string) => import(/* @vite-ignore */ path);
    const { DEFAULT_WORLD_OPTIONS, generateWorld } = await imp("/src/shared/world/generation/generate-world.ts");
    const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
    const {
      assignGarrisonSlots, garrisonSlots, garrisonWindowFrame, placeGarrisonSlot
    } = await imp("/src/render-common/buildings/military-garrison-slots.ts");
    const { GARRISON_HEAD_REACH } = await imp("/src/render-common/buildings/military-window-slots.ts");
    const { createGameSave } = await imp("/src/shared/settlement/game-save.ts");
    const { createRoadNetwork } = await imp("/src/shared/settlement/road-network.ts");
    const { createSettlementSimulation } = await imp("/src/shared/settlement/settlement-simulation.ts");
    const { openLocalSaveStore } = await imp("/src/app/save-store/local-save-store.ts");
    const { settingsStorage } = await imp("/src/app/settings/graphics-settings.ts");
    settingsStorage.writeFog(false);
    const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 100, seed: 1234 });
    world.heights.fill(1); world.blocking.fill(0); world.walkCost.fill(10);
    world.buildClass.fill(4); world.buildCap.fill(4); world.slopeClass.fill(0);
    world.start = { x: 48.5, z: 48.5 }; world.props.count = 0;
    let simulation: any;
    const roads = createRoadNetwork(world,
      { isBlocked: (x: number, z: number) => simulation?.isOccupied(x, z) ?? false });
    simulation = createSettlementSimulation({ initialSettlers: 30,
      initialStock: { cloth: 80, coins: 40, planks: 80, stone: 80 }, playerNation: nation, roads, world });
    const plots: any[] = [];
    buildings.forEach((type: number, index: number) => {
      const [width, depth] = getBuildingDefinition(type).gridFootprint;
      const x = 26 + index * 14 + width % 2 / 2, z = 70 + depth % 2 / 2;
      const result = simulation.placeBuilding(type, x, z, 0);
      if (!result.ok) throw new Error(`${type}: ${result.reason}`);
      Object.assign(result.building, { construction: 1, foundationProgress: 1, required: {} });
      plots.push({ access: result.building.access, rotation: result.building.rotation, type, uid: result.building.uid,
        x, y: result.building.y, z });
    });
    for (const plot of plots)
      if (!simulation.connectRoads(simulation.headquarters.access, plot.access)) throw new Error("road");
    simulation.receiveTroops(Array.from({ length: 24 }, (_, index) => {
      const type = ["archer", "shield", "archer", "heavy"][index % 4];
      return { hp: 999, rank, type };
    }));
    for (let tick = 0; tick < 12000; tick++) simulation.update(.05);
    const stationed = simulation.militarySoldiers().filter((soldier: any) => soldier.stationed);
    const windows: any[] = [];
    for (const plot of plots) {
      const building = { rotation: plot.rotation, x: plot.x, y: plot.y, z: plot.z };
      const garrison = stationed.filter((soldier: any) => soldier.building === plot.uid);
      let index = 0;
      for (const { slot } of assignGarrisonSlots(garrisonSlots(plot.type, nation, detailed), garrison)) {
        if (slot.kind !== "window") continue;
        const frame = garrisonWindowFrame(slot)!;
        const at = placeGarrisonSlot(slot, building);
        const outwardX = Math.sin(at.yaw), outwardZ = Math.cos(at.yaw);
        const headReach = Math.sin(slot.lean) * GARRISON_HEAD_REACH;
        const target: [number, number, number] = [at.x + outwardX * headReach,
          plot.y + (frame.sill + frame.lintel) / 2, at.z + outwardZ * headReach];
        const viewYaw = at.yaw + frontOffset;
        windows.push({ index,
          position: [target[0] + Math.sin(viewYaw) * distance, target[1],
            target[2] + Math.cos(viewYaw) * distance],
          target, type: plot.type });
        index++;
      }
    }
    const saved = await createGameSave(world, simulation.saveState(),
      { animals: [], name: "Garrison view", savedAt: 123, source: "generated" });
    await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(saved));
    return {
      plots: plots.map(plot => ({ rotation: plot.rotation, type: plot.type, uid: plot.uid, x: plot.x, y: plot.y,
        z: plot.z })),
      stationed: plots.map(plot => stationed.filter((soldier: any) => soldier.building === plot.uid).length),
      windows
    };
  }, { buildings: MILITARY, detailed, distance: FRONT_DISTANCE, frontOffset: FRONT_OFFSET, nation, rank: TROOP_RANK });
};

/** Screenshot one plot: the normal iso view, then a straight-on front view of each manned window. */
const capturePlot = async (page: Page, nation: string, quality: string, plot: Plot, windows: readonly WindowShot[]) => {
  await page.evaluate(({ tilt, x, yaw, z, zoom }) => {
    delete (window as any).__reviewCamera;
    Object.assign((window as any).__garrisonReview.camera, { centerX: x, centerZ: z - 1, tilt, yaw, zoom });
  }, { ...plot, ...ISO_VIEW });
  await page.waitForTimeout(VIEW_MS);
  await page.screenshot({ path: resolve(output, `${PREFIX}-${nation}-${quality}-${plot.type}-iso.png`) });
  for (const shot of windows) {
    await page.evaluate(({ fov, position, target }) => {
      (window as any).__reviewCamera = { fov, position, target };
    }, { fov: FRONT_FOV, position: shot.position, target: shot.target });
    await page.waitForTimeout(VIEW_MS);
    await page.screenshot({ path: resolve(output,
      `${PREFIX}-${nation}-${quality}-${plot.type}-w${shot.index}.png`) });
  }
};

/** Opens the watchtower panel (garrison counts), then lets its archers shoot at enemies beyond the walls. */
const reviewPanelAndFire = async (page: Page, plots: readonly Plot[]) => {
  const tower = plots.find(plot => plot.type === 4)!;
  await page.evaluate(({ x, z }) => {
    delete (window as any).__reviewCamera;
    Object.assign((window as any).__garrisonReview.camera, { centerX: x, centerZ: z + 3, tilt: 0, yaw: 0, zoom: 1.6 });
  }, tower);
  await page.waitForTimeout(800);
  const point = await page.evaluate(({ x, z }) => (window as any).__settlement.projectGround(x, z), tower);
  await page.mouse.click(point.x, point.y);
  await page.locator(".settlement-ui__garrison").waitFor({ timeout: 10000 });
  await page.screenshot({ path: resolve(output, "panel-watchtower.png") });
  await page.locator('button[aria-label^="Close"]:visible').first().click();
  const spawned = await page.evaluate(({ x, z }) => {
    const simulation = (window as any).__settlement.simulation;
    return [-1.5, 0, 1.5].map(offset => simulation.spawnMilitaryOpponent({ x: x + offset, z: z + 7 }, "shield"));
  }, tower);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(output, "fire-watchtower.png") });
  const fight = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    return { arrows: simulation.militaryArrows().length, deaths: simulation.militaryDeaths().length };
  });
  console.log(JSON.stringify({ fight, spawned }));
  await page.waitForFunction(() => (window as any).__settlement.simulation.militaryDeaths().length > 0, null,
    { timeout: 60000 });
  const death = await page.evaluate(() => (window as any).__settlement.simulation.militaryDeaths()[0]);
  await page.evaluate(({ x, z }) => Object.assign((window as any).__garrisonReview.camera,
    { centerX: x, centerZ: z, tilt: 0, yaw: 0, zoom: 2.6 }), death);
  for (const step of [0, 1, 2, 3]) {
    await page.screenshot({ path: resolve(output, `death-${step}.png`) });
    await page.waitForTimeout(250);
  }
  assert(spawned.every((id: number | null) => id !== null), "enemies spawned beyond the walls");
};

/** The per-slot intersection table (skipped in a checkout that predates the audit). */
const windowTable = process.env.AUDIT === "0" ? [] :
  (await import("./window-soldier-audit")).windowSoldierAudit(NATIONS as WorkerNation[]);
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const nation of NATIONS) for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    // Same soldier variants before and after: a seeded generator replaces Math.random.
    await page.addInitScript(`window.__name=value=>value; 
      Math.random = (() => { let seed = 0x9e3779b9; return () => {
        seed |= 0; seed = seed + 0x6d2b79f5 | 0;
        let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
        value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
      }; })();`);
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/garrison-fixture.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
    await installReviewCamera(page);
    await page.goto(`${url}garrison-fixture.html`);
    const fixture = await buildFixture(page, nation, quality === "high");
    assert(fixture.stationed.every((count: number) => count > 0), `${nation}: every military building is manned`);
    await page.route("**/src/app/island-runtime.ts", async route => {
      const response = await route.fetch(), source = await response.text();
      await route.fulfill({ response, body: source.replace("window.__islandReady = true",
        "window.__garrisonReview = { camera }; window.__islandReady = true") });
    });
    await page.goto(`${url}?quality=${quality}`);
    try {
      await page.waitForFunction(() => Boolean((window as any).__garrisonReview), null, { timeout: 180000 });
    } catch (error) {
      console.log("page errors", errors);
      await page.screenshot({ path: resolve(output, `failed-${nation}-${quality}.png`) });
      throw error;
    }
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    await page.waitForTimeout(SETTLE_MS);
    for (const plot of fixture.plots) {
      const windows = fixture.windows.filter(window => window.type === plot.type);
      await capturePlot(page, nation, quality, plot, windows);
    }
    if (process.env.PANEL !== "0" && nation === "roman" && quality === "high")
      await reviewPanelAndFire(page, fixture.plots);
    reports.push({ errors, nation, quality, stationed: fixture.stationed });
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  writeFileSync(resolve(output, "window-table.json"), JSON.stringify(windowTable, null, 2));
} finally { await browser.close(); await server.close(); }
const intersections = windowTable.filter((row: { intersects: boolean }) => row.intersects);
console.log(JSON.stringify({ intersections: intersections.length, reports,
  windowRows: windowTable.length }));
