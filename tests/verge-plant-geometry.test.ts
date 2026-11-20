import { expect, it } from "vitest";

import { VERGE_FOLIAGE_ATLAS } from "../src/render-common/road-verges/verge-foliage-atlas-manifest";
import { createVergePlantMesh, VERGE_SPECIES, VERGE_TRIANGLE_LIMIT,
  vergePlantRadius } from "../src/render-common/road-verges/verge-plant-geometry";

const HEIGHT_LIMIT = .45, MAX_PLACEMENT_SCALE = 1.1 * 1.14;

it.each(VERGE_SPECIES)("authors %s within the High and Minimal triangle limits", species => {
  for (const detail of ["high", "minimal"] as const) {
    const mesh = createVergePlantMesh(species, detail), triangles = mesh.indices.length / 3;
    expect(triangles).toBeGreaterThan(0);
    expect(triangles).toBeLessThanOrEqual(VERGE_TRIANGLE_LIMIT[detail]);
    expect(mesh.positions.length / 3).toBe(mesh.uvs.length / 2);
    expect(mesh.colors.length).toBe(mesh.positions.length);
    for (let index = 1; index < mesh.positions.length; index += 3)
      expect(mesh.positions[index]! * MAX_PLACEMENT_SCALE).toBeLessThanOrEqual(HEIGHT_LIMIT);
  }
  expect(createVergePlantMesh(species, "minimal").indices.length)
    .toBeLessThan(createVergePlantMesh(species, "high").indices.length);
  expect(vergePlantRadius(species)).toBeLessThan(.3);
});

it("draws only painted atlas tiles, on cards whose UVs stay inside their tile", () => {
  const painted = VERGE_FOLIAGE_ATLAS.tiles.filter(tile => tile.coverage > 0);
  expect(painted).toHaveLength(16);
  for (const species of VERGE_SPECIES) for (const detail of ["high", "minimal"] as const) {
    const { uvs } = createVergePlantMesh(species, detail);
    for (let index = 0; index < uvs.length; index += 2) {
      const [u, v] = [uvs[index]!, uvs[index + 1]!];
      const tile = painted.find(({ uvRect }) => u >= uvRect[0] - 1e-6 && u <= uvRect[2] + 1e-6 &&
        v >= uvRect[1] - 1e-6 && v <= uvRect[3] + 1e-6);
      expect(tile).toBeDefined();
    }
  }
});
