import { CLIP, createClips, cycle, pose } from "./critter-model";
import { createQuadrupedMesh } from "./quadruped-mesh";
import { QUAD_STAND, type QuadPose, type QuadShape } from "./quadruped-shape";

/**
 * Frames of the four legged critters: stand, looking left / right, a four frame walk and trot,
 * head down (sniffing, rooting) and lying down.
 */
const FRAME = {
  stand: 0,
  lookLeft: 1,
  lookRight: 2,
  walk: 3,
  trot: 7,
  reach: 11,
  rest: 12
} as const;
/** Gait phases of the four frame cycles (walk, trot, a food critter's gallop). */
export const STEP_PHASES = [0, 0.25, 0.5, 0.75];
const LOOK = 0.75;

const POSES: readonly QuadPose[] = [
  QUAD_STAND,
  { ...QUAD_STAND, headYaw: LOOK },
  { ...QUAD_STAND, headYaw: -LOOK },
  ...STEP_PHASES.map((gait) => ({ ...QUAD_STAND, gait, stride: 1 })),
  ...STEP_PHASES.map((gait) => ({ ...QUAD_STAND, footfall: "trot" as const, gait, stride: 1 })),
  { ...QUAD_STAND, reach: 1 },
  { ...QUAD_STAND, rest: 1 }
];

/** The frame ids of a four frame cycle starting at `first`. */
export const getStepFrames = (first: number) => STEP_PHASES.map((_, index) => first + index);

const CLIPS = createClips({
  [CLIP.idle]: pose(FRAME.stand),
  [CLIP.look]: pose(FRAME.lookLeft, FRAME.stand, FRAME.lookRight),
  [CLIP.move]: cycle(...getStepFrames(FRAME.walk)),
  /** Flight is a trot; the food critters gallop (quadruped-food.ts). */
  [CLIP.run]: cycle(...getStepFrames(FRAME.trot)),
  [CLIP.feed]: pose(FRAME.stand, FRAME.reach),
  [CLIP.rest]: pose(FRAME.stand, FRAME.rest)
});

/** Frame ids of every quadruped (species with extra frames append theirs after these). */
export const QUAD_FRAME = FRAME;
export const QUAD_CLIPS = CLIPS;

/** The 13 shared frames of a four legged critter. */
export const createQuadrupedFrames = (shape: QuadShape) =>
  POSES.map((values) => createQuadrupedMesh(shape, values));
