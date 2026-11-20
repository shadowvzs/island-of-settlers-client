import { CRITTER_GLB } from "./critter-glbs";
import type { CritterModel } from "./critter-model";
import { QUAD_CLIPS } from "./quadruped-models";
import { createSkinnedCritterModel } from "./skinned-critter";

/**
 * Grey wolf from the shipped model (assets/models/critters/wolf: derived from "Italian White
 * Wolf" by SDPM Esare, CC BY 4.0, rigged and posed by tools/assets/wolf-model.ts): stand,
 * looks, walk, trot, sniffing and lying in the quadruped frames (QUAD_FRAME order), its coat
 * baked into vertex colours; the winter coat is paler with a fuller ruff. Minimal draws about
 * half the triangles.
 */
export const createWolfModel = (minimal: boolean, winter: boolean): CritterModel =>
  createSkinnedCritterModel(CRITTER_GLB.wolf, QUAD_CLIPS, { minimal, winter });
