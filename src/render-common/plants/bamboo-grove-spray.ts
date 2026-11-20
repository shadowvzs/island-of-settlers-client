import { DMath } from "../../shared/math/deterministic-math";
import type { Point3 } from "../buildings/building-recipe";
import type { BambooGroveSpecies } from "./bamboo-grove-species";

export type BambooRandom = () => number;

/** One lanceolate leaf: its petiole sits on a twig tip (or the culm tip), the blade points outward. */
export interface BambooLeaf {
  /** Petiole attachment on the supporting twig. */
  base: Point3;
  /** Culm wind bend weight at the supporting node (the whole spray moves with it). */
  bend: number;
  culm: number;
  /** Unit growth direction of the blade. */
  direction: Point3;
  length: number;
  /** 0 = central/largest leaf of its spray; lower tiers keep the low ranks only. */
  rank: number;
  /** Carried by a short secondary twig (dropped with the twigs in the distant tier). */
  twig: boolean;
  /** Twist about the blade axis (radians). */
  roll: number;
  /** 0..1 colour variation (young/old, sun/shade). */
  shade: number;
  width: number;
}
export interface BambooSpray {
  axis: Point3;
  bend: number;
  count: number;
  culm: number;
  origin: Point3;
  species: BambooGroveSpecies;
  twig?: boolean;
}

/** Integer mulberry32: identical on every engine, no transcendental functions. */
export const bambooRandom = (seed: number): BambooRandom => {
  let state = seed >>> 0;
  return () => {
    state = state + 0x6d2b79f5 >>> 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
};

export const offset3 = (point: Point3, direction: Point3, distance: number): Point3 =>
  [point[0] + direction[0] * distance, point[1] + direction[1] * distance, point[2] + direction[2] * distance];

export const normalize3 = (vector: Point3): Point3 => {
  const length = Math.sqrt(vector[0] ** 2 + vector[1] ** 2 + vector[2] ** 2) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
};

/** Fan position of the j-th leaf: centre first, then alternately left and right. */
const fanAngle = (rank: number) => rank === 0 ? 0 : Math.ceil(rank / 2) * .5 * (rank % 2 ? 1 : -1);

/** A palmate terminal spray: leaves fan out sideways from the twig tip and droop under their weight. */
export const addSprayLeaves = (leaves: BambooLeaf[], spray: BambooSpray, random: BambooRandom) => {
  const { axis, species } = spray;
  const horizontal = normalize3([axis[0], 0, axis[2]]);
  const side: Point3 = [-horizontal[2], 0, horizontal[0]];
  const rise = Math.max(-.6, Math.min(.4, axis[1]));
  for (let rank = 0; rank < spray.count; rank++) {
    const angle = fanAngle(rank) + (random() - .5) * .24;
    const cosine = DMath.cos(angle), sine = DMath.sin(angle);
    const droop = rise * .5 - (.22 + rank * .07 + random() * .16);
    const direction = normalize3([horizontal[0] * cosine + side[0] * sine, droop,
      horizontal[2] * cosine + side[2] * sine]);
    leaves.push({ base: [...spray.origin], bend: spray.bend, culm: spray.culm, direction,
      length: species.leafLength * (1 - rank * .06) * (.88 + random() * .24), rank,
      roll: (random() - .5) * .8, shade: random(), twig: spray.twig ?? false,
      width: species.leafWidth * (.9 + random() * .2) });
  }
};
