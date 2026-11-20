import { describe, expect, it } from "vitest";

import { createSettlementHorses } from "../src/shared/settlement/settlement-horses";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import type { WorldData } from "../src/shared/world/world-data";

const make = (uid: number, typeId: number, x: number): SettlementBuilding => ({
  uid, typeId, x, y: 0, z: 5, width: 2, depth: 2, rotation: 0, construction: 1,
  access: { x, z: 7 }, workerApproach: { x, z: 7 }, doorThreshold: { x, z: 6 }, hasDoor: true,
  working: false, door: 0, status: "", input: {}, output: {}, inventory: {}, incoming: {},
  required: {}, accepts: {}, selected: false, cycle: 0
});

const fixture = () => {
  const source = make(1, 29, 10);
  const world = { cellsX: 30, cellsZ: 30, walkCost: new Uint8Array(900).fill(10),
    blocking: new Uint8Array(900), heights: new Float32Array(961), props: { count: 0 } } as unknown as WorldData;
  const context: SettlementContext = { options: { world, roads: {
    route: (a, b) => ({ points: [a, b], cost: Math.hypot(a.x - b.x, a.z - b.z), length: 1 }),
    addRoad: () => true, upgradeRoad: () => true
  } }, buildings: [source], actors: [], occupied: new Uint8Array(900),
    reservations: new Set(), nextActor: 0, nextBuilding: 2, settlers: 20, resourceAmounts: new Map(),
    accumulator: 0, scheduling: 0, transfers: [] };
  context.horses = createSettlementHorses(context);
  return { context, horses: context.horses };
};

const horse = (context: SettlementContext, props: Partial<SettlementActor>): SettlementActor => {
  const actor = { uid: -1, x: 10, y: 0, z: 7, yaw: 0, visible: true, job: "Mount", home: 1,
    building: 1, action: "idle", ware: null, phase: "horseMounted", path: [], pathIndex: 0, timer: 0,
    animationTime: 0, ...props } as SettlementActor;
  context.actors.push(actor); context.horses!.restore(); return actor;
};

describe("commander mount actors", () => {
  it("removes a horse outside every mount phase", () => {
    const { context, horses } = fixture();
    const stray = horse(context, { phase: "home" });
    horses.update(.05);
    expect(context.actors).not.toContain(stray);
    expect(horses.frames()).toHaveLength(0);
  });

  it("keeps a mounted rider's horse and a fallen one", () => {
    const { context, horses } = fixture();
    const mounted = horse(context, { phase: "horseMounted", visible: false });
    const fallen = horse(context, { uid: -2, phase: "horseDead", visible: false });
    horses.update(.05);
    expect(context.actors).toEqual([mounted, fallen]);
    expect(horses.frames().map(frame => frame.id)).toEqual([-1, -2]);
  });
});
