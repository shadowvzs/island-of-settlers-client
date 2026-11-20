import { CRITTER_GLB } from "./critter-glbs";
import type { CritterModel } from "./critter-model";
import { createSkinnedCritterModel } from "./skinned-critter";
import { WADER_CLIPS } from "./wader-models";

/**
 * Grey heron from the shipped model (assets/models/critters/heron: derived from "Great blue
 * heron" by faerbogdan99, CC BY 4.0, recoloured, rigged and posed by
 * tools/assets/heron-model.ts): stand, alert, a slow stalking walk, aim and strike, and the two
 * flight frames with the wings spread (wader-models.ts frame order). Minimal draws about half
 * the triangles.
 */
export const createHeronModel = (minimal: boolean): CritterModel =>
  createSkinnedCritterModel(CRITTER_GLB.heron, WADER_CLIPS, { minimal, winter: false });
