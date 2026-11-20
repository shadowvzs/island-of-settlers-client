import { DataTexture, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";

import { TWO_LANE_CART_HALF_WIDTH } from "../src/render-common/logistics/handcart-rules";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import { VERGE_FOLIAGE_ATLAS } from "../src/render-common/road-verges/verge-foliage-atlas-manifest";
import { createDecorationFoliageMaterial } from "../src/renderers/three/plants/decoration-foliage-material";
import { createThreeRoadVerges } from "../src/renderers/three/settlement/three-road-verges";
import type { RoadSegment } from "../src/shared/settlement/road-types";
import type { WorldData } from "../src/shared/world/world-data";

const world = { cellsX: 48, cellsZ: 48, fogDisplayDisabled: true, seaLevel: 0 } as unknown as WorldData;
const roads: RoadSegment[] = Array.from({ length: 40 }, (_, index) => ({
  end: { x: 4 + (index + 1) * .5, z: 20 }, start: { x: 4 + index * .5, z: 20 }, tier: "dirt",
  verge: "flowers" }));
const texture = () => new DataTexture(new Uint8Array(4), 1, 1);

const layerFor = (detailed: boolean) => createThreeRoadVerges({
  antialias: false, budget: QUALITY_PRESETS[detailed ? "high" : "minimal"].roadVerges, detailed,
  foliage: { acquire: async () => createDecorationFoliageMaterial({ antialias: false, detailed,
    maps: { albedo: texture(), normal: detailed ? texture() : null, orm: texture() }, skyLit: true,
    tiles: VERGE_FOLIAGE_ATLAS.tiles }), dispose: () => undefined },
  groundHeight: () => 0, isBare: () => false, world
});

const cameraAt = (x: number, y: number, z: number) => {
  const camera = new PerspectiveCamera(60, 1.6, .05, 300);
  camera.position.set(x, y, z); camera.lookAt(14, 0, 20); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  return camera;
};

describe("road verge layer", () => {
  it.each([true, false])("draws verge plants beside one road on both detail levels (High %s)", async detailed => {
    const layer = layerFor(detailed);
    await new Promise(resolve => setTimeout(resolve, 0));
    layer.update({ roadRevision: 1, roads }, cameraAt(14, 3, 24), 800);
    const statistics = layer.statistics();
    expect(statistics.placements).toBeGreaterThan(100);
    expect(statistics.far + statistics.near).toBeGreaterThan(0);
    if (!detailed) expect(statistics.near).toBe(0);
    for (const mesh of layer.root.children as import("three").InstancedMesh[]) {
      const matrices = mesh.instanceMatrix.array;
      for (let index = 0; index < mesh.count; index += 1)
        expect(Math.abs(matrices[index * 16 + 14]! - 20)).toBeGreaterThan(TWO_LANE_CART_HALF_WIDTH);
    }
    layer.dispose();
  });

  it.each([true, false])("draws nothing beside an unplanted road (High %s)", async detailed => {
    const layer = layerFor(detailed);
    await new Promise(resolve => setTimeout(resolve, 0));
    const unplanted = roads.map(({ start, end, tier }) => ({ start, end, tier }));
    layer.update({ roadRevision: 1, roads: unplanted }, cameraAt(14, 3, 24), 800);
    expect(layer.statistics().placements).toBe(0);
    for (const mesh of layer.root.children as import("three").InstancedMesh[]) expect(mesh.count).toBe(0);
    layer.dispose();
  });

  it("thins far chunks by projected size and refills nothing while the camera rests", async () => {
    const layer = layerFor(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    layer.update({ roadRevision: 1, roads }, cameraAt(14, 3, 24), 800);
    const close = layer.statistics();
    const versions = (layer.root.children as import("three").InstancedMesh[]).map(mesh => mesh.instanceMatrix.version);
    layer.update({ roadRevision: 1, roads }, cameraAt(14, 3, 24), 800);
    expect((layer.root.children as import("three").InstancedMesh[]).map(mesh => mesh.instanceMatrix.version))
      .toEqual(versions);
    layer.update({ roadRevision: 1, roads }, cameraAt(14, 160, 140), 800);
    const far = layer.statistics();
    expect(far.near).toBe(0);
    expect(far.far + far.near).toBeLessThan(close.far + close.near + close.placements);
    expect(far.triangles).toBeLessThan(close.triangles);
    layer.dispose();
  });
});
