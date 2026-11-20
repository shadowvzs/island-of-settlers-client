import { writeFile } from "node:fs/promises";

import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "../../tests/helpers/hunting-world";

/**
 * Writes a paused, roadless, population-capped headquarters island for quiet-skip benchmarks.
 * Usage: tsx tools/analysis/quiet-island-save.ts [output.json]
 */
const output = process.argv[2] ?? "quiet-island.json";
const world = huntingWorld();
const roads = createRoadNetwork(world, { isBlocked: () => false });
const simulation = createSettlementSimulation({ world, roads, initialSettlers: 100 });
if (simulation.buildings().length !== 1 || simulation.snapshot().actors.length !== 0)
  throw new Error("The quiet fixture must be one HQ with no actors");
const save = await createGameSave(world, simulation.saveState(), {
  animals: [], name: "Quiet benchmark island", savedAt: 10_000_000, source: "generated"
});
await writeFile(output, JSON.stringify(save));
console.log(JSON.stringify({ output, buildings: 1, actors: 0, savedAt: save.savedAt }));
