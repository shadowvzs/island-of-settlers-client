import { expect, it, vi } from "vitest";

import { createIslandBuildingClearance } from "../src/app/settlement/island-building-clearance";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { BUILD, MATERIAL_COUNT, type WorldData } from "../src/shared/world/world-data";

const world = () => {
  const size = 32;
  return {
    cellsX: size,
    cellsZ: size,
    seed: 7,
    heights: new Float32Array((size + 1) ** 2),
    waterDepth: new Float32Array((size + 1) ** 2),
    splat: new Uint8Array((size + 1) ** 2 * MATERIAL_COUNT),
    blocking: new Uint8Array(size ** 2),
    slopeClass: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10),
    buildCap: new Uint8Array(size ** 2).fill(BUILD.large),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: {
      count: 0,
      types: new Uint8Array(0),
      x: new Float32Array(0),
      y: new Float32Array(0),
      z: new Float32Array(0),
      scale: new Float32Array(0),
      rotation: new Float32Array(0),
      phase: new Float32Array(0),
      form: new Uint8Array(0)
    }
  } as unknown as WorldData;
};

it("keeps only physical building cells bare and releases them by uid on demolition", () => {
  const terrain = world();
  const reserveBuildingGroundCover = vi.fn(), reserveBuildingGroundCovers = vi.fn();
  const releaseBuildingGroundCover = vi.fn();
  const options = {
    world: terrain,
    playerNation: "roman",
    renderer: {
      mapEdit: {
        reserveBuildingGroundCover,
        reserveBuildingGroundCovers,
        releaseBuildingGroundCover,
        refreshPlacedProps: vi.fn(),
        removeProps: vi.fn(),
        previewRegion: vi.fn(),
        refreshChunks: vi.fn()
      }
    },
    animals: {
      manager: { refreshHomes: vi.fn(), relocateFrom: vi.fn(), setExcluded: vi.fn(), touchArea: vi.fn() }
    },
    felling: { removeTrees: vi.fn() },
    growth: { remove: vi.fn() }
  };
  const hook = createIslandBuildingClearance(
    options as unknown as Parameters<typeof createIslandBuildingClearance>[0]
  );
  const building = {
    uid: 41,
    typeId: 4,
    x: 16,
    z: 16,
    width: 4,
    depth: 4,
    rotation: 0
  } as SettlementBuilding;
  hook(building, []);
  expect(options.renderer.mapEdit.reserveBuildingGroundCover).toHaveBeenCalledOnce();
  const [uid, cells, region] = reserveBuildingGroundCover.mock.calls[0]!;
  expect(uid).toBe(41);
  const set = new Set(cells as number[]);
  expect(set.size).toBeGreaterThan(0);
  expect(set.size).toBeLessThan(25);
  expect(set.has(16 * 32 + 16), "the physical tower centre stays bare").toBe(true);
  expect(set.has(18 * 32 + 18), "ground beyond the tower keeps grass").toBe(false);
  expect(region).toEqual({ minX: 14, minZ: 14, maxX: 17, maxZ: 17 });
  hook.restored([building]);
  expect(reserveBuildingGroundCovers).toHaveBeenCalledOnce();
  const [restored] = reserveBuildingGroundCovers.mock.calls[0]!;
  expect(restored).toHaveLength(1);
  expect(restored[0].uid).toBe(41);
  expect(restored[0].cells.length).toBeGreaterThan(0);
  hook.demolish(building);
  expect(releaseBuildingGroundCover).toHaveBeenCalledWith(41, region);
});
