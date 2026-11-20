import { BufferAttribute, BufferGeometry } from "three";

import { type CacaoTreePart,createCacaoTreeMesh } from "../../../render-common/props/drink-crops/cacao-tree";
import { BIRCH_LEAF_RECT } from "../../../render-common/trees/foliage-atlas";

/** Building parts use a unit-centred envelope; the standalone tree remains rooted at ground level. */
export const createCacaoTreeGeometry = (part: CacaoTreePart, detailed: boolean) => {
  const mesh = createCacaoTreeMesh("ripe", detailed, part);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions.slice(), 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  const colours = mesh.colors.slice(), uvs = new Float32Array(mesh.uvs.length);
  for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
    if (part === "leaves") {
      const rect = BIRCH_LEAF_RECT;
      const across = ((mesh.uvs[vertex * 2]! - rect.u0) / (rect.u1 - rect.u0) - .25) / .13 + .5;
      const along = ((mesh.uvs[vertex * 2 + 1]! - rect.v0) / (rect.v1 - rect.v0) - .38) / .36;
      uvs.set([across, along], vertex * 2);
    } else if (part === "bark") {
      uvs.set([-mesh.uvs[vertex * 2]! - 2, mesh.uvs[vertex * 2 + 1]!], vertex * 2);
      colours.set([.9, .86, .76], vertex * 3);
    } else uvs.set([.5, .5], vertex * 2);
  }
  geometry.setAttribute("color", new BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  geometry.translate(0, -.6, 0);
  geometry.scale(1 / 1.1, 1 / 1.2, 1 / 1.1);
  return geometry;
};
