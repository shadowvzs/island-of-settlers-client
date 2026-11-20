import { lerp3 } from "../../../shared/world/noise";
import type { Vec3 } from "../../props/mesh-builder";
import { speckle } from "./critter-builder";
import { CLIP, createClips, type CritterModel,pose } from "./critter-model";
import { createQuadrupedMesh } from "./quadruped-mesh";
import { createQuadrupedFrames, QUAD_CLIPS, QUAD_FRAME } from "./quadruped-models";
import { type Coat, QUAD_STAND, type QuadShape } from "./quadruped-shape";

const HEDGEHOG = {
  dark: [0.17, 0.13, 0.1] as Vec3,
  face: [0.52, 0.41, 0.3] as Vec3,
  nose: [0.05, 0.04, 0.04] as Vec3,
  tip: [0.82, 0.76, 0.63] as Vec3
};

/** Spines: dark brown banded with cream tips (fine speckle), a pale brown face and belly. */
const hedgehogCoat: Coat = (part, _along, up, _side, at) => {
  if (part === "eye" || part === "nose") return HEDGEHOG.nose;
  if (part !== "body" || up < -0.15) return HEDGEHOG.face;
  const spine = speckle(at[0] * 900, at[1] * 900, at[2] * 900);
  return lerp3(HEDGEHOG.dark, HEDGEHOG.tip, spine > 0.2 ? 0.75 : 0.1);
};

const HEDGEHOG_SHAPE: QuadShape = {
  body: [
    [-0.5, 0.6, 0.7, 0.1],
    [-0.3, 0.95, 1, 0.06],
    [0, 1.05, 1.05, 0.05],
    [0.25, 0.95, 0.95, 0.02],
    [0.45, 0.7, 0.78, -0.05],
    [0.52, 0.45, 0.5, -0.15]
  ],
  bodyHeight: 0.04,
  bodyLength: 0.13,
  bodyWidth: 0.046,
  coat: hedgehogCoat,
  earLength: 0.008,
  earLie: 0.3,
  earWidth: 0.007,
  headLength: 0.038,
  headRadius: 0.019,
  legLength: 0.014,
  legRadius: 0.006,
  neckAngle: -0.1,
  neckLength: 0.012,
  neckRadius: 0.022,
  snoutLength: 0.024,
  snoutRadius: 0.008,
  tailDroop: 1,
  tailLength: 0.01,
  tailRadius: 0.004
};

/** The quadruped frames plus rolled up: lying, the head tucked under the spines. */
const CURL = QUAD_FRAME.rest + 1;

const CLIPS = [...QUAD_CLIPS];
CLIPS[CLIP.rest] = createClips({ [CLIP.rest]: pose(QUAD_FRAME.stand, CURL) })[CLIP.rest];

/** Hedgehog: a small domed quadruped that snuffles about and rolls up when alarmed. */
export const createHedgehogModel = (): CritterModel => ({
  clips: CLIPS,
  frames: [
    ...createQuadrupedFrames(HEDGEHOG_SHAPE),
    createQuadrupedMesh(HEDGEHOG_SHAPE, { ...QUAD_STAND, reach: 1, rest: 1 })
  ]
});
