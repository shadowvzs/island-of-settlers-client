import { describe, expect, it } from "vitest";

import { advanceOfflineHarbourShuttles } from "../src/shared/settlement/harbour-shuttle-offline";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { validateNavalState } from "../src/shared/settlement/settlement-save-naval";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import type { SettlementContext, SettlementPoint } from "../src/shared/settlement/settlement-types";
import { createShipSea, SHIP_TICK } from "./helpers/ship-motion-scenarios";

const tick = (fleet: ReturnType<typeof createNavalFleet>, seconds: number) => {
  for (let time = 0; time < seconds; time += SHIP_TICK) fleet.update(SHIP_TICK);
};
const tickUntil = (fleet: ReturnType<typeof createNavalFleet>, check: () => boolean, seconds = 120) => {
  for (let time = 0; time < seconds && !check(); time += SHIP_TICK) fleet.update(SHIP_TICK);
};
const blockHarbourRoads = (context: SettlementContext, harbours: { access: SettlementPoint }[]) => {
  const original = context.options.roads.route;
  const blocked = new Set(harbours.map(harbour => `${harbour.access.x},${harbour.access.z}`));
  context.options.roads.route = (from, to) =>
    blocked.has(`${from.x},${from.z}`) && blocked.has(`${to.x},${to.z}`) ? null : original(from, to);
};
const scenario = () => {
  const sea = createShipSea(), from = sea.harbour(20, 15), to = sea.harbour(44, 15);
  blockHarbourRoads(sea.context, [from, to]);
  from.inventory = { boat: 1, stone: 6 };
  from.idleSettlers = 4;
  sea.context.transfers.push({ count: 3, destination: to.uid, source: from.uid, ware: "stone" });
  const fleet = createNavalFleet(sea.context, sea.sea);
  return { fleet, from, sea, to };
};
const job = (fleet: ReturnType<typeof createNavalFleet>) => fleet.saveState().shuttles?.jobs[0];
const asSave = (sea: ReturnType<typeof createShipSea>, fleet: ReturnType<typeof createNavalFleet>) => ({
  actors: [], buildings: sea.context.buildings,
  naval: { active: [], fleet: structuredClone(fleet.saveState()), modes: [], nextSite: 1, sites: [] },
  world: { cellsX: sea.world.cellsX, cellsZ: sea.world.cellsZ, seed: sea.world.seed }
}) as unknown as SettlementSaveV1;

describe("harbour boat shuttle persistence and offline", () => {
  it("saves mid-voyage and continues the same cargo and route after reload", () => {
    const { fleet, sea, to } = scenario();
    tick(fleet, 5);
    tickUntil(fleet, () => job(fleet)?.phase === "outbound");
    const saved = structuredClone(fleet.saveState()), cargo = { ...job(fleet)!.cargo };
    const next = createNavalFleet(sea.context, sea.sea);
    next.restore(saved);
    expect(next.saveState().shuttles?.jobs[0]?.cargo).toEqual(cargo);
    tick(next, 240);
    expect(to.inventory.stone).toBe(3);
    expect(next.saveState().shuttles?.jobs).toHaveLength(0);
  });

  it("advances a saved job once in the finite fast lane and native continues after a split", () => {
    const { fleet, sea, to } = scenario();
    tick(fleet, 5);
    tickUntil(fleet, () => job(fleet)?.phase === "outbound");
    const fast = structuredClone(fleet.saveState().shuttles!);
    const settlement = { buildings: sea.context.buildings, settlers: sea.context.settlers,
      transfers: sea.context.transfers };
    const timer = fast.jobs[0]!.timer;
    expect(advanceOfflineHarbourShuttles(fast, settlement, 1)).toEqual({ completed: 0, remaining: 1 });
    expect(fast.jobs[0]!.timer).toBeLessThan(timer);
    expect(advanceOfflineHarbourShuttles(fast, settlement, 600).completed).toBe(1);
    expect(to.inventory.stone).toBe(3);
    expect(settlement.settlers).toBe(20);
    expect(fast.jobs).toHaveLength(0);
    // A second fast window cannot duplicate the delivered goods or create a new job.
    expect(advanceOfflineHarbourShuttles(fast, settlement, 600)).toEqual({ completed: 0, remaining: 0 });
    expect(to.inventory.stone).toBe(3);
    const next = createNavalFleet(sea.context, sea.sea);
    next.restore({ ...fleet.saveState(), shuttles: fast });
    tick(next, 30);
    expect(to.inventory.stone).toBe(3);
  });

  it("validates a saved shuttle job and rejects a duplicate source claim", () => {
    const { fleet, sea } = scenario();
    tick(fleet, 5);
    expect(job(fleet)).toBeDefined();
    const save = asSave(sea, fleet);
    const ids = new Set(sea.context.buildings.map(building => building.uid));
    expect(validateNavalState(save as unknown as Record<string, unknown>, ids)).toBeNull();
    const duplicate = structuredClone(save);
    duplicate.naval.fleet.shuttles!.jobs.push({ ...structuredClone(job(fleet)!),
      id: duplicate.naval.fleet.shuttles!.nextJob++ });
    expect(validateNavalState(duplicate as unknown as Record<string, unknown>, ids))
      .toBe("Duplicate or invalid harbour shuttle identity");
  });

  it("refuses an unversioned active crew job while accepting a save without active small boats", () => {
    const { fleet, sea } = scenario();
    tick(fleet, 5);
    const save = asSave(sea, fleet), ids = new Set(sea.context.buildings.map(building => building.uid));
    const current = save.naval.fleet.shuttles!.jobs[0]!;
    expect(current).toMatchObject({ version: 2, crew: 1 });
    delete (current as Partial<typeof current>).version;
    expect(validateNavalState(save as unknown as Record<string, unknown>, ids)).not.toBeNull();
    save.naval.fleet.shuttles!.jobs = [];
    expect(validateNavalState(save as unknown as Record<string, unknown>, ids)).toBeNull();
  });

  it("validates a recovery job after either endpoint is demolished", () => {
    const lostDestination = scenario();
    tick(lostDestination.fleet, 5);
    tickUntil(lostDestination.fleet, () => job(lostDestination.fleet)?.phase === "outbound");
    lostDestination.sea.context.buildings = lostDestination.sea.context.buildings
      .filter(building => building !== lostDestination.to);
    lostDestination.fleet.removeHarbourShuttle(lostDestination.to.uid);
    const destinationSave = asSave(lostDestination.sea, lostDestination.fleet);
    expect(validateNavalState(destinationSave as unknown as Record<string, unknown>,
      new Set(lostDestination.sea.context.buildings.map(building => building.uid)))).toBeNull();

    const lostSource = scenario();
    tick(lostSource.fleet, 5);
    tickUntil(lostSource.fleet, () => job(lostSource.fleet)?.phase === "outbound");
    lostSource.sea.context.buildings = lostSource.sea.context.buildings
      .filter(building => building !== lostSource.from);
    lostSource.fleet.removeHarbourShuttle(lostSource.from.uid);
    const sourceSave = asSave(lostSource.sea, lostSource.fleet);
    expect(validateNavalState(sourceSave as unknown as Record<string, unknown>,
      new Set(lostSource.sea.context.buildings.map(building => building.uid)))).toBeNull();
  });
});
