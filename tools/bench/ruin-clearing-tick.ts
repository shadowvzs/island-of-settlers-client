import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * BD2 perf gate (plan review B8b/c, owner gate todo:161 point 6): tick cost, delivery throughput and ruin path
 * searches on a balance island, timed by the TOOL-4 A/B runner. The simulation modules are imported from the
 * checkout the bench is started in (`process.cwd()`), so the runner can time a base without this file:
 *   npx tsx tools/bench/ab-runner.ts --base <ref> -- "$PWD/tools/bench/ruin-clearing-tick.ts"
 * Scenarios (every run does all three, `SECONDS` simulated seconds each, default 120):
 * - control: 20 settlers and a Big residence site supplied by road; nothing is destroyed. Its hash leaves out
 *   the save `version`, so base and lane must print the same one.
 * - economy: the control plus fifty reachable ruins (a lane clears them three at a time; a base ignores them).
 * - battle: fifty ruins walled off (unreachable) while a building is placed and removed every second.
 */
type Harness = typeof import("./garrison-balance-harness");
type Simulation = ReturnType<Harness["createBalanceSimulation"]>;
interface Modules {
  harness: Harness;
  hash: typeof import("../../src/shared/settlement/settlement-state-hash");
  searches: () => number;
}

const SECONDS = Number(process.env.SECONDS ?? 120);
const BIG_RESIDENCE = 59;
const SMALL_RESIDENCE = 57;
const STEP = .05;
const WALL = { from: 22, to: 36 };

const load = async (): Promise<Modules> => {
  const from = (path: string) => import(pathToFileURL(join(process.cwd(), path)).href);
  const harness = await from("tools/bench/garrison-balance-harness.ts") as Harness;
  const hash = await from("src/shared/settlement/settlement-state-hash.ts") as Modules["hash"];
  try {
    const dispatch = await from("src/shared/settlement/settlement-ruin-dispatch.ts");
    return { harness, hash, searches: dispatch.ruinPathSearches as () => number };
  } catch {
    return { harness, hash, searches: () => -1 };
  }
};

/** Ruins of 1-cell plots loaded through the save (`nextBuilding` moves past their uids). */
const loadRuins = (simulation: Simulation, cells: ReadonlyArray<readonly [number, number]>) => {
  const save = simulation.saveState() as ReturnType<Simulation["saveState"]> & { ruins?: unknown[] };
  const ruins = cells.map(([x, z], index) => ({ access: { x: x + .5, z: z + 1.5 }, depth: 1, owner: 0, rotation: 0,
    salvage: { planks: 1 }, typeId: SMALL_RESIDENCE, uid: save.nextBuilding + index, width: 1, x: x + .5, z: z + .5 }));
  const result = simulation.loadState({ ...save, nextBuilding: save.nextBuilding + cells.length, ruins });
  if (!result.ok) throw new Error(result.reason);
};
const grid = (left: number, top: number, columns: number, step: number, rowStep: number) =>
  Array.from({ length: 50 }, (_, index) =>
    [left + index % columns * step, top + Math.floor(index / columns) * rowStep] as const);

const island = (modules: Modules) => {
  let world: { cellsX: number; walkCost: Uint8Array } | undefined;
  const { roads, simulation } = modules.harness.createBalanceSettlement(64, 9, { x: 12.5, z: 12.5 },
    shaped => { world = shaped; }, { initialSettlers: 20 });
  return { roads, simulation, world: world! };
};

const units = (goods: Readonly<Record<string, number>> | undefined) =>
  Object.values(goods ?? {}).reduce((sum, count) => sum + count, 0);
/** Materials delivered to the site so far (waiting and built in). */
const delivered = (simulation: Simulation, site: number) => {
  const building = simulation.buildings().find(entry => entry.uid === site);
  return units(building?.input) + units(building?.constructionConsumed);
};

/** Runs the island tick by tick: average and p95 tick ms and the second its site had every material. */
const run = (simulation: Simulation, site: { required: number; uid: number } | undefined,
  each: (second: number) => void) => {
  const ticks: number[] = [];
  let deliveredAt = -1;
  for (let second = 0; second < SECONDS; second++) {
    each(second);
    for (let tick = 0; tick < 1 / STEP; tick++) {
      const started = performance.now();
      simulation.update(STEP);
      ticks.push(performance.now() - started);
    }
    if (deliveredAt < 0 && site && delivered(simulation, site.uid) >= site.required) deliveredAt = second + 1;
  }
  const sorted = [...ticks].sort((a, b) => a - b);
  const tickAvg = ticks.reduce((sum, value) => sum + value, 0) / ticks.length;
  return { deliveredAt, tickAvg, tickP95: sorted[Math.floor(sorted.length * .95)]! };
};

const economy = (modules: Modules, ruins: boolean) => {
  const { roads, simulation } = island(modules);
  if (ruins) loadRuins(simulation, grid(34, 4, 10, 2, 3));
  const site = simulation.placeBuilding(BIG_RESIDENCE, 20, 24);
  if (!site.ok || !site.building) throw new Error(site.reason);
  roads.addRoad(simulation.headquarters.access, site.building.access);
  const searches = modules.searches();
  const result = run(simulation, { required: units(site.building.required), uid: site.building.uid }, () => undefined);
  const { version: _version, ...save } = simulation.saveState();
  return { ...result, hash: modules.hash.hashText(modules.hash.canonicalJson(save)),
    searches: modules.searches() - searches };
};

const battle = (modules: Modules) => {
  const { simulation, world } = island(modules);
  for (let z = WALL.from; z <= WALL.to; z++) for (let x = WALL.from; x <= WALL.to; x++)
    if ([WALL.from, WALL.to].includes(x) || [WALL.from, WALL.to].includes(z)) world.walkCost[z * world.cellsX + x] = 0;
  loadRuins(simulation, grid(24, 24, 10, 1, 2));
  const searches = modules.searches();
  const result = run(simulation, undefined, () => {
    const placed = simulation.placeBuilding(SMALL_RESIDENCE, 8, 30);
    simulation.update(STEP);
    if (placed.ok && placed.building) simulation.demolishBuilding(placed.building.uid);
  });
  return { tickAvg: result.tickAvg, tickP95: result.tickP95, searches: modules.searches() - searches };
};

const main = async () => {
  const modules = await load();
  const record = { battle: battle(modules), control: economy(modules, false), economy: economy(modules, true) };
  for (const [name, values] of Object.entries(record))
    console.log(name, Object.entries(values).map(([key, value]) =>
      `${key} ${typeof value === "number" ? Number(value.toFixed(4)) : value}`).join(", "));
  const { emitBenchJson } = await import(pathToFileURL(join(process.cwd(), "tools/bench/bench-json.ts")).href);
  emitBenchJson(record);
};
void main();
