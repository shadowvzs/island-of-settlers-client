import { BufferAttribute, BufferGeometry } from "three";

import { createPomegranateFruitMesh } from "../../../render-common/props/drink-crops/pomegranate-fruit";
import { createPomegranateTreeMesh, type PomegranateTreePart } from "../../../render-common/props/drink-crops/pomegranate-tree";
import { BIRCH_LEAF_RECT } from "../../../render-common/trees/foliage-atlas";

export const createPomegranateGeometry = (part: PomegranateTreePart | "whole-fruit", detailed: boolean) => {
  const mesh = part === "whole-fruit" ? createPomegranateFruitMesh(detailed)
    : createPomegranateTreeMesh("ripe", detailed, part);
  const geometry = new BufferGeometry(), positions = mesh.positions.slice();
  const colors = mesh.colors.slice(), uvs = new Float32Array(mesh.uvs.length).fill(.5);
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    if (part !== "whole-fruit") positions[vertex * 3 + 1] = positions[vertex * 3 + 1]! - .54;
    if (part === "leaves") {
      const rect = BIRCH_LEAF_RECT;
      uvs[vertex * 2] = ((mesh.uvs[vertex * 2]! - rect.u0) / (rect.u1 - rect.u0) - .25) / .13 + .5;
      uvs[vertex * 2 + 1] = ((mesh.uvs[vertex * 2 + 1]! - rect.v0) / (rect.v1 - rect.v0) - .38) / .36;
    } else if (part === "bark") {
      uvs[vertex * 2] = -mesh.uvs[vertex * 2]! - 2;
      uvs[vertex * 2 + 1] = mesh.uvs[vertex * 2 + 1]!;
      colors.set([.9, .86, .8], vertex * 3);
    }
  }
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  if (part !== "whole-fruit") geometry.scale(1 / .98, 1 / 1.08, 1 / .98);
  return geometry;
};
