import { ROAD_SPEED } from "@shared/catalog/balance";
import { describe, expect, it, vi } from "vitest";

import { createRoadPreviewFrame } from "../src/app/settlement/road-preview-frame";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getPlacedBuildingLogistics } from "../src/render-common/buildings/building-grid-metrics";
import { ROAD_STONE_COST } from "../src/shared/balance/economy";
import { createBuildingRoadApproaches } from "../src/shared/settlement/building-road-approaches";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { ROAD_TIERS, type RoadPreview, type RoadUpgradeTier } from "../src/shared/settlement/road-types";
import { settlementRoadSpeedAt } from "../src/shared/settlement/settlement-road-speed";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { createPlacementSession } from "./helpers/placement-session";

const tiers = ROAD_TIERS.slice(1) as RoadUpgradeTier[];
const fixture = () => {
  const { roads, simulation, world } = createPlacementSession();
  const building = simulation.headquarters, flag = building.access;
  const start = { x: flag.x - 2, z: flag.z + .5 }, end = { x: flag.x + 2, z: flag.z + .5 };
  // Preserve a legacy half-cell junction exactly: new construction now reserves both verges
  // and routes this close-to-plot road farther away, producing a longer, separately paid link.
  const main = Array.from({ length: 8 }, (_, index) => ({
    start: { x: start.x + index * .5, z: start.z },
    end: { x: start.x + (index + 1) * .5, z: start.z },
    tier: "dirt" as const
  }));
  expect(roads.replaceSegments([...roads.segments(), ...main])).toBe(true);
  expect(roads.addRoad(flag, { x: flag.x, z: flag.z + .5 })).toBe(true);
  for (const tier of tiers) building.inventory[tier] = 200;
  const connector = () => roads.segments().find(segment => [segment.start, segment.end]
    .some(point => point.x === flag.x && point.z === flag.z))!;
  return { building, connector, end, roads, simulation, start, world };
};

describe("building flag connectors on upgraded road junctions", () => {
  it.each(tiers)("inherits %s through the real upgrade command, entrance geometry and speed cache", target => {
    const f = fixture();
    const context = { options: { roads: f.roads }, buildings: [f.building] } as unknown as SettlementContext;
    const point = f.building.doorThreshold;
    expect(settlementRoadSpeedAt(context, point)).toBe(ROAD_SPEED.dirt);
    expect(f.roads.stoneRoute(f.building.access, f.end)).toBeNull();
    for (const tier of tiers.slice(0, tiers.indexOf(target) + 1)) {
      const before = f.building.inventory[tier]!;
      expect(f.simulation.upgradeRoad(f.start, f.end, tier)).toBe(true);
      expect(f.connector().tier).toBe(tier);
      // The short flag junction shares the main road surface; the paid path is eight half-cells.
      expect(before - f.building.inventory[tier]!).toBe(8 * ROAD_STONE_COST);
    }
    const graph = f.roads.segments();
    const approaches = createBuildingRoadApproaches(graph, [f.building]).slice(graph.length);
    expect(approaches.length).toBeGreaterThan(0);
    expect(approaches.every(segment => segment.tier === target)).toBe(true);
    expect(settlementRoadSpeedAt(context, point)).toBe(ROAD_SPEED[target]);
    expect(f.roads.stoneRoute(f.building.access, f.end)).not.toBeNull();
    expect(graph.some(segment => segment.doorway)).toBe(false);
  });

  it.each(tiers)("a newly joined half-cell flag inherits the existing %s junction", tier => {
    const roads = createRoadNetwork({ cellsX: 12, cellsZ: 12,
      heights: new Float32Array(169), blocking: new Uint8Array(144) });
    const start = { x: 3, z: 5 }, end = { x: 7, z: 5 }, flag = { x: 5, z: 4.5 };
    expect(roads.addRoad(start, end)).toBe(true);
    for (const upgrade of tiers.slice(0, tiers.indexOf(tier) + 1))
      expect(roads.upgradeRoad(start, end, () => true, upgrade)).toBe(true);
    expect(roads.addRoad(flag, { x: 5, z: 5 })).toBe(true);
    expect(roads.stoneRoute(flag, end)).toBeNull();
    const revision = roads.revision;
    expect(roads.inheritBuildingFlagTiers!([flag])).toBe(true);
    expect(roads.revision).toBe(revision + 1);
    expect(roads.segments().find(segment => segment.start.z === flag.z)?.tier).toBe(tier);
    expect(roads.stoneRoute(flag, end)).not.toBeNull();
    expect(roads.inheritBuildingFlagTiers!([flag])).toBe(false);
    expect(roads.revision).toBe(revision + 1);
  });

  it("rejects a new plot that overlaps an upgraded road's reserved verge", () => {
    const { roads, simulation } = createPlacementSession();
    const [width, depth] = getBuildingDefinition(17).gridFootprint;
    const x = 45 + width / 2, z = 65 + depth / 2;
    const flag = getPlacedBuildingLogistics(17, x, z, 0).road;
    const start = { x: flag.x - 2, z: flag.z + .5 }, end = { x: flag.x + 2, z: flag.z + .5 };
    expect(roads.addRoad(start, end)).toBe(true);
    expect(roads.upgradeRoad(start, end, () => true, "stone")).toBe(true);
    const stock = { ...simulation.headquarters.inventory }, before = roads.segments();
    const placed = simulation.placeBuilding(17, x, z);
    expect(placed.ok).toBe(false);
    expect(placed.reason).toBe("Plot reaches into a road's reserved stone width");
    expect(roads.segments()).toEqual(before);
    expect(simulation.headquarters.inventory).toEqual(stock);
  });

  it("a public road keeps a longer building link individually upgradeable beyond its reserved verge", () => {
    const { roads, simulation } = createPlacementSession();
    const [width, depth] = getBuildingDefinition(17).gridFootprint;
    const placed = simulation.placeBuilding(17, 45 + width / 2, 65 + depth / 2);
    expect(placed.ok, placed.reason).toBe(true);
    const flag = placed.building!.access;
    const start = { x: flag.x - 2, z: flag.z + .5 }, end = { x: flag.x + 2, z: flag.z + .5 };
    expect(roads.addRoad(start, end)).toBe(true);
    expect(roads.upgradeRoad(start, end, () => true, "stone")).toBe(true);
    const stock = { ...simulation.headquarters.inventory };
    expect(simulation.connectRoads(start, end)).toBe(true);
    expect(roads.route(flag, end)).not.toBeNull();
    expect(roads.stoneRoute(flag, end)).toBeNull();
    const link = roads.segments().filter(segment => segment.start.x === flag.x && segment.end.x === flag.x);
    expect(link).toHaveLength(2);
    expect(link.every(segment => segment.tier === "dirt")).toBe(true);
    expect(simulation.headquarters.inventory).toEqual(stock);
    expect(simulation.upgradeRoad(flag, { x: flag.x, z: flag.z + 1 }, "stone")).toBe(true);
    expect(stock.stone! - simulation.headquarters.inventory.stone!).toBe(2 * ROAD_STONE_COST);
    expect(roads.stoneRoute(flag, end)).not.toBeNull();
  });

  it("previews the flag connector and entrance without spending or mutating committed roads", () => {
    const f = fixture(), before = f.roads.segments(), stock = f.building.inventory.stone;
    const plan = f.simulation.planRoad(f.start, f.end, "stone")!;
    expect(plan.segments).toHaveLength(9);
    const preview: RoadPreview = { ...plan, start: f.start, end: f.end, valid: true };
    const frame = createRoadPreviewFrame({ buildings: () => [f.building], preview: () => preview,
      segments: () => f.roads.segments(), widthObstacles: { isBlocked: () => false } })(f.roads.revision)!;
    const entrance = frame.contextSegments!.filter(segment => segment.doorway);
    expect(entrance.length).toBeGreaterThan(0);
    expect(entrance.every(segment => segment.preview && segment.tier === "stone")).toBe(true);
    expect(f.roads.segments()).toEqual(before);
    expect(f.building.inventory.stone).toBe(stock);
  });

  it("keeps the flag on dirt when payment fails and never partially upgrades the junction", () => {
    const f = fixture(), before = f.roads.segments(), revision = f.roads.revision;
    f.building.inventory.stone = 0;
    expect(f.simulation.upgradeRoad(f.start, f.end)).toBe(false);
    expect(f.roads.segments()).toEqual(before);
    expect(f.roads.revision).toBe(revision);
    expect(f.connector().tier).toBe("dirt");
  });

  it("repairs a stale flag connector beside an already paved road without charging the road twice", () => {
    const f = fixture();
    // This also represents an older save whose flag connector did not inherit the junction.
    for (const tier of tiers) expect(f.roads.upgradeRoad(f.start, f.end, () => true, tier)).toBe(true);
    expect(f.connector().tier).toBe("dirt");
    const pay = vi.fn(() => false);
    expect(f.roads.upgradeRoad(f.start, f.end, pay, "granite", [f.building.access])).toBe(true);
    expect(f.connector().tier).toBe("granite");
    expect(pay).not.toHaveBeenCalled();
    const revision = f.roads.revision;
    expect(f.roads.upgradeRoad(f.start, f.end, pay, "granite", [f.building.access])).toBe(true);
    expect(f.roads.revision).toBe(revision);
  });

  it("leaves longer building links and unrelated short side roads on their existing tiers", () => {
    const roads = createRoadNetwork({ cellsX: 12, cellsZ: 12, heights: new Float32Array(169), blocking: new Uint8Array(144) });
    const start = { x: 5, z: 3 }, end = { x: 5, z: 7 }, junction = { x: 5, z: 5 };
    expect(roads.addRoad(start, end)).toBe(true);
    expect(roads.addRoad(junction, { x: 6, z: 5 })).toBe(true);
    expect(roads.addRoad(junction, { x: 4.5, z: 5 })).toBe(true);
    expect(roads.upgradeRoad(start, end, () => true, "stone", [{ x: 6, z: 5 }])).toBe(true);
    expect(roads.segments().filter(segment => segment.start.z === 5 && segment.end.z === 5)
      .every(segment => segment.tier === "dirt")).toBe(true);
    expect(roads.inheritBuildingFlagTiers!([{ x: 6, z: 5 }])).toBe(false);
    expect(roads.stoneRoute({ x: 6, z: 5 }, end)).toBeNull();
  });
});
