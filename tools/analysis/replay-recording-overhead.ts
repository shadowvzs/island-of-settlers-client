import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

import { createBugReplayRecorder } from "../../src/shared/settlement/bug-replay";
import { readGameSave } from "../../src/shared/settlement/game-save";
import { createReplaySceneJournal } from "../../src/shared/settlement/replay-scene";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
const report = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const loaded = await readGameSave(report.baseline);
const results = [];
for (const count of [64, 128]) {
  const samples: { recording: boolean; milliseconds: number }[] = [];
  for (let pair = 0; pair < 3; pair++) {
    const outcomes = [];
    for (const recording of pair % 2 ? [true, false] : [false, true]) {
      const world = structuredClone(loaded.map.world), scene = createReplaySceneJournal(world);
      let simulation: ReturnType<typeof createSettlementSimulation>;
      const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
      simulation = createSettlementSimulation(scene.wrap({ world, roads, now: () => report.baseline.savedAt }));
      assert(simulation.loadState(loaded.settlement).ok);
      simulation.receiveTroops(Array.from({ length: count }, () => ({ hp: 100, rank: 0, type: "shield" as const })));
      const recorder = createBugReplayRecorder(simulation, "overhead-benchmark", undefined, scene);
      if (recording) await recorder.start(async () => report.baseline);
      const home = simulation.home()!;
      simulation.plantMilitaryRally({ x: home.access.x + 4, z: home.access.z + 3 });
      assert.equal(simulation.militarySoldiers().length, count);
      assert(simulation.callOutMilitary(["shield"]) > 0, "The benchmark must actually issue a rally");
      const start = performance.now();
      for (let step = 0; step < 240; step++) {
        if (recording) scene.beforeUpdate();
        simulation.update(.05);
        if (recording) recorder.advance(.05);
      }
      samples.push({ recording, milliseconds: performance.now() - start });
      outcomes.push(JSON.stringify(simulation.saveState())); recorder.dispose();
    }
    assert.equal(outcomes[0], outcomes[1], "Recording must preserve simulation results");
  }
  const median = (recording: boolean) => samples.filter(sample => sample.recording === recording)
    .map(sample => sample.milliseconds).sort((a, b) => a - b)[1]!;
  results.push({ troops: count, steps: 240, plainMs: median(false), recordedMs: median(true), samples });
}
writeFileSync("/tmp/replay-recording-overhead.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
