import type { BuildingPart } from "./building-recipe";
import { catapultRoofHeight } from "./catapult-dimensions";
import { CATAPULT_ENGINE_ORIGIN, CATAPULT_HATCH } from "./catapult-mechanism";

/** Original fixed square deck, a real hatch opening and a compact launcher-only bearing. */
export const addCatapultPlatform = (parts: BuildingPart[], detailed: boolean) => {
  const [hx, , hz] = CATAPULT_HATCH.position;
  parts.push({ position: [0, catapultRoofHeight(1.69), 0], shape: "catapult-deck", size: [1.65, .16, 1.65],
    stage: 2, surface: "planks", worldUv: 1.8 });
  parts.push({ catapultPart: "hatch", position: [hx, catapultRoofHeight(1.7575), hz], shape: "box",
    size: [CATAPULT_HATCH.size - .004, .025, CATAPULT_HATCH.size - .004], stage: 2, surface: "planks", worldUv: 1.8 });
  // Narrow dark frame and outside hinges keep the functional hatch readable without reducing its opening.
  for (const sign of [-1, 1]) {
    parts.push({ position: [hx + sign * (CATAPULT_HATCH.size / 2 + .006), catapultRoofHeight(1.767), hz], shape: "box", size: [.012, .008, CATAPULT_HATCH.size + .024], stage: 2, surface: "dark" });
    parts.push({ position: [hx, catapultRoofHeight(1.767), hz + sign * (CATAPULT_HATCH.size / 2 + .006)], shape: "box", size: [CATAPULT_HATCH.size, .008, .012], stage: 2, surface: "dark" });
    parts.push({ catapultPart: "hatch", position: [hx - .205, catapultRoofHeight(1.7435), hz + sign * .10],
      shape: "box", size: [.065, .008, .035], stage: 2, surface: "iron" });
    parts.push({ position: [CATAPULT_HATCH.hinge[0], catapultRoofHeight(1.786), hz + sign * .10], shape: "cylinder",
      rotation: [Math.PI / 2, 0, 0], radialSegments:detailed?12:3, size: [.025, .06, .025], stage: 2, surface: "iron" });
  }
  parts.push({ catapultPart: "frame", position: [CATAPULT_ENGINE_ORIGIN[0], catapultRoofHeight(1.78), CATAPULT_ENGINE_ORIGIN[2]],
    shape: "cylinder", radialSegments: detailed ? 40 : 8, size: [.744, .02, .744], stage: 2, surface: "wood", worldUv: 1.8 });
  parts.push({ position: [CATAPULT_ENGINE_ORIGIN[0], catapultRoofHeight(1.785), CATAPULT_ENGINE_ORIGIN[2]],
    shape: "ring", innerRadius: .46, radialSegments: detailed ? 32 : 12, size: [.76, .014, .76], stage: 2, surface: "iron" });
};
