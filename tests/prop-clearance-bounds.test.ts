import { expect, it } from "vitest";

import { getTreeSpecies } from "../src/render-common/props/island-trees";
import { NATIVE_PROP_CLEARANCE_BOUNDS } from "../src/render-common/props/prop-clearance-bounds";
import { getMeshId, getVariantCount, PROP_KIND_COUNT } from "../src/render-common/props/prop-mesh-layout";
import { PROP_MESH_SEED } from "../src/render-common/props/prop-mesh-seed";
import { createPropMesh } from "../src/render-common/props/prop-meshes";

it("baked non-tree physical metadata contains exact renderer-seed positions and storm wind weights", () => {
  let count = 0;
  for (let kind = 0; kind < PROP_KIND_COUNT; kind++) {
    if (getTreeSpecies(kind) !== undefined) continue;
    for (let variant = 0; variant < getVariantCount(kind); variant++) {
      const mesh = createPropMesh(PROP_MESH_SEED, kind, variant), bounds = NATIVE_PROP_CLEARANCE_BOUNDS[getMeshId(kind, variant)];
      expect(bounds, `${kind}/${variant}`).toBeDefined(); count++;
      const [height, radius, sway, flutter, minY] = bounds!;
      expect(bounds!.every(Number.isFinite)).toBe(true);
      expect(height!).toBeGreaterThanOrEqual(mesh.height); expect(radius!).toBeGreaterThanOrEqual(mesh.radius);
      for (let index = 0; index < mesh.positions.length; index += 3) {
        expect(mesh.positions[index + 1]!).toBeGreaterThanOrEqual(minY!);
        expect(mesh.wind[index / 3 * 2]!).toBeLessThanOrEqual(sway!);
        expect(mesh.wind[index / 3 * 2 + 1]!).toBeLessThanOrEqual(flutter!);
      }
    }
  }
  expect(Object.keys(NATIVE_PROP_CLEARANCE_BOUNDS)).toHaveLength(count);
}, 10_000);
