import { describe, expect, it } from "vitest";

import { createSettlementFieldCycles } from "../src/shared/settlement/settlement-field-cycles";
import type {
  ResourceTarget,
  SettlementBuilding,
  SettlementContext
} from "../src/shared/settlement/settlement-types";

const fixture = (typeId: number) => {
  const building = {
    uid: 1,
    typeId,
    input: {},
    x: 4,
    z: 4,
    access: { x: 4, z: 4 },
    workerApproach: { x: 4, z: 4 }
  } as SettlementBuilding;
  const context = {
    options: {
      world: {
        cellsX: 16,
        cellsZ: 16,
        walkCost: new Uint8Array(256).fill(10),
        buildClass: new Uint8Array(256).fill(4),
        blocking: new Uint8Array(256)
      },
      roads: { route: () => null },
      findWorkerPath: (_from: unknown, to: unknown) => [to]
    },
    reservations: new Set(),
    buildings: [building],
    occupied: new Uint8Array(256)
  } as unknown as SettlementContext;
  const cycles = createSettlementFieldCycles(context);
  const target: ResourceTarget = { kind: "field", id: 69, x: 5.5, z: 4.5 };
  return { building, cycles, target, context };
};
describe("persistent crop and charcoal cycles", () => {
  it.each([37, 5])("sowing %i produces no ware and harvesting requires actual growth", (typeId) => {
    const { building, cycles, target } = fixture(typeId);
    expect(cycles.complete(building, target)).toEqual({ success: true });
    expect(cycles.snapshot()[0]?.state).toBe("growing");
    expect(cycles.complete(building, target)).toEqual({ success: false });
    cycles.update(30);
    expect(cycles.complete(building, target)).toEqual({ success: false });
    cycles.update(typeId === 37 ? 90 : 120);
    expect(cycles.complete(building, target)).toEqual({
      success: true,
      ware: typeId === 5 ? "grapes" : "grain"
    });
    expect(cycles.snapshot()[0]?.state).toBe("stubble");
    expect(cycles.complete(building, target)).toEqual({ success: true });
    expect(cycles.snapshot()).toHaveLength(1);
  });
  it("sows more reachable patches while earlier grain grows, then prefers only mature harvest", () => {
    const { building, cycles } = fixture(37);
    const first = cycles.findWork(building)!;
    expect(first.stage).toBe("sow");
    expect(cycles.complete(building, first.target)).toEqual({ success: true });
    cycles.update(20);
    const second = cycles.findWork(building)!;
    expect(second.stage).toBe("sow");
    expect(second.target.id).not.toBe(first.target.id);
    expect(cycles.complete(building, second.target)).toEqual({ success: true });
    expect(cycles.snapshot().filter(site => site.state === "growing")).toHaveLength(2);
    cycles.update(99);
    expect(cycles.findWork(building)?.stage).toBe("sow");
    cycles.update(1);
    const harvest = cycles.findWork(building)!;
    expect(harvest.stage).toBe("harvest");
    expect(harvest.target.id).toBe(first.target.id);
    expect(cycles.snapshot().find(site => site.id === harvest.target.id)?.progress).toBe(1);
    expect(cycles.complete(building, harvest.target)).toEqual({ success: true, ware: "grain" });
    expect(cycles.snapshot().find(site => site.id === second.target.id)?.state).toBe("growing");
  });
  it("charcoal needs twelve building visits, a burn, six uncover visits, then exactly six coal", () => {
    const { building, cycles, target } = fixture(27);
    for (let index = 0; index < 12; index++)
      expect(cycles.complete(building, target)).toEqual({ success: true });
    expect(cycles.snapshot()[0]?.state).toBe("burning");
    expect(cycles.complete(building, target).success).toBe(false);
    cycles.update(59);
    expect(cycles.snapshot()[0]?.state).toBe("burning");
    cycles.update(1);
    for (let index = 0; index < 6; index++)
      expect(cycles.complete(building, target)).toEqual({ success: true });
    expect(cycles.snapshot()[0]?.state).toBe("coal");
    for (let index = 0; index < 6; index++)
      expect(cycles.complete(building, target)).toEqual({ success: true, ware: "coal" });
    expect(cycles.snapshot()[0]?.state).toBe("stubble");
    expect(cycles.complete(building, target)).toEqual({ success: true });
    expect(cycles.snapshot()[0]?.state).toBe("building");
  });
  it("loads one log on alternate visits, covers with earth between, and needs no inputs later", () => {
    const { building, context, cycles, target } = fixture(27);
    building.access = { x: 4, z: 4 };
    building.input = { logs: 6 };
    context.reservations = new Set();
    context.options.findWorkerPath = (_from, to) => [to];
    context.options.roads = {
      route: () => null
    } as unknown as SettlementContext["options"]["roads"];
    context.options.world.walkCost = new Uint8Array(256).fill(10);
    context.options.world.buildClass = new Uint8Array(256).fill(4);
    for (let index = 0; index < 12; index++) {
      const work = cycles.findWork(building)!;
      // Owner rule (2026-10-20): softwood logs only; the covering visits consume no ware.
      const expectedInputs = index % 2 === 0 ? ["logs"] : [];
      expect(work.inputs).toEqual(expectedInputs);
      // Use one persistent cell; selection starts there after its first build visit.
      cycles.complete(building, index === 0 ? target : work.target);
    }
    cycles.update(60);
    expect(cycles.findWork(building)?.inputs).toEqual([]);
    for (let index = 0; index < 6; index++) cycles.complete(building, target);
    expect(cycles.findWork(building)?.inputs).toEqual([]);
  });
  it("refuses another worker's crop and newly occupied field placement", () => {
    const { building, context, cycles, target } = fixture(37);
    context.occupied[target.id] = 1;
    expect(cycles.complete(building, target).success).toBe(false);
    context.occupied[target.id] = 0;
    cycles.complete(building, target);
    expect(cycles.complete({ ...building, uid: 2 }, target).success).toBe(false);
  });
});

describe("flax field lifecycle", () => {
  it("sows flax explicitly, grows for 60 seconds and never falls through to grain", () => {
    const { building, cycles, target } = fixture(60);
    expect(cycles.findWork(building)?.stage).toBe("sow");
    expect(cycles.complete(building, target)).toEqual({ success: true });
    expect(cycles.snapshot()[0]).toMatchObject({ kind: "flax", state: "growing", progress: 0 });
    cycles.update(59.9);
    expect(cycles.snapshot()[0]?.state).toBe("growing");
    cycles.update(.1);
    expect(cycles.snapshot()[0]?.state).toBe("ripe");
    // First contact hand-pulls the stems into a drying bundle; no ware is credited yet.
    expect(cycles.complete(building, target)).toEqual({ success: true });
    expect(cycles.snapshot()[0]?.state).toBe("drying");
    expect(cycles.findWork(building)?.stage).toBe("harvest");
    expect(cycles.complete(building, target)).toEqual({ success: true, ware: "flax" });
    expect(cycles.snapshot()[0]?.state).toBe("stubble");
    // A harvested plot is reused instead of creating another site or returning grain.
    expect(cycles.complete(building, target)).toEqual({ success: true });
    expect(cycles.snapshot()).toHaveLength(1);
    expect(cycles.snapshot()[0]).toMatchObject({ kind: "flax", state: "growing" });
  });

  it("keeps a paid crop on blocked access, full output and demolition boundaries", () => {
    const { building, context, cycles, target } = fixture(60);
    cycles.complete(building, target);
    cycles.update(60);
    context.options.findWorkerPath = () => null;
    expect(cycles.findWork(building)).toBeNull();
    expect(cycles.snapshot()[0]?.state).toBe("ripe");
    context.options.findWorkerPath = (_from, to) => [to];
    cycles.complete(building, target);
    expect(cycles.snapshot()[0]?.state).toBe("drying");
    // An occupied/shared crop cannot be harvested by another farm.
    expect(cycles.complete({ ...building, uid: 2 }, target)).toEqual({ success: false });
    cycles.removeBuilding(building.uid);
    expect(cycles.snapshot()).toEqual([]);
  });

  it("restores saved flax frames with their growth progress", () => {
    const { building, cycles, target } = fixture(60);
    cycles.complete(building, target);
    cycles.update(31);
    const saved = structuredClone(cycles.snapshot());
    cycles.restore(saved);
    expect(cycles.snapshot()[0]).toMatchObject({ kind: "flax", state: "growing" });
    expect(cycles.snapshot()[0]?.progress).toBeCloseTo(saved[0]!.progress, 9);
    cycles.update(29);
    expect(cycles.snapshot()[0]?.state).toBe("ripe");
  });
});
