import type { BuildingPart, Point3 } from "./building-recipe";

/** Authoring box of a sculpted ornament; the renderer fits the sculpt into the part's unit box. */
export interface OrnamentBox { max: Point3; min: Point3 }

export type VikingOrnamentShape = Extract<BuildingPart["shape"],
  "thor-statue" | "dragon-head" | "bearded-axe-head" | "double-axe-head" | "round-shield" | "viking-helmet" |
  "antler" | "feather-wing" | "longship-relief" | "rune-plinth">;

/**
 * Shared by the recipe (part sizes) and the renderer (geometry fit), so the sculpts keep their
 * authored proportions on both detail levels. Local +Z faces outwards (or forwards), +Y up.
 */
export const VIKING_ORNAMENT_BOXES: Readonly<Record<VikingOrnamentShape, OrnamentBox>> = {
  "antler": { max: [.46, 1.06, .05], min: [-.07, -.05, -.05] },
  "bearded-axe-head": { max: [1.03, .32, .09], min: [-.16, -.76, -.09] },
  "double-axe-head": { max: [1, .56, .09], min: [-1, -.56, -.09] },
  /** Neck along +Y, snout towards +Z, carved board thickness along X. */
  "dragon-head": { max: [.11, 1.12, .84], min: [-.11, 0, -.14] },
  "feather-wing": { max: [1, .8, .045], min: [-.06, -.1, -.045] },
  "longship-relief": { max: [.56, .8, .08], min: [-.56, 0, 0] },
  "rune-plinth": { max: [.23, .33, .21], min: [-.23, 0, -.21] },
  "round-shield": { max: [.5, .5, .15], min: [-.5, -.5, -.03] },
  "thor-statue": { max: [.255, 1.42, .17], min: [-.29, -.005, -.25] },
  "viking-helmet": { max: [.54, .62, .58], min: [-.54, -.34, -.54] }
};

/** Part size of an ornament scaled uniformly (authoring units × scale). */
export const ornamentSize = (shape: VikingOrnamentShape, scale: number): Point3 => {
  const { max, min } = VIKING_ORNAMENT_BOXES[shape];
  return [(max[0] - min[0]) * scale, (max[1] - min[1]) * scale, (max[2] - min[2]) * scale];
};

/** Offset from a part's centre to an authoring point (e.g. a neck base or a statue's feet), scaled. */
export const ornamentOffset = (shape: VikingOrnamentShape, point: Point3, scale: number): Point3 => {
  const { max, min } = VIKING_ORNAMENT_BOXES[shape];
  return [0, 1, 2].map(axis => (point[axis]! - (max[axis]! + min[axis]!) / 2) * scale) as Point3;
};
