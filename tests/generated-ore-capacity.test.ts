import { describe, expect, it } from "vitest";

import { countCompatibleOrePlots, findUsableOrePlots } from "../src/shared/settlement/settlement-ore-placement";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { ORE } from "../src/shared/world/world-data";
import { cachedWorld, freshWorldBeforeAll, preloadWorlds } from "./helpers/cached-worlds";

const options = { ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, seed: 1234, landform: "island" as const };

const small = { ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, seed: 42 };

describe("generated production mine capacity", () => {
  const freshSmall = freshWorldBeforeAll(small);
  preloadWorlds(options, { ...options, oreCapacity: false }, small, { ...small, oreCapacity: false });
  it("repairs the narrow iron patch with three legal mines without changing terrain or existing ore", () => {
    const original = cachedWorld({ ...options, oreCapacity: false });
    const world = cachedWorld(options);
    expect(world.heights).toEqual(original.heights);
    expect(world.waterDepth).toEqual(original.waterDepth);
    expect(world.blocking).toEqual(original.blocking);
    expect(world.walkCost).toEqual(original.walkCost);
    expect(world.props).toEqual(original.props);
    const context = { options: { world, roads: {} }, buildings: [],
      occupied: new Uint8Array(96 ** 2), nextBuilding: 0 } as unknown as SettlementContext;
    for (const zone of world.mineZones.filter(zone => zone.ore !== ORE.none)) {
      const cells = Array.from(world.mineZone.keys()).filter(cell => world.mineZone[cell] === zone.id);
      expect(cells.length).toBeLessThanOrEqual(170);
      expect(zone.cellCount).toBe(cells.length);
      expect(countCompatibleOrePlots(context, findUsableOrePlots(context, cells, zone.ore))).toBeGreaterThanOrEqual(3);
    }
    original.mineZone.forEach((id, cell) => {
      if (id) expect(world.mineZone[cell]).toBe(id);
      if (original.oreAmount[cell]) expect(world.oreAmount[cell]).toBe(original.oreAmount[cell]);
    });
  });

  it("remains deterministic and preserves starting deposits on small maps", () => {
    const world = freshSmall(), repeated = cachedWorld(small);
    expect(world.mineZone).toEqual(repeated.mineZone);
    expect(world.oreAmount).toEqual(repeated.oreAmount);
    const original = cachedWorld({ ...small, oreCapacity: false });
    expect(world.mineZones.filter(zone => zone.ore !== ORE.none).length)
      .toBe(original.mineZones.filter(zone => zone.ore !== ORE.none).length);
  });
});
