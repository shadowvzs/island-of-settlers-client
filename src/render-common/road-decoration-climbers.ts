import { getRoadDecoration, type RoadClimberKind } from "../shared/settlement/road-decoration-catalog";
import type { ClimberOpening, Colour } from "./climbers/climber-botany";
import { addClimbingRose, ROSE_PETAL_PALETTES } from "./climbers/climbing-rose-recipe";
import { addIvy } from "./climbers/ivy-lattice-recipe";
import { roadDecorationAdder, type RoadDecorationPart } from "./road-decoration-recipe";
import { createWisteriaHeroFrame } from "./wisteria-hero-frame";

/**
 * Per-instance ceilings after the textured-card rebuild (owner O1, cards D05a/D05b): leaves,
 * buds and Minimal blooms are atlas cards, High blooms small cupped petal meshes.
 */
export const CLIMBER_TRIANGLE_BUDGET = Object.freeze({
  "climbing-rose-white": Object.freeze({ high: 9000, minimal: 2600 }),
  "climbing-rose-red": Object.freeze({ high: 9000, minimal: 2600 }),
  "ivy-lattice": Object.freeze({ high: 8000, minimal: 3000 })
} as const);
/** Weathered oak #8A7A64, converted from sRGB to linear for the vertex tint. */
const WOOD: Colour = [.254, .194, .127];
const FOOTING: Colour = [.49, .47, .40], IRON: Colour = [.22, .21, .19], ROOT: Colour = [.29, .29, .13];

const climberOpening = (kind: RoadClimberKind): ClimberOpening => {
  const opening = getRoadDecoration(kind)?.opening;
  if (!opening) throw new Error(`Climber decoration has no traffic opening: ${kind}`);
  return { halfWidth: opening.width / 2, height: opening.height };
};

const addRoseFrameRails = (parts: RoadDecorationPart[], detailed: boolean) => {
  const add = roadDecorationAdder(parts);
  for (const side of [-1, 1]) {
    for (const y of [1.05, 1.72, 2.38])
      add({ shape: "bevel-box", position: [side * 1.0, y, 0], size: [.044, .044, .55], surface: "wood", tint: WOOD });
    // Real foot plates keep the frame visibly seated on the verge, outside the clear passage.
    add({ shape: "bevel-box", position: [side * 1.04, .028, .02], size: [.20, .045, .26], surface: "stone",
      tint: FOOTING });
    if (detailed) for (const y of [1.05, 1.72, 2.38]) for (const z of [-.24, .24])
      add({ shape: "cylinder", position: [side * 1.02, y, z], size: [.024, .018, .024],
        radialSegments: 6, surface: "iron", tint: IRON });
  }
  if (detailed) for (const side of [-1, 1]) for (const z of [-.24, .24])
    add({ shape: "box", position: [side * 1.01, 1.70, z], size: [.022, .66, .022],
      rotation: [0, 0, side * .55], surface: "wood", tint: WOOD });
};

const addIvyFooting = (parts: RoadDecorationPart[], detailed: boolean) => {
  const add = roadDecorationAdder(parts);
  for (const side of [-1, 1]) {
    // Woody root crown of the old ivy plant at the post foot.
    add({ shape: "cylinder", position: [side * 1.12, .02, .05], size: [.10, .04, .10], topScale: [.7, 1, .7],
      radialSegments: detailed ? 7 : 5, surface: "bark", tint: ROOT });
    add({ shape: "bevel-box", position: [side * 1.04, .028, .02], size: [.20, .045, .26], surface: "stone",
      tint: FOOTING });
    if (detailed) for (const y of [.55, 1.2, 1.85, 2.5]) add({ shape: "cylinder", position: [side * 1.045, y, .29],
      size: [.018, .016, .018], radialSegments: 6, surface: "iron", tint: IRON });
  }
};

/** One recipe per form; rose colour is a vertex tint, never a duplicated flower geometry. */
export const createClimberRoadRecipe = (kind: RoadClimberKind, detailed: boolean): RoadDecorationPart[] => {
  const opening = climberOpening(kind);
  if (kind === "ivy-lattice") {
    const parts = createWisteriaHeroFrame("lattice", !detailed);
    addIvyFooting(parts, detailed);
    addIvy(parts, detailed, opening);
    return parts;
  }
  const parts = createWisteriaHeroFrame("curved", !detailed);
  addRoseFrameRails(parts, detailed);
  addClimbingRose(parts, detailed, ROSE_PETAL_PALETTES[kind === "climbing-rose-red" ? "red" : "white"], opening);
  return parts;
};
