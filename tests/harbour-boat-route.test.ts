import { afterEach, describe, expect, it } from "vitest";

import { createBoatRoutePlanner } from "../src/shared/settlement/harbour-boat-route";
import { clearNavigationProfile, readNavigationProfile } from "../src/shared/settlement/navigation-profile";
import { beginFoundationChange, finishFoundationChange } from "../src/shared/settlement/settlement-foundation-changes";
import { createSeaMask } from "../src/shared/settlement/settlement-sea-navigation";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { createShipSea } from "./helpers/ship-motion-scenarios";

const globals = globalThis as { __navigationProfile?: boolean };
afterEach(() => { delete globals.__navigationProfile; clearNavigationProfile(); });

describe("boat mask validity after terrain changes", () => {
  it("retains proven unchanged water masks but invalidates routes with structure-sensitive avoidance", () => {
    const { sea, world } = createShipSea();
    const planner = createBoatRoutePlanner(world, sea), from = { x: 40.5, z: 30.5 }, to = { x: 44.5, z: 30.5 };
    let blocked = false;
    const avoid = () => blocked;
    expect(planner.route(from, to, avoid)).not.toBeNull();
    globals.__navigationProfile = true; clearNavigationProfile();
    const receipt = beginFoundationChange(world, { x: 10, z: 30, width: 2, depth: 2 } as SettlementBuilding);
    const vertex = 30 * (world.cellsX + 1) + 10;
    world.heights[vertex] = world.heights[vertex]! + .1;
    world.terrainRevision = (world.terrainRevision ?? 0) + 1;
    world.buildRevision = (world.buildRevision ?? 0) + 1;
    finishFoundationChange(world, receipt);
    blocked = true;
    expect(planner.canTurn(from)).toBe(true);
    expect(planner.route(from, to, avoid)).toBeNull();
    expect(readNavigationProfile().counters["boat.waterMaskBuilds"] ?? 0).toBe(0);
    expect(readNavigationProfile().stages["sea.mask"]).toBeUndefined();
  });

  for (const recorded of [true, false]) it(`rebuilds changed coast with foundation receipt=${recorded}`, () => {
    const { sea, world } = createShipSea();
    const planner = createBoatRoutePlanner(world, sea), point = { x: 40.5, z: 30.5 };
    expect(planner.canTurn(point)).toBe(true);
    const receipt = beginFoundationChange(world, { x: 40, z: 30, width: 2, depth: 2 } as SettlementBuilding);
    world.heights[30 * (world.cellsX + 1) + 40] = 0;
    world.terrainRevision = (world.terrainRevision ?? 0) + 1;
    world.buildRevision = (world.buildRevision ?? 0) + 1;
    if (recorded) finishFoundationChange(world, receipt);
    globals.__navigationProfile = true; clearNavigationProfile();
    expect(planner.canTurn(point)).toBe(false);
    expect(readNavigationProfile().counters["boat.waterMaskBuilds"]).toBe(1);
    const fresh = createBoatRoutePlanner(world, createSeaMask(world));
    expect(planner.canTurn(point)).toBe(fresh.canTurn(point));
    expect(planner.route(point, { x: 50.5, z: 30.5 })).toEqual(fresh.route(point, { x: 50.5, z: 30.5 }));
  });

  it("falls back to rebuilding after the bounded foundation history expires", () => {
    const { sea, world } = createShipSea();
    const planner = createBoatRoutePlanner(world, sea), point = { x: 40.5, z: 30.5 };
    expect(planner.canTurn(point)).toBe(true);
    for (let index = 0; index < 70; index++) {
      const receipt = beginFoundationChange(world, { x: 10, z: 30, width: 2, depth: 2 } as SettlementBuilding);
      world.terrainRevision = (world.terrainRevision ?? 0) + 1;
      world.buildRevision = (world.buildRevision ?? 0) + 1;
      finishFoundationChange(world, receipt);
    }
    globals.__navigationProfile = true; clearNavigationProfile();
    expect(planner.canTurn(point)).toBe(true);
    // The complete fallback ran; the dry-only sea bytes are unchanged, so it kept the derived masks.
    expect(readNavigationProfile().counters["boat.waterMaskBuilds"] ?? 0).toBe(0);
    expect(readNavigationProfile().counters["boat.waterMaskKeeps"]).toBe(1);
  });
});

describe("fractional boat landings beside a reserved ship envelope", () => {
  it("connects a real clear landing even when its snapped cell centre is inside the reserved envelope", () => {
    const { sea, world } = createShipSea();
    const planner = createBoatRoutePlanner(world, sea);
    const from = { x: 35.9, z: 30.5 }, to = { x: 40.5, z: 35.5 };
    const avoid = (point: { x: number; z: number }) => point.x < 35.8;
    const route = planner.route(from, to, avoid);
    expect(route).not.toBeNull();
    expect(route?.[0]).toEqual(from);
    expect(route?.at(-1)).toEqual(to);
    expect(route?.every(point => !avoid(point))).toBe(true);
    expect(planner.clear(route!)).toBe(true);
  });
});
