import { srgbToLinear } from "../../color";

/**
 * Earthen dikes (bunds) of one rice paddy cell, as raw geometry data in cell space (centre at 0,
 * cell edges at ±0.5). Every side is a rounded mud bank whose crest lies on the cell edge: the
 * inner slope runs down into the water, and only a side without a neighbouring paddy gets the
 * outer slope down to the ground. Two neighbours' inner halves therefore meet at one shared crest
 * (no double wall). Crest heights wobble with the along-edge world coordinate, identically on both
 * sides of a shared edge.
 */
export interface PaddyNeighbours {
  east: boolean;
  north: boolean;
  south: boolean;
  west: boolean;
}

export const PADDY_WATER_LEVEL = 0.045;
const CREST = 0.075;
/** Display colours converted to the linear vertex colours the lit material expects. */
const MUD = srgbToLinear(0.5, 0.38, 0.24);
const WET_MUD = srgbToLinear(0.36, 0.28, 0.18);
const GRASS = srgbToLinear(0.44, 0.56, 0.2);

/** Cross-section from outside to inside: [offset inwards from the edge, height, colour]. */
type Section = ReadonlyArray<readonly [number, number, readonly [number, number, number]]>;
const INNER: Section = [[0, 1, GRASS], [0.025, 0.93, MUD], [0.06, 0.62, MUD], [0.1, 0.3, WET_MUD], [0.13, 0, WET_MUD]];
const OUTER: Section = [[-0.08, -0.2, MUD], [-0.045, 0.45, MUD], [-0.02, 0.88, MUD]];

/** Smooth crest wobble along an edge (deterministic, cell-independent). */
const crestHeight = (along: number) => CREST * (1 + 0.14 * Math.sin(along * 9.1) + 0.08 * Math.sin(along * 23.7 + 1.3));

interface Side {
  /** Maps (along -0.5..0.5, inwards offset) to cell x, z. */
  at: (along: number, inward: number) => readonly [number, number];
  joined: boolean;
}

const sides = (neighbours: PaddyNeighbours): Side[] => [
  { at: (along, inward) => [0.5 - inward, along], joined: neighbours.east },
  { at: (along, inward) => [-0.5 + inward, along], joined: neighbours.west },
  { at: (along, inward) => [along, 0.5 - inward], joined: neighbours.south },
  { at: (along, inward) => [along, -0.5 + inward], joined: neighbours.north }
];

export const createPaddyDikeData = (neighbours: PaddyNeighbours, detailed: boolean) => {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const steps = detailed ? 10 : 4;
  for (const side of sides(neighbours)) {
    const section = side.joined ? INNER : [...OUTER, ...INNER];
    const first = positions.length / 3;
    for (let step = 0; step <= steps; step += 1) {
      const along = -0.5 + step / steps;
      const crest = crestHeight(along);
      for (const [inward, height, color] of section) {
        const [x, z] = side.at(along, inward);
        // The banks sink into the water and the ground; the water level caps the inner foot.
        const y = inward >= 0.13 ? PADDY_WATER_LEVEL - 0.02 : Math.max(-0.015, height * crest);
        positions.push(x, y, z);
        const shade = 0.92 + 0.16 * Math.sin(along * 31 + inward * 57);
        colors.push(color[0] * shade, color[1] * shade, color[2] * shade);
      }
    }
    const ring = section.length;
    for (let step = 0; step < steps; step += 1) for (let point = 0; point < ring - 1; point += 1) {
      const a = first + step * ring + point, b = a + ring;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { colors, indices, positions };
};
