import { describe, expect, it } from "vitest";

import {
  SAILING_SHIP_HULL_LENGTH, SAILING_SHIP_SPACING, SAILING_SHIP_TURN_RADIUS
} from "../src/render-common/ships/ship-dimensions";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { createSeaMask, findCoastalWorkSite } from "../src/shared/settlement/settlement-sea-navigation";
import {
  createShipClearanceMasks, shipHullFitsSea, shipsOverlap, shipsPenetration
} from "../src/shared/settlement/settlement-ship-clearance";
import { createShipRoutePlanner } from "../src/shared/settlement/settlement-ship-routes";
import {
  advanceShipCursor, manoeuvreShip, sailOrder, sailShip, SHIP_TURN_RATE
} from "../src/shared/settlement/settlement-ship-steering";
import { advanceShipPier,findShipWorkpoint } from "../src/shared/settlement/settlement-ship-workpoint";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { sampleSmooth } from "../src/shared/world/grid-geometry";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const size = 80, heights = new Float32Array((size + 1) ** 2);
  for (let z = 0; z <= size; z++) for (let x = 20; x <= size; x++) heights[z * (size + 1) + x] = -2;
  const world = { cellsX: size, cellsZ: size, seaLevel: -1, heights,
    blocking: new Uint8Array(size ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  for (let z = 0; z < size; z++) for (let x = 20; x < size; x++) world.walkCost[z * size + x] = 0;
  const context: SettlementContext = { options: { world, findWorkerPath: (_from, to) => [{ ...to }],
    roads: { route: (_from: { x: number; z: number }, to: { x: number; z: number }) => ({ points: [{ ...to }], length: 1, cost: 1 }) } as any },
    buildings: [], actors: [], occupied: new Uint8Array(size ** 2), reservations: new Set(),
    nextActor: 1, nextBuilding: 1, settlers: 20, resourceAmounts: new Map(), accumulator: 0, scheduling: 0, transfers: [] };
  const harbor = (z: number) => {
    const building = makeBuilding(context, 39, 15, z, 0); building.construction = 1;
    context.buildings.push(building); return building;
  };
  return { world, context, harbor, sea: createSeaMask(world) };
};

describe("large sailing ship space", () => {
  it("turns offshore and reaches a shallow oriented berth with the complete hull afloat", () => {
    const { sea, world } = fixture();
    const planner = createShipRoutePlanner(world, sea);
    const berth = { x: 23.5, yaw: 0, z: 30.5 };
    expect(shipHullFitsSea(world, sea, berth)).toBe(true);
    expect(planner.masks.turning[30 * world.cellsX + 23]).toBe(0);
    let pose = { speed: 0, x: 40.5, yaw: 0, z: 45.5 }, cursor = 0;
    const route = planner.route(pose, berth)!;
    expect(route).not.toBeNull();
    expect(route.at(-1)).toMatchObject(berth);
    for (let tick = 0; tick < 8000 && cursor < route.length; tick++) {
      if (route[cursor]!.yaw === undefined) cursor = advanceShipCursor(pose, route, cursor);
      const move = route[cursor]!.yaw === undefined
        ? sailShip(pose, route, cursor, sailOrder(pose, route, cursor), .05) : manoeuvreShip(pose, route, cursor, .05);
      expect(shipHullFitsSea(world, sea, move)).toBe(true);
      expect(Math.hypot(move.x - pose.x, move.z - pose.z)).toBeLessThanOrEqual(.075001);
      pose = move; cursor += move.advance;
    }
    expect(cursor).toBe(route.length);
    expect(Math.hypot(pose.x - berth.x, pose.z - berth.z)).toBeLessThan(.05);
    expect(pose.yaw).toBeCloseTo(berth.yaw);
  });
  it("tests the whole wet hull and keeps construction sites far enough apart to turn", () => {
    const { context, harbor, sea, world } = fixture(), building = harbor(30);
    expect(shipHullFitsSea(world, sea, { x: 20.5, z: 30.5, yaw: 0 })).toBe(false);
    const first = findCoastalWorkSite(context, building, sea)!;
    expect(first).toBeTruthy();
    expect(Math.hypot(first.water.x - first.land.x, first.water.z - first.land.z)).toBeLessThan(3);
    expect(shipHullFitsSea(world, sea, { ...first.water, yaw: first.yaw! })).toBe(true);
    const second = findCoastalWorkSite(context, building, sea, new Set([`${first.water.x},${first.water.z}`]))!;
    expect(second).toBeTruthy();
    expect(Math.hypot(first.water.x - second.water.x, first.water.z - second.water.z))
      .toBeGreaterThan(2 * SAILING_SHIP_TURN_RADIUS);
    expect(createShipClearanceMasks(world, sea).turning[30 * 80 + 21]).toBe(0);
  });
  it("includes rigs and orientation in collision, rather than a tiny center distance", () => {
    const ship = { x: 20, z: 20, yaw: 0 };
    expect(shipsOverlap(ship, { x: 20, z: 30, yaw: 0 })).toBe(true);
    expect(shipsOverlap(ship, { x: 27, z: 20, yaw: 0 })).toBe(false);
    expect(shipsOverlap(ship, { x: 27, z: 20, yaw: Math.PI / 2 })).toBe(true);
  });
  it("moves two paid voyages through distinct berths without overlapping or losing cargo", () => {
    const { context, harbor, sea } = fixture(), source = harbor(20), destination = harbor(60);
    source.inventory = { planks: 40 };
    const fleet = createNavalFleet(context, sea);
    fleet.addShip({ x: 23.5, z: 12.5 }, Math.PI); fleet.addShip({ x: 23.5, z: 45.5 }, Math.PI);
    expect(fleet.queueTransport(source.uid, destination.uid, { planks: 10 })).not.toBeNull();
    expect(fleet.queueTransport(source.uid, destination.uid, { planks: 10 })).not.toBeNull();
    let largestStep = 0;
    for (let i = 0; i < 12000 && (destination.inventory.planks ?? 0) < 20; i++) {
      const previous = fleet.frames(); fleet.update(.05); const frames = fleet.frames();
      // Rig envelopes never touch; only the clearance gap may be used up in a crowded harbour.
      expect(shipsPenetration(frames[0]!, frames[1]!)).toBeLessThanOrEqual(SAILING_SHIP_SPACING + 1e-9);
      for (let ship = 0; ship < frames.length; ship++) largestStep = Math.max(largestStep,
        Math.hypot(frames[ship]!.x - previous[ship]!.x, frames[ship]!.z - previous[ship]!.z));
      if (i === 500) fleet.restore(structuredClone(fleet.saveState()));
    }
    expect(destination.inventory.planks, JSON.stringify(fleet.saveState())).toBe(20);
    expect(source.inventory.planks).toBe(20);
    expect(fleet.snapshot().reduce((total, ship) => total + (ship.cargo.planks ?? 0), 0)).toBe(0);
    expect(largestStep).toBeLessThanOrEqual(.075001);
  });
  it("physically frees a legacy ship center near shore before using the wide sea route", () => {
    const { context, harbor, sea, world } = fixture(), source = harbor(20), destination = harbor(60);
    source.inventory = { stone: 5 }; const fleet = createNavalFleet(context, sea);
    fleet.addShip({ x: 20.5, z: 12.5 }, 0);
    expect(fleet.queueTransport(source.uid, destination.uid, { stone: 5 })).not.toBeNull();
    let largestStep = 0;
    for (let i = 0; i < 12000 && (destination.inventory.stone ?? 0) < 5; i++) {
      const previous = fleet.frames()[0]!; fleet.update(.05); const ship = fleet.frames()[0]!;
      largestStep = Math.max(largestStep, Math.hypot(ship.x - previous.x, ship.z - previous.z));
    }
    expect(destination.inventory.stone).toBe(5);
    expect(shipHullFitsSea(world, sea, fleet.frames()[0]!)).toBe(true);
    expect(largestStep).toBeLessThanOrEqual(.075001);
  });
  it("separates a crowded legacy fleet physically while retaining both receipts", () => {
    const { context, harbor, sea } = fixture(), source = harbor(20), destination = harbor(60);
    source.inventory = { stone: 10 }; const fleet = createNavalFleet(context, sea);
    fleet.addShip({ x: 20.5, z: 12.5 }, 0); fleet.addShip({ x: 20.5, z: 14.5 }, 0);
    expect(fleet.queueTransport(source.uid, destination.uid, { stone: 5 })).not.toBeNull();
    expect(fleet.queueTransport(source.uid, destination.uid, { stone: 5 })).not.toBeNull();
    let largestStep = 0, separated = false;
    for (let i = 0; i < 32000 && (destination.inventory.stone ?? 0) < 10; i++) {
      const previous = fleet.frames(); fleet.update(.05); const frames = fleet.frames();
      // Once apart, the rig envelopes never touch again (only the clearance gap may be used up).
      const depth = shipsPenetration(frames[0]!, frames[1]!);
      if (separated) expect(depth).toBeLessThanOrEqual(SAILING_SHIP_SPACING + 1e-9);
      separated ||= depth <= 0;
      for (let ship = 0; ship < frames.length; ship++) largestStep = Math.max(largestStep,
        Math.hypot(frames[ship]!.x - previous[ship]!.x, frames[ship]!.z - previous[ship]!.z));
    }
    expect(destination.inventory.stone, JSON.stringify(fleet.saveState())).toBe(10);
    expect(separated).toBe(true); expect(largestStep).toBeLessThanOrEqual(.075001);
  });

});

const angleBetween = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
/** Sails each berth's ship to the far harbour; measures turning speed and sideways travel. */
const sailFromBerths = (berths: ReadonlyArray<{ x: number; z: number; yaw: number }>) => {
  const { context, harbor, sea } = fixture(), source = harbor(20), destination = harbor(60);
  source.inventory = { planks: 40 };
  const fleet = createNavalFleet(context, sea);
  for (const { yaw, ...point } of berths) fleet.addShip(point, yaw);
  for (const _ of berths) fleet.queueTransport(source.uid, destination.uid, { planks: 10 });
  let fastestTurn = 0, sideways = 0;
  for (let tick = 0; tick < 20000 && (destination.inventory.planks ?? 0) < 10 * berths.length; tick++) {
    const previous = fleet.frames(); fleet.update(.05);
    fleet.frames().forEach((ship, index) => {
      const before = previous[index]!, travelled = Math.hypot(ship.x - before.x, ship.z - before.z);
      fastestTurn = Math.max(fastestTurn, angleBetween(ship.yaw, before.yaw));
      if (travelled < 1e-6) return;
      const course = angleBetween(Math.atan2(ship.x - before.x, ship.z - before.z), (ship.yaw + before.yaw) / 2);
      // A swing round a point of the keel (oars, spring line) is no slide; anything beyond it is.
      sideways += Math.max(0, travelled * Math.sin(Math.min(course, Math.PI - course)) -
        angleBetween(ship.yaw, before.yaw) * SAILING_SHIP_HULL_LENGTH / 2);
    });
  }
  return { delivered: destination.inventory.planks ?? 0, fastestTurn, sideways };
};

describe("ship heading", () => {
  it("sails bow first and turns gradually from open water and from a berth along the shore", () => {
    const result = sailFromBerths([{ x: 23.5, yaw: Math.PI, z: 12.5 }, { x: 30.5, yaw: 1, z: 40.5 }]);
    expect(result.delivered).toBe(20);
    expect(result.sideways).toBeLessThan(1e-3);
    expect(result.fastestTurn).toBeLessThanOrEqual(SHIP_TURN_RATE * .05 + 1e-9);
  });
  it("springs a hull lying flush along the shore off and backs clear, never sliding sideways", () => {
    const result = sailFromBerths([{ x: 22.5, yaw: 0, z: 40.5 }]);
    expect(result.delivered).toBe(10);
    expect(result.sideways).toBeLessThan(1e-3);
    expect(result.fastestTurn).toBeLessThanOrEqual(SHIP_TURN_RATE * .05 + 1e-9);
  });
});

it("chooses the closest reachable actual hull side and walks there above a reserved pier", () => {
  const { context, harbor } = fixture(), yard = harbor(30);
  const site = { land: { x: 19.5, z: 30.5 }, water: { x: 23.5, z: 30.5 }, yaw: 0, path: [] };
  const work = findShipWorkpoint(context, yard, site)!;
  expect(work).not.toBeNull(); expect(work.shore).toEqual({ x: 19.5, z: 30.5 });
  expect(Math.abs(work.y-work.shoreY)).toBeLessThanOrEqual(Math.hypot(work.point.x-work.shore.x,work.point.z-work.shore.z)*.5);
  expect(work.contact.x).toBeCloseTo(23.5 - 1.68); expect(work.contact.z).toBeCloseTo(30.5);
  expect(Math.hypot(work.point.x - work.contact.x, work.point.z - work.contact.z)).toBeCloseTo(.42);
  const actor = { uid: 1, ...work.shore, y: work.shoreY, ware: "planks", visible: true, path: [work.point], pathIndex: 0 } as SettlementActor;
  context.actors.push(actor); let arrived = false;
  for (let tick = 0; tick < 500 && !arrived; tick++) {
    const before = { x: actor.x, z: actor.z }; arrived = advanceShipPier(context, actor, work, false, .05);
    expect(Math.hypot(actor.x - before.x, actor.z - before.z)).toBeLessThanOrEqual(.045001);
  }
  expect(arrived).toBe(true); expect(actor.y).toBeCloseTo(context.options.world.seaLevel + .18);
  context.options.world.blocking[30 * 80 + 19] = 1;
  const blocked = findShipWorkpoint(context, yard, site)!;
  expect(blocked.shore).not.toEqual(work.shore);
  expect(Math.hypot(blocked.point.x - blocked.contact.x, blocked.point.z - blocked.contact.z)).toBeCloseTo(.42);
});

it("rejects a cliff-height tiny ramp and chooses the nearest approach with walking grade", () => {
  const { context, harbor }=fixture(), yard=harbor(30), world=context.options.world;
  // Raise the dry bank while keeping the same fully wet berth.
  for(let z=0;z<=world.cellsZ;z++)for(let x=0;x<20;x++)world.heights[z*(world.cellsX+1)+x]=1;
  const work=findShipWorkpoint(context,yard,{land:{x:19.5,z:30.5},water:{x:22.75,z:30.5},yaw:0,path:[]})!;
  expect(work).not.toBeNull();
  expect(Math.abs(work.shoreY-work.y)/Math.hypot(work.point.x-work.shore.x,work.point.z-work.shore.z)).toBeLessThanOrEqual(.5);
  const length=Math.hypot(work.point.x-work.shore.x,work.point.z-work.shore.z);
  expect(length).toBeGreaterThan(.36);
  for(let distance=.2;distance<=length;distance+=.2) {
    const t=distance/length,x=work.shore.x+(work.point.x-work.shore.x)*t,z=work.shore.z+(work.point.z-work.shore.z)*t;
    expect(sampleSmooth(world,world.heights,x,z)).toBeLessThanOrEqual(work.shoreY*(1-t)+work.y*t+.015);
  }
});

it("opens a compressed boarding file without letting its follower walk into the leader", () => {
  const { context } = fixture();
  const work = { shore: { x: 19.5, z: 30.5 }, point: { x: 21, z: 30.5 },
    contact: { x: 21.42, z: 30.5 }, shoreY: 0, y: 0 };
  const leader = { uid: 901, x: 19.5, z: 30.5, y: 0, visible: true, phase: "navalBoarding",
    navalOrder: 11, path: [], pathIndex: 0, yaw: 0, job: "Settler", action: "idle", ware: null,
    building: 0, home: 0, timer: 0, animationTime: 0 } as SettlementActor;
  const follower = { ...leader, uid: 902, x: 19.3 };
  context.actors.push(leader, follower);
  expect(advanceShipPier(context, follower, work, false, .05)).toBe(false);
  expect(follower.x).toBe(19.3);
  advanceShipPier(context, leader, work, false, .05);
  expect(leader.x).toBeGreaterThan(19.5);
  for (let tick = 0; tick < 20; tick++) {
    advanceShipPier(context, leader, work, false, .05);
    advanceShipPier(context, follower, work, false, .05);
  }
  expect(follower.x).toBeGreaterThan(19.3);
  expect(leader.x - follower.x).toBeGreaterThanOrEqual(.28);
});

it("keeps opposing traffic blocked on a narrow ship ramp", () => {
  const { context } = fixture();
  const work = { shore: { x: 19.5, z: 30.5 }, point: { x: 21, z: 30.5 },
    contact: { x: 21.42, z: 30.5 }, shoreY: 0, y: 0 };
  const actor = { uid: 901, x: 20, z: 30.5, y: 0, visible: true, phase: "navalBoarding",
    navalOrder: 11, path: [], pathIndex: 0, yaw: 0, job: "Settler", action: "idle", ware: null,
    building: 0, home: 0, timer: 0, animationTime: 0 } as SettlementActor;
  context.actors.push(actor, { ...actor, uid: 902, x: 20.2, phase: "navalDisembark" });
  advanceShipPier(context, actor, work, false, .05);
  expect(actor.x).toBe(20);
});
