import { describe, expect, it } from "vitest";

import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { NATION_DRINK_CHAINS, PLANTATIONS } from "../src/shared/settlement/nation-drinks";
import { createSettlementFieldCycles, orderPlantingCells } from "../src/shared/settlement/settlement-field-cycles";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";

const fixture = (playerNation: WorkerNation, blocking = new Uint8Array(256)) => {
  const building = { uid: 1, typeId: 5, input: {}, x: 8, z: 8,
    access: { x: 8, z: 8 }, workerApproach: { x: 8, z: 8 } } as SettlementBuilding;
  const context = {
    options: {
      world: {
        cellsX: 16, cellsZ: 16, walkCost: new Uint8Array(256).fill(10),
        buildClass: new Uint8Array(256).fill(4), blocking
      },
      roads: { route: () => null },
      findWorkerPath: (_from: unknown, to: unknown) => [to]
    },
    playerNation, reservations: new Set(), buildings: [building], occupied: new Uint8Array(256)
  } as unknown as SettlementContext;
  return { building, context, cycles: createSettlementFieldCycles(context) };
};
type Fixture = ReturnType<typeof fixture>;

/** Plants (or places) one site through the real work search and returns its id. */
const plantOne = ({ building, cycles }: Fixture) => {
  const work = cycles.findWork(building)!;
  expect(work.inputs).toEqual([]);
  expect(cycles.complete(building, work.target)).toEqual({ success: true });
  return work.target;
};

describe("nation plantations of building 5", () => {
  it("grows every nation's plantation in 150 s; hives and palms both refill in 75 s (owner 2026-10-13)", () => {
    expect(Object.fromEntries(Object.entries(PLANTATIONS).map(([kind, entry]) => [kind, entry.growSeconds])))
      .toEqual({ hive: 150, palm: 150, rice: 150, vine: 150, tea: 150, pomegranate: 150, cacao: 150, berries: 150 });
    expect([PLANTATIONS.hive.regrowSeconds, PLANTATIONS.palm.regrowSeconds]).toEqual([75, 75]);
    expect(PLANTATIONS.rice.regrowSeconds).toBeUndefined();
    expect(PLANTATIONS.vine.regrowSeconds).toBeUndefined();
  });

  it.each(Object.entries(NATION_DRINK_CHAINS))("%s plants its own kind and harvests its raw ware", (nation, chain) => {
    const setup = fixture(nation as WorkerNation);
    const target = plantOne(setup);
    const site = setup.cycles.snapshot()[0]!;
    expect(site.kind).toBe(chain.plantation);
    expect(PLANTATIONS[chain.plantation].ware).toBe(chain.raw);
    setup.cycles.update(PLANTATIONS[chain.plantation].growSeconds - 1);
    expect(setup.cycles.complete(setup.building, target).success).toBe(false);
    setup.cycles.update(1);
    expect(setup.cycles.findWork(setup.building)?.target.id).toBe(target.id);
    expect(setup.cycles.complete(setup.building, target)).toEqual({ success: true, ware: chain.raw });
  });

  it.each(["chinese", "persian", "maya", "indigenous"] as const)(
    "%s keeps vine cadence: no automatic regrowth, a maintenance visit, then 150 seconds",
    nation => {
      const setup = fixture(nation), target = plantOne(setup);
      const chain = NATION_DRINK_CHAINS[nation], tuning = PLANTATIONS[chain.plantation];
      expect(tuning).toMatchObject({ limit: 6, radius: 8, standOff: .6, growSeconds: 150 });
      expect(tuning.regrowSeconds).toBeUndefined();
      setup.cycles.update(150);
      expect(setup.cycles.complete(setup.building, target)).toEqual({ success: true, ware: chain.raw });
      const site = setup.cycles.snapshot()[0]!;
      expect(site).toMatchObject({ state: "stubble", step: 1, progress: 0 });
      setup.cycles.update(10_000);
      expect(site.state).toBe("stubble");
      expect(setup.cycles.complete(setup.building, target)).toEqual({ success: true });
      expect(site).toMatchObject({ state: "growing", step: 1 });
      setup.cycles.update(149.9);
      expect(site.state).toBe("growing");
      setup.cycles.update(.1);
      expect(site.state).toBe("ripe");
    }
  );

  it.each(["chinese", "persian", "maya", "indigenous"] as const)(
    "%s restores established plants and catches growth up with the same result as live ticks",
    nation => {
      const live = fixture(nation), target = plantOne(live);
      live.cycles.update(150);
      live.cycles.complete(live.building, target);
      live.cycles.complete(live.building, target);
      live.cycles.update(37);
      const restored = fixture(nation);
      restored.cycles.restore(JSON.parse(JSON.stringify(live.cycles.snapshot())));
      for (let second = 0; second < 113; second++) live.cycles.update(1);
      restored.cycles.update(113);
      expect(restored.cycles.snapshot()).toEqual(live.cycles.snapshot());
      expect(restored.cycles.snapshot()[0]!.state).toBe("ripe");
      expect(restored.cycles.complete(restored.building, target)).toEqual({
        success: true, ware: NATION_DRINK_CHAINS[nation].raw
      });
    }
  );

  it("the beekeeper sets at most six hives, which stay and refill after each honey harvest", () => {
    const setup = fixture("viking");
    const hives = Array.from({ length: 6 }, () => plantOne(setup));
    expect(new Set(hives.map(hive => hive.id)).size).toBe(6);
    expect(setup.cycles.findWork(setup.building)).toBeNull();
    setup.cycles.update(PLANTATIONS.hive.growSeconds);
    expect(setup.cycles.complete(setup.building, hives[0]!)).toEqual({ success: true, ware: "honey" });
    const hive = setup.cycles.snapshot().find(site => site.id === hives[0]!.id)!;
    expect(hive.state).toBe("fruiting");
    expect(setup.cycles.isOccupied(hive.x, hive.z)).toBe(true);
    setup.cycles.update(PLANTATIONS.hive.regrowSeconds! - 1);
    expect(setup.cycles.complete(setup.building, hives[0]!).success).toBe(false);
    setup.cycles.update(1);
    expect(hive.state).toBe("ripe");
    expect(setup.cycles.snapshot()).toHaveLength(6);
  });

  it("palms persist: never stubble, occupy their cell for foresters and bear coconuts again", () => {
    const setup = fixture("nubian");
    const palm = plantOne(setup);
    const site = setup.cycles.snapshot()[0]!;
    expect(setup.cycles.isOccupied(site.x, site.z)).toBe(true);
    setup.cycles.update(PLANTATIONS.palm.growSeconds);
    for (let harvest = 0; harvest < 3; harvest++) {
      expect(setup.cycles.complete(setup.building, palm)).toEqual({ success: true, ware: "coconut" });
      expect(site.state).toBe("fruiting");
      expect(setup.cycles.isOccupied(site.x, site.z)).toBe(true);
      setup.cycles.update(PLANTATIONS.palm.regrowSeconds!);
      expect(site.state).toBe("ripe");
    }
    expect(PLANTATIONS.palm.regrowSeconds).toBeLessThan(PLANTATIONS.palm.growSeconds);
  });

  it("rice paddies join into one field: every new paddy shares a side with an earlier one", () => {
    // A blocked ring round the building leaves two equally near free cells on opposite sides.
    const blocking = new Uint8Array(256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++)
      if (Math.hypot(x + .5 - 8, z + .5 - 8) <= 3.6) blocking[z * 16 + x] = 1;
    blocking[7 * 16 + 4] = 0;
    blocking[8 * 16 + 11] = 0;
    const setup = fixture("japanese", blocking);
    const paddies = Array.from({ length: PLANTATIONS.rice.limit }, () => plantOne(setup));
    const sideBySide = (a: { x: number; z: number }, b: { x: number; z: number }) =>
      a !== b && Math.abs(a.x - b.x) + Math.abs(a.z - b.z) < 1.01;
    paddies.slice(1).forEach((paddy, index) =>
      expect(paddies.slice(0, index + 1).some(earlier => sideBySide(paddy, earlier))).toBe(true));
  });

  it("rice paddies sit side by side in open ground; vines keep their spacing", () => {
    const rice = fixture("japanese");
    const paddies = Array.from({ length: PLANTATIONS.rice.limit }, () => plantOne(rice));
    const orthogonal = paddies.filter(paddy => paddies.some(other =>
      other !== paddy && Math.abs(other.x - paddy.x) + Math.abs(other.z - paddy.z) < 1.01));
    expect(orthogonal).toHaveLength(paddies.length);
    const vines = fixture("roman");
    const planted = Array.from({ length: 4 }, () => plantOne(vines));
    for (const vine of planted) for (const other of planted)
      if (vine !== other) expect(Math.hypot(vine.x - other.x, vine.z - other.z)).toBeGreaterThanOrEqual(1.4);
  });

  it("other plantations keep the nearest-cell order (vines are not forced together)", () => {
    const building = { x: 8, z: 8 } as SettlementBuilding;
    const near = { id: 1, kind: "field" as const, x: 8.5, z: 6.5 };
    const adjoining = { id: 2, kind: "field" as const, x: 11.5, z: 8.5 };
    const plots = [{ id: 0, owner: 1, kind: "vine" as const, x: 11.5, z: 9.5, state: "growing" as const,
      progress: 0, step: 0 }];
    expect(orderPlantingCells([adjoining, near], building, "vine", plots)[0]).toBe(near);
    const ricePlots = plots.map(plot => ({ ...plot, kind: "rice" as const }));
    expect(orderPlantingCells([near, adjoining], building, "rice", ricePlots)[0]).toBe(adjoining);
  });

  it("rice paddies are field crops: harvested to stubble and replanted", () => {
    const setup = fixture("japanese");
    const paddy = plantOne(setup);
    setup.cycles.update(PLANTATIONS.rice.growSeconds);
    expect(setup.cycles.complete(setup.building, paddy)).toEqual({ success: true, ware: "rice" });
    expect(setup.cycles.snapshot()[0]!.state).toBe("stubble");
    expect(setup.cycles.complete(setup.building, paddy)).toEqual({ success: true });
    expect(setup.cycles.snapshot()[0]!.state).toBe("growing");
  });

  it("keeps a harvesting winegrower outside the grape trellis rather than at its centre", () => {
    const setup = fixture("roman");
    const target = plantOne(setup);
    setup.cycles.update(PLANTATIONS.vine.growSeconds);
    const work = setup.cycles.findWork(setup.building)!;
    expect(work.target.id).toBe(target.id);
    const end = work.path.at(-1)!;
    expect(Math.hypot(end.x - target.x, end.z - target.z)).toBeCloseTo(.6);
    expect(setup.cycles.complete(setup.building, target)).toEqual({ success: true, ware: "grapes" });
  });

  it("the beekeeper stands beside a hive instead of on it", () => {
    const setup = fixture("viking");
    const work = setup.cycles.findWork(setup.building)!;
    const end = work.path.at(-1)!;
    expect(Math.hypot(end.x - work.target.x, end.z - work.target.z)).toBeCloseTo(PLANTATIONS.hive.standOff);
  });

  it("removes a demolished producer's hives and palms with it", () => {
    const setup = fixture("nubian");
    plantOne(setup);
    setup.cycles.removeBuilding(setup.building.uid);
    expect(setup.cycles.snapshot()).toHaveLength(0);
  });
});
