import { lerp3 } from "../../shared/world/noise";
import { getButterflyCell, toCellUv } from "../flyers/flyer-atlas-layout";
import type { Vec3 } from "../props/mesh-builder";
import { BUTTERFLY_SPECIES, type ButterflySpecies } from "./butterfly-species";
import { CARD_X_MAX, CARD_X_MIN, CARD_Z_MAX } from "./butterfly-wing-shape";

/**
 * Butterfly at rest (wingspan 1, forward +x, up +y, wings along z) as a triangle list: one wing
 * card per side (the painted forewing and hindwing, alpha cut, from the flyer atlas) subdivided
 * so the beat can bend it, a segmented body and two clubbed antennae. `upperUv` / `underUv` are
 * the atlas UVs of the wing's two sides (variant 0; -1 on the body), `sides` +1 / -1 on a wing,
 * 0 on the body; `colors` are the body colours (white on the wings: the atlas has the colour).
 */
export interface ButterflyGeometry {
  colors: Float32Array;
  positions: Float32Array;
  sides: Float32Array;
  underUv: Float32Array;
  upperUv: Float32Array;
}

/** Card grid: x stations (back to front) and z stations (root to tip) for a smooth bend. */
const CARD_XS = [CARD_X_MIN, -0.08, 0.12, CARD_X_MAX];
const CARD_ZS = [0, 0.14, 0.28, 0.4, CARD_Z_MAX];
/** Wings curve up a little towards the rim. */
const WING_CURVE = 0.03;
/** Body rings along x: [x, radius, light (segment ring / thorax hair) 0..1]. */
const BODY_RINGS: readonly (readonly [number, number, number])[] = [
  [0.15, 0.006, 0],
  [0.135, 0.026, 0.2],
  [0.11, 0.024, 0],
  [0.085, 0.036, 0.7],
  [0.03, 0.04, 0.6],
  [-0.01, 0.026, 0],
  [-0.05, 0.031, 0.5],
  [-0.09, 0.027, 0],
  [-0.13, 0.026, 0.5],
  [-0.17, 0.02, 0],
  [-0.215, 0.006, 0.3]
];
const BODY_SIDES = 5;
const BODY_DROP = -0.012;
const ANTENNA_WIDTH = 0.008;
const NO_UV = [-1, -1] as const;
const WHITE: Vec3 = [1, 1, 1];

class TriangleList {
  readonly colors: number[] = [];
  readonly positions: number[] = [];
  readonly sides: number[] = [];
  readonly underUv: number[] = [];
  readonly upperUv: number[] = [];

  add(points: readonly Vec3[], colors: readonly Vec3[], uvs: readonly UvPair[], side: number) {
    for (let corner = 0; corner < 3; corner += 1) {
      this.positions.push(...points[corner]!);
      this.colors.push(...colors[corner]!);
      this.upperUv.push(...uvs[corner]!.upper);
      this.underUv.push(...uvs[corner]!.under);
      this.sides.push(side);
    }
  }

  finish(): ButterflyGeometry {
    return {
      colors: Float32Array.from(this.colors),
      positions: Float32Array.from(this.positions),
      sides: Float32Array.from(this.sides),
      underUv: Float32Array.from(this.underUv),
      upperUv: Float32Array.from(this.upperUv)
    };
  }
}

interface UvPair {
  under: readonly [number, number];
  upper: readonly [number, number];
}

const BODY_UV: UvPair = { under: NO_UV, upper: NO_UV };

interface CardVertex {
  point: Vec3;
  uv: UvPair;
}

const createCardGrid = (species: number) =>
  CARD_ZS.map((z) =>
    CARD_XS.map((x): CardVertex => {
      const u = (x - CARD_X_MIN) / (CARD_X_MAX - CARD_X_MIN);
      const v = z / CARD_Z_MAX;
      const reach = z / CARD_Z_MAX;
      return {
        point: [x, WING_CURVE * reach * reach, z],
        uv: {
          under: toCellUv(getButterflyCell(species, 0, true), u, v),
          upper: toCellUv(getButterflyCell(species, 0, false), u, v)
        }
      };
    })
  );

const mirrorZ = ([x, y, z]: Vec3): Vec3 => [x, y, -z];

/** A wing triangle facing +y on the right side and its mirror (reversed) on the left. */
const addWingTriangle = (list: TriangleList, vertices: readonly CardVertex[]) => {
  const [a, b, c] = vertices as [CardVertex, CardVertex, CardVertex];
  const ab = [b.point[0] - a.point[0], b.point[2] - a.point[2]];
  const ac = [c.point[0] - a.point[0], c.point[2] - a.point[2]];
  const ordered = ab[1]! * ac[0]! - ab[0]! * ac[1]! > 0 ? [a, b, c] : [a, c, b];
  const whites = [WHITE, WHITE, WHITE];
  list.add(
    ordered.map((vertex) => vertex.point),
    whites,
    ordered.map((vertex) => vertex.uv),
    1
  );
  const mirrored = [...ordered].reverse();
  list.add(
    mirrored.map((vertex) => mirrorZ(vertex.point)),
    whites,
    mirrored.map((vertex) => vertex.uv),
    -1
  );
};

const addWings = (list: TriangleList, species: number) => {
  const grid = createCardGrid(species);
  for (let row = 0; row < grid.length - 1; row += 1) {
    for (let column = 0; column < CARD_XS.length - 1; column += 1) {
      const a = grid[row]![column]!;
      const b = grid[row]![column + 1]!;
      const c = grid[row + 1]![column + 1]!;
      const d = grid[row + 1]![column]!;
      addWingTriangle(list, [a, b, c]);
      addWingTriangle(list, [a, c, d]);
    }
  }
};

const getBodyPoint = (ring: number, side: number): Vec3 => {
  const [x, radius] = BODY_RINGS[ring]!;
  const angle = (side / BODY_SIDES) * Math.PI * 2;
  return [x, BODY_DROP + Math.cos(angle) * radius, Math.sin(angle) * radius];
};


/** Head, furry thorax and a ringed abdomen: paler rings mark the segments. */
const addBody = (list: TriangleList, species: ButterflySpecies) => {
  const ringColor = (ring: number) =>
    lerp3(species.body, species.bodyLight, BODY_RINGS[ring]![2] * 0.6);
  const uvs = [BODY_UV, BODY_UV, BODY_UV];
  for (let ring = 0; ring < BODY_RINGS.length - 1; ring += 1) {
    const near = ringColor(ring);
    const far = ringColor(ring + 1);
    for (let side = 0; side < BODY_SIDES; side += 1) {
      const a = getBodyPoint(ring, side);
      const b = getBodyPoint(ring, side + 1);
      const c = getBodyPoint(ring + 1, side + 1);
      const d = getBodyPoint(ring + 1, side);
      list.add([a, c, b], [near, far, near], uvs, 0);
      list.add([a, d, c], [near, far, far], uvs, 0);
    }
  }
};

/** A flat ribbon between two points, `width` wide across (horizontal: seen from above). */
const addRibbon = (
  list: TriangleList,
  from: Vec3,
  to: Vec3,
  widths: [number, number],
  color: Vec3
) => {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dz) || 1;
  const across: Vec3 = [-dz / length, 0, dx / length];
  const offset = (point: Vec3, width: number, sign: number): Vec3 => [
    point[0] + across[0] * width * sign,
    point[1],
    point[2] + across[2] * width * sign
  ];
  const colors = [color, color, color];
  const uvs = [BODY_UV, BODY_UV, BODY_UV];
  const [a, b] = [offset(from, widths[0], 1), offset(from, widths[0], -1)];
  const [c, d] = [offset(to, widths[1], 1), offset(to, widths[1], -1)];
  list.add([a, c, b], colors, uvs, 0);
  list.add([b, c, d], colors, uvs, 0);
};

/** Thin antennae curving forward and out from the head, each ending in a club. */
const addAntennae = (list: TriangleList, species: ButterflySpecies) => {
  const tipColor = lerp3(species.body, species.bodyLight, 0.5);
  for (const side of [-1, 1]) {
    const base: Vec3 = [0.14, 0.012, side * 0.008];
    const bend: Vec3 = [0.24, 0.05, side * 0.045];
    const tip: Vec3 = [0.31, 0.075, side * 0.095];
    const club: Vec3 = [0.335, 0.08, side * 0.11];
    addRibbon(list, base, bend, [ANTENNA_WIDTH / 2, ANTENNA_WIDTH / 2], species.body);
    addRibbon(list, bend, tip, [ANTENNA_WIDTH / 2, ANTENNA_WIDTH / 2], species.body);
    addRibbon(list, tip, club, [ANTENNA_WIDTH / 2, ANTENNA_WIDTH * 1.4], tipColor);
  }
};

/** The shared mesh recipe of a species (by index; about 150 triangles). */
export const createButterflyGeometry = (species: number): ButterflyGeometry => {
  const list = new TriangleList();
  addWings(list, species);
  addBody(list, BUTTERFLY_SPECIES[species]!);
  addAntennae(list, BUTTERFLY_SPECIES[species]!);
  return list.finish();
};

/** How far the wing tips lag the beat (`bend` times the reach squared), and the hindwing more. */
const HIND_LAG = 0.5;
const HIND_START = -0.02;
const HIND_RANGE = 0.25;

/**
 * Wing pose: each wing turns about the body axis by `angle` (0 flat open, positive up; about
 * 1.4 = closed above the back, negative = the down stroke); `bend` (radians) curls the outer
 * wing and the hindwing behind the beat. Writes the point into `out`.
 */
export const deformButterflyPoint = (
  x: number,
  y: number,
  z: number,
  side: number,
  pose: { angle: number; bend: number },
  out: Float32Array,
  offset: number
) => {
  out[offset] = x;
  if (side === 0) {
    out[offset + 1] = y;
    out[offset + 2] = z;
    return;
  }
  const reach = z * side;
  const tip = reach / CARD_Z_MAX;
  const hind = Math.min(1, Math.max(0, (HIND_START - x) / HIND_RANGE));
  const angle = pose.angle + pose.bend * tip * (tip + HIND_LAG * hind);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  out[offset + 1] = y * cos + reach * sin;
  out[offset + 2] = side * (reach * cos - y * sin);
};

/** The same wing pose in GLSL (Three's vertex shader). */
export const BUTTERFLY_WING_GLSL = `
vec3 deformButterflyPoint(vec3 p, float side, float angle, float bend) {
  if (side == 0.0) return p;
  float reach = p.z * side;
  float tip = reach / ${CARD_Z_MAX.toFixed(3)};
  float hind = clamp((${HIND_START.toFixed(3)} - p.x) / ${HIND_RANGE.toFixed(3)}, 0.0, 1.0);
  float turn = angle + bend * tip * (tip + ${HIND_LAG.toFixed(3)} * hind);
  float c = cos(turn);
  float s = sin(turn);
  return vec3(p.x, p.y * c + reach * s, side * (reach * c - p.y * s));
}
`;
