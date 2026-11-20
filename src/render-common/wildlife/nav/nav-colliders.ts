/**
 * What a collider stands for (debug colours; rabbits slip under shrubs). Crowns are per species:
 * the ring of low branches an animal of that height would push its back, head or antlers into.
 */
export const COLLIDER_KIND = { trunk: 0, rock: 1, shrub: 2, crown: 3 } as const;
export type ColliderKind = (typeof COLLIDER_KIND)[keyof typeof COLLIDER_KIND];

/** Bit per species (1 << species id): which animals a collider blocks. */
export const ALL_SPECIES_MASK = 0b111;

export interface ColliderInput {
  kind: ColliderKind;
  /** Species bits it blocks. */
  mask: number;
  radius: number;
  x: number;
  z: number;
}

/**
 * Static circle colliders (trunks, rocks, blocking shrubs) in a spatial hash of world cells:
 * each collider sits in the bucket of its centre (compressed rows), queries scan the buckets
 * within the query radius plus the largest collider radius. Nothing is allocated per query.
 */
export interface ColliderSet {
  /** Bucket b holds items[cellStart[b] .. cellStart[b + 1]). */
  cellStart: Int32Array;
  cellsX: number;
  cellsZ: number;
  count: number;
  items: Int32Array;
  kind: Uint8Array;
  mask: Uint8Array;
  radius: Float32Array;
  /** Largest collider radius: how far beyond the query a centre may lie. */
  reach: number;
  x: Float32Array;
  z: Float32Array;
}

const toBucket = (set: Pick<ColliderSet, "cellsX" | "cellsZ">, x: number, z: number) => {
  const column = Math.min(set.cellsX - 1, Math.max(0, Math.floor(x)));
  const row = Math.min(set.cellsZ - 1, Math.max(0, Math.floor(z)));
  return row * set.cellsX + column;
};

export const createColliderSet = (
  cellsX: number,
  cellsZ: number,
  colliders: readonly ColliderInput[]
): ColliderSet => {
  const count = colliders.length;
  const grid = { cellsX, cellsZ };
  const cellStart = new Int32Array(cellsX * cellsZ + 1);
  for (const collider of colliders) cellStart[toBucket(grid, collider.x, collider.z) + 1]! += 1;
  for (let bucket = 0; bucket < cellsX * cellsZ; bucket += 1) {
    cellStart[bucket + 1]! += cellStart[bucket]!;
  }
  const fill = cellStart.slice(0, cellsX * cellsZ);
  const items = new Int32Array(count);
  let reach = 0;
  colliders.forEach((collider, index) => {
    const bucket = toBucket(grid, collider.x, collider.z);
    items[fill[bucket]!] = index;
    fill[bucket]! += 1;
    reach = Math.max(reach, collider.radius);
  });
  return {
    cellStart,
    cellsX,
    cellsZ,
    count,
    items,
    kind: Uint8Array.from(colliders, (collider) => collider.kind),
    mask: Uint8Array.from(colliders, (collider) => collider.mask),
    radius: Float32Array.from(colliders, (collider) => collider.radius),
    reach,
    x: Float32Array.from(colliders, (collider) => collider.x),
    z: Float32Array.from(colliders, (collider) => collider.z)
  };
};

/** Squared distance from (px, pz) to the segment (x0, z0)-(x1, z1). */
export const getSegmentDistanceSquared = (
  px: number,
  pz: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number
) => {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const lengthSquared = dx * dx + dz * dz;
  const along = lengthSquared > 0 ? ((px - x0) * dx + (pz - z0) * dz) / lengthSquared : 0;
  const t = Math.min(1, Math.max(0, along));
  const ox = x0 + dx * t - px;
  const oz = z0 + dz * t - pz;
  return ox * ox + oz * oz;
};

/**
 * True when a collider blocking `speciesBit` comes closer than `radius` (plus its own radius)
 * to the segment; a point is a segment of length zero.
 */
export const isSegmentBlocked = (
  set: ColliderSet,
  speciesBit: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  radius: number
) => {
  const margin = radius + set.reach;
  const firstColumn = Math.max(0, Math.floor(Math.min(x0, x1) - margin));
  const lastColumn = Math.min(set.cellsX - 1, Math.floor(Math.max(x0, x1) + margin));
  const firstRow = Math.max(0, Math.floor(Math.min(z0, z1) - margin));
  const lastRow = Math.min(set.cellsZ - 1, Math.floor(Math.max(z0, z1) + margin));
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const bucket = row * set.cellsX + column;
      for (let slot = set.cellStart[bucket]!; slot < set.cellStart[bucket + 1]!; slot += 1) {
        const index = set.items[slot]!;
        if ((set.mask[index]! & speciesBit) === 0) continue;
        const limit = set.radius[index]! + radius;
        const distance = getSegmentDistanceSquared(set.x[index]!, set.z[index]!, x0, z0, x1, z1);
        if (distance < limit * limit) return true;
      }
    }
  }
  return false;
};

export const isCircleBlocked = (
  set: ColliderSet,
  speciesBit: number,
  x: number,
  z: number,
  radius: number
) => isSegmentBlocked(set, speciesBit, x, z, x, z, radius);
