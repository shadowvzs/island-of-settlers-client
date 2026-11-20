import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Actual game: a Tavern per nation (High and Minimal), its recruiting panel and every troop type
 * recruited with stock present and refused without. OUT_DIR overrides the output folder.
 */
const NATIONS = process.env.NATIONS?.split(",") ?? ["roman", "viking", "nubian", "japanese"];
const QUALITIES = process.env.QUALITIES?.split(",") ?? ["high", "minimal"];
const output = resolve(process.env.OUT_DIR ?? "../resources/tavern-2026-10-12");
mkdirSync(output, { recursive: true });
type Page = Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>["newPage"]>>;
type Plot = { uid: number; x: number; z: number };

/** Flat island with a completed, staffed Tavern and stock for one recruit of every type. */
const createFixture = (page: Page, nation: string) => page.evaluate(async nation => {
  const imp = (path: string) => import(/* @vite-ignore */ path);
  const { DEFAULT_WORLD_OPTIONS, generateWorld } = await imp("/src/shared/world/generation/generate-world.ts");
  const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
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
  const roads = createRoadNetwork(world, { isBlocked: (x: number, z: number) => simulation?.isOccupied(x, z) ?? false });
  const kit = { armor: 4, axe: 1, beer: 4, bow: 1, shield: 2, sword: 2 };
  simulation = createSettlementSimulation({ initialSettlers: 30, initialStock: { ...kit, planks: 80, stone: 80 },
    playerNation: nation, roads, world });
  const [width, depth] = getBuildingDefinition(40).gridFootprint;
  const x = 56 + width % 2 / 2, z = 56 + depth % 2 / 2;
  const result = simulation.placeBuilding(40, x, z, 0);
  if (!result.ok) throw new Error(result.reason);
  Object.assign(result.building, { construction: 1, foundationProgress: 1, required: {} });
  if (!simulation.connectRoads(simulation.headquarters.access, result.building.access)) throw new Error("road");
  // One stored horse for the cavalry recruit.
  const home = simulation.headquarters;
  simulation.frames().push({ uid: -1, ...home.doorThreshold, y: home.y, yaw: 0, visible: false, job: "Mount",
    action: "idle", ware: null, phase: "horseStored", building: home.uid, home: home.uid, path: [], pathIndex: 0,
    timer: 0, animationTime: 0 });
  home.inventory.horse = 1;
  for (let tick = 0; tick < 1200; tick++) simulation.update(.05);
  const saved = await createGameSave(world, simulation.saveState(),
    { animals: [], name: "Tavern review", savedAt: 123, source: "generated" });
  await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(saved));
  return { uid: result.building.uid, x, z };
}, nation);

const openGame = async (page: Page, base: string, quality: string) => {
  await page.route("**/src/app/main.ts", async route => {
    const response = await route.fetch(), source = await response.text();
    await route.fulfill({ response, body: source.replace("window.__islandReady = true",
      "window.__tavernReview = { camera }; window.__islandReady = true") });
  });
  await page.goto(`${base}?quality=${quality}`);
  await page.waitForFunction(() => Boolean((window as any).__tavernReview), null, { timeout: 180000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
};

const look = (page: Page, point: { x: number; z: number }, zoom: number, yaw = 0, tilt = 0) =>
  page.evaluate(({ point, tilt, yaw, zoom }) => Object.assign((window as any).__tavernReview.camera,
    { centerX: point.x, centerZ: point.z, tilt, yaw, zoom }), { point, tilt, yaw, zoom });

const shot = async (page: Page, name: string, settle = 1500) => {
  await page.waitForTimeout(settle);
  await page.screenshot({ path: resolve(output, `${name}.png`) });
};

/** Runs the simulation in the page until `done` (a stringified predicate on the simulation) holds. */
const fastForward = (page: Page, done: string, seconds: number) => page.evaluate(({ done, seconds }) => {
  const simulation = (window as any).__settlement.simulation;
  // Intentional: the review passes its completion check as a string expression (dev tool only).
  // oxlint-disable-next-line typescript/no-implied-eval
  const test = new Function("simulation", `return ${done};`) as (value: unknown) => boolean;
  for (let tick = 0; tick < seconds * 20 && !test(simulation); tick++) simulation.update(.05);
  return test(simulation);
}, { done, seconds });

const reserves = `simulation.militarySoldiers().filter(s => simulation.frames().find(a => a.uid === s.actor)?.phase === "militaryReserve")`;

const openTavern = async (page: Page, plot: Plot) => {
  await look(page, { x: plot.x, z: plot.z + 2 }, 1.8);
  await page.waitForTimeout(800);
  const point = await page.evaluate(({ x, z }) => (window as any).__settlement.projectGround(x, z), plot);
  await page.mouse.click(point.x, point.y);
  await page.locator(".settlement-ui__tavern").waitFor({ timeout: 10000 });
};

const toastText = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll<HTMLElement>(".settlement-ui__status")]
    .map(element => element.textContent ?? "").join(" | "));

/** Recruiting: a refused order, then every troop type with its ingredients present. */
const reviewRecruiting = async (page: Page, plot: Plot, report: Record<string, unknown>) => {
  await openTavern(page, plot);
  await shot(page, "panel-recruit", 600);
  // Refused: the axeman needs armour, which is taken away for the moment.
  const armour = await page.evaluate(() => {
    const hq = (window as any).__settlement.simulation.headquarters, count = hq.inventory.armor;
    hq.inventory.armor = 0; return count;
  });
  await page.locator('[data-tavern-troop="heavy"]').click();
  await page.locator("[data-tavern-order]").click();
  report.refused = await toastText(page);
  await shot(page, "recruit-refused", 400);
  await page.evaluate(count => { (window as any).__settlement.simulation.headquarters.inventory.armor = count; }, armour);
  // Cavalry first: once deliveries start, the stored horse may be out working as a mount.
  for (const type of ["cavalry", "shield", "heavy", "archer"]) {
    await page.locator(`[data-tavern-troop="${type}"]`).click();
    await page.locator("[data-tavern-order]").click();
    await page.waitForTimeout(150);
  }
  report.ordered = await page.evaluate(() => (window as any).__settlement.simulation.tavernOrders());
  await page.locator('button[aria-label^="Close"]:visible').first().click();
  // Carriers bring the equipment: the delivered wares lie on the yard bench.
  report.delivered = await fastForward(page, `Object.values(simulation.buildings().find(b => b.uid === ${plot.uid})` +
    ".input).reduce((sum, count) => sum + count, 0) >= 3", 240);
  await look(page, { x: plot.x + 1, z: plot.z + 1 }, 2.6, 0.3, 0.1);
  await shot(page, "recruit-delivery");
  report.recruited = await fastForward(page, `${reserves}.length >= 4`, 900);
  report.troops = await page.evaluate(() => (window as any).__settlement.simulation.militarySoldiers()
    .map((soldier: any) => soldier.combat?.type));
  report.stock = await page.evaluate(() => ({ ...(window as any).__settlement.simulation.headquarters.inventory }));
};

const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const nation of NATIONS) for (const quality of QUALITIES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/tavern-fixture.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
    await page.goto(`${url}tavern-fixture.html`);
    const plot = await createFixture(page, nation);
    await openGame(page, url, quality);
    const report: Record<string, unknown> = { nation, quality };
    await look(page, { x: plot.x, z: plot.z }, 2.4, 0.35, 0.1);
    await shot(page, `${nation}-${quality}-close`, 2500);
    await look(page, { x: plot.x, z: plot.z }, 1.2, -0.5, 0);
    await shot(page, `${nation}-${quality}-gameplay`, 1500);
    if (nation === "roman" && quality === "high") await reviewRecruiting(page, plot, report);
    report.errors = errors;
    reports.push(report);
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
} finally { await browser.close(); await server.close(); }
console.log(JSON.stringify(reports));
