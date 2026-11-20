import { describe, expect, it } from "vitest";

import { COVER } from "../src/render-common/props/prop-mesh-layout";
import { PROP_MESH_SEED } from "../src/render-common/props/prop-mesh-seed";
import { createPropMesh, getVariantCount } from "../src/render-common/props/prop-meshes";

describe("untextured cover meshes", () => {
  it("keeps every cover vertex on the untextured path", () => {
    for (const kind of Object.values(COVER)) {
      for (let variant = 0; variant < getVariantCount(kind); variant += 1) {
        const uvs = createPropMesh(PROP_MESH_SEED, kind, variant).uvs;
        for (let index = 0; index < uvs.length; index += 2)
          expect(uvs[index]).toBeLessThan(0);
      }
    }
  });
});
