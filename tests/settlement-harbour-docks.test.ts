import { describe, expect, it, vi } from "vitest";

import { SHIP_DECK } from "../src/render-common/ships/ship-deck-layout";
import { SAILING_SHIP_SCALE } from "../src/render-common/ships/ship-dimensions";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { fishingSites, isFishingStanceClear } from "../src/shared/settlement/settlement-fishing";
import {
  createHarbourDocks, findHarbourDock, findHarbourDockAt, HARBOUR_PIER_MAX_LENGTH, HARBOUR_SHORE_ACCESS_MAX_DISTANCE
} from "../src/shared/settlement/settlement-harbour-docks";
import { harbourPlacementReason } from "../src/shared/settlement/settlement-harbour-placement";
import { isGroundSegmentClear } from "../src/shared/settlement/settlement-navigation";
import { createSeaMask, findCoastalWorkSite } from "../src/shared/settlement/settlement-sea-navigation";
import {
  createShipClearanceMasks, shipHullFitsSea
} from "../src/shared/settlement/settlement-ship-clearance";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { trafficWork } from "../src/shared/settlement/settlement-traffic-counters";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { sampleSmooth } from "../src/shared/world/grid-geometry";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";
import { edgeBaySettlement } from "./helpers/edge-bay-settlement";

const fixture = () => {
  const size = 64, shore = 48;
  const heights = new Float32Array((size + 1) ** 2);
  for (let z = shore; z <= size; z++) for (let x = 0; x <= size; x++)
    heights[z * (size + 1) + x] = -2;
  const walkCost = new Uint8Array(size ** 2).fill(10), blocking = new Uint8Array(size ** 2);
  for (let z = shore; z < size; z++) for (let x = 0; x < size; x++) {
    walkCost[z * size + x] = 0;
    blocking[z * size + x] = 1;
  }
  const world = { blocking, buildClass: new Uint8Array(size ** 2).fill(BUILD.large), cellsX: size,
    cellsZ: size, heights, seaLevel: -1, seed: 9, start: { x: 32.5, z: 36.5 }, walkCost,
    props: { count: 0, scale: new Float32Array(), types: new Uint8Array(), x: new Float32Array(),
      z: new Float32Array() } } as unknown as WorldData;
  const harbour = { access: { x: 32.5, z: 43.5 }, construction: 1, typeId: 39, uid: 1 };
  const context = { actors: [], buildings: [harbour], navigationRevision: 0,
    occupied: new Uint8Array(size ** 2), options: { world }, reservations: new Set() } as unknown as SettlementContext;
  const ship = { cargo: { planks: 3 }, cargoCount: 1, cursor: 0, id: 7, phase: "loading" as const,
    route: [], sourceUid: harbour.uid, x: 32.5, y: -1, yaw: Math.PI / 2, z: 56.5 };
  return { context, harbour, ship, world };
};

describe("physical harbour docks", () => {
  it("retains its own sea mask and docks across unchanged inputs, renewing them when an input changes", async () => {
    const seaModule = await import("../src/shared/settlement/settlement-sea-navigation");
    const mask = vi.spyOn(seaModule, "createSeaMask");
    try {
      const { context, harbour, ship, world } = fixture();
      const first = findHarbourDockAt(context, harbour, ship);
      expect(first).not.toBeNull(); expect(mask).toHaveBeenCalledTimes(1);
      // JETTY-FRAMES: a revision that changed none of the dock's copied inputs keeps the same dock.
      for (let cycle = 0; cycle < 4; cycle++) {
        context.navigationRevision = (context.navigationRevision ?? 0) + 1;
        expect(findHarbourDockAt(context, harbour, ship)).toBe(first);
      }
      expect(mask).toHaveBeenCalledTimes(1);
      context.occupied.fill(1); context.navigationRevision = (context.navigationRevision ?? 0) + 1;
      expect(findHarbourDockAt(context, harbour, ship)).toBeNull();
      context.occupied.fill(0); context.navigationRevision++;
      const renewed = findHarbourDockAt(context, harbour, ship);
      expect(renewed).toEqual(first); expect(renewed).not.toBe(first);
      expect(mask).toHaveBeenCalledTimes(1);
      // An authoritative caller's mask must never replace the ordinary caller's owned mask.
      expect(findHarbourDockAt(context, harbour, ship, new Uint8Array(world.cellsX * world.cellsZ))).toBeNull();
      expect(findHarbourDockAt(context, harbour, ship)).toEqual(first);
      expect(mask).toHaveBeenCalledTimes(1);
      // A build revision without a wet height change keeps the owned mask (its flood fill reads heights only).
      world.buildRevision = (world.buildRevision ?? 0) + 1;
      expect(findHarbourDockAt(context, harbour, ship)).toEqual(first);
      expect(mask).toHaveBeenCalledTimes(1);
      const heights = world.heights.slice();
      world.heights.fill(5); world.buildRevision = (world.buildRevision ?? 0) + 1;
      expect(findHarbourDockAt(context, harbour, ship)).toBeNull();
      expect(mask).toHaveBeenCalledTimes(2);
      world.heights.set(heights); world.terrainRevision = (world.terrainRevision ?? 0) + 1;
      expect(findHarbourDockAt(context, harbour, ship)).toEqual(first);
      expect(mask).toHaveBeenCalledTimes(3);
    } finally { mask.mockRestore(); }
  });
  it("reuses an authoritative placement sea mask without changing default dock geometry or stale-mask ownership", () => {
    const { context, harbour, ship, world } = fixture();
    const expected = findHarbourDockAt(context, harbour, ship);
    expect(expected).not.toBeNull();
    const sea = createSeaMask(world);
    const supplied = findHarbourDockAt(context, harbour, ship, sea);
    expect(supplied).toEqual(expected);
    expect(findHarbourDockAt(context, harbour, ship, sea)).toBe(supplied);
    expect(findHarbourDockAt(context, harbour, ship, new Uint8Array(sea.length))).toBeNull();
    expect(findHarbourDockAt(context, harbour, ship)).toEqual(expected);
    world.heights.fill(5);
    world.terrainRevision = (world.terrainRevision ?? 0) + 1;
    expect(findHarbourDockAt(context, harbour, ship, createSeaMask(world))).toBeNull();
    expect(findHarbourDockAt(context, harbour, ship)).toBeNull();
  });
  it.each([123, 77])("supports fishing and a short ship pier on generated coast seed %i", seed => {
    const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 128, cellsZ: 128,
      forest: 0, mountains: 0, seed });
    let simulation: ReturnType<typeof createSettlementSimulation>;
    const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
    simulation = createSettlementSimulation({ roads, world });
    const started = simulation.startDebugExpedition("adventure");
    expect(started, JSON.stringify(started)).toMatchObject({ ok: true });
    const harbour = simulation.buildings().find(building => building.typeId === 39)!;
    const occupied = new Uint8Array(world.cellsX * world.cellsZ);
    for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < world.cellsX; x++)
      occupied[z * world.cellsX + x] = Number(simulation.isOccupied(x, z));
    const context = { actors: simulation.frames(), buildings: simulation.buildings(), occupied,
      options: { roads, world }, reservations: new Set() } as unknown as SettlementContext;
    const sea = createSeaMask(world);
    const site = findCoastalWorkSite(context, harbour, sea, new Set(), HARBOUR_SHORE_ACCESS_MAX_DISTANCE,
      undefined, candidate => Boolean(findHarbourDock(context, harbour.uid,
        { ...candidate.water, yaw: candidate.yaw ?? 0 })), 4)!;
    expect(site).not.toBeNull();
    const dock = findHarbourDock(context, harbour.uid, { ...site.water, yaw: site.yaw ?? 0 })!;
    const shore = dock.workPier.shore;
    expect(Math.hypot(dock.workPier.point.x - shore.x, dock.workPier.point.z - shore.z))
      .toBeLessThanOrEqual(HARBOUR_PIER_MAX_LENGTH);
    expect(shipHullFitsSea(world, sea, { ...site.water, yaw: site.yaw ?? 0 })).toBe(true);
    const berthCell = Math.floor(site.water.z) * world.cellsX + Math.floor(site.water.x);
    expect(createShipClearanceMasks(world, sea).turning[berthCell]).toBe(0);
    expect(harbourPlacementReason(context, harbour)).toBeNull();
    const visits = trafficWork.groundVisits;
    expect(harbourPlacementReason(context, harbour)).toBeNull();
    expect(trafficWork.groundVisits).toBe(visits);
    const fish = [];
    for (let z = Math.max(0, Math.floor(shore.z) - 8); z < Math.min(world.cellsZ, shore.z + 8); z++)
      for (let x = Math.max(0, Math.floor(shore.x) - 8); x < Math.min(world.cellsX, shore.x + 8); x++)
        fish.push(...fishingSites(context, { id: z * world.cellsX + x, kind: "fish", x: x + .5, z: z + .5 }));
    expect(fish.length).toBeGreaterThan(0);
    expect(fish.every(target => isFishingStanceClear(context, target.approach!,
      { x: target.x, y: target.y!, z: target.z }))).toBe(true);
  }, 60000);

  it("shares a clear source-harbour route and an actual oriented hull-side pier", () => {
    const { context, harbour, ship, world } = fixture();
    const geometry = findHarbourDock(context, harbour.uid, ship)!;
    expect(geometry).not.toBeNull();
    expect(findHarbourDock(context, harbour.uid, ship)).toBe(geometry);
    expect(shipHullFitsSea(world, createSeaMask(world), ship)).toBe(true);
    expect(geometry.porterRoute[0]).toEqual(harbour.access);
    expect(geometry.porterRoute.at(-1)).toEqual(geometry.workPier.shore);
    for (let index = 1; index < geometry.porterRoute.length; index++)
      expect(isGroundSegmentClear(context, geometry.porterRoute[index - 1]!, geometry.porterRoute[index]!))
        .toBe(true);
    const work = geometry.workPier;
    expect(work.y).toBeCloseTo(ship.y + SHIP_DECK.floorY * SAILING_SHIP_SCALE);
    expect(Math.abs(work.y - work.shoreY)).toBeLessThanOrEqual(
      Math.hypot(work.point.x - work.shore.x, work.point.z - work.shore.z) * .5);
    expect(Math.hypot(work.point.x - work.shore.x, work.point.z - work.shore.z))
      .toBeLessThanOrEqual(HARBOUR_PIER_MAX_LENGTH);
    expect(Math.hypot(work.shore.x - harbour.access.x, work.shore.z - harbour.access.z))
      .toBeLessThanOrEqual(HARBOUR_SHORE_ACCESS_MAX_DISTANCE);
    expect(Math.hypot(work.point.x - work.contact.x, work.point.z - work.contact.z)).toBeCloseTo(.42);
    const forward = (work.contact.x - ship.x) * Math.sin(ship.yaw) +
      (work.contact.z - ship.z) * Math.cos(ship.yaw);
    expect(Math.abs(forward)).toBeLessThan(1.1 * SAILING_SHIP_SCALE);
    expect(createHarbourDocks(context).forShip(ship)!.workPier).toBe(work);
  });

  it("rejects long offshore piers and a beach far from the actual source harbour", () => {
    const { context, harbour, ship, world } = fixture();
    const offshore = { ...ship, z: 61.5 };
    expect(shipHullFitsSea(world, createSeaMask(world), offshore)).toBe(true);
    expect(findHarbourDock(context, harbour.uid, offshore)).toBeNull();
    harbour.access.z = 20.5;
    expect(findHarbourDock(context, harbour.uid, ship)).toBeNull();
  });

  it("accepts a short coastal berth whose hull fits without a turning circle at the pier", () => {
    const { context, harbour, ship, world } = fixture();
    const coastal = { ...ship, z: 51.5 }, sea = createSeaMask(world);
    expect(shipHullFitsSea(world, sea, coastal)).toBe(true);
    const cell = Math.floor(coastal.z) * world.cellsX + Math.floor(coastal.x);
    expect(createShipClearanceMasks(world, sea).turning[cell]).toBe(0);
    const geometry = findHarbourDock(context, harbour.uid, coastal)!;
    expect(geometry).not.toBeNull();
    expect(Math.hypot(geometry.workPier.point.x - geometry.workPier.shore.x,
      geometry.workPier.point.z - geometry.workPier.shore.z)).toBeLessThan(4);
  });

  it("starts a deck-height ramp at a curved dry bank crest without cutting through the beach", () => {
    const { context, harbour, ship, world } = fixture();
    world.heights = Float32Array.from({ length: (world.cellsX + 1) * (world.cellsZ + 1) },
      (_, index) => Math.floor(index / (world.cellsX + 1)) < 16 ? -2 : 0);
    for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < world.cellsX; x++) {
      const cell = z * world.cellsX + x;
      world.walkCost[cell] = z < 16 ? 0 : 10;
      world.blocking[cell] = z < 16 ? 1 : 0;
    }
    harbour.access.z = 22.5;
    const coastal = { ...ship, z: 12.5 };
    const geometry = findHarbourDock(context, harbour.uid, coastal)!;
    expect(geometry).not.toBeNull();
    const work = geometry.workPier;
    expect(work.shore.z).toBe(16.25);
    expect(work.y).toBeCloseTo(ship.y + SHIP_DECK.floorY * SAILING_SHIP_SCALE);
    for (let step = 0; step <= 40; step++) {
      const t = step / 40, x = work.shore.x + (work.point.x - work.shore.x) * t,
        z = work.shore.z + (work.point.z - work.shore.z) * t;
      const rampY = work.shoreY * (1 - t) + work.y * t;
      expect(sampleSmooth(world, world.heights, x, z)).toBeLessThanOrEqual(rampY + .015);
    }
  });

  it("invalidates both valid and missing piers after navigation changes", () => {
    const { context, harbour, ship } = fixture();
    expect(findHarbourDock(context, harbour.uid, ship)).not.toBeNull();
    context.occupied.fill(1);
    context.navigationRevision!++;
    expect(findHarbourDock(context, harbour.uid, ship)).toBeNull();
    context.occupied.fill(0);
    context.navigationRevision!++;
    expect(findHarbourDock(context, harbour.uid, ship)).not.toBeNull();
    expect(findHarbourDock(context, undefined, ship)).toBeNull();
    expect(findHarbourDock(context, harbour.uid, { ...ship, z: 44.5 })).toBeNull();
  });

  it("shows a positioning pier only at the validated final berth", () => {
    const { context, ship } = fixture();
    const docks = createHarbourDocks(context);
    const positioning = { ...ship, phase: "positioning", route: [{ x: ship.x, z: ship.z, yaw: ship.yaw }] };
    expect(docks.forShip({ ...positioning, z: ship.z - 1 })).toBeNull();
    expect(docks.forShip({ ...positioning, yaw: ship.yaw + .3 })).toBeNull();
    expect(docks.forShip(positioning)?.workPier).toBeDefined();
    expect(docks.forShip({ ...ship, x: ship.x + 50 })).toBeNull();
  });

  it("provides a visible pier at every actual loading berth in the edge harbour expedition", () => {
    const simulation = edgeBaySettlement();
    const started = simulation.startDebugExpedition("adventure");
    expect(started, JSON.stringify(started)).toMatchObject({ ok: true });
    let checked = 0;
    for (let step = 0; step < 1200 && checked < 5; step++) {
      simulation.update(.05);
      for (const ship of simulation.ships().filter(candidate => candidate.phase === "loading")) {
        const dock = simulation.shipSites().find(site => site.id === 1_000_000 + ship.id)!;
        expect(dock, `Missing pier for loading ship ${ship.id}`).toBeDefined();
        expect(dock.workPier).toBeDefined();
        const frame = simulation.shipFrames().find(candidate => candidate.id === ship.id)!;
        expect(dock).toMatchObject({ x: frame.x, yaw: frame.yaw, z: frame.z });
        const harbour = simulation.buildings().find(building => building.uid === ship.sourceUid)!;
        expect(dock.porterRoute?.[0]).toEqual(harbour.access);
        const work = dock.workPier!;
        expect(Math.hypot(work.point.x - work.shore.x, work.point.z - work.shore.z))
          .toBeLessThanOrEqual(HARBOUR_PIER_MAX_LENGTH);
        expect(Math.hypot(work.shore.x - harbour.access.x, work.shore.z - harbour.access.z))
          .toBeLessThanOrEqual(HARBOUR_SHORE_ACCESS_MAX_DISTANCE);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 60000);
});
