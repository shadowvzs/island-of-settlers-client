import type { MapScript } from "../../../island-of-settlers-shared/src/script/types/index";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { placeProp } from "../../src/shared/world/editing/prop-placement";
import { PROP } from "../../src/shared/world/world-data";
import { huntingWorld } from "./hunting-world";

/**
 * A small island with a forest and a starting stock: the determinism and command log fixtures start here. With
 * `script`, the island runs that map script from its start (TRG3b nature verification).
 */
export const determinismIslandSave = (script?: MapScript) => {
  const world = huntingWorld();
  if (script) world.script = script;
  for (let z = 30; z <= 44; z += 2) for (let x = 40; x <= 54; x += 2)
    placeProp(world, { kind: PROP.broadleafTree, seed: x * 131 + z, x: x + .5, z: z + .5 });
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 20, initialStock: {
    axe: 2, fish: 200, hammer: 2, logs: 80, planks: 60, saw: 2, shovel: 2, stone: 40 } });
  return createGameSave(world, simulation.saveState(), {
    name: "Determinism island", savedAt: 10_000_000, source: "generated", animals: [] });
};
