/**
 * Copies a game save with every road segment turned into a dirt road (the lowest tier), for the
 * traffic-wear rut review (wear-2, owner 2026-11-07). Geometry, bridges and every other field stay
 * unchanged; the input is never modified. Both saves go through the game's own save reader and the
 * settlement's `loadState` validation.
 *
 *   npx tsx tools/analysis/save-roads-to-dirt.ts <in.json> <out.json>
 */
import { readFile, writeFile } from "node:fs/promises";

import { createIslandStockContacts } from "../../src/app/settlement/island-stock-contacts";
import { type GameSaveV1, readGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { isHomeBuilding } from "../../src/shared/settlement/settlement-home";
import { createSettlementSimulation, type SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { savedHomeBuilding } from "./helpers";

const [input, output] = process.argv.slice(2);
if (!input || !output || input === output) {
  throw new Error("Usage: save-roads-to-dirt.ts <in.json> <out.json> (two different paths)");
}

/** Reads and fully restores a save; returns the restored road segments. */
const validateSave = async (save: GameSaveV1) => {
  const loaded = await readGameSave(save);
  const { world } = loaded.map;
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({
    homeBuilding: savedHomeBuilding(loaded.settlement.buildings.find(isHomeBuilding)),
    now: () => save.savedAt,
    playerNation: loaded.settlement.playerNation,
    roads,
    stockContact: createIslandStockContacts(world),
    world
  });
  const restored = simulation.loadState(loaded.settlement);
  if (!restored.ok) throw new Error(`Save does not restore: ${JSON.stringify(restored)}`);
  return simulation.saveState().roads;
};

const original = JSON.parse(await readFile(input, "utf8")) as GameSaveV1;
const originalRoads = await validateSave(original);
const converted: GameSaveV1 = {
  ...original,
  settlement: { ...original.settlement, roads: original.settlement.roads.map(segment => ({ ...segment, tier: "dirt" })) }
};
const convertedRoads = await validateSave(converted);
if (convertedRoads.length !== originalRoads.length || convertedRoads.some(segment => segment.tier !== "dirt")) {
  throw new Error("Converted save did not restore every road as dirt");
}
await writeFile(output, JSON.stringify(converted));
const paved = original.settlement.roads.filter(segment => segment.tier !== "dirt").length;
console.log(JSON.stringify({ output, paved, segments: convertedRoads.length }));
