import { CLIP, cycle, pose } from "./critter-model";
import { getStepFrames, QUAD_CLIPS, QUAD_FRAME, STEP_PHASES } from "./quadruped-models";

/**
 * Food critters (wild boar, piglets, chamois) are hunted: after the shared quadruped frames
 * they add a four frame gallop (their flight) and four frames of the death fall (stumbling,
 * buckling, rolling onto the side, lying), at death progress 0.25, 0.5, 0.75 and 1. Their
 * source-built models (chamois.ts, boar.ts) bake their frames in this order.
 */
export const FOOD_FRAME = {
  ...QUAD_FRAME,
  gallop: QUAD_FRAME.rest + 1,
  dying: QUAD_FRAME.rest + 1 + STEP_PHASES.length
} as const;
const DEATH_STEPS = [0.25, 0.5, 0.75, 1];

/** Clips of the food critters. */
export const FOOD_CLIPS = [...QUAD_CLIPS];
FOOD_CLIPS[CLIP.run] = cycle(...getStepFrames(FOOD_FRAME.gallop));
FOOD_CLIPS[CLIP.dead] = pose(
  FOOD_FRAME.stand,
  ...DEATH_STEPS.map((_, index) => FOOD_FRAME.dying + index)
);
