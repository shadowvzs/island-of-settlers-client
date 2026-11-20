import { readFileSync, writeFileSync } from "node:fs";

import { fromSaveSnapshot } from "../../src/app/save-store/save-snapshot";
import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import { replayCommandLog } from "../../src/shared/settlement/command-log-replay";

/**
 * Rewrites the wildlife section of a command-log verification fixture's end snapshot after a
 * wildlife rules change: replays the fixture's own intervals from its base with this build and
 * stores the replayed `runtime.animals` (everything else stays byte-identical). Only valid when
 * the logged checksums still verify, i.e. the island draws nothing from the wildlife stream.
 * Usage: npx tsx tools/analysis/command-log-fixture-wildlife.ts <fixture.json>
 */
const path = process.argv[2];
if (!path) throw new Error("Usage: command-log-fixture-wildlife.ts <fixture.json>");
const inputs = JSON.parse(readFileSync(path, "utf8"));
const input = inputs[0];
const island = await createHeadlessIsland(fromSaveSnapshot(input.base)!, false, input.allowDebug === true);
for (const [index, interval] of input.intervals.entries()) {
  if (index > 0 && !island.simulation.reloadSnapshot(island.simulation.saveState(), true).ok) {
    throw new Error(`interval ${index}: the island could not reload its own snapshot`);
  }
  const result = replayCommandLog(island.simulation, interval, { rejectDebug: !input.allowDebug, untilEnd: true });
  if (!result.ok) throw new Error(`interval ${index} no longer verifies: ${JSON.stringify(result.mismatch)}`);
}
const runtime = (island.runtimeState() as { world: { animals: unknown } }).world;
const end = input.end.islands[0].save.data.runtime;
const before = JSON.stringify(end.animals).length;
end.animals = runtime.animals;
writeFileSync(path, JSON.stringify(inputs));
console.log(JSON.stringify({ animalsBytesAfter: JSON.stringify(runtime.animals).length, animalsBytesBefore: before,
  tick: island.simulation.gameTick() }));
