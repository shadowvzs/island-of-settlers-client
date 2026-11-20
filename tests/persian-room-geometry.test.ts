import { expect, it } from "vitest";
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { createPersianRoomGeometry } from "../src/renderers/three/buildings/persian-room-geometry";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";

const room = (opening: [number, number, number]): BuildingPart => ({ shape: "persian-room", surface: "plaster",
  size: [1, 1, 1], position: [0, 0, 0], stage: 1, persianOpening: opening });

it("has a real clear doorway with solid side walls and crown at both detail levels", () => {
  for (const detailed of [true, false]) {
    const geometry = createPersianRoomGeometry(room([-.2, .2, .2]), detailed);
    const mesh = new Mesh(geometry, new MeshBasicMaterial()); mesh.updateMatrixWorld();
    const cast = (x: number, y: number) => new Raycaster(new Vector3(x, y, 1), new Vector3(0, 0, -1))
      .intersectObject(mesh)[0]!.point.z;
    expect(cast(.001, 0)).toBeLessThan(0);
    expect(cast(.3, 0)).toBeGreaterThan(.3);
    expect(cast(.001, .3)).toBeGreaterThan(.4);
    geometry.dispose();
  }
});

it("keeps off-centre doors and fully open upgrade bands finite inside the unit envelope", () => {
  for (const detailed of [true, false]) for (const opening of [[1, 2, .2], [-2, -1, .2],
    [-.2, .2, .5], [0, 0, -.49]] as [number, number, number][]) {
    const geometry = createPersianRoomGeometry(room(opening), detailed);
    for (const name of ["position", "normal", "uv"]) expect(Array.from(geometry.getAttribute(name).array)
      .every(Number.isFinite)).toBe(true);
    expect(Array.from(geometry.getAttribute("position").array).every(value => Math.abs(value) <= .50001)).toBe(true);
    geometry.dispose();
  }
});

it("fits vault wall caps under the actual faceted barrel roof on both LODs", () => {
  for (const detailed of [true, false]) {
    const rows = detailed ? 16 : 6;
    const geometry = createPersianRoomGeometry({ ...room([0, 0, -.5]), compactGeometry: true,
      occupationRoof: "barrel", radialSegments: rows }, detailed);
    const positions = geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index), y = positions.getY(index);
      const at = Math.min(rows, Math.max(0, (x + .5) * rows));
      const cell = Math.min(rows - 1, Math.floor(at)), share = at - cell;
      const profile = (column: number) => Math.sqrt(Math.max(0, 1 - 4 * (column / rows - .5) ** 2));
      const facetedRoof = profile(cell) * (1 - share) + profile(cell + 1) * share;
      // The physical cap uses the same mesh subdivisions, including the coarse Minimal arch.
      expect(y + .5).toBeLessThanOrEqual(facetedRoof + .000001);
    }
    geometry.dispose();
  }
});
