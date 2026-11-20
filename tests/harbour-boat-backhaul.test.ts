import { describe, expect, it } from "vitest";

import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { validateNavalState } from "../src/shared/settlement/settlement-save-naval";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import { createShipSea } from "./helpers/ship-motion-scenarios";

const scenario = (startZ = 20, endZ = 68) => {
  const sea = createShipSea(), a = sea.harbour(startZ), b = sea.harbour(44), c = sea.harbour(endZ);
  sea.context.options.roads.route = () => null;
  a.inventory = { boat: 1, stone: 3 }; a.idleSettlers = 1;
  b.inventory = { planks: 2 }; b.idleSettlers = 0;
  c.inventory = { fish: 2 }; c.idleSettlers = 0;
  sea.context.transfers = [
    { count: 3, destination: b.uid, source: a.uid, ware: "stone" },
    { count: 2, destination: c.uid, source: b.uid, ware: "planks" },
    { count: 2, destination: b.uid, source: c.uid, ware: "fish" }
  ];
  return { a, b, c, fleet: createNavalFleet(sea.context, sea.sea), sea };
};
const until = (fleet: ReturnType<typeof createNavalFleet>, check: () => boolean, seconds = 300) => {
  for (let time = 0; time < seconds && !check(); time += .1) fleet.update(.1);
  expect(check(), JSON.stringify({ boats: fleet.harbourShuttles(), jobs: fleet.saveState().shuttles })).toBe(true);
};
const first = (fleet: ReturnType<typeof createNavalFleet>) => fleet.saveState().shuttles!.jobs[0];
const save = (scene: ReturnType<typeof scenario>) => ({
  actors: [], buildings: scene.sea.context.buildings,
  naval: { active: [], fleet: structuredClone(scene.fleet.saveState()), modes: [], nextSite: 1, sites: [] },
  world: { cellsX: scene.sea.world.cellsX, cellsZ: scene.sea.world.cellsZ, seed: scene.sea.world.seed }
}) as unknown as SettlementSaveV1;

describe("same boat and paddler onward cargo work", () => {
  it("chains A→B→C→B without new crew or boats, survives reload and rows home before release", () => {
    const scene = scenario(), { a, b, c, sea } = scene;
    until(scene.fleet, () => first(scene.fleet)?.sourceUid === b.uid);
    const id = first(scene.fleet)!.id;
    expect(first(scene.fleet)).toMatchObject({ crew: 1, homeUid: a.uid, legIndex: 1, phase: "loading", sourceUid: b.uid });
    expect(a.idleSettlers).toBe(0);
    expect(b.idleSettlers).toBe(0);
    expect(a.inventory.boat).toBe(1);
    expect(scene.fleet.localBoatClaims(a.uid)).toBe(1);
    expect(scene.fleet.localBoatClaims(b.uid)).toBe(0);
    const snapshot = save(scene), ids = new Set(sea.context.buildings.map(row => row.uid));
    expect(validateNavalState(snapshot as unknown as Record<string, unknown>, ids)).toBeNull();
    const restored = createNavalFleet(sea.context, sea.sea);
    restored.restore(structuredClone(scene.fleet.saveState()));
    scene.fleet = restored;
    until(restored, () => first(restored)?.sourceUid === c.uid);
    expect(first(restored)).toMatchObject({ crew: 1, homeUid: a.uid, id, legIndex: 2 });
    until(restored, () => first(restored)?.returningHome === true);
    expect(a.idleSettlers).toBe(0); // The paddler is still physically at sea.
    expect(validateNavalState(save(scene) as unknown as Record<string, unknown>, ids)).toBeNull();
    until(restored, () => restored.saveState().shuttles!.jobs.length === 0);
    expect(b.inventory.stone).toBe(3);
    expect(c.inventory.planks).toBe(2);
    expect(b.inventory.fish).toBe(2);
    expect([a.idleSettlers, b.idleSettlers, c.idleSettlers]).toEqual([1, 0, 0]);
    expect([a.inventory.boat, b.inventory.boat ?? 0, c.inventory.boat ?? 0]).toEqual([1, 0, 0]);
    expect(sea.context.settlers).toBe(20);
    expect(restored.localBoatClaims(a.uid)).toBe(0);
    expect(sea.context.transfers).toEqual([]);
  });

  it("chooses the largest real onward request before the eight-unit visible boat limit", () => {
    const scene = scenario(), { a, b, c, sea } = scene;
    b.inventory.planks = 250;
    sea.context.transfers = [
      { id: 1, count: 3, destination: b.uid, source: a.uid, ware: "stone" },
      { id: 2, count: 50, destination: a.uid, source: b.uid, ware: "planks" },
      { id: 3, count: 200, destination: c.uid, source: b.uid, ware: "planks" }
    ];
    until(scene.fleet, () => first(scene.fleet)?.sourceUid === b.uid);
    expect(first(scene.fleet)).toMatchObject({ cargo: { planks: 8 }, destinationUid: c.uid, homeUid: a.uid });
    expect(sea.context.transfers.find(row => row.id === 2)!.count).toBe(50);
    expect(sea.context.transfers.find(row => row.id === 3)!.count).toBe(192);
  });

  it("chooses shorter valid water distance before the older request when uncovered needs tie", () => {
    const scene = scenario(20, 70), { a, b, c, sea } = scene;
    b.inventory.planks = 100;
    sea.context.transfers = [
      { id: 1, count: 3, destination: b.uid, source: a.uid, ware: "stone" },
      { id: 2, count: 50, destination: c.uid, source: b.uid, ware: "planks" },
      { id: 3, count: 50, destination: a.uid, source: b.uid, ware: "planks" }
    ];
    until(scene.fleet, () => first(scene.fleet)?.sourceUid === b.uid);
    expect(first(scene.fleet)!.destinationUid).toBe(a.uid);
    expect(sea.context.transfers.find(row => row.id === 2)!.count).toBe(50);
  });

  it("rows an empty boat to a real recovery harbour when its home disappears during return", () => {
    const scene = scenario(), { a, b, sea } = scene;
    sea.context.transfers.splice(1);
    until(scene.fleet, () => first(scene.fleet)?.phase === "returning");
    scene.fleet.update(.5);
    scene.fleet.removeHarbourShuttle(a.uid);
    sea.context.buildings.splice(sea.context.buildings.indexOf(a), 1);
    expect(b.idleSettlers).toBe(0);
    expect(b.inventory.boat ?? 0).toBe(0);
    until(scene.fleet, () => scene.fleet.saveState().shuttles!.jobs.length === 0);
    expect(b.idleSettlers).toBe(1);
    expect(b.inventory.boat).toBe(1);
  });

  it("cannot release its original crew twice when a loading cancellation is repeated in one tick", () => {
    const scene = scenario();
    scene.fleet.update(.1);
    const id = first(scene.fleet)!.id;
    expect(scene.fleet.cancelHarbourShuttle(id)).toBe(true);
    expect(scene.fleet.cancelHarbourShuttle(id)).toBe(false);
    expect(scene.a.idleSettlers).toBe(1);
    expect(scene.sea.context.settlers).toBe(20);
    expect(scene.a.inventory.stone).toBe(3);
  });

  it("cancels an onward load once at its real source and returns the same paddler home", () => {
    const scene = scenario(), { a, b } = scene;
    until(scene.fleet, () => first(scene.fleet)?.sourceUid === b.uid);
    const id = first(scene.fleet)!.id;
    expect(b.inventory.planks ?? 0).toBe(0);
    expect(scene.fleet.cancelHarbourShuttle(id)).toBe(true);
    expect(b.inventory.planks).toBe(2);
    expect(a.idleSettlers).toBe(0);
    expect(scene.fleet.cancelHarbourShuttle(id)).toBe(false);
    until(scene.fleet, () => scene.fleet.saveState().shuttles!.jobs.length === 0);
    expect(b.inventory.planks).toBe(2);
    expect(a.idleSettlers).toBe(1);
    expect(scene.sea.context.transfers.filter(row => row.source === b.uid && row.ware === "planks"))
      .toEqual([{ count: 2, destination: scene.c.uid, source: b.uid, ware: "planks" }]);
  });
});
