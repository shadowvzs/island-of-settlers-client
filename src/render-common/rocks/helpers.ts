/** Normal helpers shared by the rock skin and the rock library shapes. */

/** Smooth vertex normals: area weighted face normals of an indexed mesh. */
export const computeVertexNormals = (positions: Float32Array, indices: ArrayLike<number>) => {
  const normals = new Float32Array(positions.length);
  for (let index = 0; index < indices.length; index += 3) {
    const [a, b, c] = [indices[index]! * 3, indices[index + 1]! * 3, indices[index + 2]! * 3];
    const ab = [0, 1, 2].map((axis) => positions[b + axis]! - positions[a + axis]!);
    const ac = [0, 1, 2].map((axis) => positions[c + axis]! - positions[a + axis]!);
    const face = [
      ab[1]! * ac[2]! - ab[2]! * ac[1]!,
      ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!
    ];
    for (const corner of [a, b, c]) {
      for (let axis = 0; axis < 3; axis += 1) normals[corner + axis]! += face[axis]!;
    }
  }
  for (let index = 0; index < normals.length; index += 3) {
    const length = Math.hypot(normals[index]!, normals[index + 1]!, normals[index + 2]!);
    if (length === 0) normals[index + 1] = 1;
    else for (let axis = 0; axis < 3; axis += 1) normals[index + axis]! /= length;
  }
  return normals;
};

/** Neighbour averaging passes of the skin normals (very smooth shading, broad light falloff). */
const NORMAL_SMOOTHING_PASSES = 2;

/**
 * Smooths vertex normals by averaging each with its triangle neighbours: forms read through soft
 * light gradients (ledges and strata by their shape, not by hard edges).
 */
export const smoothNormals = (
  normals: Float32Array,
  indices: ArrayLike<number>,
  passes = NORMAL_SMOOTHING_PASSES
) => {
  let current = normals;
  for (let pass = 0; pass < passes; pass += 1) {
    const sums = Float32Array.from(current);
    for (let index = 0; index < indices.length; index += 3) {
      for (let corner = 0; corner < 3; corner += 1) {
        const target = indices[index + corner]! * 3;
        for (const other of [1, 2]) {
          const source = indices[index + ((corner + other) % 3)]! * 3;
          for (let axis = 0; axis < 3; axis += 1)
            sums[target + axis]! += current[source + axis]! * 0.5;
        }
      }
    }
    for (let index = 0; index < sums.length; index += 3) {
      const length = Math.hypot(sums[index]!, sums[index + 1]!, sums[index + 2]!) || 1;
      for (let axis = 0; axis < 3; axis += 1) sums[index + axis]! /= length;
    }
    current = sums;
  }
  return current;
};
