import type { RoadDecorationDefinition } from "../shared/settlement/road-decoration-catalog";
import { MAYA_STONE } from "./buildings/maya-building-kit";
import { addMayaCarvedMotif } from "./buildings/maya-carved-motifs";
import { roadDecorationAdder, type RoadDecorationPart, roadProfileBeam } from "./road-decoration-recipe";

/** Genuine corbelled vault or sloped lintel variant, with supported blocks and relief fascia. */
export const mayaRoadPortalParts = (definition: RoadDecorationDefinition, detailed: boolean): RoadDecorationPart[] => {
  const parts: RoadDecorationPart[] = [], add = roadDecorationAdder(parts), opening = definition.opening!;
  const pier = opening.width / 2 + .28, spring = opening.height + .08;
  const rows = detailed ? 8 : 4;
  for (const side of [-1, 1]) {
    add({ shape: "box", position: [side * pier, (spring + .16) / 2, 0], size: [.37, spring - .16, .495],
      surface: "plaster", tint: [.70, .68, .61] });
    add({ shape: "bevel-box", position: [side * pier, .08, 0], size: [.48, .16, .65],
      surface: "cut-stone", tint: MAYA_STONE });
    for (let row = 0; row < rows; row++) {
      const height = (spring - .16) / rows;
      add({ shape: "bevel-box", position: [side * pier, .16 + height * (row + .5), 0],
        size: [.39, height - .005, .52], surface: "cut-stone", tint: MAYA_STONE });
    }
    // The same carved limestone vocabulary and palette as the nation's buildings.
    for (const face of [-1, 1]) for (const y of [spring * .35, spring * .69])
      addMayaCarvedMotif(add, y < spring * .5 ? "water" : "maize",
        [side * pier, y, face * .276], .24, .32, .03, face > 0 ? 0 : Math.PI, detailed);
  }
  if (definition.variant === 0) {
    const steps = 6, rise = .95;
    for (let index = 0; index < steps; index++) for (const side of [-1, 1]) {
      const inner = opening.width / 2 * (1 - index / steps);
      const width = .38 + opening.width / 2 / steps;
      add({ shape: "box", position: [side * (inner + .19 - opening.width / 2 / steps / 2),
        spring + rise / steps * (index + .5), 0], size: [width - .014, rise / steps, .525],
        surface: "plaster", tint: [.70, .68, .61] });
      add({ shape: "bevel-box", position: [side * (inner + .19 - opening.width / 2 / steps / 2),
        spring + rise / steps * (index + .5), 0], size: [width, rise / steps - .003, .55],
        surface: "cut-stone", tint: MAYA_STONE });
    }
    add({ shape: "bevel-box", position: [0, spring + rise + .075, 0], size: [.74, .15, .64],
      surface: "cut-stone", tint: MAYA_STONE });
  } else {
    const top = spring + .95;
    for (const side of [-1, 1]) {
      roadProfileBeam(add, [side * pier, spring + .065, 0], [0, top, 0],
        .22, .56, "cut-stone", MAYA_STONE);
      roadProfileBeam(add, [side * (pier + .015), spring + .18, 0], [0, top + .14, 0],
        .12, .66, "cut-stone", MAYA_STONE);
    }
    add({ shape: "bevel-box", position: [0, top + .18, 0], size: [.24, .30, .68],
      surface: "cut-stone", tint: MAYA_STONE });
    for (const side of [-1, 1]) addMayaCarvedMotif(add, "maize", [0, top + .18, side * .35], .19, .22, .022,
      side > 0 ? 0 : Math.PI, detailed);
  }
  return parts;
};
