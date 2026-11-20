import { CLIP, createClips, type CritterModel,cycle, pose } from "./critter-model";
import { createWaderMesh } from "./wader-mesh";
import { SHORE_GULL, WADER_REST, type WaderPose, type WaderShape } from "./wader-shape";

/**
 * Frames of the long legged birds: stand, alert, a four frame walk, reaching for prey (aim and
 * strike / peck) and two flight frames (wings up and down, legs trailing, body level).
 */
const FRAME = { stand: 0, alert: 1, walk: 2, aim: 6, strike: 7, flapUp: 8, flapDown: 9 } as const;
const WALK_STEPS = [0, 0.25, 0.5, 0.75];
const FLIGHT: Partial<WaderPose> = { legsBack: 1, level: 1, spread: 1 };

const createPoses = (stride: number): WaderPose[] => [
  WADER_REST,
  { ...WADER_REST, neckUp: 1 },
  ...WALK_STEPS.map((step) => ({ ...WADER_REST, neckUp: 0.25, step, stride })),
  { ...WADER_REST, reach: 0.45 },
  { ...WADER_REST, reach: 1 },
  { ...WADER_REST, ...FLIGHT, flap: 0.65 },
  { ...WADER_REST, ...FLIGHT, flap: -0.55 }
];

/** Clips of the long legged birds (the heron model bakes its frames in this order). */
export const WADER_CLIPS = createClips({
  [CLIP.idle]: pose(FRAME.stand),
  [CLIP.look]: pose(FRAME.stand, FRAME.alert),
  [CLIP.move]: cycle(FRAME.walk, FRAME.walk + 1, FRAME.walk + 2, FRAME.walk + 3),
  [CLIP.feed]: pose(FRAME.stand, FRAME.aim, FRAME.strike),
  [CLIP.fly]: cycle(FRAME.flapUp, FRAME.flapDown),
  [CLIP.rest]: pose(FRAME.stand)
});

const createWaderModel = (shape: WaderShape, stride: number): CritterModel => ({
  clips: WADER_CLIPS,
  frames: createPoses(stride).map((values) => createWaderMesh(shape, values))
});

/** Shore gull: brisk steps. */
export const createGullModel = () => createWaderModel(SHORE_GULL, 1);
