import { describe, expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { snapshotMovementSkipWork } from "../src/shared/settlement/settlement-movement-skip";
import { countSaveIntegrity } from "../src/shared/settlement/settlement-save-integrity";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementPoint } from "../src/shared/settlement/settlement-types";
import { huntingWorld } from "./helpers/hunting-world";

const START = 10_000_000;
/** Two turns: north 28 tiles, east 20, south 28. All legs stay outside the HQ/mill envelopes. */
const ROUTE: readonly SettlementPoint[] = [
  { x: 2.5, z: 2.5 },
  { x: 2.5, z: 30.5 },
  { x: 22.5, z: 30.5 },
  { x: 22.5, z: 2.5 }
];
const MILL = { x: 50.5, z: 20 } as const;

/** A paused Miller and one plain outbound walker with a multi-waypoint polyline. */
const turnSave = (): SettlementSaveV1 => {
  const world = huntingWorld();
  const roads = createRoadNetwork(world, { isBlocked: () => false });
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 100, clockStart: START });
  const placed = simulation.placeBuilding(31, MILL.x, MILL.z);
  expect(placed.ok, placed.reason).toBe(true);
  Object.assign(placed.building!, {
    construction: 1, foundationProgress: 1, input: { grain: 10 }, incoming: {}, output: {},
    productionPaused: true, required: {}
  });
  const settlement = simulation.saveState();
  const home = settlement.buildings.find(building => building.typeId === 0)!;
  const start = ROUTE[0]!;
  settlement.actors = [{
    uid: 1, job: "Miller", home: home.uid, building: placed.building!.uid,
    x: start.x, y: 2, z: start.z, yaw: 0, visible: true, action: "walk", ware: null,
    phase: "outbound", path: ROUTE.slice(1).map(point => ({ ...point })),
    pathIndex: 0, timer: 0, animationTime: 0
  } satisfies SettlementActor];
  settlement.nextActor = 2;
  settlement.buildings.find(building => building.uid === placed.building!.uid)!.worker = 1;
  settlement.integrity = countSaveIntegrity(settlement);
  return settlement;
};

const simulationFrom = (save: SettlementSaveV1) => {
  const world = huntingWorld();
  const roads = createRoadNetwork(world, { isBlocked: () => false });
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 100, clockStart: START });
  const loaded = simulation.loadState(structuredClone(save));
  expect(loaded.ok, loaded.ok ? "" : loaded.reason).toBe(true);
  return simulation;
};

const walker = (simulation: ReturnType<typeof simulationFrom>) =>
  simulation.snapshot().actors.find(actor => actor.uid === 1)!;

describe("movement skip segment boundaries", () => {
  it("runs each waypoint's arrival/turn tick through the exact pipeline", () => {
    const save = turnSave();
    const exact = simulationFrom(save);
    const skipped = simulationFrom(save);
    const startWork = snapshotMovementSkipWork();
    const ticks = 1_800;
    const turns: number[] = [];
    let previousIndex = walker(exact).pathIndex;
    let skippedTicks = 0;
    let firstTurn: SettlementActor | undefined;
    let secondTurn: SettlementActor | undefined;

    for (let tick = 1; tick <= ticks; tick++) {
      const skippedNow = skipped.advanceMovementSkipTicks(1);
      if (skippedNow) skippedTicks += skippedNow;
      // A boundary (0 skipped ticks) falls back to the full fixed tick for this tick.
      else skipped.update(.05);
      exact.update(.05);
      expect(skipped.gameTick(), `clock at tick ${tick}`).toBe(exact.gameTick());
      expect(skipped.snapshot(), `state at tick ${tick}`).toEqual(exact.snapshot());

      const actor = walker(exact);
      if (actor.pathIndex !== previousIndex) {
        // The waypoint boundary must be owned by the normal fixed pipeline, never by a skip tick.
        expect(skippedNow, `waypoint arrival at tick ${tick} ran normally`).toBe(0);
        turns.push(tick);
        if (turns.length === 1) firstTurn = actor;
        if (turns.length === 2) secondTurn = actor;
        previousIndex = actor.pathIndex;
      }
    }

    // Two intermediate turns plus the final arrival.
    expect(turns).toHaveLength(ROUTE.length - 1);
    expect(skippedTicks, "the straight legs were skipped").toBeGreaterThan(1_400);
    const work = snapshotMovementSkipWork();
    expect(work.actorTicks - startWork.actorTicks, "skipped fixed actor ticks").toBe(skippedTicks);
    expect(work.segments - startWork.segments, "each straight leg re-segmented").toBeGreaterThanOrEqual(3);

    // The first turn landed on its waypoint and the boundary tick spent its remainder on the next
    // leg (x up to one step past 2.5); the next leg heads east at z=30.5.
    expect(firstTurn!.x).toBeGreaterThanOrEqual(2.5);
    expect(firstTurn!.x).toBeLessThan(2.55);
    expect(firstTurn!.z).toBeCloseTo(30.5, 5);
    expect(secondTurn!.x).toBeCloseTo(22.5, 5);
    expect(secondTurn!.z).toBeGreaterThan(30.44);
    expect(secondTurn!.z).toBeLessThanOrEqual(30.5);
    expect(secondTurn!.yaw, "facing east before the second turn")
      .toBeGreaterThan(1.3);
    expect(secondTurn!.yaw).toBeLessThan(1.9);
  }, 60_000);
});
