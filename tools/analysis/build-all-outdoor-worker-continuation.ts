import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import { canWorkerEnterBuildingPlot } from "../../src/app/settlement/island-simulation-hooks";
import type { BugReplayReport } from "../../src/shared/settlement/bug-replay";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { isOwnDoorLane, isOwnStockCourtyard } from "../../src/shared/settlement/settlement-entrance";
import { isGroundSegmentClear } from "../../src/shared/settlement/settlement-navigation";
import { createSettlementRoadDecorations } from "../../src/shared/settlement/settlement-road-decorations";
import type { SettlementContext } from "../../src/shared/settlement/settlement-types";
import { PROP_REMOVED } from "../../src/shared/world/world-data";
import { resourcesPath } from "../bench/resources-path";
import { savedOccupancy } from "../../src/shared/settlement/save-cell-codecs";

const input = process.argv[2] ?? resourcesPath("project-reviews", "build-all-slowdown-2026-11-04", "browser",
  "residual-high", "high-build-all-reproduction.json");
const bytes = readFileSync(input), loaded = JSON.parse(bytes.toString("utf8")) as BugReplayReport | GameSaveV1;
const baseline = "baseline" in loaded ? loaded.baseline : loaded;
const inputKind = "baseline" in loaded ? "reproduction-baseline" : "original-game-save";
const maximumSeconds = Number(process.argv[3] ?? 100);
assert(Number.isFinite(maximumSeconds) && maximumSeconds > 0 && maximumSeconds <= 180);
const label = process.argv[4] ?? "outdoor-worker-continuation";
assert(/^[a-z0-9-]+$/.test(label));
let elapsed = 0;
const production: { seconds: number; inputs: object; output?: string; cycle: number }[] = [];
const session = await createHeadlessIsland(baseline, false, true, {
  onProductionCycle: (building, inputs, output) => {
    if (building.uid === 1) production.push({ seconds: elapsed, inputs: { ...inputs }, output, cycle: building.cycle });
  }
});
const { simulation, world } = session;
const initial = simulation.saveState(), building = simulation.buildings().find(site => site.uid === 1)!;
assert(building?.typeId === 17 && building.worker !== undefined);
const uid = building.worker, actor = simulation.frames().find(body => body.uid === uid)!;
assert(actor.job === "Woodcutter");
const identity = { uid, tool: actor.tool, home: actor.home, building: actor.building, job: actor.job };
const roads = createRoadNetwork(world);
roads.replaceSegments(initial.roads);
const context = { ...initial, options: { roads, world }, actors: simulation.frames(), buildings: simulation.buildings(),
  occupied: savedOccupancy(initial).slice(), reservations: new Set(initial.reservations),
  resourceAmounts: new Map(initial.resourceAmounts) } as unknown as SettlementContext;
context.options.canWorkerEnterPlot = (site, point) => canWorkerEnterBuildingPlot(site, point, simulation.playerNation());
context.roadDecorations = createSettlementRoadDecorations(context);
context.roadDecorations.load(initial.roadDecorations);
const cycle = building.cycle;
let maximumVisibleStep = 0, outputObserved = false, previousSignature = "";
const snapshots: object[] = [];
const selectedTrees = new Set<number>();
const invalidSegments: object[] = [];
const snapshot = () => ({ seconds: elapsed, phase: actor.phase, x: actor.x, z: actor.z,
  visible: actor.visible, ware: actor.ware, target: actor.target && { ...actor.target },
  pathIndex: actor.pathIndex, pathLength: actor.path.length, cycle: building.cycle,
  output: { ...building.output }, status: building.status });
snapshots.push(snapshot());
for (let tick = 0; tick < Math.ceil(maximumSeconds / .05); tick++) {
  const previous = { x: actor.x, z: actor.z, phase: actor.phase, visible: actor.visible };
  simulation.update(.05); elapsed = (tick + 1) * .05;
  if (actor.target?.kind === "tree") selectedTrees.add(actor.target.id);
  if (actor.visible && previous.visible && actor.phase === previous.phase &&
    ["outbound", "outputWalk"].includes(actor.phase)) {
    maximumVisibleStep = Math.max(maximumVisibleStep, Math.hypot(actor.x - previous.x, actor.z - previous.z));
    if (!isGroundSegmentClear(context, previous, actor, undefined, point =>
      isOwnDoorLane(context, actor, point) || isOwnStockCourtyard(context, actor, point)))
      invalidSegments.push({ seconds: elapsed, previous, current: { x: actor.x, z: actor.z } });
  }
  outputObserved ||= (building.output.logs ?? 0) > (initial.buildings.find(site => site.uid === 1)!.output.logs ?? 0);
  const signature = JSON.stringify([actor.phase, actor.ware, actor.target?.id, building.cycle, building.output]);
  if (signature !== previousSignature || tick % 200 === 199) {
    snapshots.push(snapshot()); previousSignature = signature;
  }
  if (outputObserved && building.cycle > cycle && ["enterRest", "workerRestWait", "rest"].includes(actor.phase)) break;
}
const final = simulation.saveState();
if (invalidSegments.length) writeFileSync(resourcesPath("project-reviews", "build-all-slowdown-2026-11-04",
  `${label}-segment-failure.json`), JSON.stringify({ invalidSegments, snapshots, production }, null, 2));
const finalIdentity = { uid: actor.uid, tool: actor.tool, home: actor.home, building: actor.building, job: actor.job };
assert.deepEqual(finalIdentity, identity);
assert(outputObserved, "The real worker must put its produced log in the actual output bay");
assert.equal(building.cycle - cycle, production.length);
assert(production.length > 0 && production.every(receipt => receipt.output === "logs" && Object.keys(receipt.inputs).length === 0));
assert.equal(actor.ware, null, "The placed log must leave the worker's hands");
assert.equal(invalidSegments.length, 0, "Worker movement crossed canonical terrain/props/building geometry");
assert(maximumVisibleStep < .1, "Worker moved faster than an ordinary bounded .05-second step");
const amounts = new Map(final.resourceAmounts);
const treeState = [...selectedTrees].map(id => ({ id, type: world.props.types[id], amount: amounts.get(`tree:${id}`) }));
assert(treeState.some(tree => tree.type === PROP_REMOVED && tree.amount === 0), "Actual tree harvest was not committed");
assert(bytes.equals(readFileSync(input)), "Owner reproduction changed");
const receipt = { input, inputKind, sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  identity, finalIdentity, elapsed, maximumVisibleStep, invalidSegments, production, outputObserved,
  initialCycle: cycle, finalCycle: building.cycle, finalOutput: building.output, treeState, snapshots,
  finalActorWare: actor.ware, noInputsConsumed: production.every(event => Object.keys(event.inputs).length === 0),
  originalUnchanged: true };
writeFileSync(resourcesPath("project-reviews", "build-all-slowdown-2026-11-04", `${label}.json`),
  JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ elapsed, maximumVisibleStep, production, treeState, finalPhase: actor.phase,
  outputObserved, finalActorWare: actor.ware, invalidSegments }));
