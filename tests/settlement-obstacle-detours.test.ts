import { expect, it } from "vitest";

import { findObstacleDetour } from "../src/shared/settlement/settlement-obstacle-detours";
import { beginNavigationRepairTick } from "../src/shared/settlement/settlement-repair-budget";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";

const TICK = .05;

const fixture = () => {
  const size = 16;
  return {
    actors: [],
    buildings: [],
    occupied: new Uint8Array(size ** 2),
    reservations: new Set(),
    options: {
      roads: { revision: 0 },
      world: {
        buildRevision: 0,
        cellsX: size,
        cellsZ: size,
        heights: new Float32Array((size + 1) ** 2),
        props: { count: 0 },
        walkCost: new Uint8Array(size ** 2).fill(10)
      }
    }
  } as unknown as SettlementContext;
};

/** A soldier yielding towards a queue target with no route left (perf 2026-11-07: owner save uid 136). */
const yieldingActor = (): SettlementActor => ({
  action: "walk", animationTime: 0, building: 1, home: 0, job: "Soldier", path: [], pathIndex: 0,
  phase: "assigned", queueTarget: { x: 5, z: 5 }, timer: 0, uid: 7, visible: true, ware: null,
  x: 4, y: 0, yaw: 0, z: 4
});

/** Ticks of `seconds`, each beginning the repair budget's tick like the simulation does. */
const tickFor = (context: SettlementContext, seconds: number, step: () => void) => {
  for (let tick = 0; tick < Math.round(seconds / TICK); tick++) {
    beginNavigationRepairTick(context, TICK);
    step();
  }
};

it("does not throw for an actor whose route is empty (it has no waypoint to rejoin)", () => {
  const context = fixture();
  expect(findObstacleDetour(context, yieldingActor(), TICK)).toBeNull();
});

it("tries a failing rejoin once per repair window, not every tick", () => {
  const context = fixture(), actor = yieldingActor();
  let searches = 0;
  const rejoin = () => { searches++; return null; };
  tickFor(context, .95, () => findObstacleDetour(context, actor, TICK, rejoin));
  expect(searches).toBe(1);
  tickFor(context, 1, () => findObstacleDetour(context, actor, TICK, rejoin));
  expect(searches).toBe(2);
});

it("retries at once after a building edit", () => {
  const context = fixture(), actor = yieldingActor();
  let searches = 0;
  const failing = () => { searches++; return null; };
  beginNavigationRepairTick(context, TICK);
  findObstacleDetour(context, actor, TICK, failing);
  context.options.world.buildRevision = 1;
  beginNavigationRepairTick(context, TICK);
  findObstacleDetour(context, actor, TICK, failing);
  expect(searches).toBe(2);
});

it("returns a successful rejoin and lets the next blockage repair at once", () => {
  const context = fixture(), actor = yieldingActor();
  const path = [{ x: 6, z: 6 }];
  beginNavigationRepairTick(context, TICK);
  expect(findObstacleDetour(context, actor, TICK, () => path)).toBe(path);
  let searches = 0;
  beginNavigationRepairTick(context, .25);
  findObstacleDetour(context, actor, TICK, () => { searches++; return null; });
  expect(searches).toBe(1);
});
