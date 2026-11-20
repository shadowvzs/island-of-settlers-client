import { LEVEL_THRESHOLDS } from "@shared/catalog/balance";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

import { COMMANDER_INPUT_BUTTON } from "../../../island-of-settlers-shared/src/commander-input";
import { toSaveSnapshot } from "../../src/app/save-store/save-snapshot";
import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import type { WorkerNation } from "../../src/render-common/workers/worker-unit";
import { createPlayerProgress } from "../../src/shared/progression/player-progress";
import { createCommandLogRecorder } from "../../src/shared/settlement/command-log";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { commanderRecruitCost } from "../../src/shared/settlement/settlement-commander";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "../../tests/helpers/hunting-world";
import { resourcesPath } from "./resources-path";

// CPU-only actual API-verifier proof. No database, browser, production bundle or user save mutation.
const nation = (process.argv.find(value => value.startsWith("--nation="))?.slice(9) ?? "roman") as WorkerNation;
assert(["roman", "japanese", "viking", "nubian", "chinese", "maya", "persian", "indigenous"].includes(nation));
const run = process.argv.find(value => value.startsWith("--run="))?.slice(6) ?? "direct-api-i";
assert(/^[a-z0-9-]{1,80}$/.test(run));
const combat = process.argv.includes("--combat");
const freeAim = process.argv.includes("--free-aim");
const shotEndpoint = process.argv.includes("--shot-endpoint");
const variableClock = process.argv.includes("--variable-clock");
const output = resourcesPath("project-reviews", "commander-possession-2026-11-03", run);
mkdirSync(output, { recursive: true });
const bundle = resolve(output, "verifier.mjs");
await build({ bundle: true, entryPoints: [resolve("src/app/settlement/server-bundle.ts")],
  format: "esm", outfile: bundle, platform: "node", target: "node22" });
const server = await import(pathToFileURL(bundle).href);
const world = huntingWorld();
let fixture: ReturnType<typeof createSettlementSimulation>;
const roads = createRoadNetwork(world, { isBlocked: (x, z) => fixture?.isOccupied(x, z) ?? false });
fixture = createSettlementSimulation({ clockStart: 0, developmentAllowed: true, initialSettlers: 20,
  initialStock: { ...Object.fromEntries(Object.keys(commanderRecruitCost(nation)).map(ware => [ware, 40])),
    cloth: 40, planks: 40, stone: 40 },
  playerLevel: () => 23, playerNation: nation, roads, world });
const [width, depth] = getBuildingDefinition(62).gridFootprint;
const placed = fixture.placeBuilding(62, 26 + width / 2, 22 + depth / 2);
assert(placed.ok && placed.building, placed.reason ?? "Lodge placement failed");
Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
assert(fixture.connectRoads(fixture.headquarters.access, placed.building.access));
const initial = await createGameSave(world, fixture.saveState(), {
  animals: [], name: "Commander direct-input verifier", savedAt: 1_000_000, source: "generated"
});
initial.player = { ...createPlayerProgress(world.seed), experience: LEVEL_THRESHOLDS[22]! };
const client = await createHeadlessIsland(initial), { simulation } = client;
const recruited = simulation.recruitCommander(placed.building.uid);
assert(recruited.ok, JSON.stringify(recruited));
assert(simulation.deployCommander().ok);
for (let tick = 0; tick < 500; tick++) simulation.update(.05);
const actor = simulation.militarySoldiers().find(row => row.commanderId)!.actor;
assert.equal(simulation.commanderControlProblem(actor), null);
if (combat) {
  const body = simulation.frames().find(row => row.uid === actor)!;
  assert(simulation.spawnMilitaryOpponent({ x: body.x, z: body.z + 6 }, "shield") !== null);
}
const base = await client.save();
const recorder = createCommandLogRecorder(simulation, { sourceVersion: run });
recorder.open();
const started = simulation.beginCommanderControl(actor);
assert(started.ok);
const arrows = new Set<number>();
let frame = 0;
for (let tick = 0; tick < 100;) {
  const previous = simulation.gameTick();
  const duration = variableClock ? [.016, .017, .016][frame++ % 3]! : .05;
  simulation.update(duration);
  if (simulation.gameTick() === previous) continue;
  for (const arrow of simulation.militaryArrows()) if (arrow.shooter === actor) arrows.add(arrow.id);
  let buttons = (combat || freeAim) && tick > 0 && tick < 25 ? COMMANDER_INPUT_BUTTON.attack : 0;
  if (tick >= 25 && tick < 40) buttons = COMMANDER_INPUT_BUTTON.block;
  else if (tick === 45) buttons = COMMANDER_INPUT_BUTTON.dismount;
  else if (tick === 70) buttons = COMMANDER_INPUT_BUTTON.callHorse;
  assert(simulation.submitCommanderInput({ generation: started.generation, forward: tick < (combat ? 15 : 20) ? 127 : 0,
    right: 0, heading: freeAim ? tick * 80 : 0, pitch: freeAim ? 1200 : 0,
    buttons }));
  if (shotEndpoint && arrows.size > 0) break;
  tick++;
}
assert(simulation.endCommanderControl(started.generation));
if ((combat || freeAim) && nation === "nubian") assert(arrows.size > 0, "Actual controlled bow released a swept projectile");
const interval = recorder.close("home")!;
assert.equal(interval.version, 2);
const end = await client.save();
const input = { base: toSaveSnapshot(base), end: toSaveSnapshot(end), intervals: [{ ...interval, baseRevision: 1 }] };
const verified = await server.verifyCommandLogs(input);
assert.equal(verified.status, "verified", JSON.stringify(verified));
const forged = structuredClone(input);
const forgedSave = forged.end.islands[0]!.save.data as unknown as typeof end;
forgedSave.settlement.actors.find(row => row.uid === actor)!.x += 3;
const rejected = await server.verifyCommandLogs(forged);
assert.notEqual(rejected.status, "verified");
const report = { status: "passed", actor, nation, combat, freeAim, shotEndpoint,
  variableClock, endAccumulator: interval.endAccumulator,
  endpointArrows: simulation.militaryArrows().map(arrow => ({ ...arrow })),
  observedArrows: arrows.size, inputVersion: interval.version, verified, rejected,
  scope: "Real headless physical deployment, v2 move/guard/dismount/call/end through independently bundled API verifier; forged actor position rejected." };
writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
recorder.dispose();
