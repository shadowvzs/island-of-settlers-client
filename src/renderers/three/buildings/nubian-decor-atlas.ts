/** Atlas rectangle in UV space (v up, as the GPU samples a flipped canvas texture). */
export interface AtlasRegion {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

const CELL = 0.25;

const cell = (column: number, row: number, columns = 1): AtlasRegion => ({
  u0: column * CELL,
  u1: (column + columns) * CELL,
  v0: row * CELL,
  v1: (row + 1) * CELL
});

/**
 * The shared Nubian decor atlas (4 × 4 cells): painted jars unroll over two cells, shields, skull
 * bone and horn take one cell each, hats are painted top-down (radial) in one cell each.
 */
export const NUBIAN_DECOR_ATLAS = {
  bone: cell(3, 0),
  hat: [cell(0, 3), cell(1, 3)],
  horn: [cell(3, 1), cell(3, 2)],
  shield: [cell(2, 0), cell(2, 1), cell(2, 2)],
  vase: [cell(0, 0, 2), cell(0, 1, 2), cell(0, 2, 2)]
} as const;

/** The textile atlas: one full-height column per woven design. */
export const NUBIAN_TEXTILE_COLUMNS = 4;
export const nubianTextileRegion = (variant: number): AtlasRegion => ({
  u0: variant / NUBIAN_TEXTILE_COLUMNS,
  u1: (variant + 1) / NUBIAN_TEXTILE_COLUMNS,
  v0: 0,
  v1: 1
});

/** Half a texel of the High atlas kept clear of each region edge, so mips do not bleed. */
const INSET = 1 / 512;
export const regionUv = (region: AtlasRegion, u: number, v: number): [number, number] => [
  region.u0 + INSET + Math.max(0, Math.min(1, u)) * (region.u1 - region.u0 - INSET * 2),
  region.v0 + INSET + Math.max(0, Math.min(1, v)) * (region.v1 - region.v0 - INSET * 2)
];
