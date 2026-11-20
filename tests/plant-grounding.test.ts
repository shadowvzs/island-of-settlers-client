import { MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";

import {
  buildPropInstances, getPlantGroundHeight
} from "../src/render-common/props/prop-instances";
import { createPropMeshes } from "../src/render-common/props/prop-meshes";
import { createThreePropMeshes } from "../src/renderers/three/three-props";
import { sampleSmooth } from "../src/shared/world/grid-geometry";
import { PROP, type WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const size = 64, vertices = (size + 1) ** 2;
  const world = {
    cellsX: size, cellsZ: size,
    heights: Float32Array.from({ length: vertices }, (_, i) => 2 + (i % (size + 1)) * .3),
    sunShadow: new Uint8Array(vertices).fill(255),
    props: {
      count: 4,
      types: Uint8Array.of(PROP.bush, PROP.bush, PROP.waterLily, PROP.broadleafTree),
      x: Float32Array.of(4.5, 40.5, 6, 8),
      z: Float32Array.of(4.5, 40.5, 6, 8),
      y: Float32Array.of(20, 20, 9, 11),
      scale: new Float32Array(4).fill(1),
      rotation: new Float32Array(4), phase: new Float32Array(4), form: new Uint8Array(4)
    }
  } as unknown as WorldData;
  return { world, fog: new Float32Array(vertices).fill(1) };
};

describe("plant ground contact", () => {
  it("ignores stale saved shrub heights while preserving floating lilies and tree anchors", () => {
    const { fog, world } = fixture();
    const instances = buildPropInstances(world, fog);
    const slot = (id: number) => instances.sourceIndex.indexOf(id);
    expect(instances.y[slot(0)]).toBeCloseTo(getPlantGroundHeight(world, 4.5, 4.5, 1), 5);
    expect(instances.y[slot(2)]).toBe(9);
    expect(instances.y[slot(3)]).toBe(11);
    expect(world.props.y[0]).toBe(20);
    world.heights.fill(-2);
    expect(buildPropInstances(world, fog).y[slot(0)]).toBeCloseTo(-2.01);
  });

  it("keeps even downhill root origins below the slope", () => {
    const { world } = fixture();
    const height = getPlantGroundHeight(world, 4.5, 4.5, 1);
    for (const dx of [-.06, 0, .06]) {
      for (const dz of [-.06, 0, .06]) {
        expect(height).toBeLessThan(sampleSmooth(world, world.heights, 4.5 + dx, 4.5 + dz));
      }
    }
  });

  it("updates visible and culled cached matrices without restoring a hidden plant", () => {
    const { fog, world } = fixture();
    const instances = buildPropInstances(world, fog);
    const material = new MeshBasicMaterial();
    const layers = createThreePropMeshes(createPropMeshes(7), instances, 64, { main: material, depth: null });
    const visible = new Uint8Array(64).fill(1);
    const bushLayers = layers.filter(layer => layer.kind === PROP.bush);
    for (const layer of bushLayers) {
      layer.showChunks(visible);
      layer.hideInstance(0);
      layer.showChunks(new Uint8Array(64));
      layer.refreshHeights(new Map([[0, -3], [1, -4]]));
      layer.showChunks(visible);
    }
    const heights = bushLayers.flatMap(layer => {
      const matrix = layer.mesh.instanceMatrix.array;
      return Array.from({ length: layer.mesh.count }, (_, i) => matrix[i * 16 + 13]!);
    });
    expect(heights.sort((a, b) => a - b)).toEqual([-4, -3]);
    const flags = bushLayers.flatMap(layer => {
      const data = layer.mesh.geometry.getAttribute("instanceData").array;
      return Array.from({ length: layer.mesh.count }, (_, i) => data[i * 4 + 3]);
    });
    expect(flags.filter(flag => flag === 1)).toHaveLength(1);
    for (const layer of layers) layer.mesh.geometry.dispose();
    material.dispose();
  });
});
