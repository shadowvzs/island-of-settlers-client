import { CRITTER_GLB } from "./critter-glbs";
import { CLIP, createClips, type CritterModel, cycle, pose } from "./critter-model";
import { createSkinnedCritterModel } from "./skinned-critter";

/**
 * Harbour seal from the shipped model (assets/models/critters/seal: derived from "Dotted White
 * Seal - Free Giveaway" by Kugatsu Tsukai 3D Models Hub, CC BY 4.0, recoloured, rigged and
 * posed by tools/assets/seal-model.ts): grey with dark spots and a paler belly. Frames: lying,
 * head up (ahead, left, right), banana, the two crawl humps, swimming (lowered into the water
 * line); Minimal draws about half the triangles.
 */
const SEAL_FRAME = {
  lie: 0,
  headUp: 1,
  headLeft: 2,
  headRight: 3,
  banana: 4,
  crawlFront: 5,
  crawlRear: 6,
  swim: 7
} as const;

const CLIPS = createClips({
  [CLIP.idle]: pose(SEAL_FRAME.lie),
  [CLIP.look]: pose(SEAL_FRAME.headLeft, SEAL_FRAME.headUp, SEAL_FRAME.headRight),
  [CLIP.rest]: pose(SEAL_FRAME.lie, SEAL_FRAME.banana),
  [CLIP.move]: cycle(SEAL_FRAME.crawlFront, SEAL_FRAME.lie, SEAL_FRAME.crawlRear, SEAL_FRAME.lie),
  [CLIP.fast]: cycle(SEAL_FRAME.crawlFront, SEAL_FRAME.crawlRear),
  [CLIP.air]: pose(SEAL_FRAME.swim)
});

export const createSealModel = (minimal: boolean): CritterModel =>
  createSkinnedCritterModel(CRITTER_GLB.seal, CLIPS, { minimal, winter: false });
