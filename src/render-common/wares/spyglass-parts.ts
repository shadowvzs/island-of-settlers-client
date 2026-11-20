import type { BuildingPart, Point3 } from "../buildings/building-recipe";
import { srgbToLinear } from "../color";

/** Carried tool pose stays proportional to the worker; stock and icon retain authored size. */
export const SPYGLASS_TOOL_SCALE = .6;
export const SPYGLASS_EYE_LENS_Y = -.49;

const BRASS = srgbToLinear(.77, .58, .25);
const GRIP = srgbToLinear(.1, .12, .13);
const GLASS = srgbToLinear(.07, .25, .29);

/** An original draw-tube telescope: broad objective, dark grip, nested brass tubes and small eyecup.
 * Y is the optical axis; the grip surrounds the worker-contact origin. Shared by world and icon.
 */
export const spyglassParts = (detailed: boolean): BuildingPart[] => {
  const parts: BuildingPart[] = [];
  const cylinder = (y: number, diameter: number, length: number,
    surface: BuildingPart["surface"], tint: Point3, shape: BuildingPart["shape"] = "cylinder") => {
    parts.push({ position: [0, y, 0], shape, size: [diameter, length, diameter], stage: 3, surface, tint });
  };
  cylinder(.095, .13, .26, "gold", BRASS);
  cylinder(.065, .134, .14, "paint", GRIP);
  cylinder(-.15, .095, .26, "gold", BRASS);
  cylinder(-.36, .066, .2, "gold", BRASS);
  cylinder(-.47, .078, .035, "paint", GRIP);
  cylinder(SPYGLASS_EYE_LENS_Y, .052, .004, "steel", GLASS);
  // The objective glass sits inside its hollow brass bezel, rather than sealing a solid cap.
  cylinder(.228, .145, .035, "gold", BRASS, "ring");
  cylinder(.24, .114, .006, "steel", GLASS);
  for (const [y, diameter, length] of [[-.285, .108, .018], [-.025, .145, .02], [.16, .145, .023]] as const)
    cylinder(y, diameter, length, "gold", BRASS);
  if (detailed) for (const y of [.176, .191, .206]) cylinder(y, .134, .004, "gold", BRASS, "ring");
  return parts;
};
