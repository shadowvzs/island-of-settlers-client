import { describe, expect, it } from "vitest";

import { shuttlePorters } from "../src/app/settlement/dock-porters";
import { rememberIslandRocks } from "../src/render-common/rocks/island-rock-instances";
import type { RockInstance } from "../src/render-common/rocks/rock-instances";
import { BOAT_JETTY_DECK_WIDTH } from "../src/render-common/ships/lighter-dimensions";
import { SAILING_SHIP_OVERALL_BEAM, SAILING_SHIP_OVERALL_LENGTH }
  from "../src/render-common/ships/ship-dimensions";
import { boatJettyReservedAt, boatJettyRoadClear } from "../src/shared/settlement/harbour-boat-reservations";
import { boatJettyPlacementReason } from "../src/shared/settlement/harbour-boat-reservations";
import { BOAT_TURN_RADIUS } from "../src/shared/settlement/harbour-boat-route";
import { beginFoundationChange, finishFoundationChange } from "../src/shared/settlement/settlement-foundation-changes";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import type { SettlementContext, SettlementPoint } from "../src/shared/settlement/settlement-types";
import { storageContribution } from "../src/shared/settlement/storage-capacity";
import { createShipSea, createShipSeaWorld, SHIP_TICK } from "./helpers/ship-motion-scenarios";

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
const firstJob = (fleet: ReturnType<typeof createNavalFleet>) => fleet.saveState().shuttles?.jobs[0];
const insideShipEnvelope = (point: SettlementPoint, pose: SettlementPoint & { yaw?: number }) => {
  const yaw = pose.yaw ?? 0, dx = point.x - pose.x, dz = point.z - pose.z;
  const along = dx * Math.sin(yaw) + dz * Math.cos(yaw), across = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  return Math.abs(along) <= SAILING_SHIP_OVERALL_LENGTH / 2 && Math.abs(across) <= SAILING_SHIP_OVERALL_BEAM / 2;
};
const scenario = (options: { spur?: { z0: number; z1: number; tip: number }; third?: boolean } = {}) => {
  const sea = createShipSea(160, options.spur), from = sea.harbour(options.third ? 40 : 20, 15);
  const to = sea.harbour(options.third ? 15 : 44, 15);
  const far = options.third ? sea.harbour(65, 15) : undefined;
  blockHarbourRoads(sea.context, [from, to, ...(far ? [far] : [])]);
  from.inventory = { boat: 1, stone: 6 };
  from.idleSettlers = 4;
  sea.context.transfers.push({ count: 3, destination: to.uid, source: from.uid, ware: "stone" },
    ...(far ? [{ count: 3, destination: far.uid, source: from.uid, ware: "stone" }] : []));
  const fleet = createNavalFleet(sea.context, sea.sea);
  return { far, fleet, from, sea, to };
};

describe("nearby harbour boat shuttle", () => {
  it("protects the idle jetty and dry approach before a boat job exists, including after restore", () => {
    const { fleet, sea } = scenario();
    const site = fleet.shuttleJetties()[0]!.workPier!;
    expect(fleet.saveState().shuttles?.jobs).toHaveLength(0);
    expect(boatJettyReservedAt(sea.context, site.shore)).toBe(true);
    const plot = makeBuilding(sea.context, 1, site.shore.x, site.shore.z, 0);
    expect(boatJettyPlacementReason(sea.context, plot)).toMatch(/jetty/);
    expect(boatJettyRoadClear(sea.context, [site.shore, site.point])).toBe(false);
    const harbour = sea.context.buildings[0]!;
    expect(boatJettyRoadClear(sea.context, [harbour.access, { x: harbour.access.x - 2, z: harbour.access.z }])).toBe(true);
    const restored = createNavalFleet(sea.context, sea.sea);
    restored.restore(fleet.saveState());
    expect(boatJettyReservedAt(sea.context, site.shore)).toBe(true);
  });
  it("uses only the one claimed boatman on real carrying routes and restores their midwalk pose", () => {
    const { fleet, from, sea } = scenario();
    tickUntil(fleet, () => Boolean(firstJob(fleet)));
    expect(from.idleSettlers).toBe(3);
    let witnessed = false;
    for (let time = 0; time < 80 && firstJob(fleet)?.phase === "loading"; time += SHIP_TICK) {
      const frames = fleet.shuttleFrames(), actors = shuttlePorters(sea.world, frames);
      expect(actors.length).toBeLessThanOrEqual(1);
      if (actors.some(actor => actor.ware && actor.locomotionSpeed! > 0)) {
        const saved = structuredClone(fleet.saveState());
        const restored = createNavalFleet(sea.context, sea.sea); restored.restore(saved);
        expect(shuttlePorters(sea.world, restored.shuttleFrames())).toEqual(actors);
        expect(actors.every(actor => Number.isFinite(actor.y))).toBe(true);
        witnessed = true; break;
      }
      fleet.update(SHIP_TICK);
    }
    expect(witnessed).toBe(true);
  });
  it("reconstructs the current hull-side handling contact without restarting the clock or changing ownership", () => {
    const { fleet, sea } = scenario();
    tickUntil(fleet, () => Boolean(firstJob(fleet)));
    const save = structuredClone(fleet.saveState()), job = save.shuttles!.jobs[0]!;
    job.sourceRoute[job.sourceRoute.length - 1] = { ...job.sourceLanding };
    job.destinationRoute[job.destinationRoute.length - 1] = { ...job.destinationLanding };
    const timer = job.timer, cargo = { ...job.cargo }, crew = job.crew;
    const restored = createNavalFleet(sea.context, sea.sea); restored.restore(save);
    const actual = firstJob(restored)!;
    expect(actual.timer).toBe(timer); expect(actual.cargo).toEqual(cargo); expect(actual.crew).toBe(crew);
    expect(actual.sourceRoute.at(-1)).not.toEqual(actual.sourceLanding);
    expect(actual.destinationRoute.at(-1)).not.toEqual(actual.destinationLanding);
  });
  it("revalidates idle jetties when the native rendered rock envelopes become available", () => {
    const { fleet, sea } = scenario();
    expect(fleet.shuttleJetties()).toHaveLength(2);
    rememberIslandRocks(sea.world, [{ axes: [[10, 0, 0], [0, 6, 0], [0, 0, 300]],
      centre: [20, -1, 60], role: 0, exposure: 0, family: 2, high: true, moss: 0, slab: 1, tint: 0, variant: 0 } satisfies RockInstance]);
    expect(fleet.shuttleJetties()).toHaveLength(0);
  });
  it("recovers the exact load and finite boatmen when terrain removes their loading path", () => {
    const { fleet, from, sea } = scenario();
    tickUntil(fleet, () => Boolean(firstJob(fleet)));
    expect(firstJob(fleet)?.phase).toBe("loading");
    for (let i = 0; i < sea.world.heights.length; i++)
      if (sea.world.heights[i]! >= 0) sea.world.heights[i] = 8;
    sea.world.terrainRevision = (sea.world.terrainRevision ?? 0) + 1;
    tick(fleet, .1);
    expect(firstJob(fleet)).toBeUndefined();
    expect(from.inventory.stone).toBe(6);
    expect(from.idleSettlers).toBe(4);
    expect(sea.context.transfers[0]?.count).toBe(3);
  });
  it("rejects a cliff-foot landing instead of drawing its board through exposed terrain", () => {
    const { fleet, sea } = scenario();
    for (let i = 0; i < sea.world.heights.length; i++)
      if (sea.world.heights[i]! >= 0) sea.world.heights[i] = 8;
    sea.world.terrainRevision = (sea.world.terrainRevision ?? 0) + 1;
    expect(fleet.shuttleJetties()).toHaveLength(0);
  });
  it("clears the permanent jetty through departure turns and removes its loading gangway before rowing", () => {
    const { fleet } = scenario();
    tick(fleet, 5);
    const job = firstJob(fleet)!;
    expect(job.phase).toBe("loading");
    const point = job.sourceRoute.at(-2)!;
    expect(Math.hypot(job.sourceLanding.x - point.x, job.sourceLanding.z - point.z))
      .toBeGreaterThan(BOAT_TURN_RADIUS + BOAT_JETTY_DECK_WIDTH / 2);
    const loading = fleet.shuttleFrames()[0]!;
    expect(loading.gangway?.from).toMatchObject(point);
    expect(loading.rowing).toBe(false);
    tickUntil(fleet, () => firstJob(fleet)?.phase === "outbound");
    expect(fleet.shuttleFrames()[0]!.gangway).toBeUndefined();
    firstJob(fleet)!.yielding = true;
    expect(fleet.shuttleFrames()[0]!.rowing).toBe(false);
  });

  it("retains distant jetties across local founding work and unknown revisions, renewing a changed one", () => {
    const sea = createShipSea(220), from = sea.harbour(20, 15), to = sea.harbour(44, 15);
    blockHarbourRoads(sea.context, [from, to]);
    // Real porter routes: a stub `findWorkerPath` would hide what each jetty search read.
    delete sea.context.options.findWorkerPath;
    const fleet = createNavalFleet(sea.context, sea.sea);
    const before = fleet.shuttleJetties();
    expect(before).toHaveLength(2);
    const far = { ...from, x: 10, z: 180, width: 2, depth: 2 };
    const receipt = beginFoundationChange(sea.world, far);
    sea.world.heights[180 * (sea.world.cellsX + 1) + 10] = .1;
    sea.world.terrainRevision = (sea.world.terrainRevision ?? 0) + 1;
    sea.world.buildRevision = (sea.world.buildRevision ?? 0) + 1;
    finishFoundationChange(sea.world, receipt);
    expect(fleet.shuttleJetties()).toBe(before);
    // An editor/unknown revision that changed none of a jetty's copied inputs keeps it too (JETTY-FRAMES).
    sea.world.terrainRevision++;
    expect(fleet.shuttleJetties()).toBe(before);
    // Occupying the first jetty's dry foot changes what its search read: that jetty is searched again.
    const foot = before[0]!.workPier!.shore;
    sea.context.occupied[Math.floor(foot.z) * sea.world.cellsX + Math.floor(foot.x)] = 1;
    sea.world.terrainRevision++;
    const after = fleet.shuttleJetties();
    expect(after).not.toBe(before);
    expect(after[1]).toBe(before[1]);
    expect(after[0]!.workPier!.shore).not.toEqual(foot);
  });

  it("finds a safe boat landing and carries a real transfer", () => {
    const { fleet, from, sea, to } = scenario();
    expect(fleet.shuttleJetties()).toHaveLength(2);
    expect(fleet.harbourShuttleStatus(from.uid)?.reason).toBe("idle");
    expect(fleet.harbourShuttleStatus(to.uid)?.reason).toBe("waiting-boat");
    tick(fleet, 5);
    expect(fleet.saveState().shuttles?.jobs).toHaveLength(1);
    expect(to.incoming.stone).toBe(3);
    expect(fleet.harbourShuttleStatus(from.uid)?.reason).toBe("active");
    tick(fleet, 200);
    expect(to.inventory.stone).toBe(3);
    expect(to.incoming.stone ?? 0).toBe(0);
    expect(from.inventory.stone).toBe(3);
    expect(sea.context.transfers).toHaveLength(0);
    expect(from.idleSettlers).toBe(4);
  });

  it("refuses a straight-line-near pair whose real water route is beyond 1.5x fishery range", () => {
    const { fleet, from, sea, to } = scenario({ spur: { tip: 70, z0: 30, z1: 32 } });
    expect(fleet.shuttleJetties()).toHaveLength(2);
    expect(fleet.harbourShuttleStatus(from.uid)?.reason).toBe("no-route");
    tick(fleet, 20);
    expect(fleet.saveState().shuttles?.jobs).toHaveLength(0);
    expect(sea.context.transfers).toHaveLength(1);
    expect(to.inventory.stone).toBeUndefined();
  });

  it("does not advertise a service where no dedicated landing fits", () => {
    // A two-cell-wide shelf is too narrow for the hull/oar turning disk, even though it is water.
    const sea = createShipSeaWorld(60, 60, x => x < 20 || x > 22), harbour = sea.harbour(30, 15);
    const fleet = createNavalFleet(sea.context, sea.sea);
    expect(fleet.shuttleJetties()).toHaveLength(0);
    expect(fleet.harbourShuttleStatus(harbour.uid)?.reason).toBe("no-landing");
  });

  it("waits for a boat and one real paddler instead of spawning either", () => {
    const { fleet, from } = scenario();
    from.inventory.boat = 0;
    tick(fleet, 10);
    expect(fleet.harbourShuttleStatus(from.uid)?.reason).toBe("waiting-boat");
    expect(fleet.saveState().shuttles?.jobs).toHaveLength(0);
    from.inventory.boat = 1; from.idleSettlers = 0;
    tick(fleet, 10);
    expect(fleet.harbourShuttleStatus(from.uid)?.reason).toBe("no-crew");
    expect(fleet.saveState().shuttles?.jobs).toHaveLength(0);
    from.idleSettlers = 1;
    tick(fleet, 5);
    expect(fleet.saveState().shuttles?.jobs).toHaveLength(1);
    expect(from.idleSettlers).toBe(0);
  });

  it("gives one boat to only one of two waiting services, then serves the other", () => {
    const { far, fleet, from, to } = scenario({ third: true });
    tick(fleet, 5);
    const jobs = fleet.saveState().shuttles?.jobs ?? [];
    expect(jobs).toHaveLength(1);
    const firstDestination = jobs[0]!.destinationUid;
    tick(fleet, 320);
    const destinations = [to, far!].filter(building => (building.inventory.stone ?? 0) === 3);
    expect(fleet.harbourShuttleStatus(from.uid)?.reason).toBe("idle");
    expect(destinations).toHaveLength(2);
    expect([to.uid, far!.uid]).toContain(firstDestination);
    expect(from.idleSettlers).toBe(4);
  });

  it("carries a partial load when the source has less than the transfer asks", () => {
    const { fleet, from, to } = scenario();
    from.inventory.stone = 3;
    tick(fleet, 5);
    expect(fleet.saveState().shuttles?.jobs?.[0]?.cargo).toEqual({ stone: 3 });
    tick(fleet, 200);
    expect(to.inventory.stone).toBe(3);
    expect(from.inventory.stone).toBeUndefined();
  });

  it("returns cargo and reopens the transfer claim when cancelled after loading", () => {
    const { fleet, from, sea, to } = scenario();
    tick(fleet, 5);
    const job = firstJob(fleet)!;
    tickUntil(fleet, () => firstJob(fleet)?.phase === "outbound");
    expect(firstJob(fleet)?.phase).toBe("outbound");
    expect(fleet.cancelHarbourShuttle(job.id)).toBe(true);
    from.inventory.boat = 0;
    tick(fleet, 120);
    expect(fleet.saveState().shuttles?.jobs).toHaveLength(0);
    expect(to.inventory.stone).toBeUndefined();
    expect(from.inventory.stone).toBe(6);
    expect(from.idleSettlers).toBe(4);
    expect(to.incoming.stone ?? 0).toBe(0);
    expect(sea.context.transfers).toHaveLength(1);
  });

  it("holds cargo when the destination is full, then returns it safely", () => {
    const { fleet, from, sea, to } = scenario();
    tick(fleet, 5);
    expect(firstJob(fleet)).toBeDefined();
    const capacity = storageContribution(to, 0);
    to.inventory.stone = capacity; from.inventory.stone = capacity;
    tickUntil(fleet, () => firstJob(fleet)?.interrupted === "destination-full", 120);
    expect(to.inventory.stone).toBe(capacity);
    expect(firstJob(fleet)?.cargo.stone).toBe(3);
    from.inventory.boat = 0; from.inventory.stone = 0;
    tickUntil(fleet, () => !firstJob(fleet), 120);
    expect(firstJob(fleet)).toBeUndefined();
    expect(from.inventory.stone).toBe(3);
    expect(sea.context.transfers).toHaveLength(1);
  });

  it("returns the actual cargo to source when the destination is demolished", () => {
    const { fleet, from, sea, to } = scenario();
    tick(fleet, 5);
    tickUntil(fleet, () => firstJob(fleet)?.phase === "outbound");
    sea.context.buildings = sea.context.buildings.filter(building => building !== to);
    fleet.removeHarbourShuttle(to.uid);
    tick(fleet, 120);
    expect(fleet.saveState().shuttles?.jobs).toHaveLength(0);
    expect(from.inventory.stone).toBe(6);
    // The deleted destination cannot own a restored claim; the goods are free at the source.
    expect(sea.context.transfers).toHaveLength(0);
  });

  it("delivers to the destination and recovers boat/crew when the source is demolished", () => {
    const { fleet, from, sea, to } = scenario();
    tick(fleet, 5);
    tickUntil(fleet, () => firstJob(fleet)?.phase === "outbound");
    sea.context.buildings = sea.context.buildings.filter(building => building !== from);
    tick(fleet, 160);
    expect(to.inventory.stone).toBe(3);
    expect(to.idleSettlers).toBe(1);
    expect(to.inventory.boat).toBe(1);
    expect(sea.context.settlers).toBe(20);
  });

  it("re-searches the landing when a new ship berth appears instead of claiming it", () => {
    const { fleet, from } = scenario();
    from.workshopUpgrade = { level: 2 };
    const berths = fleet.harbourBerths(from.uid);
    expect(berths.length).toBe(2);
    const landings = fleet.shuttleJetties().filter(frame => frame.id === 3_000_000 + from.uid)
      .map(frame => frame.workPier!.contact);
    for (const landing of landings)
      for (const berth of berths) expect(insideShipEnvelope(landing, berth)).toBe(false);
  });

  it("shares the water with an entering sea ship and still delivers both loads", () => {
    const { fleet, from, to } = scenario();
    from.inventory.stone = 10;
    fleet.addShip({ x: 40.5, z: 40.5 }, 0);
    expect(fleet.queueTransport(from.uid, to.uid, { stone: 1 })).not.toBeNull();
    tick(fleet, 420);
    expect(to.inventory.stone).toBe(4);
    expect(fleet.pending()).toHaveLength(0);
    expect(fleet.frames().some(ship => ship.phase === "stranded")).toBe(false);
  });
});
