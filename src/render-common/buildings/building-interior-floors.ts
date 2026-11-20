import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";

const BAMBOO_FORESTERS = new Set([20, 41, 45, 49, 53]);

/** Existing authored room slabs, not stock, productive benches, porch furniture or foundations. */
export const isAuthoredInteriorFloor = (part: BuildingPart) => {
  if (part.stock || part.workyardAssembly || part.rotation) return false;
  if (part.interiorFloorFaces === "top") return true;
  return part.shape === "box" && part.stage === 0 && part.size[1] <= .04 &&
    Math.min(part.size[0], part.size[2]) > .4;
};

export interface BuildingInteriorFloorSite {
  part: BuildingPart;
  partIndex: number;
  /** Actual top bearing; no decorative support offset is invented. */
  position: Point3;
  /** Horizontal top-face envelope in recipe units; an ellipse is inscribed in this rectangle. */
  size: [number, number];
  profile: "rectangle" | "ellipse";
}

/** Shared sites for floor finishes and supported rugs; terrain-backed shelters remain their own geometry owner. */
export const getBuildingInteriorFloorSites = (recipe: BuildingRecipe, typeId: number): BuildingInteriorFloorSite[] =>
  recipe.parts.flatMap((part, partIndex) => {
    const bambooRoom = BAMBOO_FORESTERS.has(typeId) && part.shape === "box" && !part.stock &&
      !part.workyardAssembly && part.surface === "planks" && part.stage === 1 &&
      Math.abs(part.position[1] - .012) < .00001 && part.size[1] <= .04 &&
      Math.min(part.size[0], part.size[2]) > .4;
    if (!isAuthoredInteriorFloor(part) && !bambooRoom) return [];
    return [{ part, partIndex, position: [part.position[0] + (part.topOffset?.[0] ?? 0),
      part.position[1] + part.size[1] / 2, part.position[2] + (part.topOffset?.[2] ?? 0)] as Point3,
    profile: part.shape === "cylinder" ? "ellipse" as const : "rectangle" as const,
    size: [part.size[0] * (part.topScale?.[0] ?? 1), part.size[2] * (part.topScale?.[2] ?? 1)] as [number, number] }];
  });
