import { describe, expect, it } from "vitest";

import { createVertexFog } from "../src/render-common/chunk-sampling";
import { ADVENTURE_PROP } from "../src/render-common/props/adventure-prop-kinds";
import { buildFieldCoverInstances } from "../src/render-common/props/field-cover";
import { createIslandTreePropMesh } from "../src/render-common/props/island-trees";
import { createCactus } from "../src/render-common/props/plants/cactus";
import { createSparseSwampTree } from "../src/render-common/props/plants/swamp-tree";
import { buildPropInstances } from "../src/render-common/props/prop-instances";
import { COVER, getMeshKind, getMeshVariant } from "../src/render-common/props/prop-meshes";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { createRandom } from "../src/shared/world/rng";
import { PROP } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

/** Prop source indices that each adventure theme swaps for its own plants. */
const THEMED_SOURCE_PROPS: Record<"desert" | "swamp", Partial<Record<number, number>>> = {
  desert: { 0: ADVENTURE_PROP.cactus },
  swamp: { 1: ADVENTURE_PROP.sparseOak, 2: ADVENTURE_PROP.sparseBirch }
};

describe("themed vegetation", () => {
  it("keeps cactus silhouettes stiff, cheap and deterministic with removable spine detail", () => {
    for (let variant = 0; variant < 3; variant++) {
      const mesh = createCactus(createRandom(71), variant);
      expect(mesh.positions).toEqual(createCactus(createRandom(71), variant).positions);
      expect(mesh.indices.length / 3).toBeLessThan(900);
      expect(mesh.coreIndexCount).toBeLessThan(mesh.indices.length);
      expect(mesh.wind.every(value => value === 0)).toBe(true);
      expect(mesh.height).toBeLessThan(1);
      expect(mesh.positions.every(Number.isFinite)).toBe(true);
    }
  });

  it("retains temperate bark triangles while thinning leaf cards and compacting vertices", () => {
    for (const kind of [PROP.broadleafTree, PROP.birchTree]) {
      const original = createIslandTreePropMesh(kind, 4, 31);
      const sparse = createSparseSwampTree(kind, 4, 31);
      const barkCount = (mesh: typeof original) => Array.from(mesh.indices).filter((_, index) =>
        index % 3 === 0 && mesh.uvs[mesh.indices[index]! * 2]! < 0).length;
      expect(barkCount(sparse)).toBe(barkCount(original));
      expect(sparse.indices.length).toBeLessThan(original.indices.length);
      expect(new Set(sparse.indices).size).toBe(sparse.positions.length / 3);
      expect(sparse.positions).toEqual(createSparseSwampTree(kind, 4, 31).positions);
    }
  });

  it("changes presentation only, preserving world bytes, anchors and original unthemed mesh ids", () => {
    const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 32, cellsZ: 32, erosionDroplets: 100 });
    world.props.types.set([PROP.fieldShrub, PROP.broadleafTree, PROP.birchTree]);
    const bytes = world.props.types.slice(), fog = createVertexFog(world);
    const original = buildPropInstances(world, fog);
    for (const theme of ["desert", "swamp"] as const) {
      world.adventureTheme = theme;
      const themed = buildPropInstances(world, fog);
      expect(world.props.types).toEqual(bytes);
      expect(themed.x).toEqual(original.x);
      expect(themed.y).toEqual(original.y);
      expect(themed.z).toEqual(original.z);
      expect(themed.sourceIndex).toEqual(original.sourceIndex);
      for (let index = 0; index < themed.count; index++) {
        const source = themed.sourceIndex[index]!;
        if (source > 2) continue;
        const expected = THEMED_SOURCE_PROPS[theme][source] ?? getMeshKind(original.meshIds[index]!);
        expect(getMeshKind(themed.meshIds[index]!)).toBe(expected);
      }
    }
    delete world.adventureTheme;
    expect(buildPropInstances(world, fog).meshIds).toEqual(original.meshIds);
  });

  it("removes expedition blooms while keeping leaf-only clover and lily pads", () => {
    const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 100 });
    world.props.types.set([PROP.flowers, PROP.waterLily]);
    const fog = createVertexFog(world), original = buildFieldCoverInstances(world, fog, 6);
    const blooms = new Set<number>([COVER.pinkFlower, COVER.whiteFlower, COVER.yellowFlower, COVER.thistle]);
    expect(Array.from(original.meshIds).some(id => blooms.has(getMeshKind(id)))).toBe(true);
    for (const kind of ["adventure", "colony"] as const) {
      world.expeditionKind = kind;
      const cover = buildFieldCoverInstances(world, fog, 6);
      expect(cover.count).toBe(original.count);
      expect(cover.x).toEqual(original.x);
      expect(cover.z).toEqual(original.z);
      for (const id of cover.meshIds) {
        expect(blooms.has(getMeshKind(id))).toBe(false);
        if (getMeshKind(id) === COVER.clover) expect(getMeshVariant(id)).toBe(0);
      }
      const props = buildPropInstances(world, fog);
      expect(Array.from(props.sourceIndex)).not.toContain(0);
      const lily = Array.from(props.sourceIndex).indexOf(1);
      expect(lily).toBeGreaterThanOrEqual(0);
      expect(getMeshKind(props.meshIds[lily]!)).toBe(PROP.waterLily);
      expect(getMeshVariant(props.meshIds[lily]!)).toBeLessThan(3);
    }
    delete world.expeditionKind;
    expect(buildFieldCoverInstances(world, fog, 6).meshIds).toEqual(original.meshIds);
  });
});
