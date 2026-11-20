import { createPermutation } from "../../shared/world/noise";
import type { Vec3 } from "../props/mesh-builder";

/** Plate size (world units): big forms first. */
const PLATE = 2.6;

export interface Plate {
  /** Distance to the nearest plate centre minus the second nearest (crack proximity). */
  edge: number;
  /** 1 between two formations (a real fracture) .. 0.3 inside one (a soft seam). */
  fracture: number;
  /** Offset of the plate surface at this point (planar per formation: offset + tilt). */
  offset: number;
  /** The formation's tilt: its facet normal leans this way. */
  tilt: Vec3;
}

type CellId = [number, number, number];

/** Formation of a cell: neighbours merge in brick-like pairs, so most seams disappear. */
const getGroup = (id: CellId): CellId => {
  const shift = id[1] & 1;
  return [Math.floor((id[0] + shift) / 2), id[1], Math.floor((id[2] + shift) / 2)];
};

const isSameGroup = (a: CellId, b: CellId) => {
  const groupA = getGroup(a);
  const groupB = getGroup(b);
  return groupA[0] === groupB[0] && groupA[1] === groupB[1] && groupA[2] === groupB[2];
};

/**
 * 3D Voronoi cells merged into formations: every formation is a planar slab with its own
 * standing-out depth and tilt, so a face becomes broad facets catching light differently;
 * fractures only between formations, faint seams inside them (no visible tessellation).
 */
export const createPlates = (seed: number) => {
  const permutation = createPermutation(seed);
  const hash = (x: number, y: number, z: number) =>
    permutation[(permutation[(permutation[x & 255]! + y) & 255]! + z) & 255]! / 255;
  const getCentreX = (x: number, y: number, z: number) => (x + 0.15 + hash(x, y, z) * 0.7) * PLATE;
  const getCentreY = (x: number, y: number, z: number) =>
    (y + 0.15 + hash(y + 31, z, x) * 0.7) * PLATE * 0.7;
  const getCentreZ = (x: number, y: number, z: number) =>
    (z + 0.15 + hash(z + 17, x, y + 5) * 0.7) * PLATE;
  const getCentre = ([x, y, z]: CellId): Vec3 => [
    getCentreX(x, y, z),
    getCentreY(x, y, z),
    getCentreZ(x, y, z)
  ];
  /**
   * Nearest and second nearest cell centre among the 27 around the point. Scalar math and
   * squared distances: this runs for every skin vertex (hundreds of thousands on 256 x 256).
   */
  const findNearest = (point: Vec3) => {
    const cellX = Math.floor(point[0] / PLATE);
    const cellY = Math.floor(point[1] / (PLATE * 0.7));
    const cellZ = Math.floor(point[2] / PLATE);
    let nearest = 81;
    let second = 81;
    let best = 0;
    let secondBest = 0;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = cellX + dx;
          const y = cellY + dy;
          const z = cellZ + dz;
          const offsetX = point[0] - getCentreX(x, y, z);
          const offsetY = (point[1] - getCentreY(x, y, z)) * 1.4;
          const offsetZ = point[2] - getCentreZ(x, y, z);
          const squared = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;
          const code = (dz + 1) * 9 + (dy + 1) * 3 + dx + 1;
          if (squared < nearest) {
            second = nearest;
            secondBest = best;
            nearest = squared;
            best = code;
          } else if (squared < second) {
            second = squared;
            secondBest = code;
          }
        }
      }
    }
    const toId = (code: number): CellId => [
      cellX + (code % 3) - 1,
      cellY + (Math.floor(code / 3) % 3) - 1,
      cellZ + Math.floor(code / 9) - 1
    ];
    return {
      best: toId(best),
      nearest: Math.sqrt(nearest),
      second: Math.sqrt(second),
      secondId: toId(secondBest)
    };
  };
  /** One fixed point per formation, so merged cells share one plane (no step at the seam). */
  const getAnchor = (group: CellId) => {
    const shift = group[1] & 1;
    return getCentre([group[0] * 2 - shift, group[1], group[2] * 2 - shift]);
  };
  return (point: Vec3): Plate => {
    const { best, nearest, second, secondId } = findNearest(point);
    const group = getGroup(best);
    const seedValue = hash(group[0] + 7, group[1] + 3, group[2] + 11);
    const tilt: Vec3 = [
      hash(group[0], group[1] + 9, group[2]) - 0.5,
      hash(group[0] + 4, group[1], group[2]) - 0.5,
      hash(group[0], group[1], group[2] + 6) - 0.5
    ];
    const anchor = getAnchor(group);
    const along =
      (point[0] - anchor[0]) * tilt[0] +
      (point[1] - anchor[1]) * tilt[1] +
      (point[2] - anchor[2]) * tilt[2];
    return {
      edge: second - nearest,
      fracture: isSameGroup(best, secondId) ? 0.3 : 1,
      offset: 0.15 + seedValue * 0.25 + along * 0.18,
      tilt
    };
  };
};
