import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { plotCacheWork, setPlotCacheStrict } from "../src/shared/settlement/economy-ai/plot-cache";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { WorldData } from "../src/shared/world/world-data";
import { economyCampaignScenario } from "./helpers/economy-factions";
import { huntingWorld, plantForestEdge } from "./helpers/hunting-world";

/**
 * EAI3b: the `develop` build planner on the candidate plot cache, run by the EAI2a loop for EAI3a's committed goals
 * (the balanced program starts with two woodcutters). Strict mode is on for the whole file: every planner decision
 * also rebuilds the cache from scratch with the direct pre-check and throws on any difference.
 */
type Simulation = ReturnType<typeof createSettlementSimulation>;
const AI = 2;
const WOODCUTTER = 17;
const GUARDHOUSE = 2;
const TIMEOUT = 300_000;
const STOCK = { axe: 2, hammer: 3, logs: 40, planks: 60, pickaxe: 1, saw: 1, stone: 40 };

/** Faction 2 plays `develop` with a stocked depot in the east of a flat 64² island; the player's HQ is at (10, 10). */
const developIsland = (shape?: (world: WorldData) => void) => {
  const world = huntingWorld();
  plantForestEdge(world);
  shape?.(world);
  world.scenario = economyCampaignScenario([AI], "develop");
  // Roads route round buildings, as on a live island (`island-settlement.ts`).
  let simulation: Simulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 0, initialSettlers: 8,
    roads, world });
  const depot = simulation.aiPlace(AI, { typeId: 0, x: 47, z: 46 }, { settlers: 8,
    soldiers: [{ count: 4, rank: 0, type: "shield" }], stock: STOCK }).building!;
  expect(depot).toBeDefined();
  return { depot, roads, simulation, world };
};

const aiBuildings = (simulation: Simulation, typeId: number) =>
  simulation.buildings().filter(building => building.typeId === typeId && building.militaryFaction === AI);
const plannerOf = (simulation: Simulation) =>
  simulation.saveState().factionAi?.find(entry => entry.faction === AI)?.planner;
/** What the planner decides: the faction's sites, its AI state and the road network. */
const plannerResults = (simulation: Simulation) => {
  const { factionAi, roads } = simulation.saveState();
  const sites = simulation.buildings().filter(building => building.militaryFaction === AI)
    .map(({ rotation, typeId, uid, x, z }) => ({ rotation, typeId, uid, x, z }));
  return { factionAi, roads, sites };
};
/** Runs whole ticks until the island reaches `tick`. */
const runTicks = (simulation: Simulation, tick: number) => {
  while (simulation.tickCount() < tick) simulation.update(.05);
};

let previousStrict = false;
beforeAll(() => { previousStrict = setPlotCacheStrict(true); });
afterAll(() => { setPlotCacheStrict(previousStrict); });

describe("economy AI build planner (EAI3b)", () => {
  it("places the committed goal one site per decision from the faction's stock, joined to its road network", () => {
    const { depot, roads, simulation } = developIsland();
    const playerStock = { ...simulation.headquarters.inventory };
    runTicks(simulation, 600);
    const sites = aiBuildings(simulation, WOODCUTTER);
    expect(sites).toHaveLength(2);
    expect(simulation.headquarters.inventory).toEqual(playerStock);
    for (const site of sites) expect(roads.route(depot.access, site.access)).not.toBeNull();
  }, TIMEOUT);

  it("keeps the cache equal to a rebuild through territory, building, ruin and terrain changes", () => {
    const { depot, simulation } = developIsland();
    const work = { ...plotCacheWork };
    runTicks(simulation, 600);
    // A guardhouse garrisoned from the depot's reserve adds a territory source (a full rebuild).
    const guardhouse = simulation.aiPlace(AI, { typeId: GUARDHOUSE, x: 30.5, z: 50 }, {}).building!;
    expect(simulation.connectFactionRoads(AI, depot.access, guardhouse.access)).toBeTruthy();
    // The player builds inside the faction's watched window; an AI site falls into a ruin.
    simulation.placeBuilding(WOODCUTTER, 40, 30);
    simulation.destroyBuilding(aiBuildings(simulation, WOODCUTTER)[0]!.uid);
    runTicks(simulation, 4000);
    expect(plotCacheWork.rebuilds - work.rebuilds).toBeGreaterThanOrEqual(2);
    expect(plotCacheWork.retests - work.retests).toBeGreaterThan(0);
    expect(plotCacheWork.strictChecks - work.strictChecks).toBeGreaterThan(2);
    expect(simulation.buildings().filter(building => building.militaryFaction === AI).length).toBeGreaterThan(4);
  }, TIMEOUT);

  it("judges uneven ground from its tables exactly as the direct pre-check does (strict reference)", () => {
    // Ridges west and north of the depot: some plots there are gentle, some are not.
    const ridges = (world: WorldData) => {
      for (let z = 0; z <= world.cellsZ; z++) for (let x = 0; x <= Math.min(world.cellsX, 40); x++)
        world.heights[z * (world.cellsX + 1) + x] = 2 + (x * 7 + z * 3) % 5 * .3;
    };
    const { simulation } = developIsland(ridges);
    const work = { ...plotCacheWork };
    runTicks(simulation, 6000);
    expect(plotCacheWork.strictChecks - work.strictChecks).toBeGreaterThan(3);
    expect(aiBuildings(simulation, WOODCUTTER)).toHaveLength(2);
  }, TIMEOUT);

  it("remembers plots the real rules refuse, saves them, and refuses a malformed memory", () => {
    // Blocked cells every third cell round the depot: a plot may cover them (its claim clears them), but the real
    // rule refuses a door on one, which the pre-check does not read.
    const blockedDoors = (world: WorldData) => {
      for (let z = 30; z < 62; z += 3) for (let x = 30; x < 62; x += 3) world.blocking[z * world.cellsX + x] = 3;
    };
    const { simulation } = developIsland(blockedDoors);
    runTicks(simulation, 600);
    const memo = plannerOf(simulation)?.memo ?? [];
    const entries = memo.map(record => record.entry);
    expect(entries.length).toBeGreaterThan(0);
    expect(new Set(entries).size).toBe(entries.length);
    const saved = JSON.parse(JSON.stringify(simulation.saveState()));
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.saveState().factionAi).toEqual(saved.factionAi);
    for (const planner of [{ memo: [{ entry: -1, expires: 1, fingerprint: 0, typeId: 17 }] }, { memo: 1 }, 7]) {
      const broken = structuredClone(saved);
      broken.factionAi[0].planner = planner;
      expect(simulation.loadState(broken).ok).toBe(false);
    }
  }, TIMEOUT);

  /*
   * Compares the planner's own results (sites, faction AI state, roads), not the whole state hash: a reload of an
   * island with road-joined computer sites drifts in the kernel's idle-carrier animation clock with or without any
   * AI decision (EAI3a receipt finding 1, lane ai-reload-drift).
   */
  it("saves and reloads one tick before a planner decision and resumes identically (cache rebuilt on load)", () => {
    const run = (reload: boolean) => {
      const { simulation } = developIsland();
      runTicks(simulation, 900);
      simulation.destroyBuilding(aiBuildings(simulation, WOODCUTTER)[0]!.uid);
      const due = simulation.factionAiDiagnostics().find(entry => entry.faction === AI)!.due[1]!;
      runTicks(simulation, simulation.tickCount() + due - simulation.gameTick() - 1);
      if (reload) {
        const saved = JSON.parse(JSON.stringify(simulation.saveState()));
        expect(simulation.loadState(saved)).toEqual({ ok: true });
      }
      runTicks(simulation, 3000);
      return plannerResults(simulation);
    };
    expect(run(true)).toEqual(run(false));
  }, TIMEOUT);

  it("saves a placement still running between its steps and resumes it after a reload", () => {
    const run = (reload: boolean) => {
      const { simulation } = developIsland();
      // The first tick after a decision left a placement waiting for its next step.
      while (!plannerOf(simulation)?.pending && simulation.tickCount() < 2000)
        runTicks(simulation, simulation.tickCount() + 1);
      const pending = plannerOf(simulation)?.pending;
      expect(pending?.candidates.length).toBeGreaterThan(0);
      if (reload)
        expect(simulation.loadState(JSON.parse(JSON.stringify(simulation.saveState())))).toEqual({ ok: true });
      expect(plannerOf(simulation)?.pending).toEqual(pending);
      runTicks(simulation, 1200);
      return plannerResults(simulation);
    };
    expect(run(true)).toEqual(run(false));
  }, TIMEOUT);
});
