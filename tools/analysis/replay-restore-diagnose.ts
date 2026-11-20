import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";

const source = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as GameSaveV1;
const updates = Array.from({ length: 600 }, () => .05);
const island = await createHeadlessIsland(source);
const simulation = island.simulation;
const pick = (sim: typeof simulation) => {
  const actor = sim.frames().find(entry => entry.uid === 2)!;
  const building = sim.buildings().find(entry => entry.uid === 3)!;
  return { actor: { phase: actor.phase, action: actor.action, ware: actor.ware, pathIndex: actor.pathIndex,
    x: actor.x, z: actor.z, timer: actor.timer, target: actor.target, consumed: actor.consumed,
    productionSeconds: actor.productionSeconds, stockContact: actor.stockContact },
    building: { cycle: building.cycle, output: building.output, input: building.input,
      status: building.status, working: building.working } };
};
for (const dt of updates.slice(0, 300)) simulation.update(dt);
const halfway = await island.save();
const restoredIsland = await createHeadlessIsland(structuredClone(halfway));
const restored = restoredIsland.simulation;
const liveRuntime = () => island.runtimeState().world;
const restoredRuntime = () => restoredIsland.runtimeState().world;
console.log(JSON.stringify({ startRuntimeEqual: isDeepStrictEqual(liveRuntime(), restoredRuntime()) }));
let beforeLeft: unknown, beforeRight: unknown, beforeRuntimeLeft: unknown, beforeRuntimeRight: unknown;
for (const [index, dt] of updates.slice(300).entries()) {
  if (index === 191) {
    beforeLeft = simulation.saveState(); beforeRight = restored.saveState();
    beforeRuntimeLeft = liveRuntime(); beforeRuntimeRight = restoredRuntime();
  }
  simulation.update(dt);
  restored.update(dt);
  const left = pick(simulation), right = pick(restored);
  const runtimeEqual = isDeepStrictEqual(liveRuntime(), restoredRuntime());
  if (!isDeepStrictEqual(left, right) || !runtimeEqual) {
    console.log(JSON.stringify({ index, left, right, runtimeEqual,
      beforeSettlementEqual: isDeepStrictEqual(beforeLeft, beforeRight),
      beforeRuntimeEqual: isDeepStrictEqual(beforeRuntimeLeft, beforeRuntimeRight) }, null, 1));
    break;
  }
}
