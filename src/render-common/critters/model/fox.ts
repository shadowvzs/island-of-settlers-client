import { CRITTER_GLB } from "./critter-glbs";
import type { CritterModel } from "./critter-model";
import { QUAD_CLIPS } from "./quadruped-models";
import { createSkinnedCritterModel } from "./skinned-critter";

/**
 * Red fox from the shipped model (assets/models/critters/fox: derived from "Fox-rigged" by
 * freddy1231, CC BY 4.0, built by tools/assets/fox-model.ts): its walk and run strides,
 * standing, sniffing and sitting baked into the quadruped frames (QUAD_FRAME order), its coat
 * baked into vertex colours, the deeper winter rust; Minimal draws about half the triangles.
 */
export const createFoxModel = (minimal: boolean, winter: boolean): CritterModel =>
  createSkinnedCritterModel(CRITTER_GLB.fox, QUAD_CLIPS, { minimal, winter });
