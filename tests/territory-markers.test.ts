import { Matrix4, Scene, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

import {
  createTerritoryMarkerRecipe,
  TERRITORY_MARKER_HEIGHT
} from "../src/render-common/settlement/territory-marker-recipe";
import { createThreeTerritoryMarkers } from "../src/renderers/three/settlement/three-territory-markers";

describe.each([false, true])("Original Roman territory marker (High %s)", (detailed) => {
  it("has a bevelled, grounded silhouette, readable red paint and valid outward geometry", () => {
    const mesh = createTerritoryMarkerRecipe(detailed);
    expect(mesh.height).toBe(TERRITORY_MARKER_HEIGHT);
    expect(mesh.radius).toBeLessThan(0.16);
    const heights = Array.from(mesh.positions).filter((_value, index) => index % 3 === 1);
    expect(Math.min(...heights)).toBeCloseTo(-0.035);
    expect(Math.max(...heights)).toBeCloseTo(0.44);
    expect(mesh.indices.length / 3).toBeLessThan(140);
    expect(Array.from(mesh.positions).every(Number.isFinite)).toBe(true);
    expect(Array.from(mesh.normals).every(Number.isFinite)).toBe(true);
    expect(Array.from(mesh.indices).every((index) => index < mesh.positions.length / 3)).toBe(true);
    expect(
      Array.from(mesh.colors).some(
        (value, index) => index % 3 === 0 && value > mesh.colors[index + 1]! * 4
      )
    ).toBe(true);
    for (let index = 0; index < mesh.indices.length; index += 3) {
      const a = new Vector3().fromArray(mesh.positions, mesh.indices[index]! * 3);
      const b = new Vector3().fromArray(mesh.positions, mesh.indices[index + 1]! * 3);
      const c = new Vector3().fromArray(mesh.positions, mesh.indices[index + 2]! * 3);
      const normal = new Vector3().fromArray(mesh.normals, mesh.indices[index]! * 3);
      expect(b.sub(a).cross(c.sub(a)).dot(normal)).toBeGreaterThan(0);
    }
  });

  it("batches points at sampled terrain height/yaw and skips unchanged uploads", () => {
    const shadows = new Scene();
    const markers = createThreeTerritoryMarkers({}, detailed, detailed ? shadows : undefined);
    const points = [
      { x: 7, z: 12, y: 2.1, yaw: Math.PI / 2 },
      { x: 5, z: 8, y: 1.4, yaw: 0 }
    ];
    markers.update(points, 1);
    const mesh = markers.root.children[0] as import("three").InstancedMesh;
    const matrix = new Matrix4();
    mesh.getMatrixAt(0, matrix);
    expect(new Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([
      7,
      expect.closeTo(2.1),
      12
    ]);
    expect(new Vector3(0, 0, 1).transformDirection(matrix).x).toBeCloseTo(1);
    expect(markers.getStats().territoryMarkerDraws).toBe(detailed ? 2 : 1);
    expect(markers.getStats().territoryMarkerCount).toBe(2);
    markers.update(points, 1);
    expect(markers.getStats().territoryMarkerUploads).toBe(1);
    markers.update(points, 1, 1, [.1,.6,.2]);
    const paint = (mesh.material as import("three").RawShaderMaterial).uniforms.uPlayerColor!.value;
    expect(paint.toArray()).toEqual([.1,.6,.2]);
    expect(markers.getStats().territoryMarkerUploads).toBe(1);
    const tint = mesh.geometry.getAttribute("playerTint");
    expect(Array.from(tint.array).filter(value=>value===1)).toHaveLength(32);
    expect(Array.from(tint.array).some(value=>value===0)).toBe(true);
    markers.update(points, 1, 0.3);
    if (detailed) expect(mesh.geometry.drawRange.count).toBe(mesh.geometry.index!.count - 24);
    else expect(mesh.geometry.drawRange.count).toBe(Infinity);
    expect(markers.getStats().territoryMarkerUploads).toBe(1);
    markers.update([], 2);
    expect(markers.getStats().territoryMarkerCount).toBe(0);
    expect(markers.getStats().territoryMarkerDraws).toBe(0);
    expect(
      shadows.children.every((child) => (child as import("three").InstancedMesh).count === 0)
    ).toBe(true);
    markers.dispose();
  });

  it("releases replaced instance buffers and shared geometry/materials once", () => {
    const shadows = new Scene();
    const markers = createThreeTerritoryMarkers({}, detailed, detailed ? shadows : undefined);
    markers.update([{ x: 1, z: 1, y: 0, yaw: 0 }], 1);
    const first = markers.root.children[0] as import("three").InstancedMesh;
    const release = vi.spyOn(first, "dispose");
    const releaseGeometry = vi.spyOn(first.geometry, "dispose");
    const releaseMaterial = vi.spyOn(first.material as import("three").Material, "dispose");
    markers.update(
      Array.from({ length: 40 }, (_unused, x) => ({ x, z: 1, y: 0, yaw: 0 })),
      2
    );
    expect(release).toHaveBeenCalledOnce();
    expect(releaseGeometry).not.toHaveBeenCalled();
    expect(markers.root.children).toHaveLength(1);
    expect(shadows.children).toHaveLength(detailed ? 1 : 0);
    markers.dispose();
    markers.dispose();
    expect(releaseGeometry).toHaveBeenCalledOnce();
    expect(releaseMaterial).toHaveBeenCalledOnce();
    expect(markers.root.children).toHaveLength(0);
    expect(shadows.children).toHaveLength(0);
    markers.update([{ x: 1, z: 1, y: 0, yaw: 0 }], 3);
    expect(markers.root.children).toHaveLength(0);
  });
});

it("materials read the live fog and shared weather/lighting in both quality modes", () => {
  for (const detailed of [false, true]) {
    const fog = { value: "shared fog texture" };
    const markers = createThreeTerritoryMarkers({ uFogMap: fog }, detailed);
    markers.update([{ x: 0, z: 0, y: 0, yaw: 0 }]);
    const material = (markers.root.children[0] as import("three").InstancedMesh)
      .material as import("three").RawShaderMaterial;
    expect(material.uniforms.uFogMap).toBe(fog);
    expect(material.fragmentShader).toContain("isHiddenByFog(fog, vWorld.xz)");
    expect(material.fragmentShader).toContain("applyFogOfWar(lit, fog, vWorld.xz)");
    expect(material.fragmentShader).toContain("uRain");
    markers.dispose();
  }
});
