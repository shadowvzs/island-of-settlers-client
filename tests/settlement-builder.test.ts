import { STARTER_STOCK } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import {
  createSettlementSimulation,
  type SettlementSimulation
} from "../src/shared/settlement/settlement-simulation";
import type {
  SettlementActor,
  SettlementOptions
} from "../src/shared/settlement/settlement-types";
import { BUILD, PROP, PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";

const fixture = (stock = STARTER_STOCK, hooks: Partial<SettlementOptions> = {}) => {
  const size = 40;
  const world = {
    cellsX: size,
    cellsZ: size,
    start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2),
    blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2),
    mineZone: new Uint16Array(size ** 2),
    mineZones: [],
    props: {
      count: 2,
      types: new Uint8Array([PROP.broadleafTree, PROP.coniferTree]),
      scale: new Float32Array([1, 1]),
      x: new Float32Array([16, 22]),
      z: new Float32Array([12, 12])
    }
  } as unknown as WorldData;
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, {
    isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false
  });
  const felled: number[] = [];
  simulation = createSettlementSimulation({
    world,
    roads,
    initialStock: { ...stock },
    onFellTree: (index) => {
      felled.push(index);
      world.props.types[index] = PROP_REMOVED;
      return true;
    },
    ...hooks
  });
  const advance = (seconds: number) => {
    for (let step = 0; step < seconds * 10; step++) simulation!.update(0.1);
  };
  const place = (id: number, x = 12.5, z = 8, rotation = 0) => {
    const [width, depth] = getBuildingDefinition(id).gridFootprint;
    const actualWidth = rotation % 2 ? depth : width;
    const actualDepth = rotation % 2 ? width : depth;
    const snappedX = Math.floor(x - actualWidth / 2) + actualWidth / 2;
    const snappedZ = Math.floor(z - actualDepth / 2) + actualDepth / 2;
    const result = simulation!.placeBuilding(id, snappedX, snappedZ, rotation);
    expect(result.ok, result.reason).toBe(true);
    const building = result.building!;
    expect(simulation!.connectRoads(simulation!.headquarters.access, building.access)).toBe(true);
    return building;
  };
  return { world, roads, simulation, felled, advance, place };
};

import { readFileSync } from "node:fs";

import {
  applyConstructionContact,
  BUILDER_HAMMER,
  builderHammerContacts,
  constructionFacing,
  constructionHits,
  constructionWorkPositions
} from "../src/shared/settlement/settlement-construction";
describe("hammer driven construction", () => {
  it("matches the original clip contact and does not count pre-impact motion twice", () => {
    const manifest = JSON.parse(
      readFileSync(
        new URL("../../island-of-settlers-worker-generation/assets/animation-manifest.json", import.meta.url),
        "utf8"
      )
    );
    const clip = manifest.clips.find((entry: { name: string }) => entry.name === "build_hammer");
    expect(clip.duration).toBe(BUILDER_HAMMER.duration);
    expect(clip.events.find((entry: { type: string }) => entry.type === "work_contact").time).toBe(
      BUILDER_HAMMER.contact
    );
    expect(builderHammerContacts(0, 0.719)).toBe(0);
    expect(builderHammerContacts(0.719, 0.72)).toBe(1);
    expect(builderHammerContacts(0.72, 2.019)).toBe(0);
    expect(builderHammerContacts(2.019, 2.02)).toBe(1);
    expect(builderHammerContacts(0, 3.32)).toBe(3);
  });
  it.each([0, 1, 2, 3])("faces the adjacent wall squarely at rotation %s", (rotation) => {
    const { place } = fixture();
    const building = place(17, 12, 8, rotation);
    constructionWorkPositions(building).forEach((point, edge) => {
      const alongX = Math.abs(point.z - building.z) > building.depth / 2;
      const wall = alongX
        ? { x: point.x, z: building.z + Math.sign(point.z - building.z) * building.depth / 2 }
        : { x: building.x + Math.sign(point.x - building.x) * building.width / 2, z: point.z };
      const heading = Math.atan2(wall.x - point.x, wall.z - point.z);
      expect(Math.cos(heading - constructionFacing(edge))).toBeCloseTo(1);
    });
  });
  it.each([0, 1, 2, 3])("leaves the rotated entrance clear at rotation %s", (rotation) => {
    const { place } = fixture();
    const building = place(17, 12, 8, rotation);
    for (const point of constructionWorkPositions(building)) {
      expect(Math.hypot(point.x - building.access.x, point.z - building.access.z)).toBeGreaterThan(
        0.75
      );
      expect(
        Math.abs(point.x - building.x) > building.width / 2 ||
          Math.abs(point.z - building.z) > building.depth / 2
      ).toBe(true);
    }
  });
  it("keeps unconsumed delivered stock visible and consumes boards then stone exactly once", () => {
    const { place } = fixture();
    const building = place(32);
    const cost = { ...building.required };
    building.input = { ...cost };
    expect(applyConstructionContact(building)).toBe(true);
    expect(building.input.planks).toBe(cost.planks! - 1);
    expect(building.input.stone).toBe(cost.stone);
    for (let i = 1; i < constructionHits(building); i++)
      expect(applyConstructionContact(building)).toBe(true);
    expect(building.construction).toBe(1);
    expect(building.constructionConsumed).toEqual(cost);
    expect(Object.values(building.input).every((count) => count === 0)).toBe(true);
    expect(building.required).toEqual(cost);
    expect(applyConstructionContact(building)).toBe(false);
  });
  it("waits without progress when a required delivery is missing", () => {
    const { place } = fixture();
    const building = place(17);
    expect(applyConstructionContact(building)).toBe(false);
    expect(building.construction).toBe(0);
    building.input.planks = 1;
    for (let i = 0; i < Math.ceil(constructionHits(building) / 2); i++)
      applyConstructionContact(building);
    const progress = building.construction;
    expect(applyConstructionContact(building)).toBe(false);
    expect(building.construction).toBe(progress);
  });
  it("resets the hammer clock after supply pauses without catching up missed impacts", () => {
    const { place, simulation } = fixture(STARTER_STOCK, { initialSettlers: 0 });
    const building = place(17);
    // Growth now creates helpers even when the initial pool is zero: keep this supply-pause
    // fixture out of stock so new carriers cannot finish its deliberately partial delivery.
    simulation.headquarters.inventory.planks = 0;
    simulation.headquarters.inventory.stone = 0;
    const actor: SettlementActor = {
      uid: 100,
      ...building.access,
      y: 0,
      yaw: 0,
      visible: true,
      job: "Builder",
      action: "idle",
      ware: null,
      tool: "hammer",
      phase: "inside",
      building: building.uid,
      home: simulation.headquarters.uid,
      path: [],
      pathIndex: 0,
      timer: 0,
      animationTime: 0
    };
    simulation.frames().push(actor);
    building.worker = actor.uid;
    building.input.planks = 1;
    for (let i = 0; i < 2000 && !(actor.action === "idle" && building.construction > 0); i++)
      simulation.update(0.05);
    const paused = building.construction;
    expect(paused).toBeGreaterThan(0);
    expect(paused).toBeLessThan(1);
    for (let i = 0; i < 400; i++) simulation.update(0.05);
    expect(building.construction).toBe(paused);
    expect(actor.animationTime).toBe(0);
    building.input.planks = 1;
    for (let i = 0; i < 14; i++) simulation.update(0.05);
    expect(building.construction).toBe(paused);
    simulation.update(0.1);
    expect(building.construction).toBeGreaterThan(paused);
  });
  it("walks to several safe sides, keeps the entrance clear and does not redeliver consumed materials", () => {
    const { place, simulation } = fixture({ ...STARTER_STOCK, axe: 0 });
    const building = place(17);
    const cost = { ...building.required };
    const initial = simulation.headquarters.inventory.planks!;
    const positions = new Set<number>();
    let last = 0;
    for (let tick = 0; tick < 2500 && building.construction < 1; tick++) {
      simulation.update(0.05);
      const builder = simulation.frames().find((actor) => actor.job === "Builder");
      if (builder?.phase === "construct" && builder.action === "work") {
        const side = constructionWorkPositions(building).findIndex(
          (point) => Math.hypot(point.x - builder.x, point.z - builder.z) < 0.1
        );
        positions.add(side);
        expect(
          Math.hypot(builder.x - building.access.x, builder.z - building.access.z)
        ).toBeGreaterThan(0.6);
      }
      if (building.construction !== last) {
        if (builder)
          expect(
            (builder.animationTime - BUILDER_HAMMER.contact) % BUILDER_HAMMER.duration
          ).toBeLessThan(0.051);
        last = building.construction;
      }
    }
    expect(building.construction).toBe(1);
    expect(positions.size).toBe(4);
    expect(positions.has(-1)).toBe(false);
    expect(simulation.headquarters.inventory.planks).toBe(initial - cost.planks!);
    expect(building.constructionConsumed).toEqual({ planks: cost.planks });
  });
});
