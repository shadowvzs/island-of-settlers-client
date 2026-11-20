import { readFileSync, writeFileSync } from "node:fs";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { createOfflineIslandRuntime } from "../../src/app/settlement/offline-island-runtime";

/**
 * Converts a game save fixture whose `runtime.animals` is a Wildlife 1.0 section (rejected by the
 * Wildlife 2.0 loader) in place: the section becomes the version 2 state of a fresh manager on the
 * same island (no animals yet; the first wildlife step spawns the initial population, as on a new
 * island). Every other byte of the save stays unchanged, including its key order.
 * Usage: npx tsx tools/analysis/save-fixture-wildlife-v2.ts <save.json>
 */
const path = process.argv[2];
if (!path) throw new Error("Usage: save-fixture-wildlife-v2.ts <save.json>");
const save = JSON.parse(readFileSync(path, "utf8"));
const before = JSON.stringify(save.runtime?.animals ?? null).length;
const withoutAnimals = structuredClone(save);
delete withoutAnimals.runtime.animals;
const runtime = createOfflineIslandRuntime(await stageGameSession(withoutAnimals)).save();
save.runtime.animals = runtime.animals;
await stageGameSession(structuredClone(save));
writeFileSync(path, JSON.stringify(save));
console.log(JSON.stringify({ animalsBytesAfter: JSON.stringify(runtime.animals).length,
  animalsBytesBefore: before, path }));
