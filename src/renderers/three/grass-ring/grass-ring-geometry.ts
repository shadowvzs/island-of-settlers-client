import { BufferAttribute, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry } from "three";

import { GRASS_RING_PATCH_BLADES, type GrassRingBand } from "../../../render-common/grass/grass-ring-layout";

/**
 * One band's patch: `band.blades` strips of `2 * segments + 1` vertices (pairs up the blade, one
 * tip). position = (tile-local root x, height parameter t, root z); blade = (rank, side).
 * The per-tile instance attribute `tile` holds the tile's integer x/z.
 */
export const createGrassRingGeometry = (band: GrassRingBand, roots: Float32Array, tileCapacity: number) => {
  const vertsPerBlade = band.segments * 2 + 1;
  const vertexCount = band.blades * vertsPerBlade;
  const positions = new Float32Array(vertexCount * 3);
  const blades = new Float32Array(vertexCount * 2);
  const indices = new Uint16Array(band.blades * (band.segments * 2 - 1) * 3);
  let vertex = 0, index = 0;
  for (let bladeIndex = 0; bladeIndex < band.blades; bladeIndex++) {
    const first = vertex;
    const rank = bladeIndex / GRASS_RING_PATCH_BLADES;
    for (let step = 0; step < vertsPerBlade; step++) {
      const level = Math.floor(step / 2);
      const isTip = step === vertsPerBlade - 1;
      positions.set([roots[bladeIndex * 2]!, level / band.segments, roots[bladeIndex * 2 + 1]!], vertex * 3);
      blades.set([rank, isTip ? 0 : (step % 2) * 2 - 1], vertex * 2);
      vertex++;
    }
    for (let level = 0; level < band.segments - 1; level++) {
      const low = first + level * 2;
      indices.set([low, low + 1, low + 2, low + 1, low + 3, low + 2], index);
      index += 6;
    }
    const last = first + (band.segments - 1) * 2;
    indices.set([last, last + 1, last + 2], index);
    index += 3;
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("blade", new BufferAttribute(blades, 2));
  const tiles = new InstancedBufferAttribute(new Float32Array(tileCapacity * 2), 2);
  tiles.setUsage(DynamicDrawUsage);
  geometry.setAttribute("tile", tiles);
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.instanceCount = 0;
  return { geometry, tiles, triangles: indices.length / 3 };
};
