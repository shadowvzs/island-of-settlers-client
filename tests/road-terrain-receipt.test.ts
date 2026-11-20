import { afterEach, expect, it } from "vitest";

import { createBoatRoutePlanner } from "../src/shared/settlement/harbour-boat-route";
import { clearNavigationProfile, readNavigationProfile } from "../src/shared/settlement/navigation-profile";
import { levelRoadGround } from "../src/shared/settlement/road-ground-leveling";
import { beginTerrainChange, finishFoundationChange, foundationRevision, localFoundationChanges }
  from "../src/shared/settlement/settlement-foundation-changes";
import { claimBuilding, makeBuilding } from "../src/shared/settlement/settlement-placement";
import { createSeaMask } from "../src/shared/settlement/settlement-sea-navigation";
import { createShipRoutePlanner } from "../src/shared/settlement/settlement-ship-routes";
import { restoreTerrain, snapshotTerrain } from "../src/shared/settlement/settlement-terrain-snapshot";
import { BLOCKING, MATERIAL_COUNT, PROP, PROP_REMOVED } from "../src/shared/world/world-data";
import { createShipSea } from "./helpers/ship-motion-scenarios";

const globals = globalThis as { __navigationProfile?: boolean };
afterEach(() => { delete globals.__navigationProfile; clearNavigationProfile(); });

it("retains the exact boat water mask after actual inland road grading, including refreshed neighbouring cells", () => {
  const { sea, world } = createShipSea();
  for (let z = 0; z <= world.cellsZ; z++) for (let x = 0; x < 19; x++)
    world.heights[z * (world.cellsX + 1) + x] = x < 10 ? .1 : .5;
  const planner = createBoatRoutePlanner(world, sea), ship = createShipRoutePlanner(world, sea);
  const point = { x: 40.5, z: 30.5 };
  expect(planner.canTurn(point)).toBe(true);
  const revision = foundationRevision(world);
  globals.__navigationProfile = true; clearNavigationProfile();
  const changed = levelRoadGround(world, [{ start: { x: 7, z: 30 }, end: { x: 13, z: 30 }, tier: "dirt" }], []);
  expect(changed).not.toBeNull();
  expect(localFoundationChanges(world, revision)).toHaveLength(1);
  expect(planner.canTurn(point)).toBe(true);
  expect(readNavigationProfile().counters["boat.waterMaskBuilds"] ?? 0).toBe(0);
  expect(readNavigationProfile().stages["sea.mask"]).toBeUndefined();
  expect(sea).toEqual(createSeaMask(world));
  const fresh = createBoatRoutePlanner(world, createSeaMask(world));
  expect(planner.route(point, { x: 55.5, z: 50.5 })).toEqual(fresh.route(point, { x: 55.5, z: 50.5 }));
  const freshShip = createShipRoutePlanner(world, createSeaMask(world));
  for (const key of ["parallelX", "parallelZ", "turning"] as const)
    expect(ship.masks[key]).toEqual(freshShip.masks[key]);
  expect(ship.route({ ...point, yaw: 0 }, { x: 55.5, z: 50.5, yaw: 0 }))
    .toEqual(freshShip.route({ ...point, yaw: 0 }, { x: 55.5, z: 50.5, yaw: 0 }));
});

it("chains finished claim, offset entrance clearing and road grading without losing the exact mask proof", () => {
  const { context, sea, world } = createShipSea();
  world.heights[34 * (world.cellsX + 1) + 16] = .4;
  const planner = createBoatRoutePlanner(world, sea), point = { x: 40.5, z: 30.5 };
  expect(planner.canTurn(point)).toBe(true);
  const revision = foundationRevision(world);
  const building = makeBuilding(context, 0, 10, 30, 0);
  building.construction = 1;
  // Exercise the actual authored access, beyond any fixed foundation-only receipt margin.
  building.access = { x: 10, z: 44 };
  world.props.count = 1;
  world.props.x = new Float32Array([10]); world.props.z = new Float32Array([44]);
  world.props.types = new Uint8Array([PROP.broadleafTree]);
  world.blocking[44 * world.cellsX + 10] = BLOCKING.prop;
  world.heights[30 * (world.cellsX + 1) + 10] = .4;
  world.slopeClass = new Uint8Array(world.cellsX * world.cellsZ);
  world.waterDepth = new Float32Array(world.heights.length);
  world.splat = new Uint8Array(world.heights.length * MATERIAL_COUNT);
  world.buildCap = world.buildClass.slice();
  claimBuilding(context, building);
  expect(world.props.types[0]).toBe(PROP_REMOVED);
  expect(world.blocking[44 * world.cellsX + 10]).toBe(BLOCKING.free);
  const claims = localFoundationChanges(world, revision);
  expect(claims).toHaveLength(1);
  expect(claims![0]!.maxZ).toBeGreaterThanOrEqual(44);
  expect(levelRoadGround(world, [{ start: { x: 15, z: 34 }, end: { x: 18, z: 34 }, tier: "dirt" }], [building]))
    .not.toBeNull();
  expect(localFoundationChanges(world, revision)).toHaveLength(2);
  globals.__navigationProfile = true; clearNavigationProfile();
  expect(planner.canTurn(point)).toBe(true);
  expect(readNavigationProfile().counters["boat.waterMaskBuilds"] ?? 0).toBe(0);
  expect(sea).toEqual(createSeaMask(world));
  const fresh = createBoatRoutePlanner(world, createSeaMask(world));
  expect(planner.route(point, { x: 55.5, z: 50.5 })).toEqual(fresh.route(point, { x: 55.5, z: 50.5 }));
});

it("does not certify an unknown onBuildingPlanned callback mutation", () => {
  const { context, world } = createShipSea();
  const revision = foundationRevision(world), building = makeBuilding(context, 0, 10, 30, 0);
  building.construction = 1;
  context.options.onBuildingPlanned = () => {
    world.heights[30 * (world.cellsX + 1) + 40] = 0;
    world.terrainRevision = (world.terrainRevision ?? 0) + 1;
  };
  claimBuilding(context, building);
  expect(localFoundationChanges(world, revision)).toBeNull();
});

it("keeps the unknown debug rollback revision gap and rebuilds the exact water mask", () => {
  const { context, sea, world } = createShipSea();
  world.heights[30 * (world.cellsX + 1) + 10] = .4;
  const planner = createBoatRoutePlanner(world, sea), point = { x: 40.5, z: 30.5 };
  expect(planner.canTurn(point)).toBe(true);
  const revision = foundationRevision(world), snapshot = snapshotTerrain(context);
  const building = makeBuilding(context, 0, 10, 30, 0);
  building.construction = 1; building.y = 0;
  claimBuilding(context, building);
  expect(localFoundationChanges(world, revision)).toHaveLength(1);
  restoreTerrain(context, snapshot);
  expect(localFoundationChanges(world, revision)).toBeNull();
  globals.__navigationProfile = true; clearNavigationProfile();
  expect(planner.canTurn(point)).toBe(true);
  // The complete fallback ran; the restored sea bytes are unchanged, so it kept the derived masks.
  expect(readNavigationProfile().counters["boat.waterMaskBuilds"] ?? 0).toBe(0);
  expect(readNavigationProfile().counters["boat.waterMaskKeeps"]).toBe(1);
  expect(sea).toEqual(createSeaMask(world));
});

for (const kind of ["coast", "shallow depth", "water depth", "unknown", "lake"] as const)
  it(`keeps the complete rebuild fallback for ${kind} changes`, () => {
    const { sea, world } = createShipSea();
    const planner = createBoatRoutePlanner(world, sea), point = { x: 40.5, z: 30.5 };
    expect(planner.canTurn(point)).toBe(true);
    const revision = foundationRevision(world);
    if (kind === "coast") {
      expect(levelRoadGround(world, [{ start: { x: 17, z: 30 }, end: { x: 24, z: 30 }, tier: "dirt" }], [])).not.toBeNull();
    } else {
      const vertex = 30 * (world.cellsX + 1) + 40;
      const receipt = beginTerrainChange(world, { minX: 39, maxX: 41, minZ: 29, maxZ: 31 });
      if (kind === "lake") {
        world.lakeWater = new Uint8Array(world.heights.length);
        world.lakeWater[vertex] = 1;
      } else if (kind === "water depth") {
        world.waterDepth = new Float32Array(world.heights.length);
        world.waterDepth[vertex] = .8;
      } else world.heights[vertex] = -1.8;
      world.terrainRevision = (world.terrainRevision ?? 0) + 1;
      world.buildRevision = (world.buildRevision ?? 0) + 1;
      if (kind !== "unknown") finishFoundationChange(world, receipt);
    }
    expect(localFoundationChanges(world, revision)).toBeNull();
    globals.__navigationProfile = true; clearNavigationProfile();
    planner.canTurn(point);
    // The complete fallback runs once: it rebuilds, or keeps the masks when the sea bytes are unchanged.
    const { counters } = readNavigationProfile();
    expect((counters["boat.waterMaskBuilds"] ?? 0) + (counters["boat.waterMaskKeeps"] ?? 0)).toBe(1);
    const freshSea = createSeaMask(world), fresh = createBoatRoutePlanner(world, freshSea);
    expect(sea).toEqual(freshSea);
    expect(planner.route(point, { x: 55.5, z: 50.5 })).toEqual(fresh.route(point, { x: 55.5, z: 50.5 }));
    const ship = createShipRoutePlanner(world, sea), freshShip = createShipRoutePlanner(world, freshSea);
    for (const key of ["parallelX", "parallelZ", "turning"] as const)
      expect(ship.masks[key]).toEqual(freshShip.masks[key]);
  });

it("covers water-blocking changes in the refresh apron outside the editable road vertices", () => {
  const { world } = createShipSea();
  world.waterDepth = new Float32Array(world.heights.length);
  world.slopeClass = new Uint8Array(world.cellsX * world.cellsZ);
  world.splat = new Uint8Array(world.heights.length * MATERIAL_COUNT);
  world.buildCap = world.buildClass.slice();
  world.waterDepth[28 * (world.cellsX + 1) + 10] = 1;
  const revision = foundationRevision(world);
  // A cross slope guarantees actual grading; x=10,z=28 is outside the road's editable reach.
  world.heights[30 * (world.cellsX + 1) + 10] = .4;
  world.heights[29 * (world.cellsX + 1) + 10] = .4;
  expect(levelRoadGround(world, [{ start: { x: 7, z: 30 }, end: { x: 13, z: 30 }, tier: "dirt" }], [])).not.toBeNull();
  expect(world.blocking[28 * world.cellsX + 10]).toBe(BLOCKING.water);
  expect(localFoundationChanges(world, revision)).toBeNull();
});

it("does not certify an unknown revision preceding a later proven road edit", () => {
  const { world } = createShipSea();
  const revision = foundationRevision(world);
  world.terrainRevision = 1;
  world.heights[30 * (world.cellsX + 1) + 10] = .4;
  levelRoadGround(world, [{ start: { x: 7, z: 30 }, end: { x: 13, z: 30 }, tier: "dirt" }], []);
  expect(localFoundationChanges(world, revision)).toBeNull();
});
