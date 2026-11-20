import { afterEach, describe, expect, it, vi } from "vitest";

import * as navigation from "../src/shared/settlement/settlement-sea-navigation";
import * as portals from "../src/shared/settlement/settlement-ship-portal";
import { createShipRoutePlanner } from "../src/shared/settlement/settlement-ship-routes";
import { createShipSea } from "./helpers/ship-motion-scenarios";

afterEach(() => vi.restoreAllMocks());

describe("terrain-only ship routes", () => {
  it("retains a local turning proof when distant hulls move and invalidates when they enter its influence", () => {
    const { sea, world } = createShipSea();
    const search = vi.spyOn(portals, "findTurningPortal"), planner = createShipRoutePlanner(world, sea);
    const from = { x: 25.5, yaw: 0, z: 40.5 }, to = { x: 70.5, z: 90.5 };
    const blocked = [{ x: 85.5, z: 105.5, yaw: 0 }];
    const first = planner.route(from, to, blocked, true)!;
    expect(first).not.toBeNull();
    const calls = search.mock.calls.length;
    first[0]!.x = -99;
    blocked[0]!.yaw = .3;
    const reused = planner.route(from, to, blocked, true)!;
    expect(reused[0]!.x).not.toBe(-99);
    expect(search).toHaveBeenCalledTimes(calls);
    blocked[0] = { x: 40.5, z: 55.5, yaw: .3 };
    expect(planner.route(from, to, blocked, true)).toEqual(createShipRoutePlanner(world, sea).route(from, to, blocked, true));
    expect(search.mock.calls.length).toBeGreaterThan(calls);
  });

  it("reuses exact dynamic portals across voyage goals, cloning legs and respecting live poses", () => {
    const { sea, world } = createShipSea();
    const search = vi.spyOn(portals, "findTurningPortal"), planner = createShipRoutePlanner(world, sea);
    const from = { x: 25.5, yaw: 0, z: 40.5 }, to = { x: 70.5, z: 90.5 };
    const blocked = [{ x: 60.5, yaw: 0, z: 20.5 }];
    const first = planner.route(from, to, blocked, true)!;
    expect(first).not.toBeNull();
    const original = structuredClone(first), calls = search.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    planner.route(from, { ...to, z: 85.5 }, blocked, true);
    expect(search).toHaveBeenCalledTimes(calls);
    first[0]!.x = -99;
    expect(planner.route(from, to, blocked, true)).toEqual(original);
    blocked[0]!.yaw = .1;
    planner.route(from, to, blocked, true);
    expect(search.mock.calls.length).toBeGreaterThan(calls);
    const changed = search.mock.calls.length;
    world.heights[40 * (world.cellsX + 1) + 40] = 3;
    world.terrainRevision = 1;
    navigation.refreshSeaMask(world, sea);
    expect(planner.route(from, to, blocked, true)).toEqual(
      createShipRoutePlanner(world, sea).route(from, to, blocked, true));
    expect(search.mock.calls.length).toBeGreaterThan(changed);
  });

  it("memoizes bounded portal nulls only for their identical query and mode", () => {
    const { sea, world } = createShipSea();
    const search = vi.spyOn(portals, "findTurningPortal").mockReturnValue(null);
    vi.spyOn(portals, "findDriftPortal").mockReturnValue(null);
    const planner = createShipRoutePlanner(world, sea), from = { x: 25.5, yaw: 0, z: 40.5 };
    const blocked = [{ x: 80.5, yaw: 0, z: 20.5 }];
    expect(planner.route(from, { x: 70.5, z: 90.5 }, blocked, true)).toBeNull();
    const calls = search.mock.calls.length;
    expect(planner.route(from, { x: 75.5, z: 90.5 }, blocked, true)).toBeNull();
    expect(search).toHaveBeenCalledTimes(calls);
    planner.route(from, { x: 75.5, z: 90.5 }, blocked, false);
    expect(search.mock.calls.length).toBeGreaterThan(calls);
  });

  it("retains sea proofs across exact mask-equivalent land edits and invalidates a changed coast", () => {
    const { sea, world } = createShipSea();
    const planner = createShipRoutePlanner(world, sea), masks = planner.masks;
    const from = { x: 40.5, yaw: 0, z: 35.5 }, to = { x: 80.5, z: 90.5 };
    const route = planner.route(from, to);
    world.heights[5] = 3;
    world.terrainRevision = 1;
    expect(planner.refresh()).toBe(false);
    expect(planner.masks).toBe(masks);
    expect(planner.route(from, to)).toEqual(createShipRoutePlanner(world, sea).route(from, to));
    expect(planner.route(from, to)).toEqual(route);
    world.heights[40 * (world.cellsX + 1) + 40] = 3;
    world.terrainRevision++;
    // Other naval owners share this mutable buffer and may refresh it before this planner.
    navigation.refreshSeaMask(world, sea);
    expect(planner.refresh()).toBe(true);
    expect(planner.masks).not.toBe(masks);
    expect(planner.route(from, to)).toEqual(createShipRoutePlanner(world, sea).route(from, to));
  });

  it("reuses exact static searches without exposing mutable cached legs", () => {
    const { sea, world } = createShipSea();
    const search = vi.spyOn(navigation, "findSeaRoute");
    const planner = createShipRoutePlanner(world, sea);
    const from = { x: 40.5, yaw: 0, z: 35.5 }, to = { x: 80.5, z: 90.5 };
    const first = planner.route(from, to)!;
    expect(first).not.toBeNull();
    const original = structuredClone(first), calls = search.mock.calls.length;
    first[0]!.x = -99;
    first.push({ x: -99, z: -99 });
    expect(planner.route(from, to)).toEqual(original);
    expect(search).toHaveBeenCalledTimes(calls);
    // Live hulls must never use a static result, including when the hull moves between requests.
    const blocked = [{ id: 99, x: 60.5, yaw: 0, z: 60.5 }];
    planner.route(from, to, blocked);
    expect(search.mock.calls.length).toBeGreaterThan(calls);
    const dynamicCalls = search.mock.calls.length;
    blocked[0]!.x = 65.5;
    planner.route(from, to, blocked);
    expect(search.mock.calls.length).toBeGreaterThan(dynamicCalls);
  });

  it("invalidates a cached failed sea crossing after an actual terrain revision", () => {
    const { sea, world } = createShipSea();
    const stride = world.cellsX + 1;
    for (let z = 0; z <= world.cellsZ; z++) for (let x = 59; x <= 61; x++)
      world.heights[z * stride + x] = world.seaLevel + 2;
    world.terrainRevision = 1;
    const search = vi.spyOn(navigation, "findSeaRoute"), planner = createShipRoutePlanner(world, sea);
    const from = { x: 40.5, yaw: 0, z: 35.5 }, to = { x: 80.5, z: 90.5 };
    expect(planner.route(from, to)).toBeNull();
    const calls = search.mock.calls.length;
    expect(planner.route(from, to)).toBeNull();
    expect(search).toHaveBeenCalledTimes(calls);
    for (let z = 0; z <= world.cellsZ; z++) for (let x = 59; x <= 61; x++)
      world.heights[z * stride + x] = world.seaLevel - 2;
    world.terrainRevision++;
    expect(planner.route(from, to)).toEqual(createShipRoutePlanner(world, sea).route(from, to));
    expect(planner.route(from, to)).not.toBeNull();
    expect(search.mock.calls.length).toBeGreaterThan(calls);
  });

  it("reuses an exhausted sea region only for the same start cell and exact obstacle poses", () => {
    const { sea, world } = createShipSea();
    const search = vi.spyOn(navigation, "findSeaRoute"), planner = createShipRoutePlanner(world, sea);
    const from = { x: 40.5, yaw: 0, z: 35.5 };
    const blocked = Array.from({ length: 12 }, (_, index) => ({ id: index, x: 60, yaw: 0, z: 5 + index * 10 }));
    expect(planner.route(from, { x: 80.5, z: 90.5 }, blocked)).toBeNull();
    const calls = search.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(planner.route({ ...from, x: 40.6 }, { x: 80.5, z: 80.5 }, blocked)).toBeNull();
    expect(search).toHaveBeenCalledTimes(calls);
    // A reachable goal inside the exhausted region still runs the original search and path order.
    const inside = { x: 45.5, z: 80.5 };
    expect(planner.route(from, inside, blocked)).toEqual(createShipRoutePlanner(world, sea).route(from, inside, blocked));
    expect(search.mock.calls.length).toBeGreaterThan(calls);
    blocked[5]!.x = 5; // Open an actual gap in the hull wall; the old failure proof no longer applies.
    const opened = planner.route(from, { x: 80.5, z: 90.5 }, blocked);
    expect(opened).not.toBeNull();
    expect(opened).toEqual(createShipRoutePlanner(world, sea).route(from, { x: 80.5, z: 90.5 }, blocked));
  });
});
