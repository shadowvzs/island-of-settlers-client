import type { SeasonWeights } from "./season-weights";

type Rgb = readonly [number, number, number];

/**
 * Ground season look (lane C1, plan 4 and 12): meadow grass tints, the dry-grass lean, leaf litter weight and tint,
 * damp ground, mud and the global snow cover. Tints multiply the summer colours, so summer is exactly 1.
 */
export const SEASON_GROUND_TUNING = {
  /** Straw-olive autumn grass, dull brown-olive dormant grass, fresh spring green-up, deep wet monsoon green. */
  meadow: {
    autumn: [1.2, 0.98, 0.62],
    dormant: [1.0, 0.8, 0.58],
    monsoon: [0.86, 1.0, 0.88],
    spring: [0.93, 1.1, 0.86]
  } satisfies Record<string, Rgb>,
  /** Extra straw share on the dry-grass mask (sunny slopes, dry patches). */
  dryLean: { autumn: 0.45, dormant: 0.3, drySeason: 1 },
  /** Fresh orange-brown autumn litter, flat brown dormant litter, dark wet monsoon litter. */
  litter: {
    autumn: [1.2, 0.95, 0.62],
    dormant: [0.92, 0.86, 0.8],
    monsoon: [0.82, 0.84, 0.82]
  } satisfies Record<string, Rgb>,
  /** Leaf litter mask gain under the broadleaf crowns (plan: x(1 + 0.8 autumn), dormant x1.3). */
  litterGain: { autumn: 0.8, dormant: 0.3 },
  /** Damp ground below the film threshold (0.5): monsoon, spring thaw, and the wet edge of a snow change. */
  wetness: { monsoon: 0.34, snowEdge: 0.6, spring: 0.16 }
} as const;

/** The packed ground season uniforms; zero in every field is the summer look (a missing uniform is summer). */
export interface SeasonGroundUniforms {
  /** x damp wetness, y mud (swamp and wet dirt), z reserved, w snow cover ramp. */
  cover: [number, number, number, number];
  /** rgb leaf litter tint - 1, a leaf litter mask gain. */
  litter: [number, number, number, number];
  /** rgb meadow grass tint - 1, a dry-grass lean. */
  meadow: [number, number, number, number];
}

export const createSeasonGroundUniforms = (): SeasonGroundUniforms => ({
  cover: [0, 0, 0, 0], litter: [0, 0, 0, 0], meadow: [0, 0, 0, 0]
});

/** rgb offsets (tint - 1) of the product of the weighted tints. */
const writeTintOffset = (target: number[], tints: ReadonlyArray<readonly [Rgb, number]>) => {
  for (let channel = 0; channel < 3; channel++) {
    let product = 1;
    for (const [tint, weight] of tints) product *= 1 + (tint[channel]! - 1) * weight;
    target[channel] = product - 1;
  }
};

/** Fills `target` from the frame's season weights (one call per frame, no allocation). */
export const writeSeasonGroundUniforms = (weights: SeasonWeights | undefined, target: SeasonGroundUniforms) => {
  const { autumn = 0, dormant = 0, drySeason = 0, monsoon = 0, snowCover = 0, spring = 0 } = weights ?? {};
  const { dryLean, litter, litterGain, meadow, wetness } = SEASON_GROUND_TUNING;
  writeTintOffset(target.meadow, [
    [meadow.autumn, autumn], [meadow.dormant, dormant], [meadow.spring, spring], [meadow.monsoon, monsoon]
  ]);
  target.meadow[3] = Math.min(1, dryLean.autumn * autumn + dryLean.dormant * dormant + dryLean.drySeason * drySeason);
  writeTintOffset(target.litter, [[litter.autumn, autumn], [litter.dormant, dormant], [litter.monsoon, monsoon]]);
  target.litter[3] = litterGain.autumn * autumn + litterGain.dormant * dormant;
  target.cover[0] = Math.min(0.45, wetness.monsoon * monsoon + wetness.spring * spring
    + wetness.snowEdge * snowCover * (1 - snowCover));
  target.cover[1] = monsoon;
  target.cover[2] = 0;
  target.cover[3] = snowCover;
};
