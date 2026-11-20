import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { withChineseBuriedWallFaces } from "../src/render-common/buildings/chinese-buried-wall-faces";
import { createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";

it("funds the reveal with buried caps while preserving every external ray and ignoring movable stock", () => {
  const support: BuildingPart = { shape: "box", surface: "plaster", stage: 0,
    position: [0, .1, 0], size: [2, .2, 2] };
  const post: BuildingPart = { shape: "box", surface: "paint", stage: 2,
    position: [0, .7, 0], size: [.12, 1, .12] };
  const stock: BuildingPart = { ...support, position: [0, 1.3, 0], stock: { ware: "wood", slot: 0 } };
  const original = [support, post, stock], reduced = withChineseBuriedWallFaces(original);
  expect(reduced[1]!.buriedBoxFaces).toEqual(["-y"]);
  expect(reduced[0]).toBe(support); expect(reduced[2]).toBe(stock);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const meshes = [original, reduced].map(parts => parts.map(part => new Mesh(createRomanPartGeometry(part, false), material)));
  try {
    for (const x of [-3, 0, 3]) for (const y of [-2, 2, 4]) for (const z of [-3, 0, 3]) {
      const start = new Vector3(x, y, z), direction = new Vector3(0, .6, 0).sub(start).normalize();
      const distances = meshes.map(objects => new Raycaster(start, direction).intersectObjects(objects)[0]?.distance);
      expect(distances[1]).toBeCloseTo(distances[0]!, 7);
    }
  } finally { meshes.flat().forEach(mesh => mesh.geometry.dispose()); material.dispose(); }
});
