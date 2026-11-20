import { CRITTER_GLB } from "./critter-glbs";
import type { CritterModel } from "./critter-model";
import { QUAD_CLIPS } from "./quadruped-models";
import { createSkinnedCritterModel } from "./skinned-critter";

/**
 * Brown bear from the shipped model (assets/models/critters/bear: derived from "Realistic
 * Animated Bear 3D Model" by WildMesh 3D, CC BY 4.0, built by tools/assets/bear-model.ts): its
 * idle, walk, trot, eating and lying clips baked into the quadruped frames (QUAD_FRAME order),
 * its coat baked into vertex colours. Bears keep the summer coat in winter (owner); Minimal
 * draws about half the triangles.
 */
export const createBearModel = (minimal: boolean): CritterModel =>
  createSkinnedCritterModel(CRITTER_GLB.bear, QUAD_CLIPS, { minimal, winter: false });
