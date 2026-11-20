import { expect } from "vitest";

import type { MapScript } from "../../../island-of-settlers-shared/src/script/types/script";
import { doStep, emptyScript, str, trigger } from "../../../island-of-settlers-shared/tests/script-fixtures";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { hashSettlementState } from "../../src/shared/settlement/settlement-state-hash";
import type { ScenarioFactionAi } from "../../src/shared/world/scenario-faction-ai";
import type { WorldData } from "../../src/shared/world/world-data";
import { economyCampaignScenario } from "./economy-factions";
import { huntingWorld } from "./hunting-world";

/** EAI2b/EAI2d `maintain` fixtures: an island whose map gives faction 2 `maintain`, run by the faction AI loop. */
export type Simulation = ReturnType<typeof createSettlementSimulation>;
export const AI = 2;
export const TOWER = 2;
export const CATAPULT = 16;
/** Another computer faction: hostile to the economy faction. */
export const RIVAL = 1;
export const TIMEOUT = 300_000;

/** The plot centre of `typeId` with its left/top corner at (x, z). */
export const plotAt = (typeId: number, x: number, z: number) => {
  const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  return { typeId, x: x + width / 2, z: z + depth / 2 };
};

/** A one-cell pocket within the civilian threat radius of the tower's door: an enemy there stays put. */
export const POCKET = { x: 60.5, z: 52.5 };
export const pocket = (world: WorldData) => {
  for (let z = 51; z <= 53; z++) for (let x = 59; x <= 61; x++)
    if (x !== 60 || z !== 52) world.walkCost[z * world.cellsX + x] = 0;
};

/** A script that wakes the map's `none` faction to `maintain` when the map starts (EAI2c `setFactionAi`). */
const WAKE: MapScript = emptyScript({ triggers: [trigger("wake", { actions: [doStep("s1", "setFactionAi",
  { faction: { faction: AI, kind: "slot" }, mode: str("maintain") })] })] });

interface IslandOptions {
  shape?: (world: WorldData) => void;
  typeId?: number;
  /** The map leaves the faction at `none` and a script wakes it. */
  woken?: boolean;
}

/** An economy faction's depot (start kit) and a finished tower east of it, joined by a road that meets its door. */
export const maintainIsland = (
  stock: Record<string, number>, { shape, typeId = TOWER, woken = false }: IslandOptions = {}
) => {
  const world = huntingWorld();
  shape?.(world);
  const scenario = economyCampaignScenario([AI]);
  if (woken) {
    // The Ready rules a switch re-checks ask a `maintain` faction for start settlers.
    scenario.factionAi = [{ faction: AI, mode: "none", start: { settlers: 6, stock: {} } } satisfies ScenarioFactionAi];
    world.script = WAKE;
  }
  world.scenario = scenario;
  const simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 0, initialSettlers: 8,
    roads: createRoadNetwork(world), world });
  if (woken) for (let tick = 0; tick < 10; tick++) simulation.update(.05);
  const depot = simulation.aiPlace(AI, { typeId: 0, x: 47, z: 46 }, { settlers: 6,
    soldiers: [{ count: 6, rank: 0, type: "shield" }], stock: { axe: 1, hammer: 2, ...stock } }).building!;
  expect(depot).toBeDefined();
  const tower = simulation.aiPlace(AI, plotAt(typeId, 54, 45), {}).building!;
  const route = [depot.access, { x: depot.access.x, z: 53.5 }, { x: tower.access.x, z: 53.5 }, tower.access];
  for (let index = 1; index < route.length; index++)
    expect(simulation.connectFactionRoads(AI, route[index - 1]!, route[index]!)).toBeTruthy();
  return { depot, simulation, tower, world };
};

export const pool = (simulation: Simulation, owner: number) =>
  simulation.saveState().storagePools.pools.find(entry => entry.owner === owner)?.available ?? {};
export const aiTower = (simulation: Simulation, typeId = TOWER) =>
  simulation.buildings().find(building => building.typeId === typeId && building.militaryFaction === AI);
export const stationed = (simulation: Simulation, uid: number) => simulation.militarySoldiers()
  .filter(soldier => soldier.building === uid && soldier.stationed && soldier.combat?.faction === AI).length;
export const runSeconds = (simulation: Simulation, seconds: number, each: () => boolean | void = () => undefined) => {
  for (let step = 0; step < seconds * 20; step++) {
    simulation.update(.05);
    if (step % 20 === 0 && each() === true) return true;
  }
  return false;
};
export const hashOf = (simulation: Simulation, world: WorldData) =>
  hashSettlementState({ settlement: { ...simulation.saveState(), accumulator: 0 }, world });
/** The faction's saved `maintain` memory (EAI2b part of the faction AI save). */
export const maintainOf = (simulation: Simulation) =>
  simulation.saveState().factionAi?.find(entry => entry.faction === AI)?.maintain;
/** Runs whole ticks at a frame pattern until the island reaches `tick` (the frame remainder is left out). */
export const runTicks = (simulation: Simulation, tick: number, frames: readonly number[]) => {
  for (let frame = 0; simulation.tickCount() < tick; frame++)
    simulation.update(Math.min(frames[frame % frames.length]!, (tick - simulation.tickCount()) * .05));
};
