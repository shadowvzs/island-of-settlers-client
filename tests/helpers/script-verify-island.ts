import { expect } from "vitest";

import type { MapScript } from "../../../island-of-settlers-shared/src/script/types/index";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { HARBOUR_TYPE_ID, SAWMILL_TYPE_ID } from "../../src/shared/settlement/building-type-ids";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import {
  createSettlementSimulation, type SettlementSimulation
} from "../../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./hunting-world";

/**
 * The home island of the script verification tests (client session vs server replay): the hunting island with
 * open sea in the east, a finished harbour and sawmill, running `script`.
 */

const COAST = 36;

/** The hunting island with open sea in the east: the trade ship's way to the harbour. */
const coastWorld = (script: MapScript) => {
  const world = huntingWorld(), { cellsX, cellsZ } = world;
  for (let z = 0; z <= cellsZ; z++) for (let x = COAST; x <= cellsX; x++) world.heights[z * (cellsX + 1) + x] = -2;
  for (let z = 0; z < cellsZ; z++) for (let x = COAST; x < cellsX; x++) {
    world.walkCost[z * cellsX + x] = 0; world.blocking[z * cellsX + x] = 1;
  }
  world.script = script;
  return world;
};

/** A finished, road-connected building of `type` whose footprint starts at (`x`, `z`). */
const finished = (simulation: SettlementSimulation, type: number, x: number, z: number) => {
  const [width, depth] = getBuildingDefinition(type).gridFootprint;
  const placed = simulation.placeBuilding(type, x + width / 2, z + depth / 2);
  expect(placed.ok, placed.reason).toBe(true);
  Object.assign(placed.building!, { construction: 1, input: {}, required: {}, worker: undefined });
  expect(simulation.connectRoads(simulation.headquarters.access, placed.building!.access)).toBe(true);
};

type SavedSettlement = ReturnType<SettlementSimulation["saveState"]>;

/** The island's save after its first tick; `adjust` edits the saved settlement (e.g. a known market). */
export const scriptIslandSave = (script: MapScript, name: string, adjust?: (settlement: SavedSettlement) => void) => {
  const world = coastWorld(script);
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ initialSettlers: 30, initialStock: {
    axe: 2, fish: 40, hammer: 2, logs: 40, planks: 120, saw: 2, stone: 100 }, roads, unlockAllBuildings: true,
  world });
  const [width] = getBuildingDefinition(HARBOUR_TYPE_ID).gridFootprint;
  finished(simulation, HARBOUR_TYPE_ID, Math.floor(32 - width / 2), 18);
  finished(simulation, SAWMILL_TYPE_ID, 4, 36);
  simulation.update(.05);
  const settlement = simulation.saveState();
  adjust?.(settlement);
  return createGameSave(world, settlement, { animals: [], name, savedAt: 10_000_000, source: "generated" });
};
