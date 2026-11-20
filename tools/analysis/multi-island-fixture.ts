import { ADVENTURE_LIMIT } from "@shared/catalog/balance";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { COLONY_LIMIT } from "../../src/shared/balance/colonies";
import type { AdventureRecord, Archipelago, ColonyRecord } from "../../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";

/**
 * Builds a repeatable N-island archipelago benchmark fixture from one continued home save.
 * The extra islands are copies of the same developed settlement filed as conquered colonies or a
 * contested adventure, so the replay scales the actual per-island work without generating new maps.
 *
 * Usage: tsx tools/analysis/multi-island-fixture.ts <home-save.json> <output.json> [island-count]
 */
const [inputArgument, outputArgument, countArgument = "5"] = process.argv.slice(2);
if (!inputArgument || !outputArgument)
  throw new Error("Usage: multi-island-fixture.ts <home-save.json> <output.json> [island-count]");
const count = Number(countArgument);
const maxIslands = 1 + COLONY_LIMIT + ADVENTURE_LIMIT;
if (!Number.isSafeInteger(count) || count < 1 || count > maxIslands)
  throw new Error(`island-count must be between 1 and ${maxIslands} (the shipped island limit)`);
const source = JSON.parse(await readFile(resolve(inputArgument), "utf8")) as GameSaveV1;
const islandSave = (): GameSaveV1 => ({ ...source, archipelago: undefined });
const extra = count - 1, colonyCount = Math.min(extra, COLONY_LIMIT);
const colonies: ColonyRecord[] = Array.from({ length: colonyCount }, (_, index) => {
  const id = index + 1;
  return {
    expeditionId: id,
    island: {
      difficulty: "easy", id, name: `Benchmark colony ${id}`, ore: "ironOre", seed: id,
      voyageSeconds: 90
    },
    status: "conquered",
    conqueredAt: source.savedAt,
    // Keep the abstract ore clock out of the measurement; the island replay itself is the target.
    nextOreShipAt: source.savedAt + 30 * 24 * 60 * 60 * 1000,
    save: islandSave()
  };
});
const adventureCount = extra - colonyCount;
const adventures: AdventureRecord[] = Array.from({ length: adventureCount }, (_, index) => {
  const id = 1000 + index;
  return {
    expeditionId: id,
    island: {
      difficulty: "easy", id, kind: "adventure", name: `Benchmark adventure ${index + 1}`, seed: id,
      size: 96, voyageSeconds: 90
    },
    status: "contested",
    save: islandSave()
  };
});
// With no active expedition the home island is the top-level settlement. Do not also file a
// second home copy in the archipelago: the server snapshot would see two `home` islands.
const archipelago: Archipelago = { active: null, colonies, version: 1,
  ...(adventures.length ? { adventures } : {}) };
const result: GameSaveV1 = { ...source, archipelago };
await writeFile(resolve(outputArgument), JSON.stringify(result));
console.log(JSON.stringify({ islands: count, colonies: colonies.length,
  adventures: adventures.length, output: resolve(outputArgument) }));

