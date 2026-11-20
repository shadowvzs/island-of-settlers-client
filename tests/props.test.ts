import { describe, expect, it } from "vitest";

import { createVertexFog } from "../src/render-common/chunk-sampling";
import { buildFieldCoverInstances } from "../src/render-common/props/field-cover";
import { buildPropInstances } from "../src/render-common/props/prop-instances";
import {
  COVER,
  createPropMeshes,
  getMeshId,
  getMeshKind,
  GRASS_KIND,
  PROP_MESH_COUNT
} from "../src/render-common/props/prop-meshes";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { sampleBilinear } from "../src/shared/world/grid-geometry";
import { cachedWorld } from "./helpers/cached-worlds";

describe("prop meshes", () => {
  const meshes = createPropMeshes(7);

  it("builds every kind and variant with valid triangles", () => {
    expect(meshes).toHaveLength(PROP_MESH_COUNT);
    for (const mesh of meshes) {
      const vertices = mesh.positions.length / 3;
      expect(mesh.indices.length % 3).toBe(0);
      expect(Math.max(...mesh.indices)).toBeLessThan(vertices);
      expect(mesh.colors.length).toBe(vertices * 3);
      expect(mesh.wind.length).toBe(vertices * 2);
    }
  });

  it("roots the bend weight at the ground and is deterministic", () => {
    const tree = meshes[getMeshId(0, 0)]!;
    expect(Math.min(...tree.wind.filter((_, index) => index % 2 === 0))).toBe(0);
    expect(createPropMeshes(7)[5]!.positions).toEqual(meshes[5]!.positions);
  });
});

describe("prop instances", () => {
  const world = cachedWorld({
    ...DEFAULT_WORLD_OPTIONS,
    cellsX: 64,
    cellsZ: 64,
    erosionDroplets: 4000
  });
  const fog = createVertexFog(world);

  it("sorts world props far to near for the iso camera", () => {
    const props = buildPropInstances(world, fog);
    expect(props.count).toBe(world.props.count);
    for (let index = 1; index < props.count; index += 1) {
      expect(props.x[index]! + props.z[index]!).toBeGreaterThanOrEqual(
        props.x[index - 1]! + props.z[index - 1]!
      );
    }
  });

  it("keeps the world prop index of every instance", () => {
    const props = buildPropInstances(world, fog);
    for (let index = 0; index < props.count; index += 1) {
      const source = props.sourceIndex[index]!;
      expect(world.props.x[source]).toBe(props.x[index]);
    }
  });

  it("grows field cover only on dry ground, mostly grass, more with more samples", () => {
    const sparse = buildFieldCoverInstances(world, fog, 2);
    const dense = buildFieldCoverInstances(world, fog, 6);
    const coverKinds = new Set<number>(Object.values(COVER));
    let grass = 0;
    expect(dense.count).toBeGreaterThan(sparse.count);
    for (let index = 0; index < dense.count; index += 1) {
      const kind = getMeshKind(dense.meshIds[index]!);
      expect(coverKinds.has(kind)).toBe(true);
      if (kind === GRASS_KIND) grass += 1;
      expect(sampleBilinear(world, world.waterDepth, dense.x[index]!, dense.z[index]!)).toBe(0);
    }
    expect(grass / dense.count).toBeGreaterThan(0.6);
  });
});
