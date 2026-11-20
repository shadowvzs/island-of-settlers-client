import { describe, expect, it } from "vitest";

import { prepareBakedRiverAdoption } from "../src/shared/world/editing/baked-river-adoption";
import { editGeneratedRiver } from "../src/shared/world/editing/generated-river-edit";
import { applyWorldDiff, createWorldSnapshot } from "../src/shared/world/editing/history/world-diff";
import { createGeneratedRiverCapture } from "../src/shared/world/generation/generated-river-capture";
import { carveRivers } from "../src/shared/world/generation/river-carving";
import { createWaterLayers } from "../src/shared/world/generation/water";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";

const fixture = () => {
  const world = cachedWorld({ ...SMALL_EDITOR_WORLD, rivers: 0 });
  world.props.count = 0; world.seaLevel = 0;
  world.mineZone.fill(0); world.mineZones = [];
  const stride = world.cellsX + 1;
  for (let i = 0; i < world.heights.length; i++) world.heights[i] = 8 - Math.floor(i / stride) * .06;
  const points = Array.from({ length: 60 }, (_, step) => ({ x: 40, z: 15 + step }));
  const widths = () => .6;
  const capture = createGeneratedRiverCapture(world, world.heights, 0, widths);
  const layers = carveRivers(world, world.heights, [{ points, mouthStep: 59 }], 0, widths, capture);
  const water = createWaterLayers(world, world.heights, layers.surface, 0);
  world.waterSurface = water.waterSurface; world.waterDepth = water.waterDepth;
  world.flow = layers.flow; world.waterfalls = layers.waterfalls;
  world.generatedRivers = []; world.authoredRivers = [];
  return world;
};

describe("explicit baked river adoption", () => {
  it("adopts metadata without changing terrain or water and removal preserves the baked bed", () => {
    const world = fixture(), before = structuredClone(world);
    const river = prepareBakedRiverAdoption(world, [{ x: 40, z: 20 }, { x: 40, z: 65 }]);
    expect(world).toEqual(before);
    expect(river.adopted).toBe(true);
    expect(river.patches.length).toBeGreaterThan(0);
    world.generatedRivers = [river];
    editGeneratedRiver(world, null, river.id);
    expect(world.heights).toEqual(before.heights);
    expect(world.flow[(40 * (world.cellsX + 1) + 40) * 2 + 1]).toBe(0);
    expect(world.generatedRivers).toEqual([]);
  });

  it("rejects dry traces and existing editable ownership atomically", () => {
    const world = fixture(), before = structuredClone(world);
    expect(() => prepareBakedRiverAdoption(world, [{ x: 10, z: 20 }, { x: 10, z: 65 }])).toThrow("flowing");
    expect(world).toEqual(before);
    world.generatedRivers = [prepareBakedRiverAdoption(world, [{ x: 40, z: 20 }, { x: 40, z: 65 }])];
    expect(() => prepareBakedRiverAdoption(world, [{ x: 40, z: 20 }, { x: 40, z: 65 }])).toThrow("editable");
  });

  it("persists adoption through history and map saves, then supports a real width/depth edit", async () => {
    const world = fixture(), snapshot = createWorldSnapshot(world, null);
    snapshot.capture();
    world.generatedRivers = [prepareBakedRiverAdoption(world, [{ x: 40, z: 20 }, { x: 40, z: 65 }])];
    const diff = snapshot.diff()!;
    applyWorldDiff(world, null, diff, "before"); expect(world.generatedRivers).toEqual([]);
    applyWorldDiff(world, null, diff, "after"); expect(world.generatedRivers![0]!.adopted).toBe(true);
    const bytes = await writeMapFile(world, { name: "Adopted river", source: "legacy", savedAt: 1, animals: [] });
    const loaded = (await readMapFile(bytes)).world;
    expect(loaded.generatedRivers).toEqual(world.generatedRivers);
    const heights = loaded.heights.slice();
    editGeneratedRiver(loaded, { ...loaded.generatedRivers![0]!, widthScale: 1.2, depthScale: 1.5 });
    expect(loaded.generatedRivers![0]!.depthScale).toBe(1.5);
    expect(loaded.heights.some((height, index) => height < heights[index]!)).toBe(true);
  });
});
