import { describe, expect, it } from "vitest";

import { FISHING_SKIFF_BEAM, FISHING_SKIFF_LENGTH } from "../src/render-common/ships/fishing-skiff-dimensions";
import { findBoatFishingSite } from "../src/shared/settlement/boat-fishing-site";
import { boatWaterKindAt, boatWaterSurface, classifyBoatWater, isSkiffWaterClear } from "../src/shared/settlement/boat-fishing-water";
import { BOAT_NET_SPACING, BOAT_SLOT_SPACING, BOAT_STANCE_FARTHEST } from "../src/shared/settlement/constants";
import { fisherBoatFrames } from "../src/shared/settlement/fisher-boat-frames";
import { sampleSmooth } from "../src/shared/world/grid-geometry";
import { BLOCKING } from "../src/shared/world/world-data";
import { BOAT_WORLD_SIZE, boatFishingSettlement, boatFishingWorld } from "./helpers/boat-fishing-world";

const sea = (_x: number, z: number) => z >= 30;
const lake = (x: number, z: number) => x >= 4 && x <= 28 && z >= 30 && z <= 44;
const pond = (x: number, z: number) => x >= 14 && x <= 18 && z >= 30 && z <= 34;
const river = (x: number, _z: number) => x >= 22 && x <= 25;

const markRiver = (world: ReturnType<typeof boatFishingWorld>, fromX: number, toX: number) => {
  const stride = world.cellsX + 1;
  for (let z = 0; z <= world.cellsZ; z++) for (let x = fromX; x <= toX + 1; x++)
    world.flow[(z * stride + x) * 2 + 1] = 1.2;
};

describe("boat water classification", () => {
  it("separates sea, lakes, ponds and rivers", () => {
    const smallPond = (x: number, z: number) => x >= 2 && x <= 6 && z >= 2 && z <= 6;
    const inlandLake = (x: number, z: number) => x >= 30 && x <= 44 && z >= 4 && z <= 22;
    const riverBed = (x: number, z: number) => river(x, z) && z < 30;
    const world = boatFishingWorld((x, z) => sea(x, z) || smallPond(x, z) || inlandLake(x, z) || riverBed(x, z));
    markRiver(world, 22, 25);
    const classes = classifyBoatWater(world);
    expect(boatWaterKindAt(world, classes, 40, 40)).toBe("sea");
    expect(boatWaterKindAt(world, classes, 36, 12)).toBe("lake");
    expect(world.blocking[4 * world.cellsX + 4]).toBe(BLOCKING.water);
    expect(boatWaterKindAt(world, classes, 4, 4)).toBeUndefined();
    expect(world.blocking[5 * world.cellsX + 23]).toBe(BLOCKING.water);
    expect(boatWaterKindAt(world, classes, 23, 5)).toBeUndefined();
    expect(classifyBoatWater(world)).toBe(classes);
  });

  it("removes the estuary cells of a river running into the sea", () => {
    const world = boatFishingWorld((x, z) => sea(x, z) || river(x, z));
    markRiver(world, 22, 25);
    const classes = classifyBoatWater(world);
    expect(boatWaterKindAt(world, classes, 23, 32)).toBeUndefined();
    expect(boatWaterKindAt(world, classes, 10, 32)).toBe("sea");
  });
});

describe("boat fishing site", () => {
  it("places the entire rowing envelope beyond the visible shoreline even when water flags start on dry sand", () => {
    const world = boatFishingWorld(sea), stride = world.cellsX + 1;
    // Deliberately retain the old water cell flags and depth map: the visible beach moved seawards.
    world.waterDepth = new Float32Array(world.heights.length).fill(1);
    for (let z = 30; z <= 31; z++) for (let x = 0; x <= world.cellsX; x++) world.heights[z * stride + x] = .15;
    const { context, fishery } = boatFishingSettlement(world);
    const site = findBoatFishingSite(context, fishery);
    expect(isSkiffWaterClear(world, 16.5, 31)).toBe(false);
    expect(site.ok).toBe(true);
    if (!site.ok) return;
    for (const slot of site.slots) expect(isSkiffWaterClear(world, slot.launch.x, slot.launch.z)).toBe(true);
  });

  it("finds ranked, spaced launch slots and deep net points on a sea shore", () => {
    const { context, fishery } = boatFishingSettlement(boatFishingWorld(sea));
    const site = findBoatFishingSite(context, fishery);
    expect(site).toMatchObject({ ok: true, water: "sea", radius: 24 });
    if (!site.ok) return;
    expect(site.slots.length).toBeGreaterThan(1);
    for (const slot of site.slots) {
      expect(slot.z).toBeLessThan(30);
      expect(slot.launch.z).toBeGreaterThan(30);
      expect(slot.yaw).toBeCloseTo(0);
    }
    for (let index = 1; index < site.slots.length; index++)
      expect(Math.hypot(site.slots[index]!.x - site.slots[0]!.x, site.slots[index]!.z - site.slots[0]!.z))
        .toBeGreaterThanOrEqual(BOAT_SLOT_SPACING);
    expect(site.nets.length).toBeGreaterThan(0);
    for (const net of site.nets) expect(net.z).toBeGreaterThan(32.5);
    for (let index = 1; index < site.nets.length; index++)
      expect(Math.hypot(site.nets[index]!.x - site.nets[0]!.x, site.nets[index]!.z - site.nets[0]!.z))
        .toBeGreaterThanOrEqual(BOAT_NET_SPACING);
  });

  it("accepts a large enclosed lake", () => {
    const { context, fishery } = boatFishingSettlement(boatFishingWorld(lake));
    expect(findBoatFishingSite(context, fishery)).toMatchObject({ ok: true, water: "lake" });
  });

  it("rejects ponds and river banks", () => {
    const pondSettlement = boatFishingSettlement(boatFishingWorld(pond));
    expect(findBoatFishingSite(pondSettlement.context, pondSettlement.fishery)).toEqual({ ok: false, radius: 24 });
    const riverWorld = boatFishingWorld(river);
    markRiver(riverWorld, 22, 25);
    const riverSettlement = boatFishingSettlement(riverWorld);
    expect(findBoatFishingSite(riverSettlement.context, riverSettlement.fishery).ok).toBe(false);
  });

  it("rejects a shore beyond the work radius", () => {
    const { context, fishery } = boatFishingSettlement(boatFishingWorld((_x, z) => z >= BOAT_WORLD_SIZE - 2), 16, 8);
    expect(findBoatFishingSite(context, fishery).ok).toBe(false);
  });

  it("keeps launches off building plots and other fisheries' slots and nets", () => {
    const { context, fishery } = boatFishingSettlement(boatFishingWorld(sea));
    const first = findBoatFishingSite(context, fishery);
    if (!first.ok) throw new Error("sea shore expected");
    const reserved = { nets: first.nets, slots: first.slots };
    const second = findBoatFishingSite(context, fishery, reserved);
    if (!second.ok) throw new Error("free shore expected");
    for (const slot of second.slots) for (const taken of first.slots)
      expect(Math.hypot(slot.x - taken.x, slot.z - taken.z)).toBeGreaterThanOrEqual(BOAT_SLOT_SPACING);
    const blocked = first.slots[0]!;
    context.occupied[Math.floor(blocked.z) * context.options.world.cellsX + Math.floor(blocked.x)] = 1;
    const third = findBoatFishingSite(context, fishery);
    if (!third.ok) throw new Error("other launches expected");
    expect(third.slots.some(slot => Math.hypot(slot.x - blocked.x, slot.z - blocked.z) < .5)).toBe(false);
  });

  it("is deterministic across runs", () => {
    const run = () => {
      const { context, fishery } = boatFishingSettlement(boatFishingWorld(sea));
      return findBoatFishingSite(context, fishery);
    };
    expect(run()).toEqual(run());
  });

  /** Gentle default banks, and a steeper, higher beach (dry .3, waterline vertices just under water). */
  const beaches = {
    gentle: () => boatFishingWorld(sea),
    steep: () => {
      const world = boatFishingWorld(sea);
      world.heights.forEach((height, index) => {
        if (height > 0) world.heights[index] = .3;
        else if (height > -.5) world.heights[index] = -.05;
      });
      return world;
    }
  };
  for (const [name, beach] of Object.entries(beaches))
    it(`keeps the entire parked hull off the sand of a ${name} beach`, () => {
      const world = beach();
      const { context, fishery } = boatFishingSettlement(world);
      const site = findBoatFishingSite(context, fishery);
      if (!site.ok) throw new Error("site expected");
      const slot = site.slots[0]!;
      fishery.fisherBoat = { place: "slot", slot: 0, x: slot.x, yaw: slot.yaw, z: slot.z };
      const [frame] = fisherBoatFrames(context);
      const forwardX = Math.sin(frame!.yaw), forwardZ = Math.cos(frame!.yaw);
      const surface = boatWaterSurface(world, frame!.x, frame!.z);
      expect(frame!.y).toBeCloseTo(surface, 3);
      // Even the shore-facing end has water under its keel.
      for (let along = -FISHING_SKIFF_LENGTH / 2; along <= FISHING_SKIFF_LENGTH / 2; along += .1)
        for (const side of [-FISHING_SKIFF_BEAM / 2, 0, FISHING_SKIFF_BEAM / 2]) {
          const x = frame!.x + forwardX * along + forwardZ * side, z = frame!.z + forwardZ * along - forwardX * side;
          expect(sampleSmooth(world, world.heights, x, z)).toBeLessThanOrEqual(surface - .078);
        }
      // The fisher launches right behind the bow, close to the waterline.
      const bowX = frame!.x - forwardX * FISHING_SKIFF_LENGTH / 2, bowZ = frame!.z - forwardZ * FISHING_SKIFF_LENGTH / 2;
      expect(Math.hypot(bowX - slot.x, bowZ - slot.z)).toBeLessThanOrEqual(BOAT_STANCE_FARTHEST);
    });
});
