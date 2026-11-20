import type { OrnamentalLimb } from "../../../render-common/plants/ornamental-tree-graph";
import { createOrnamentalShootGeometry } from "./ornamental-shoot-geometry";
import { createOrnamentalWoodGeometry } from "./ornamental-wood-geometry";

/** Preserve curved structural bearings; subpixel terminal tubes stay in the botanical graph only. */
export const createMapleProductionWood = (limb: OrnamentalLimb, detailed: boolean, seed: number) => {
  if (limb.role === "twig") return undefined;
  if (limb.role === "branch" && limb.radius <= .035) return createOrnamentalShootGeometry(limb);
  let rings = 12, sides = detailed ? 10 : 8;
  if (limb.role === "root") { rings = detailed ? 4 : 3; sides = detailed ? 5 : 4; }
  if (limb.role === "branch") { rings = detailed ? 7 : 6; sides = detailed ? 7 : 6; }
  return createOrnamentalWoodGeometry(limb, detailed, seed, { rings, sides });
};
