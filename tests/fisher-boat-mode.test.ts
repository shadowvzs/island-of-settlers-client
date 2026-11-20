import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { isOverheadCarriedWare } from "../src/render-common/wares/ware-catalog";
import { fisherBoatSaveProblem } from "../src/shared/settlement/fisher-boat-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { REPLAY_COMMANDS } from "../src/shared/settlement/settlement-commands";
import { isFisherBoatSource } from "../src/shared/settlement/settlement-fisher-boat-mode";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { paintBoatWater } from "./helpers/boat-fishing-world";
import { createWorld } from "./helpers/handcart-fixture";

const FISHERY = 18;
const SEA_FROM_Z = 44;

const setup = (sea = true) => {
  const world = createWorld();
  if (sea) paintBoatWater(world, (_x, z) => z >= SEA_FROM_Z);
  let blocked: ((x: number, z: number) => boolean) | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => blocked?.(x, z) ?? false });
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 20,
    initialStock: { logs: 40, planks: 40, stone: 40 }, resourceTargets: () => [] });
  blocked = simulation.isOccupied;
  const placeFishery = (x: number, z = 30) => {
    const [width, depth] = getBuildingDefinition(FISHERY).gridFootprint;
    const placed = simulation.placeBuilding(FISHERY, x + width % 2 / 2, z + depth % 2 / 2, 0);
    expect(placed.ok, placed.reason).toBe(true);
    const fishery = placed.building!;
    Object.assign(fishery, { construction: 1, required: {} });
    expect(simulation.connectRoads(fishery.access, simulation.headquarters.access)).toBe(true);
    return fishery;
  };
  const advance = (seconds: number, until: () => boolean) => {
    for (let tick = 0; tick < seconds * 20; tick++) {
      simulation.update(.05);
      if (until()) return true;
    }
    return false;
  };
  return { advance, headquarters: simulation.headquarters, placeFishery, simulation };
};

const boatCarriers = (simulation: ReturnType<typeof setup>["simulation"]) =>
  simulation.frames().filter(actor => actor.delivery?.ware === "boat");

describe("fisher boat mode", () => {
  it("is a replay-recorded command and boats are carried overhead", () => {
    expect(REPLAY_COMMANDS).toContain("setFisherMode");
    expect(isOverheadCarriedWare("boat")).toBe(true);
    expect(isOverheadCarriedWare("fish")).toBe(false);
  });

  it("disables boat mode without a sea or lake shore in the work radius", () => {
    const { headquarters, placeFishery, simulation } = setup(false);
    headquarters.inventory.boat = 1;
    const fishery = placeFishery(30);
    fishery.selected = true;
    expect(simulation.fisherBoatStatus(fishery.uid)).toEqual({ block: "noShore", mode: "rod" });
    expect(simulation.setFisherMode(fishery.uid, "boat")).toBe(false);
    expect(fishery.fisherMode).toBeUndefined();
    expect(fishery.boatSite).toBeUndefined();
  });

  it("disables boat mode while the island has no spare boat", () => {
    const { placeFishery, simulation } = setup();
    const fishery = placeFishery(30);
    expect(simulation.fisherBoatStatus(fishery.uid)).toEqual({ block: "noBoat", mode: "rod" });
    expect(simulation.setFisherMode(fishery.uid, "boat")).toBe(false);
    expect(simulation.setFisherMode(simulation.headquarters.uid, "rod")).toBe(false);
  });

  it("reserves one storehouse boat that a carrier delivers as the Fishery input", () => {
    const { advance, headquarters, placeFishery, simulation } = setup();
    headquarters.inventory.boat = 1;
    const fishery = placeFishery(30), neighbour = placeFishery(42);
    simulation.update(.05);
    expect(simulation.fisherBoatStatus(fishery.uid)).toEqual({ mode: "rod" });
    expect(simulation.setFisherMode(fishery.uid, "boat")).toBe(true);
    expect(fishery.boatSite).toMatchObject({ ok: true, water: "sea" });
    expect(simulation.fisherBoatStatus(fishery.uid)).toEqual({ mode: "boat", place: "waiting" });
    expect(simulation.fisherBoatStatus(neighbour.uid)).toEqual({ block: "noBoat", mode: "rod" });
    expect(simulation.setFisherMode(neighbour.uid, "boat")).toBe(false);
    expect(advance(10, () => boatCarriers(simulation).length > 0)).toBe(true);
    expect(advance(120, () => (fishery.input.boat ?? 0) > 0)).toBe(true);
    expect(headquarters.inventory.boat ?? 0).toBe(0);
    expect(simulation.fisherBoatStatus(fishery.uid)).toEqual({ mode: "boat", place: "yard" });
    advance(5, () => false);
    expect(fishery.input.boat).toBe(1);
    expect(boatCarriers(simulation)).toEqual([]);
  });

  it("keeps the owned boat when switching back to the rod", () => {
    const { headquarters, placeFishery, simulation } = setup();
    headquarters.inventory.boat = 1;
    const fishery = placeFishery(30);
    expect(simulation.setFisherMode(fishery.uid, "boat")).toBe(true);
    fishery.input.boat = 1;
    delete headquarters.inventory.boat;
    expect(simulation.setFisherMode(fishery.uid, "rod")).toBe(true);
    expect(fishery.fisherMode).toBeUndefined();
    expect(simulation.fisherBoatStatus(fishery.uid)).toEqual({ mode: "rod", place: "yard" });
    expect(simulation.setFisherMode(fishery.uid, "boat")).toBe(true);
    expect(fishery.input.boat).toBe(1);
  });

  it("saves, validates and restores the mode and site", () => {
    const { headquarters, placeFishery, simulation } = setup();
    headquarters.inventory.boat = 1;
    const fishery = placeFishery(30);
    expect(simulation.setFisherMode(fishery.uid, "boat")).toBe(true);
    const save = simulation.saveState();
    const saved = save.buildings.find(building => building.uid === fishery.uid)!;
    expect(saved.fisherMode).toBe("boat");
    expect(simulation.loadState(save)).toEqual({ ok: true });
    const restored = simulation.buildings().find(building => building.uid === fishery.uid)!;
    expect(restored.fisherMode).toBe("boat");
    expect(restored.boatSite).toEqual(fishery.boatSite);
  });
});

describe("fisher boat save validation", () => {
  const world = createWorld();
  const site = { nets: [{ x: 30.5, z: 50.5 }], ok: true, radius: 24, slots: [{ launch: { x: 30, z: 45 },
    shoreEntry: { x: 30, z: 42.4 }, waterY: 0, x: 30, yaw: 0, z: 43.4 }], water: "sea" };
  const fishery = (fields: Record<string, unknown>) => ({ input: {}, typeId: FISHERY, ...fields });

  it("accepts absent fields and a complete boat state", () => {
    expect(fisherBoatSaveProblem(fishery({}), world)).toBeUndefined();
    expect(fisherBoatSaveProblem(fishery({ boatSite: site, fisherBoat: { place: "slot", slot: 0, x: 30, yaw: 0,
      z: 43.4 }, fisherMode: "boat" }), world)).toBeUndefined();
  });

  it("rejects malformed or misplaced boat state", () => {
    expect(fisherBoatSaveProblem({ fisherMode: "boat", typeId: 33 }, world)).toBeDefined();
    expect(fisherBoatSaveProblem(fishery({ fisherMode: "rod" }), world)).toBeDefined();
    expect(fisherBoatSaveProblem(fishery({ boatSite: { ...site, slots: [] } }), world)).toBeDefined();
    expect(fisherBoatSaveProblem(fishery({ boatSite: site, fisherBoat: { place: "slot", slot: 3, x: 30, yaw: 0,
      z: 43 } }), world)).toBeDefined();
    expect(fisherBoatSaveProblem(fishery({ boatSite: site, fisherBoat: { place: "slot", slot: 0, x: 30, yaw: 0,
      z: 43 }, input: { boat: 1 } }), world)).toBeDefined();
  });

  it("never takes harbour boats", () => {
    const source = (typeId: number) => ({ construction: 1, typeId }) as SettlementBuilding;
    expect(isFisherBoatSource(source(0))).toBe(true);
    expect(isFisherBoatSource(source(29))).toBe(true);
    expect(isFisherBoatSource(source(39))).toBe(false);
  });
});
