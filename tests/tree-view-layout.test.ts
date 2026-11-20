import { describe, expect, it } from "vitest";

import { getTreeViewBasis } from "../src/render-common/baker/tree-view-baker";
import {
  FOLIAGE,
  getMeshFoliage,
  getViewRange,
  layoutTreeViews,
  TREE_VIEW_AZIMUTHS,
  TREE_VIEW_ELEVATIONS,
  TREE_VIEW_MAX_ATLAS_SIDE,
  TREE_VIEW_MAX_FRAME_TEXELS
} from "../src/render-common/baker/tree-view-layout";
import type { PropMesh } from "../src/render-common/props/mesh-builder";
import { QUALITY_PRESETS } from "../src/render-common/quality";

/** A box-shaped stand-in tree: trunk axis at the origin, given radius and height. */
const createTree = (radius: number, height: number, u = 0.9): PropMesh => {
  const positions = new Float32Array([-radius, 0, 0, radius, 0, 0, 0, height, radius, 0, height, -radius]);
  return {
    colors: new Float32Array(12),
    height,
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    normals: new Float32Array(12),
    positions,
    radius,
    uvs: new Float32Array([u, 0.1, u, 0.1, u, 0.1, u, 0.1]),
    wind: new Float32Array(8)
  };
};

/** Albedo RGBA8 plus a half-resolution normal map, with mips. */
const BYTES_PER_TEXEL = 5 * 4 / 3;

const MIB = 1024 * 1024;
const getLimits = (preset: "high" | "medium", maxAtlasSide = TREE_VIEW_MAX_ATLAS_SIDE) =>
  ({ budgetBytes: QUALITY_PRESETS[preset].treeViewAtlasMiB * MIB, maxAtlasSide });
const createForest = (count: number) =>
  Array.from({ length: count }, (_, index) => createTree(0.8 + index * 0.02, 2.5 + index * 0.03));
const layoutForest = (count: number, limits: ReturnType<typeof getLimits>) => {
  const meshes = createForest(count);
  return layoutTreeViews(meshes, meshes.map((_, meshId) => ({ bare: false, meshId })), limits);
};
const getLayoutBytes = (layout: { height: number; width: number }) =>
  layout.width * layout.height * BYTES_PER_TEXEL;

describe("R15a tree view layout", () => {
  it.each(["high", "medium"] as const)("fits the %s atlas budget and keeps blocks apart", preset => {
    const limits = getLimits(preset);
    const layout = layoutForest(40, limits);
    expect(getLayoutBytes(layout)).toBeLessThanOrEqual(limits.budgetBytes);
    expect(Math.max(layout.width, layout.height)).toBeLessThanOrEqual(TREE_VIEW_MAX_ATLAS_SIDE);
    const blocks = layout.entries.map(entry => ({
      x0: entry.x, x1: entry.x + entry.frameWidth * TREE_VIEW_AZIMUTHS,
      y0: entry.y, y1: entry.y + entry.frameHeight * TREE_VIEW_ELEVATIONS.length
    }));
    for (const [index, block] of blocks.entries()) {
      expect(block.x1).toBeLessThanOrEqual(layout.width);
      expect(block.y1).toBeLessThanOrEqual(layout.height);
      for (const other of blocks.slice(index + 1)) {
        const apart = block.x1 <= other.x0 || other.x1 <= block.x0 || block.y1 <= other.y0 || other.y1 <= block.y0;
        expect(apart).toBe(true);
      }
    }
    for (const entry of layout.entries) {
      expect(entry.frameWidth % 8).toBe(0);
      expect(entry.frameHeight % 8).toBe(0);
    }
  });

  it("gives High twice Medium's atlas memory: about x1.41 texel density", () => {
    expect(QUALITY_PRESETS.high.treeViewAtlasMiB).toBe(64);
    expect(QUALITY_PRESETS.medium.treeViewAtlasMiB).toBe(32);
    expect(QUALITY_PRESETS.low.treeViewAtlasMiB).toBe(0);
    expect(QUALITY_PRESETS.minimal.treeViewAtlasMiB).toBe(0);
    const high = layoutForest(40, getLimits("high"));
    const medium = layoutForest(40, getLimits("medium"));
    const ratio = high.texelsPerUnit / medium.texelsPerUnit;
    // sqrt(2), plus what the fixed 2048 page of Medium loses to shelf packing.
    expect(ratio).toBeGreaterThan(1.3);
    expect(ratio).toBeLessThan(1.7);
    // The 64 MiB atlas needs the wide page; 32 MiB keeps the R15a 2048 wide one.
    expect(high.width).toBeGreaterThan(2048);
    expect(medium.width).toBeLessThanOrEqual(2048);
    expect(getLayoutBytes(high)).toBeGreaterThan(0.8 * 64 * MIB);
  });

  it.each([4096, 8192])("degrades to a smaller atlas on a %i texture limit", textureLimit => {
    // The bake target is supersampled x2, so the atlas side is half the GPU's texture limit.
    const maxAtlasSide = Math.min(textureLimit / 2, TREE_VIEW_MAX_ATLAS_SIDE);
    const limits = getLimits("high", maxAtlasSide);
    const layout = layoutForest(40, limits);
    expect(layout.width).toBeLessThanOrEqual(maxAtlasSide);
    expect(layout.height).toBeLessThanOrEqual(maxAtlasSide);
    expect(getLayoutBytes(layout)).toBeLessThanOrEqual(limits.budgetBytes);
    expect(layout.entries).toHaveLength(40);
    expect(layout.texelsPerUnit).toBeGreaterThan(0);
  });

  it("gives every tree the same texel density, capped at the largest frame", () => {
    const meshes = [createTree(1, 3), createTree(0.5, 1.5)];
    const sources = [{ bare: false, meshId: 0 }, { bare: false, meshId: 1 }];
    const layout = layoutTreeViews(meshes, sources, getLimits("high"));
    const [mature, young] = layout.entries.sort((first, second) => first.meshId - second.meshId);
    expect(mature!.frameHeight).toBeLessThanOrEqual(TREE_VIEW_MAX_FRAME_TEXELS);
    expect(young!.frameHeight).toBeLessThan(mature!.frameHeight);
    expect(young!.frameHeight / mature!.frameHeight).toBeCloseTo(0.5, 0);
  });

  it("covers the bounding cylinder in every row", () => {
    const entry = { radius: 1, yMax: 3, yMin: -0.2 };
    for (const elevation of TREE_VIEW_ELEVATIONS) {
      const range = getViewRange(entry, elevation);
      const { up } = getTreeViewBasis(0.3, elevation);
      for (const [x, y, z] of [[1, 3, 0], [-1, -0.2, 0], [0, 3, 1], [0, -0.2, -1]] as const) {
        const v = x * up[0] + y * up[1] + z * up[2];
        expect(v).toBeGreaterThanOrEqual(range.min - 1e-6);
        expect(v).toBeLessThanOrEqual(range.max + 1e-6);
      }
    }
  });

  it("uses an orthonormal view basis facing the viewer", () => {
    const { right, toViewer, up } = getTreeViewBasis(1.1, TREE_VIEW_ELEVATIONS[2]!);
    const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    expect(dot(right, up)).toBeCloseTo(0);
    expect(dot(right, toViewer)).toBeCloseTo(0);
    expect(dot(up, toViewer)).toBeCloseTo(0);
    expect(up[1]).toBeGreaterThan(0);
  });

  it("classifies foliage for the winter blocks", () => {
    expect(getMeshFoliage(createTree(1, 3, -1.2))).toBe(FOLIAGE.broadleaf);
    expect(getMeshFoliage(createTree(1, 3, -0.5))).toBe(FOLIAGE.wood);
  });

  it("enables the view impostors on High and Medium only (rollback: off)", () => {
    expect(QUALITY_PRESETS.high.treeViewImpostors).toBe("full");
    expect(QUALITY_PRESETS.medium.treeViewImpostors).toBe("azimuth");
    expect(QUALITY_PRESETS.low.treeViewImpostors).toBe("off");
    expect(QUALITY_PRESETS.minimal.treeViewImpostors).toBe("off");
  });
});
