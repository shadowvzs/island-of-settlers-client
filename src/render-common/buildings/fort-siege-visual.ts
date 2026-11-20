import { FORT_COLLAPSE_DURATION, FORT_COLLAPSE_SECONDS } from "../../shared/balance/military";
import { FORT_REMOVAL_SECONDS, fortFlames, type MilitaryStructure } from "../../shared/settlement/fort-assault-rules";
import { clamp01 } from "../../shared/world/noise";
import type { BuildingFrame } from "./building-catalog";

/**
 * Timeline of a colony fort's fall (owner decision 2026-10-13): it burns on for 5 s, collapses,
 * and its charred ruin smoulders until the plot is cleared 10 s after the fall.
 */
/** When the collapse has finished. */
const COLLAPSED = FORT_COLLAPSE_SECONDS + FORT_COLLAPSE_DURATION;

/** Height scale of the fort model: 1 until the collapse, then sinking to a stump. */
export const fortCollapseScale = (fallenAge?: number) => fallenAge === undefined ? 1
  : Math.max(.03, 1 - Math.max(0, fallenAge - FORT_COLLAPSE_SECONDS) / FORT_COLLAPSE_DURATION);
/** The fort model is drawn until the collapse ends. */
export const isFortStanding = (fallenAge?: number) => fallenAge === undefined || fallenAge < COLLAPSED;
/** Opacity of the flames: full while it burns, dying out just after the collapse. */
export const fortFlameFade = (fallenAge?: number) => fallenAge === undefined ? 1
  : 1 - clamp01((fallenAge - COLLAPSED + .3) / 1.3);
/** Opacity of the charred ruin: it appears during the collapse and fades in the last second. */
export const fortRuinOpacity = (fallenAge?: number) => fallenAge === undefined ? 0
  : Math.min(clamp01((fallenAge - FORT_COLLAPSE_SECONDS - .3) / .6), clamp01(FORT_REMOVAL_SECONDS - fallenAge));
/** Whether the ruin smoulders (thin smoke and embers after the flames die). */
export const isFortSmouldering = (fallenAge?: number) => fallenAge !== undefined && fallenAge >= COLLAPSED;

/** The frame's view of a fort's walls: health, milestone flames and seconds since the fall. */
export const fortSiegeFrame = (structure?: MilitaryStructure, immediateCollapse = false): BuildingFrame["fortSiege"] => {
  if (!structure) return undefined;
  const view = { flames: fortFlames(structure), health: structure.hp / structure.maximum };
  return structure.fallen === undefined ? view : {
    ...view, fallenAge: structure.fallen + (immediateCollapse ? FORT_COLLAPSE_SECONDS : 0)
  };
};
