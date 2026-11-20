import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { canWorkerEnterBuildingPlot } from "../../src/app/settlement/island-simulation-hooks";
import { createIslandStockContacts } from "../../src/app/settlement/island-stock-contacts";
import { createOfflineIslandRuntime } from "../../src/app/settlement/offline-island-runtime";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { isNavigationClear, searchGroundPath } from "../../src/shared/settlement/settlement-navigation";
import { groundPath } from "../../src/shared/settlement/settlement-paths";
import { canPlantAt } from "../../src/shared/settlement/settlement-resources";
import { createSettlementRoadDecorations } from "../../src/shared/settlement/settlement-road-decorations";
import { validateSettlementSave } from "../../src/shared/settlement/settlement-save-state";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementContext } from "../../src/shared/settlement/settlement-types";
import { savedHomeBuilding } from "./helpers";
import { savedOccupancy } from "../../src/shared/settlement/save-cell-codecs";

const [input, output, secondsArgument = "5", reloadArgument = "0"] = process.argv.slice(2);
assert(input && output, "Expected original save, new JSON receipt, optional simulated seconds/reload second");
const bytes = await readFile(input), source = JSON.parse(bytes.toString()) as GameSaveV1;
const loaded = await stageGameSession(source), { world } = loaded.map;
const runtime = createOfflineIslandRuntime(loaded);
const originalPlanted = new Set(runtime.save().growth.jobPlanted);
let elapsed = 0;
let simulation: ReturnType<typeof createSettlementSimulation>;
const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
const options = { world, roads, ...runtime.hooks,
  homeBuilding: savedHomeBuilding(loaded.settlement.buildings.find(building =>
    building.typeId === 0 || building.colonyHome)) as 0 | 39 | null,
  playerNation: loaded.settlement.playerNation, now: () => source.savedAt + elapsed * 1000,
  canWorkerEnterPlot: (building: Parameters<typeof canWorkerEnterBuildingPlot>[0],
    point: Parameters<typeof canWorkerEnterBuildingPlot>[1]) =>
    canWorkerEnterBuildingPlot(building, point, simulation.playerNation()),
  stockContact: createIslandStockContacts(world, (x, z) => simulation.isOccupied(x, z),
    () => simulation.playerNation()) };
simulation = createSettlementSimulation(options);
const restored = simulation.loadState(loaded.settlement);
assert(restored.ok, restored.ok ? "" : restored.reason);
let actor = simulation.frames().find(entry => entry.uid === 1)!;
let building = simulation.buildings().find(entry => entry.uid === 2)!;
assert(actor && building && building.typeId === 20 && actor.target);
const state = simulation.saveState();
const context = { ...state, options, actors: simulation.frames(), buildings: simulation.buildings(),
  occupied: savedOccupancy(state).slice(), reservations: new Set(state.reservations),
  resourceAmounts: new Map(state.resourceAmounts) } as unknown as SettlementContext;
context.roadDecorations = createSettlementRoadDecorations(context);
context.roadDecorations.load(state.roadDecorations);
const target = { ...actor.target };
const distance = Math.hypot(actor.x - target.x, actor.z - target.z);
const oldApproach = { x: target.x + (actor.x - target.x) / distance * .5,
  z: target.z + (actor.z - target.z) / distance * .5 };
const route = (from: { x: number; z: number }, to: { x: number; z: number }, own?: number) => {
  const path = groundPath(context, from, to, own);
  return path && { length: path.length, start: path[0], end: path.at(-1) };
};
const diagnostics = { target, oldApproach, canPlant: canPlantAt(context, target.x, target.z),
  oldApproachSearch: (() => {
    const { path, ...result } = searchGroundPath(context, building.workerApproach, oldApproach);
    return { ...result, pathLength: path?.length };
  })(),
  cardinalApproaches: [[.5, 0], [-.5, 0], [0, .5], [0, -.5]].map(([dx, dz]) => {
    const point = { x: target.x + dx!, z: target.z + dz! };
    return { point, path: route(actor, point, building.uid) };
  }),
  oldApproachClear: isNavigationClear(context, oldApproach), targetClear: isNavigationClear(context, target),
  alternatives: Array.from({ length: 8 }, (_, index) => {
    const angle = Math.atan2(actor.x - target.x, actor.z - target.z) + index * Math.PI / 4;
    const point = { x: target.x + Math.sin(angle) * .5, z: target.z + Math.cos(angle) * .5 };
    return { point, clear: isNavigationClear(context, point), path: route(actor, point, building.uid) };
  }),
  building: { access: building.access, workerApproach: building.workerApproach },
  stockToOldApproach: route(actor, oldApproach, building.uid), stockToTarget: route(actor, target, building.uid),
  stockToWorkerApproach: route(actor, building.workerApproach, building.uid),
  workerApproachToTarget: route(building.workerApproach, target) };
const snapshot = () => ({ seconds: elapsed, uid: actor.uid, phase: actor.phase, x: actor.x, z: actor.z,
  target: actor.target && { ...actor.target }, seedling: actor.foresterSeedling && structuredClone(actor.foresterSeedling),
  nurseryTaken: building.nurserySeedlingTaken, pathLength: actor.path.length,
  pathIndex: actor.pathIndex, recovery: actor.navigationRecovery && structuredClone(actor.navigationRecovery) });
const phases = [snapshot()];
const reloads = [];
let previous = actor.phase;
const seconds = Number(secondsArgument), reloadSecond = Number(reloadArgument);
assert(Number.isFinite(seconds) && seconds >= 0 && seconds <= 600);
assert(Number.isFinite(reloadSecond) && reloadSecond >= 0 && reloadSecond <= seconds);
for (let tick = 0; tick < Math.ceil(seconds / .05); tick++) {
  simulation.update(.05); elapsed += .05;
  if (actor.phase !== previous) { phases.push(snapshot()); previous = actor.phase; }
  if (reloadSecond > 0 && elapsed >= reloadSecond && reloads.length === 0) {
    const before = snapshot(), saved = simulation.saveState();
    assert(!validateSettlementSave(saved, { options }));
    const result = simulation.reloadSnapshot(saved);
    assert(result.ok, result.ok ? "" : result.reason);
    actor = simulation.frames().find(entry => entry.uid === 1)!;
    building = simulation.buildings().find(entry => entry.uid === 2)!;
    const after = snapshot();
    for (const key of ["uid", "phase", "x", "z", "target", "seedling", "nurseryTaken"] as const)
      // Save serialization intentionally omits undefined optional fields.
      assert.deepEqual(JSON.parse(JSON.stringify({ value: after[key] })),
        JSON.parse(JSON.stringify({ value: before[key] })), `Reload changed forester ${key}`);
    reloads.push({ seconds: elapsed, before, after, custodyAndPositionExact: true });
  }
  if (tick % 200 === 199) await new Promise(resolve => setTimeout(resolve, 0));
}
phases.push(snapshot());
const final = simulation.saveState();
const validation = validateSettlementSave(final, { options });
assert(!validation, validation ?? "");
const sourceUnchanged = bytes.equals(await readFile(input));
assert(sourceUnchanged);
const report = { source: resolve(input), sha256: createHash("sha256").update(bytes).digest("hex"),
  sourceUnchanged, diagnostics, phases, reloads, finalSaveValid: true,
  newPlanted: runtime.save().growth.jobPlanted.filter(id => !originalPlanted.has(id))
    .map(id => ({ id, x: world.props.x[id], z: world.props.z[id], type: world.props.types[id] })),
  finalRuntime: { planted: runtime.save().growth.planted, jobPlanted: runtime.save().growth.jobPlanted } };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, newPlanted: report.newPlanted, reloads, phases, finalSaveValid: true }));
