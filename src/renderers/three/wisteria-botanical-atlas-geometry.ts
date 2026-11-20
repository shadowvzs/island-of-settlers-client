import type { BufferGeometry } from "three";

import { mapWisteriaAtlasVertices } from "./wisteria-botanical-atlas";

/** Preserve the liked curved surfaces; tissue-space UVs add detail without a copied colour model. */
export const mapWisteriaFlowerAtlas = (geometry: BufferGeometry) => {
  const position = geometry.getAttribute("position");
  if (position.count !== 29 && position.count !== 21)
    throw new Error("Wisteria flower topology changed; review its tissue atlas mapping");
  const lean = position.count === 21;
  mapWisteriaAtlasVertices(geometry, "banner", 0, 9, vertex =>
    [(position.getX(vertex) + .48) / .96, (position.getY(vertex) - .06) / .59]);
  const wings = lean ? [[9, -1], [13, 1]] as const : [[9, -1], [16, 1]] as const;
  for (const [first, sign] of wings)
    mapWisteriaAtlasVertices(geometry, "wing", first, lean ? 4 : 7, vertex =>
      [(position.getX(vertex) * sign - .035) / .305, (position.getY(vertex) + .29) / .325]);
  mapWisteriaAtlasVertices(geometry, "keel", lean ? 17 : 23, lean ? 4 : 6, vertex =>
    [(position.getX(vertex) + .10) / .20, (position.getY(vertex) + .36) / .33]);
};

export const mapWisteriaLeafAtlas = (geometry: BufferGeometry) => {
  const position = geometry.getAttribute("position");
  geometry.computeBoundingBox();
  const halfWidth = Math.max(Math.abs(geometry.boundingBox!.min.x), Math.abs(geometry.boundingBox!.max.x));
  mapWisteriaAtlasVertices(geometry, "leafFront", 0, position.count, vertex =>
    [position.getX(vertex) / (halfWidth * 2) + .5, position.getY(vertex)]);
};

export const mapWisteriaBudAtlas = (geometry: BufferGeometry) => {
  const uv = geometry.getAttribute("uv");
  // The closed bud is a solid volume; sample inside tissue instead of punching holes at atlas corners.
  const local = Array.from({ length: uv.count }, (_, vertex) =>
    [.12 + uv.getX(vertex) * .76, .12 + uv.getY(vertex) * .76] as const);
  mapWisteriaAtlasVertices(geometry, "bud", 0, uv.count, vertex => local[vertex]!);
};
