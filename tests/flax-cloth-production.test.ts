import { buildingExperience, TRADE_WARE_VALUES } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { CART_CARGO_LAYOUTS } from "../src/render-common/logistics/cart-cargo-layouts";
import { cartCapacityFor } from "../src/render-common/logistics/handcart-rules";
import { getWareCarryAction, WARE_DESCRIPTIONS, WARE_IDS } from "../src/render-common/wares/ware-catalog";
import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { buildingsUnlockedAt, buildingUnlockLevel } from "../src/shared/progression/building-unlocks";
import { hasBuildingLevels, maxSavedBuildingLevel } from "../src/shared/settlement/building-levels";
import { FLAX_FARM_TYPE_ID, WEAVER_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { getConstructionCost } from "../src/shared/settlement/construction-costs";
import { getBuildingProductionRule } from "../src/shared/settlement/production-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { weaverWorkstation } from "../src/shared/settlement/settlement-weaver-work";
import { wareBoxUnits } from "../src/shared/settlement/ship-cargo-boxes";
import {
  SHIPYARD_HULL_PLANKS_BEFORE_RIGGING, SHIPYARD_MAST_CLOTH, SHIPYARD_RECIPES, shipyardRecipeInputs
} from "../src/shared/settlement/shipyard-recipes";
import { huntingWorld } from "./helpers/hunting-world";

const session = (nation: WorkerNation = "roman", rotation = 0) => {
  const world = huntingWorld();
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({
    initialSettlers: 24,
    initialStock: { flax: 8, hammer: 4, planks: 100, stone: 100 },
    playerNation: nation,
    roads,
    world
  });
  const place = (typeId: number) => {
    const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
    const result = simulation.placeBuilding(typeId, Math.floor(20 - width / 2) + width / 2,
      Math.floor(10 - depth / 2) + depth / 2, rotation);
    expect(result.ok, result.reason).toBe(true);
    expect(simulation.connectRoads(simulation.headquarters.access, result.building!.access)).toBe(true);
    return result.building!;
  };
  return { place, roads, simulation, world };
};
const stockOf = (building: SettlementBuilding, ware: string) =>
  (building.inventory[ware] ?? 0) + (building.input[ware] ?? 0) + (building.output[ware] ?? 0);

describe("flax and cloth canonical data", () => {
  it("registers both wares with carry, cargo, cart and trade rules", () => {
    expect(WARE_IDS).toEqual(expect.arrayContaining(["flax", "cloth"]));
    expect(getWareCarryAction("flax")).toBe("carry_back");
    expect(getWareCarryAction("cloth")).toBe("carry_back");
    expect(wareBoxUnits("flax")).toBeGreaterThan(0);
    expect(wareBoxUnits("cloth")).toBeGreaterThan(0);
    expect(CART_CARGO_LAYOUTS.flax).toBeDefined();
    expect(CART_CARGO_LAYOUTS.cloth).toBeDefined();
    expect(cartCapacityFor("flax")).toBeGreaterThan(0);
    expect(cartCapacityFor("cloth")).toBeGreaterThan(0);
    expect(TRADE_WARE_VALUES.flax).toBeGreaterThan(0);
    expect(TRADE_WARE_VALUES.cloth).toBeGreaterThan(TRADE_WARE_VALUES.flax!);
    expect(WARE_DESCRIPTIONS.flax).toContain("fibre");
    expect(WARE_DESCRIPTIONS.cloth).toContain("sails");
  });

  // Current catalog: Flax Farm 5, Weaver 6 (national-construction-materials-design-2026-11-03;
  // stock-contact-offline-parity-2026-11-03 records the old 4/5 expectation as stale).
  it("adds two Small producer buildings at levels 5 and 6 with shared level families", () => {
    const farm = getBuildingDefinition(FLAX_FARM_TYPE_ID);
    const weaver = getBuildingDefinition(WEAVER_TYPE_ID);
    expect([...farm.gridFootprint].every(side => side <= 4)).toBe(true);
    expect([...weaver.gridFootprint].every(side => side <= 4)).toBe(true);
    expect(buildingExperience(farm.gridFootprint)).toBe(5);
    expect(buildingExperience(weaver.gridFootprint)).toBe(5);
    expect(buildingUnlockLevel(FLAX_FARM_TYPE_ID)).toBe(5);
    expect(buildingUnlockLevel(WEAVER_TYPE_ID)).toBe(6);
    expect(buildingsUnlockedAt(5)).toContain(FLAX_FARM_TYPE_ID);
    expect(buildingsUnlockedAt(6)).toContain(WEAVER_TYPE_ID);
    expect(buildingUnlockLevel(36)).toBe(18);
    expect(getConstructionCost(FLAX_FARM_TYPE_ID)).toEqual({ planks: 2, stone: 1 });
    expect(getConstructionCost(WEAVER_TYPE_ID)).toEqual({ planks: 2, stone: 2 });
    expect(hasBuildingLevels(FLAX_FARM_TYPE_ID)).toBe(true);
    expect(hasBuildingLevels(WEAVER_TYPE_ID)).toBe(true);
    expect(maxSavedBuildingLevel(FLAX_FARM_TYPE_ID)).toBe(4);
    expect(maxSavedBuildingLevel(WEAVER_TYPE_ID)).toBe(4);
  });

  it("uses one canonical recipe per shipyard mode: boats planks only, sea ships planks and cloth", () => {
    expect(SHIPYARD_RECIPES.boats).toEqual({ cloth: 0, planks: 1 });
    expect(SHIPYARD_RECIPES.ships).toEqual({ cloth: 4, planks: 10 });
    expect(SHIPYARD_HULL_PLANKS_BEFORE_RIGGING).toBe(8);
    expect(SHIPYARD_MAST_CLOTH).toBe(2);
    expect(shipyardRecipeInputs("boats")).toEqual(["planks"]);
    expect(shipyardRecipeInputs("ships")).toEqual([
      "planks", "planks", "planks", "planks", "planks",
      "planks", "planks", "planks", "planks", "planks", "cloth", "cloth", "cloth", "cloth"
    ]);
    expect(getBuildingProductionRule({ typeId: 36 } as SettlementBuilding)).toMatchObject({
      inputs: ["planks"], outputs: ["boat"]
    });
  });

  it("weaves two flax into one cloth and preserves both paid inputs", () => {
    const rule = getBuildingProductionRule({ typeId: WEAVER_TYPE_ID } as SettlementBuilding);
    expect(rule).toMatchObject({ inputs: ["flax", "flax"], job: "Weaver", outputs: ["cloth"] });
    expect(getBuildingProductionRule({ typeId: FLAX_FARM_TYPE_ID } as SettlementBuilding)).toMatchObject({
      job: "Flax grower", outdoor: "field", outputs: ["flax"]
    });
  });
});

describe("flax and cloth live production", () => {
  it.each((["roman", "viking", "nubian", "japanese"] as const).flatMap(nation =>
    [0, 1, 2, 3].map(rotation => ({ nation, rotation }))))(
    "weaves delivered flax at a visible loom and resumes a paid cycle: $nation/$rotation", ({ nation, rotation }) => {
    const { place, simulation } = session(nation, rotation);
    const weaver = place(WEAVER_TYPE_ID);
    const beforeFlax = stockOf(simulation.buildings()[0]!, "flax");
    let observedWork = false;
    for (let tick = 0; tick < 24000 && !simulation.buildings().some(building =>
      (building.inventory.cloth ?? 0) > 0 || (building.output.cloth ?? 0) > 0); tick++) {
      simulation.update(.05);
      const worker = simulation.frames().find(actor => actor.job === "Weaver" && actor.phase === "work");
      if (!worker || observedWork) continue;
      expect(worker.visible).toBe(true);
      const station = weaverWorkstation(weaver);
      expect(Math.hypot(worker.x - station.point.x, worker.z - station.point.z)).toBeLessThan(.05);
      expect(Math.cos(worker.yaw - station.yaw)).toBeCloseTo(1);
      expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
      observedWork = true;
    }
    expect(observedWork, JSON.stringify(simulation.frames().filter(actor => actor.job === "Weaver"))).toBe(true);
    const cloth = simulation.buildings().reduce((sum, building) => sum + stockOf(building, "cloth"), 0);
    expect(cloth).toBeGreaterThanOrEqual(1);
    expect(stockOf(simulation.buildings().find(building => building.uid === weaver.uid)!, "cloth") +
      stockOf(simulation.buildings()[0]!, "cloth")).toBeGreaterThanOrEqual(1);
    expect(stockOf(simulation.buildings()[0]!, "flax")).toBeLessThan(beforeFlax);
  }, 30_000);

  it("does not consume flax when the Weaver's output is full", () => {
    const { place, roads, simulation } = session();
    const weaver = place(WEAVER_TYPE_ID);
    for (let tick = 0; tick < 8000 && weaver.construction < 1; tick++) simulation.update(.05);
    expect(weaver.construction).toBe(1);
    // Shared storage has no per-ware acceptance gate any more; remove the access road so the
    // filled output shelf cannot be drained by a carrier during the observation window.
    roads.replaceSegments([]);
    weaver.output.cloth = 6;
    weaver.input.flax = 2;
    for (let tick = 0; tick < 1000; tick++) simulation.update(.05);
    expect(weaver.output.cloth).toBe(6);
    expect(weaver.input.flax).toBe(2);
  }, 30_000);
});

describe("flax save round-trip", () => {
  it("keeps a saved flax frame and rejects an unknown crop kind", () => {
    const { simulation } = session();
    const saved = simulation.saveState();
    const owner = saved.buildings[0]!.uid;
    saved.fields = [{ id: 4242, kind: "flax", owner, progress: .4, state: "growing", step: 0, x: 14.5, z: 14.5 }];
    expect(simulation.loadState(structuredClone(saved))).toEqual({ ok: true });
    expect(simulation.fieldFrames()).toEqual([{ id: 4242, kind: "flax", owner, progress: .4, state: "growing", step: 0,
      x: 14.5, z: 14.5 }]);
    const invalid = structuredClone(saved);
    invalid.fields[0]!.kind = "grain2" as never;
    expect(simulation.loadState(invalid).ok).toBe(false);
  });
});

describe("flax output capacity", () => {
  it("keeps a full farm shelf from starting another harvest", () => {
    const { place, roads, simulation } = session();
    const farm = place(FLAX_FARM_TYPE_ID);
    for (let tick = 0; tick < 8000 && farm.construction < 1; tick++) simulation.update(.05);
    expect(farm.construction).toBe(1);
    roads.replaceSegments([]);
    farm.output.flax = 6;
    const fields = simulation.fieldFrames().filter(frame => frame.owner === farm.uid).length;
    for (let tick = 0; tick < 1000; tick++) simulation.update(.05);
    expect(farm.output.flax).toBe(6);
    expect(simulation.fieldFrames().filter(frame => frame.owner === farm.uid)).toHaveLength(fields);
  }, 30_000);
});
