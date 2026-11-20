import type { BuildingPart } from "./building-recipe";
import { getOccupationRoofHeight } from "./occupation-roof-height";

export type MayaPlantRoofStyle = "maize" | "palm" | "reed";

/** Unit-plan ellipse of a round tower body that a rectangular thatch surface must not enter. */
export interface MayaRoofPlanCut {
  radiusX: number;
  radiusZ: number;
  x: number;
  z: number;
}

/** Local unit-plan test: the thick roof shell and its loose fibres stay outside a tower body. */
export const insideMayaRoofPlanCut = (cut: MayaRoofPlanCut, x: number, z: number) => {
  const dx = (x - cut.x) / cut.radiusX, dz = (z - cut.z) / cut.radiusZ;
  return dx * dx + dz * dz < 1 - 1e-9;
};
export const MAYA_PLANT_ROOF_SURFACES = {
  maize: "straw", palm: "palm-thatch", reed: "roof-thatch"
} as const;
export const MAYA_PLANT_ROOF_CORE_SCALE = .978;
export const MAYA_PLANT_ROOF_CORE_EDGE = .47;
export const MAYA_PLANT_ROOF_CORE_THICKNESS = .14;

/** Shared vertical transform for weather skin, wall infill and physical surface sampling. */
export const mayaPlantRoofProfileHeight = (part: BuildingPart, x: number, z: number) =>
  .06 + .86 * getOccupationRoofHeight(part.occupationRoof, x, z);

export const mayaRoofPlantStyle = (id: number): MayaPlantRoofStyle => {
  if ([17, 18, 20, 22, 57, 60, 61].includes(id)) return "palm";
  if ([3, 6, 8, 15, 21, 27, 33].includes(id)) return "reed";
  return "maize";
};

/** Canonical thick weather core; loose frayed leaf tips never carry props or alter contact rules. */
export const mayaPlantRoofCoreHeight = (part: BuildingPart, x: number, z: number): number | null => {
  const edge = MAYA_PLANT_ROOF_CORE_EDGE * MAYA_PLANT_ROOF_CORE_SCALE;
  if (Math.abs(x) > edge + 1e-8 || Math.abs(z) > edge + 1e-8) return null;
  return mayaPlantRoofProfileHeight(part,
    x / MAYA_PLANT_ROOF_CORE_SCALE, z / MAYA_PLANT_ROOF_CORE_SCALE);
};

export const MAYA_PLANT_ROOF_STYLES = {
  maize: { arc: .022, fieldHigh: 64, fieldMin: 6, fringeHigh: 128, fringeMin: 24,
    length: .055, lengthRange: .075, segments: 2, segmentsMin: 1, width: .005, widthRange: .009 },
  palm: { arc: .025, fieldHigh: 60, fieldMin: 12, fringeHigh: 80, fringeMin: 20,
    length: .13, lengthRange: .11, segments: 4, segmentsMin: 2, width: .017, widthRange: .014 },
  reed: { arc: .004, fieldHigh: 90, fieldMin: 6, fringeHigh: 144, fringeMin: 24,
    length: .045, lengthRange: .035, segments: 2, segmentsMin: 1, width: .002, widthRange: .003 }
} as const;
