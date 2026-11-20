import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { buildingVolumeClearance } from "../src/render-common/buildings/building-navigation-geometry";
import { getBuildingNavigationProfile } from "../src/render-common/buildings/building-navigation-profile";
import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { buildFlowField, flowBounds, flowCost } from "../src/shared/settlement/military-flow-field";
import { isCorridorStep, routeRevision } from "../src/shared/settlement/military-long-routes";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { isPublicBuildingPointClear } from "../src/shared/settlement/settlement-building-navigation";
import { findGroundPath, isGroundSegmentClear, isMountedNavigationClear, isNavigationClear,
  isNavigationFootprintClear } from "../src/shared/settlement/settlement-navigation";
import { makeBuilding, placementReason } from "../src/shared/settlement/settlement-placement";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { resetTransientState } from "../src/shared/settlement/settlement-transient-state";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = (typeId = 17, nation: WorkerNation = "roman", rotation = 0) => {
  const size = 40, world = { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() } } as unknown as WorldData;
  const context = { options: { world, roads: createRoadNetwork(world) }, buildings: [], actors: [],
    nextBuilding: 1, occupied: new Uint8Array(size ** 2), playerNation: nation,
    reservations: new Set(), navigationRevision: 0 } as unknown as SettlementContext;
  const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  const building = makeBuilding(context, typeId, 20 + ((rotation % 2 ? depth : width) % 2) / 2,
    20 + ((rotation % 2 ? width : depth) % 2) / 2, rotation);
  building.construction = 1;
  context.buildings.push(building);
  for (let z = building.z - building.depth / 2; z < building.z + building.depth / 2; z++)
    for (let x = building.x - building.width / 2; x < building.x + building.width / 2; x++)
      context.occupied[z * size + x] = 1;
  return { context, building };
};
const placePoint = (building: SettlementBuilding, x: number, z: number): SettlementPoint => {
  const angle = building.rotation * Math.PI / 2;
  return { x: building.x + x * Math.round(Math.cos(angle)) + z * Math.round(Math.sin(angle)),
    z: building.z - x * Math.round(Math.sin(angle)) + z * Math.round(Math.cos(angle)) };
};
const clearPoints = (context: SettlementContext, building: SettlementBuilding) => {
  const points: SettlementPoint[] = [];
  for (let z = building.z - building.depth / 2 + .25; z < building.z + building.depth / 2; z += .25)
    for (let x = building.x - building.width / 2 + .25; x < building.x + building.width / 2; x += .25)
      if (isNavigationClear(context, { x, z })) points.push({ x, z });
  return points;
};

describe("reserved plots with public physical exteriors", () => {
  it("opens actual clear yard space and finds a route while retaining every placement reservation", () => {
    const { building, context } = fixture(), before = context.occupied.slice();
    const points = clearPoints(context, building);
    expect(points.length).toBeGreaterThan(8);
    const from = { x: building.x - building.width / 2 - 1, z: building.z };
    const point = points.find(to => findGroundPath(context, from, to));
    expect(point).toBeDefined();
    const path = findGroundPath(context, from, point!)!;
    let previous = from;
    for (const next of path) { expect(isGroundSegmentClear(context, previous, next)).toBe(true); previous = next; }
    expect(placementReason(context, makeBuilding(context, 17, building.x, building.z))).not.toBeNull();
    expect(context.occupied).toEqual(before);
  });

  it.each(["roman", "viking", "japanese", "nubian", "maya", "persian", "chinese", "indigenous"] as const)(
    "excludes the actual %s room and walls in every quarter-turn", nation => {
      const profile = getBuildingNavigationProfile(17, nation);
      expect(profile.interiors.length, nation).toBeGreaterThan(0);
      for (const rotation of [0, 1, 2, 3]) {
        const { building, context } = fixture(17, nation, rotation);
        const room = profile.interiors[0]!, x = (room.min[0] + room.max[0]) / 2,
          z = (room.min[2] + room.max[2]) / 2;
        expect(isNavigationClear(context, placePoint(building, x, z))).toBe(false);
        expect(clearPoints(context, building).length).toBeGreaterThan(0);
        // The public path cannot borrow an open door's permission to enter this room.
        building.door = 1;
        expect(findGroundPath(context, { x: 10, z: 10 }, placePoint(building, x, z))).toBeNull();
      }
    });

  it("uses exact rotated box and curved-room clearance instead of their empty envelope corners", () => {
    const ellipse = { min: [-2, 0, -1] as [number, number, number],
      max: [2, 2, 1] as [number, number, number], shape: "ellipse" as const };
    expect(buildingVolumeClearance(ellipse, 1.8, .9)).toBeGreaterThan(.2);
    expect(buildingVolumeClearance(ellipse, 0, .9)).toBeLessThan(0);
    expect(buildingVolumeClearance(ellipse, 0, 1.3)).toBeCloseTo(.3, 5);
    const box = { ...ellipse, shape: "box" as const, yaw: Math.PI / 2 };
    expect(buildingVolumeClearance(box, 1.3, 0)).toBeCloseTo(.3, 5);
  });

  it.each([0, 3, 4, 9, 10, 23, 29, 37, 57, 58, 59, 61, 62])(
    "keeps the canonical interior of building %s private, including older untagged room floors", typeId => {
      const { building, context } = fixture(typeId);
      const profile = getBuildingNavigationProfile(typeId, "roman");
      expect(profile.interiors.length).toBeGreaterThan(0);
      for (const room of profile.interiors) expect(isPublicBuildingPointClear(context, placePoint(building,
        (room.min[0] + room.max[0]) / 2, (room.min[2] + room.max[2]) / 2))).toBe(false);
    });

  it("keeps ordinary bodies out of shaft openings, narrow gaps and horse overlaps", () => {
    const { building, context } = fixture(35, "indigenous");
    expect(isNavigationFootprintClear(context, building)).toBe(false);
    expect(isMountedNavigationClear(context, building)).toBe(false);
    const { building: house, context: yard } = fixture();
    const points = clearPoints(yard, house);
    expect(points.some(point => !isMountedNavigationClear(yard, point))).toBe(true);
    expect(points.every(point => isNavigationFootprintClear(yard, point))).toBe(true);
  });

  it("opens and closes real stock footprints immediately, including same-tick route cache revisions", () => {
    const { building, context } = fixture(37), candidates = clearPoints(context, building);
    const before = routeRevision(context);
    building.output.grain = 9;
    expect(routeRevision(context)).not.toBe(before);
    const newlyBlocked = candidates.filter(point => !isNavigationClear(context, point));
    expect(newlyBlocked.length).toBeGreaterThan(0);
    building.output.grain = 0;
    for (const point of newlyBlocked) expect(isNavigationClear(context, point)).toBe(true);
    expect(routeRevision(context)).toBe(before);
  });

  it("preserves construction, owner passage overrides, anonymous obstacles and load reset", () => {
    const { building, context } = fixture(), point = clearPoints(context, building)[0]!;
    building.construction = .5;
    expect(isNavigationClear(context, point)).toBe(false);
    expect(isNavigationClear(context, point, true)).toBe(true);
    building.construction = 1;
    expect(isNavigationClear(context, point)).toBe(true);
    context.occupied[5 * 40 + 5] = 1;
    expect(isPublicBuildingPointClear(context, { x: 5.5, z: 5.5 })).toBe(false);
    const snapshot = structuredClone(context.buildings);
    context.buildings = [];
    resetTransientState(context);
    expect(isNavigationClear(context, point)).toBe(false);
    context.buildings = snapshot;
    resetTransientState(context);
    expect(isNavigationClear(context, point)).toBe(true);
  });

  it("shares public exterior decisions with coarse military corridors and flow fields", () => {
    const { building, context } = fixture();
    const point = clearPoints(context, building).find(p => p.x % 1 === .5 && p.z % 1 === .5)!;
    expect(point).toBeDefined();
    const cellX = Math.floor(point.x), cellZ = Math.floor(point.z);
    expect(isCorridorStep(context, cellX, cellZ, 0, 0, null)).toBe(true);
    const bounds = flowBounds(context, [point, { x: 10, z: 10 }]);
    const field = buildFlowField(context, point, false, bounds);
    expect(Number.isFinite(flowCost(field, { x: 10, z: 10 }))).toBe(true);
  });

  it("walks a regular soldier through the reserved exterior and replays the exact saved journey", () => {
    const { building, context } = fixture();
    const create = () => {
      const { context: fresh } = fixture(), world = fresh.options.world;
      return createSettlementSimulation({ clockStart: 0, initialSettlers: 0, initialStock: { planks: 20, stone: 20 },
        resourceTargets: () => [], roads: createRoadNetwork(world), world });
    };
    const simulation = create();
    const placed = simulation.placeBuilding(17, building.x, building.z);
    expect(placed.ok, placed.reason).toBe(true);
    Object.assign(placed.building!, { construction: 1, foundationProgress: 1, required: {} });
    const points = clearPoints(context, building), from = points[0]!;
    const to = points.find(point => Math.hypot(point.x - from.x, point.z - from.z) > 2 &&
      !isGroundSegmentClear(context, from, point) && findGroundPath(context, from, point));
    expect(to).toBeDefined();
    const base = structuredClone(simulation.saveState());
    const recorder = createCommandLogRecorder(simulation, { sourceVersion: "public-yard-test" });
    recorder.open();
    const spawn = simulation.spawnDebugSoldier(from, { rank: 1, type: "shield" })!;
    expect(spawn).not.toBeNull();
    expect(simulation.commandMilitary([spawn.id], to!, "move")).toBe(true);
    let arrived = false, distance = 0, previous = from;
    for (let tick = 0; tick < 1200; tick++) {
      simulation.update(.05);
      const actor = simulation.frames().find(actor => actor.uid === spawn.id)!;
      expect(isPublicBuildingPointClear(context, actor), `tick ${tick} cuts a room/solid`).toBe(true);
      distance += Math.hypot(actor.x - previous.x, actor.z - previous.z);
      previous = { x: actor.x, z: actor.z };
      if (Math.hypot(actor.x - to!.x, actor.z - to!.z) < .3) { arrived = true; break; }
    }
    expect(arrived).toBe(true);
    expect(distance).toBeGreaterThan(Math.hypot(to!.x - from.x, to!.z - from.z));
    const interval = recorder.close("home")!, saved = structuredClone(simulation.saveState());
    const replay = create();
    expect(replay.loadState(base)).toEqual({ ok: true });
    expect(replayCommandLog(replay, interval, { rejectDebug: false })).toEqual({ ok: true,
      endChecksum: interval.endChecksum });
    const restored = create();
    expect(restored.loadState(saved)).toEqual({ ok: true });
    expect(restored.frames().find(actor => actor.uid === spawn.id)?.x).toBeCloseTo(previous.x);
    expect(restored.frames().find(actor => actor.uid === spawn.id)?.z).toBeCloseTo(previous.z);
    recorder.dispose();
  });
});
