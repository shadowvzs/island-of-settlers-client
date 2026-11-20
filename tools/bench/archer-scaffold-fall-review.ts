import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

/**
 * Native review of an archer scaffold assault (owner request 2026-10-22): player melee strike the
 * supports of an occupied open scaffold, it collapses and its archer falls beside the ruin and
 * fights on foot. The simulation is paused between shots, so the 0.8 s fall is caught mid-air.
 * Frames: `<quality>-<step>[-gameplay].png`. Run: `npx tsx tools/bench/archer-scaffold-fall-review.ts`.
 */
type Page = import("playwright-core").Page;
interface Scene { scaffold: number; x: number; z: number }

const output = resourcesPath("military-2026-10-22", "scaffold");
mkdirSync(output, { recursive: true });
const CLOSE_ZOOM = 2.4, GAMEPLAY_ZOOM = 1.2;

/** A flat island: a hostile open scaffold with one archer, eight player melee soldiers nearby. */
const authorScene = (page: Page) => page.evaluate(async () => {
  const load = (path: string) => import(/* @vite-ignore */ String(path));
  const { DEFAULT_WORLD_OPTIONS, generateWorld } = await load("/src/shared/world/generation/generate-world.ts");
  const { createGameSave } = await load("/src/shared/settlement/game-save.ts");
  const { createRoadNetwork } = await load("/src/shared/settlement/road-network.ts");
  const { createSettlementSimulation } = await load("/src/shared/settlement/settlement-simulation.ts");
  const { openLocalSaveStore } = await load("/src/app/save-store/local-save-store.ts");
  const { settingsStorage } = await load("/src/app/settings/graphics-settings.ts");
  const { getBuildingDefinition } = await load("/src/render-common/buildings/building-catalog.ts");
  const { ARCHER_SCAFFOLD_SITE: scaffold, placedBanditCamp } =
    await load("/src/render-common/buildings/bandit-camp-plan.ts");
  const { siteStructure } = await load("/src/shared/settlement/fort-assault-rules.ts");
  const { militaryHealth } = await load("/src/shared/settlement/military-combat-rules.ts");
  settingsStorage.writeFog(false);
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 100, seed: 1234 });
  world.heights.fill(1); world.blocking.fill(0); world.walkCost.fill(10); world.buildClass.fill(4);
  world.buildCap.fill(4); world.slopeClass.fill(0); world.props.count = 0;
  let simulation: any;
  const roads = createRoadNetwork(world, { isBlocked: (x: number, z: number) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 30, initialStock: { planks: 40, stone: 40 } });
  const home = simulation.headquarters, x = Math.floor(home.x) + 14, z = Math.floor(home.z);
  const troops = Array.from({ length: 8 }, (_, index) => index < 4 ? "heavy" : "shield");
  simulation.receiveTroops(troops.map(type => ({ type, rank: 0, hp: militaryHealth(type, 0) })));
  simulation.callOutMilitary(["heavy", "shield"], { x: x - 11, z });
  for (let second = 0; second < 90; second++) simulation.update(1);
  const [width, depth] = getBuildingDefinition(4).gridFootprint;
  const placed = simulation.placeBuilding(4, x + (width % 2) / 2, z + (depth % 2) / 2);
  if (!placed.ok) throw new Error(placed.reason);
  const saved = simulation.saveState(), site = saved.buildings.find((entry: any) => entry.uid === placed.building.uid);
  Object.assign(site, { x, z, bandit: scaffold, militaryFaction: 1, construction: 1, foundationProgress: 1,
    required: {}, hasDoor: false }, placedBanditCamp(scaffold, x, z));
  // The watchtower plot claimed more cells than the 2 × 2 scaffold holds.
  for (let row = z - 5; row < z + 5; row++) for (let column = x - 5; column < x + 5; column++)
    saved.occupied[row * world.cellsX + column] = Math.abs(column + .5 - x) < 1 && Math.abs(row + .5 - z) < 1 ? 1 : 0;
  const structure = siteStructure(site);
  saved.military.combat.doors.push({ building: site.uid, faction: 1, hp: 200, maximum: 200, structure });
  const loaded = simulation.loadState(saved);
  if (!loaded.ok) throw new Error(loaded.reason);
  const archer = simulation.spawnMilitaryOpponent({ x: x + 4, z: z + 4 }, "archer", 0);
  if (!simulation.registerMilitaryGarrison(site.uid, [archer], 1, 200, structure)) throw new Error("No garrison");
  const game = await createGameSave(world, simulation.saveState(),
    { name: "Archer scaffold review", source: "generated", savedAt: Date.now(), animals: [] });
  const storage = await openLocalSaveStore();
  await storage.writeStartupGame(JSON.stringify(game));
  return { scaffold: site.uid as number, x, z };
});

/** Stops the live loop's simulation steps: the review steps the game itself between shots. */
const pauseAndSiege = (page: Page, scene: Scene) => page.evaluate(({ scaffold }) => {
  const simulation = (window as any).__settlement.simulation;
  (window as any).__step = simulation.update.bind(simulation);
  simulation.update = () => {};
  const ours = simulation.militarySoldiers().filter((soldier: any) => soldier.combat?.faction === 0)
    .map((soldier: any) => soldier.actor);
  if (!simulation.siegeMilitary(ours, scaffold)) throw new Error("Scaffold siege rejected");
}, scene);

type Moment = "damaged" | "fighting" | "landed" | "midFall";

/** Steps until the scene reaches `moment` (or `limit` game seconds); returns the seconds stepped. */
const stepUntil = (page: Page, scene: Scene, moment: Moment, limit: number) =>
  page.evaluate(({ cap, scaffold, target }) => {
    const simulation = (window as any).__settlement.simulation, step = (window as any).__step;
    const archer = () => simulation.militarySoldiers().find((soldier: any) => soldier.combat?.faction === 1);
    const structure = () => simulation.militaryDoors().find((door: any) => door.building === scaffold).structure;
    const reached = () => {
      if (target === "damaged") return structure().hp < structure().maximum * .8;
      if (target === "midFall") return archer()?.combat?.towerFall?.remaining < .5;
      if (target === "landed") return !archer()?.combat?.towerFall;
      return !archer() || archer().combat.attackTime > 0;
    };
    let ticks = 0;
    for (; ticks < cap * 20 && !reached(); ticks++) step(.05);
    return ticks / 20;
  }, { cap: limit, scaffold: scene.scaffold, target: moment });

const shot = async (page: Page, scene: Scene, quality: string, name: string, gameplay = false) => {
  const view = (zoom: number) => page.evaluate(({ x, z, zoom: level }) =>
    (window as any).__settlement.focusGround(x, z - 1.5, level), { ...scene, zoom });
  await view(CLOSE_ZOOM); await page.waitForTimeout(600);
  await page.screenshot({ path: `${output}/${quality}-${name}.png` });
  if (!gameplay) return;
  await view(GAMEPLAY_ZOOM); await page.waitForTimeout(600);
  await page.screenshot({ path: `${output}/${quality}-${name}-gameplay.png` });
};

const reviewQuality = async (browser: Awaited<ReturnType<typeof launchBrowser>>, url: string, quality: string) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/archer-scaffold-fixture.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.goto(`${url}archer-scaffold-fixture.html`);
  const scene = await authorScene(page);
  await page.goto(`${url}?quality=${quality}&view=${scene.x},${scene.z + 1},${CLOSE_ZOOM}`);
  page.on("console", message => message.type() === "error" && console.log("console", message.text().slice(0, 300)));
  await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: 60000 }).catch(async error => {
    await page.screenshot({ path: `${output}/${quality}-failure.png` }); console.log(errors); throw error; });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  await pauseAndSiege(page, scene);
  const report: Record<string, unknown> = { quality };
  report.toSupports = await stepUntil(page, scene, "damaged", 60);
  await shot(page, scene, quality, "1-melee-strike-occupied", true);
  report.toFall = await stepUntil(page, scene, "midFall", 120);
  await shot(page, scene, quality, "2-archer-falling", true);
  report.landing = await stepUntil(page, scene, "landed", 2);
  await shot(page, scene, quality, "3-landed");
  report.fight = await stepUntil(page, scene, "fighting", 15);
  report.state = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation, actors = simulation.snapshot().actors;
    return simulation.militarySoldiers().map((soldier: any) => {
      const body = actors.find((actor: any) => actor.uid === soldier.actor);
      return { action: body?.action, faction: soldier.combat?.faction, hp: soldier.combat?.hp, phase: body?.phase,
        siege: soldier.combat?.siege, target: soldier.combat?.target, x: body?.x, z: body?.z };
    });
  });
  await shot(page, scene, quality, "4-close-fight", true);
  report.errors = errors;
  assert.deepEqual(errors, []);
  await page.close();
  return report;
};

const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) reports.push(await reviewQuality(browser, url, quality));
} finally {
  writeFileSync(`${output}/review.json`, JSON.stringify(reports, null, 2));
  await browser.close();
  await server.close();
}
console.log(JSON.stringify(reports));
