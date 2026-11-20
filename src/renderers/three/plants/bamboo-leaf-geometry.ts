import type { Point3 } from "../../../render-common/buildings/building-recipe";
import type { BambooLeaf } from "../../../render-common/plants/bamboo-grove-graph";
import { addBambooVertex, type BambooMeshBuffers, type BambooRgb, cross3, unit3 } from "./bamboo-mesh-buffers";

export type BambooLeafDetail = "high" | "minimal" | "far";

/** Rows along the blade (fraction of length) and their half-width (fraction of the leaf width). */
const ROWS: Record<BambooLeafDetail, readonly (readonly [t: number, width: number])[]> = {
  high: [[0, .1], [.14, .66], [.4, 1], [.7, .7], [1, 0]],
  minimal: [[0, .1], [.36, 1], [1, 0]],
  far: [[0, .1], [.36, 1], [1, 0]]
};

const SKY_BIAS = .7;
/** Lower tiers keep fewer leaves per spray; slightly larger blades keep the crown mass. */
const TIER_SCALE: Record<BambooLeafDetail, readonly [length: number, width: number]> = {
  high: [1, 1], minimal: [1.1, 1.22], far: [1.2, 1.4]
};

export interface BambooLeafPaint {
  colour: BambooRgb;
  /** Dry/yellowed tip colour, blended over the last row. */
  tip?: BambooRgb;
  phase: number;
}

const mixRgb = (a: BambooRgb, b: BambooRgb, t: number): BambooRgb =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const rotateAbout = (vector: Point3, axis: Point3, angle: number): Point3 => {
  const cosine = Math.cos(angle), sine = Math.sin(angle), across = cross3(axis, vector);
  const along = axis[0] * vector[0] + axis[1] * vector[1] + axis[2] * vector[2];
  return [0, 1, 2].map(index => vector[index]! * cosine + across[index]! * sine +
    axis[index]! * along * (1 - cosine)) as Point3;
};

/**
 * Lanceolate blade in real geometry (no alpha test): rounded base on a short petiole, widest at about
 * a third, long acuminate tip; V-folded along the raised midrib and arching downward along its length.
 */
export const addBambooLeaf = (buffers: BambooMeshBuffers, leaf: BambooLeaf, detail: BambooLeafDetail,
  paint: BambooLeafPaint, flat = false) => {
  const direction = leaf.direction;
  const level = unit3(cross3(direction, Math.abs(direction[1]) > .95 ? [1, 0, 0] : [0, 1, 0]));
  const side = rotateAbout(level, direction, leaf.roll), normal = unit3(cross3(side, direction));
  const [lengthScale, widthScale] = TIER_SCALE[detail];
  const length = leaf.length * lengthScale, breadth = leaf.width * widthScale;
  const fold = flat ? 0 : breadth * .12, droop = flat ? 0 : length * .2;
  const columns = detail === "far" ? [-1, 1] : [-1, 0, 1];
  const rows = ROWS[detail], start = buffers.positions.length / 3;
  rows.forEach(([t, width], row) => {
    const tipBlend = paint.tip && t > .6 ? (t - .6) / .4 : 0;
    const colour = tipBlend ? mixRgb(paint.colour, paint.tip!, tipBlend) : paint.colour;
    const last = row === rows.length - 1, edges = last ? [0] : columns;
    for (const column of edges) {
      const reach = column * width * breadth * .5, lift = column === 0 ? fold : 0;
      const position = [0, 1, 2].map(axis => leaf.base[axis]! + direction[axis]! * length * t +
        side[axis]! * reach + normal[axis]! * lift - (axis === 1 ? droop * t * t : 0)) as Point3;
      const tilt = column * (flat ? 0 : .35);
      // Lean shading normals towards the sky so sprays read as lit foliage masses.
      const vertexNormal = unit3([0, 1, 2].map(axis => normal[axis]! - side[axis]! * tilt +
        (axis === 1 ? SKY_BIAS : 0)) as Point3);
      addBambooVertex(buffers, position, vertexNormal, [last ? .5 : (column + 1) / 2, t], colour,
        [paint.phase, leaf.bend, t]);
    }
  });
  let rowStart = start;
  for (let row = 0; row < rows.length - 1; row++) {
    const next = rowStart + columns.length;
    if (row === rows.length - 2) {
      // The acuminate tip closes on one apex vertex.
      for (let column = 0; column < columns.length - 1; column++)
        buffers.indices.push(rowStart + column, rowStart + column + 1, next);
    } else for (let column = 0; column < columns.length - 1; column++) {
      const a = rowStart + column, b = next + column;
      buffers.indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
    rowStart = next;
  }
};
