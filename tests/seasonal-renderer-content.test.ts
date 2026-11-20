import { describe, expect, it, vi } from "vitest";

import { createVertexAttributes } from "../src/render-common/chunk-sampling";
import type { ContentBuilders } from "../src/render-common/content-builders";
import { ADVENTURE_PROP } from "../src/render-common/props/adventure-prop-kinds";
import type { PropMesh } from "../src/render-common/props/mesh-builder";
import { allocatePropInstances } from "../src/render-common/props/prop-instances";
import { COVER, getMeshId, getMeshKind } from "../src/render-common/props/prop-meshes";
import type { ChunkVertexData } from "../src/render-common/terrain-chunks";
import { createPropDepthMaterial, createPropMaterial, hasWinter } from "../src/renderers/three/three-prop-materials";
import {
  createSeasonalContentBuilders,
  getSeasonalFieldCoverInstances,
  getSeasonalImpostorName,
  getSeasonalPropKind,
  getSeasonalVegetationUniforms
} from "../src/renderers/three/three-seasonal-content";
import { PROP } from "../src/shared/world/world-data";

const mesh = (): PropMesh => ({
  colors: new Float32Array([0.2, 0.3, 0.1, 0.2, 0.3, 0.1, 0.2, 0.3, 0.1]),
  height: 1,
  indices: new Uint16Array([0, 1, 2]),
  normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
  positions: new Float32Array([0, 1, 0, 1, 1, 0, 0, 1, 1]),
  radius: 1,
  uvs: new Float32Array([-1, -1, -1, -1, -1, -1]),
  wind: new Float32Array(6)
});

describe("seasonal renderer content boundary", () => {
  it("keeps aquatic/shell content original and explicitly includes every tree and sparse adventure tree", () => {
    for (const kind of [PROP.broadleafTree, PROP.birchTree, PROP.palmTree, PROP.cedarTree, PROP.walnutTree,
      PROP.mahoganyTree, PROP.hardwoodTree, ADVENTURE_PROP.sparseOak, ADVENTURE_PROP.sparseBirch])
      expect(getSeasonalPropKind(kind)).toBe("tree");
    for (const kind of [PROP.waterLily, COVER.seaStar, COVER.seashell, COVER.snailShell, 255])
      expect(getSeasonalPropKind(kind)).toBeUndefined();
    expect(getSeasonalPropKind(PROP.fieldShrub)).toBe("shrub");
    expect(getSeasonalPropKind(COVER.shortGrass)).toBe("grass");
  });

  it("wraps only terrain and allowed props, reuses derived tables, and preserves canonical data", async () => {
    const props: PropMesh[] = [];
    const treeId = getMeshId(PROP.broadleafTree, 0), shellId = getMeshId(COVER.seashell, 0);
    props[treeId] = mesh();
    props[shellId] = mesh();
    const chunk: ChunkVertexData = {
      ...createVertexAttributes(1), chunkX: 0, chunkZ: 0, indices: new Uint16Array(), vertexCount: 1
    };
    chunk.splatA[0] = 255;
    chunk.normals[1] = 1;
    chunk.water[0] = -5;
    const chunks = [chunk];
    const buildings = vi.fn(), water = vi.fn(), rocks = vi.fn();
    const builders = {
      islandRocks: rocks,
      paintBuildingSurface: buildings,
      propMeshes: vi.fn().mockResolvedValue(props),
      terrainChunks: vi.fn().mockResolvedValue(chunks),
      waterField: water
    } as unknown as ContentBuilders;
    expect(createSeasonalContentBuilders(builders, false)).toBe(builders);
    const winter = createSeasonalContentBuilders(builders, true);
    const converted = await winter.propMeshes(1);
    expect(await winter.propMeshes(1)).toBe(converted);
    expect(converted[treeId]).not.toBe(props[treeId]);
    expect(converted[treeId]!.positions).toBe(props[treeId]!.positions);
    expect(converted[shellId]).toBe(props[shellId]);
    expect(props[treeId]!.colors[0]).toBeCloseTo(0.2);
    const terrain = await winter.terrainChunks("terrain");
    expect(await winter.terrainChunks("terrain")).toBe(terrain);
    expect(terrain[0]).not.toBe(chunk);
    expect(terrain[0]!.positions).toBe(chunk.positions);
    expect(chunk.splatA[0]).toBe(255);
    expect(await winter.terrainChunks("water")).toBe(chunks);
    expect(winter.paintBuildingSurface).toBe(buildings);
    expect(winter.islandRocks).toBe(rocks);
    expect(winter.waterField).toBe(water);
  });

  it("keeps prepainted foliage on existing summer shaders while native rock/weather uniforms stay intact", () => {
    const original = { uSnowMap: { value: { userData: { hasSnow: true } } }, uTime: { value: 0 } };
    expect(getSeasonalVegetationUniforms(original, false)).toBe(original);
    const seasonal = getSeasonalVegetationUniforms(original, true);
    expect(hasWinter(original)).toBe(true);
    expect(hasWinter(seasonal)).toBe(false);
    expect(seasonal.uTime).toBe(original.uTime);
    const native = createPropMaterial(original, false), full = createPropMaterial(seasonal, false, true);
    const minimal = createPropMaterial(seasonal, true), depth = createPropDepthMaterial(seasonal, true);
    expect(native.defines).toHaveProperty("WINTER");
    for (const material of [full, minimal, depth]) {
      expect(material.defines).not.toHaveProperty("WINTER");
      material.dispose();
    }
    native.dispose();
    expect(getSeasonalImpostorName(true)).not.toBe(getSeasonalImpostorName(false));
  });

  it("keeps about a third of the natural field cover in winter, grey-tinted, stable per position", () => {
    const kinds = [COVER.shortGrass, COVER.tallGrass, COVER.whiteFlower, COVER.seashell];
    const count = 4000;
    const source = allocatePropInstances(count);
    for (let index = 0; index < count; index++) {
      const kind = index % 10 < 8 ? COVER.shortGrass : kinds[index % 4]!;
      source.meshIds[index] = getMeshId(kind, 0);
      source.x[index] = (index % 63) * 0.37;
      source.z[index] = Math.floor(index / 63) * 0.41;
      source.tint.set([0.7, 1.2, 0.4], index * 3);
    }
    const converted = getSeasonalFieldCoverInstances(source);
    const kindOf = (instances: typeof source, index: number) => getMeshKind(instances.meshIds[index]!);
    const kept = (kind: number) => Array.from({ length: converted.count }, (_, i) => kindOf(converted, i))
      .filter(found => found === kind).length;
    const total = (kind: number) => Array.from({ length: count }, (_, i) => kindOf(source, i))
      .filter(found => found === kind).length;
    expect(kept(COVER.whiteFlower)).toBe(0);
    expect(kept(COVER.seashell)).toBe(total(COVER.seashell));
    const grass = [COVER.shortGrass, COVER.tallGrass];
    const share = grass.reduce((sum, kind) => sum + kept(kind), 0) / grass.reduce((sum, kind) => sum + total(kind), 0);
    expect(share).toBeGreaterThan(0.27);
    expect(share).toBeLessThan(0.4);
    expect(converted.tint[0]).toBe(converted.tint[1]);
    expect(source.tint[1]).toBeCloseTo(1.2);
    expect(getSeasonalFieldCoverInstances(source)).toBe(converted);
  });
});
