import { BufferGeometry, Float32BufferAttribute } from "three";

import { SHIP_CLOTH_WIND, type ShipClothWindVertex } from "../../../render-common/ships/ship-cloth-wind";

/** Billow directions (angle in the ship's xz plane): forward (+z), starboard (+x), port (-x). */
export const CLOTH_FORWARD = Math.PI / 2, CLOTH_STARBOARD = 0, CLOTH_PORT = Math.PI;

/** Wind data of a grid sail vertex at (u, v); see SHIP_CLOTH_WIND. */
export type SailWind = (u: number, v: number) => ShipClothWindVertex;

/** A sail grid; `wind` adds the `clothWind` attribute the SHIP-WIND shader reads. */
export const createSailGrid = (columns: number, rows: number, point: (u: number, v: number) => readonly number[],
  wind?: SailWind) => {
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = [], winds: number[] = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    vertices.push(...point(x / columns, y / rows)); uvs.push(x / columns, y / rows);
    if (wind) winds.push(...wind(x / columns, y / rows));
    if (x < columns && y < rows) {
      const a = y * (columns + 1) + x, b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices);
  if (wind) geometry.setAttribute(SHIP_CLOTH_WIND.attribute, new Float32BufferAttribute(winds, 4));
  geometry.computeVertexNormals();
  return geometry;
};

/**
 * Head-to-foot sail under a yard (square and cotton sails): the belly peaks mid-height, the yard is
 * pinned and the foot flutters most at its middle (its corners are sheeted).
 */
export const yardSailWind = (belly: number): SailWind => (u, v) =>
  [CLOTH_FORWARD, Math.sin(v * Math.PI) * belly, (1 - v) * Math.sin(u * Math.PI), 1];

/** Square sail below the yard (Roman merchant and Viking longship): it billows forward in the wind. */
const SQUARE_SAIL = { belly: .14, bottom: .64, depth: .08, height: 1.02, width: 1.25 } as const;

export const createSquareSail = (detailed: boolean) => {
  const { belly, bottom, depth, height, width } = SQUARE_SAIL;
  return createSailGrid(detailed ? 10 : 4, detailed ? 6 : 3, (u, v) =>
    [(u - .5) * width, bottom + v * height, depth + Math.sin(v * Math.PI) * belly], yardSailWind(belly));
};

/**
 * Stiff battened cloth: only the panels between the battens puff and flutter (0 on every batten), and
 * the normals keep the shape the battens give the sail.
 */
export const battenPanelWind = (battens: number, direction: number, puff: number): SailWind => (_, v) => {
  const panel = Math.sin((v * battens) % 1 * Math.PI);
  return [direction, panel * puff, panel * .5, 0];
};

/** Battened (junk-style) sail: stiff panels between bamboo battens, a shallow fixed curve. */
export const BATTENED_SAIL = { battens: 6, bottom: .64, height: 1.02, width: 1.25 } as const;
export const battenedSailDepth = (y: number) =>
  .08 + Math.sin(Math.min(1, Math.max(0, (y - BATTENED_SAIL.bottom) / BATTENED_SAIL.height)) * Math.PI) * .07;

const BATTEN_SAG = .012;

export const createBattenedSail = (detailed: boolean) => {
  const rows = detailed ? BATTENED_SAIL.battens * 2 : BATTENED_SAIL.battens;
  return createSailGrid(detailed ? 6 : 2, rows, (u, v) => {
    const y = BATTENED_SAIL.bottom + v * BATTENED_SAIL.height;
    // Each panel sags a little between its battens.
    const panel = (v * BATTENED_SAIL.battens) % 1, sag = Math.sin(panel * Math.PI) * BATTEN_SAG;
    return [(u - .5) * BATTENED_SAIL.width, y, battenedSailDepth(y) + sag];
  }, battenPanelWind(BATTENED_SAIL.battens, CLOTH_FORWARD, BATTEN_SAG));
};

/** Lateen (Nile felucca) sail: a triangle under a long slanted yard, set beside the mast to starboard. */
export const LATEEN_SAIL = {
  clew: [.15, .66, -.52], peak: [.1, 2.22, -.86], tack: [.1, .72, .95]
} as const;

const lerp = (a: readonly number[], b: readonly number[], k: number) => a.map((value, axis) => value + (b[axis]! - value) * k);

/** Rest belly of the lateen cloth (starboard): none on the yard, clew or tack; the clew is sheeted. */
const LATEEN_BELLY = .16;
const lateenBelly = (u: number, v: number) =>
  Math.sin(u * Math.PI) * Math.sin(Math.min(1, v * 1.3) * Math.PI / 1.3) * (1 - v ** 4) * LATEEN_BELLY;

/** Yard (v = 0) and clew (v = 1) are pinned; the free cloth between them flutters. */
export const LATEEN_FLUTTER = (v: number) => 4 * v * (1 - v);

export const createLateenSail = (detailed: boolean) => {
  const { clew, peak, tack } = LATEEN_SAIL;
  // u runs along the yard (tack to peak), v from the yard towards the clew (rows meet in the clew).
  const shape = (u: number, v: number) => {
    const point = lerp(lerp(tack, peak, u), clew, v);
    return [point[0]! + lateenBelly(u, v), point[1]!, point[2]!];
  };
  return createSailGrid(detailed ? 10 : 4, detailed ? 5 : 2, shape,
    (u, v) => [CLOTH_STARBOARD, lateenBelly(u, v), LATEEN_FLUTTER(v), 1]);
};
