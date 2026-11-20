import { CRITTER_GLB } from "./critter-glbs";
import { CLIP, createClips, type CritterModel, cycle, pose } from "./critter-model";
import { createSkinnedCritterModel } from "./skinned-critter";

/** Frames: four flap phases, the glide, and the glide banked right / left (soaring circles). */
const FRAME = { flap: 0, glide: 4, bankRight: 5, bankLeft: 6 } as const;

const CLIPS = createClips({
  [CLIP.idle]: pose(FRAME.glide),
  [CLIP.fly]: cycle(FRAME.flap, FRAME.flap + 1, FRAME.flap + 2, FRAME.flap + 3),
  /** Pose 0 banked right, 0.5 level, 1 banked left. */
  [CLIP.air]: pose(FRAME.bankRight, FRAME.glide, FRAME.bankLeft)
});

/**
 * The golden eagle from the shipped model (assets/models/critters/eagle: derived from
 * "Animated Eagle" by Clement Abai, CC BY 4.0, recoloured by tools/assets/eagle-model.ts):
 * one deep wing beat, the soaring glide with its slight dihedral and the banked glides of its
 * circles over the peaks, the body at the origin. Minimal draws about half the triangles.
 */
export const createEagleModel = (minimal: boolean): CritterModel =>
  createSkinnedCritterModel(CRITTER_GLB.eagle, CLIPS, { minimal, winter: false });
