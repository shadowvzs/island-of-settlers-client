import type { WorkerNation } from "../workers/worker-nation";
import { getBuildingInteriorFloorSites, isAuthoredInteriorFloor } from "./building-interior-floors";
import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { withIndigenousFloorHides } from "./indigenous-floor-hides";
import { withJapaneseInteriorFloors } from "./japanese-interior-floors";
import { PERSIAN_ROOM_INNER_RADIUS } from "./persian-room-dimensions";

const isGrounded = (part: BuildingPart) => Math.abs(part.position[1] - part.size[1] / 2) < .00001;

/** Grounded hollow bodies prove their own floor outline; flat paint collars and roof caps do not. */
const withMissingPersianRoomFloors = (recipe: BuildingRecipe, typeId: number, detailed: boolean) => {
  const sites = getBuildingInteriorFloorSites(recipe, typeId), added: BuildingPart[] = [];
  for (const room of recipe.parts) {
    if (room.shape !== "persian-room" || room.stock || room.rotation || room.occupationRoof ||
      room.size[1] < .4 || !isGrounded(room)) continue;
    const inside = (x: number, z: number) => ((x - room.position[0]) / (room.size[0] * PERSIAN_ROOM_INNER_RADIUS)) ** 2 +
      ((z - room.position[2]) / (room.size[2] * PERSIAN_ROOM_INNER_RADIUS)) ** 2 <= 1;
    if (sites.some(site => inside(site.position[0], site.position[2]))) continue;
    const radiusX = room.size[0] * PERSIAN_ROOM_INNER_RADIUS, radiusZ = room.size[2] * PERSIAN_ROOM_INNER_RADIUS;
    const supportedSlab = recipe.parts.some(part => !part.stock && !part.rotation &&
      ["box", "bevel-box"].includes(part.shape) && ["stone", "cut-stone", "plaster"].includes(part.surface) &&
      part.size[1] <= .16 && part.position[1] + part.size[1] / 2 >= 0 &&
      part.position[1] + part.size[1] / 2 <= .2 &&
      Math.abs(part.position[0] - room.position[0]) + radiusX <= part.size[0] / 2 &&
      Math.abs(part.position[2] - room.position[2]) + radiusZ <= part.size[2] / 2);
    if (supportedSlab) continue;
    added.push({ shape: "cylinder", interiorFloorFaces: "top", surface: "cut-stone", stage: 0,
      position: [room.position[0], .012, room.position[2]], size: [radiusX * 2, .024, radiusZ * 2],
      radialSegments: detailed ? 32 : 16, worldUv: 1, tint: [.79, .73, .62] });
  }
  return added.length ? { ...recipe, parts: [...recipe.parts, ...added] } : recipe;
};

/** Finish only footings supporting an actual hollow Yagura body or the enclosed Catapult room. */
const withChineseTowerFloors = (recipe: BuildingRecipe, typeId: number) => ({ ...recipe,
  parts: recipe.parts.flatMap(part => {
    if (part.shape !== "box" || part.stock || part.rotation || part.interiorFloorFaces ||
      !["stone", "plaster", "cut-stone"].includes(part.surface) || !isGrounded(part)) return [part];
    const top = part.position[1] + part.size[1] / 2;
    const catapultRoom = typeId === 16 && part.surface === "stone" && part.stage === 2 &&
      Math.abs(part.size[1] - .12) < .00001 && part.size[0] === 1.05 && part.size[2] === 1.05 &&
      recipe.parts.some(room => room.shape === "catapult-national-shell" && room.catapultShellNation === "chinese");
    const body = part.topScale && recipe.parts.find(room => room.shape === "yagura-wall" &&
      Math.abs(room.position[1] - room.size[1] / 2 - top) < .00001 &&
      Math.abs(room.position[0] - part.position[0]) < .01 &&
      Math.abs(room.position[2] - part.position[2] - (part.topOffset?.[2] ?? 0)) < .01);
    if (!body && !catapultRoom) return [part];
    return [{ ...part, interiorFloorFaces: "sides" as const },
      { ...part, interiorFloorFaces: "top" as const, surface: "planks" as const, tint: undefined, worldUv: 1 }];
  })
});

/** Repair only verified national-floor gaps; existing appropriate palettes and outdoor structures remain. */
export const withNationalInteriorFloors = (
  recipe: BuildingRecipe, nation: WorkerNation, typeId: number, detailed: boolean
): BuildingRecipe => {
  if (nation === "japanese") return withJapaneseInteriorFloors(recipe, typeId);
  if (nation === "indigenous") return withIndigenousFloorHides(recipe, typeId);
  if (nation === "chinese") return withChineseTowerFloors(recipe, typeId);
  const finished = { ...recipe, parts: recipe.parts.map(part => {
    if (!isAuthoredInteriorFloor(part)) return part;
    if (typeId === 62 && part.surface === "mosaic" && ["viking", "nubian"].includes(nation))
      return { ...part, surface: nation === "viking" ? "planks" as const : "stone" as const, worldUv: 1 };
    if (nation === "maya") return { ...part, mayaMasonryUv: undefined, worldUv: 1 };
    return part;
  }) };
  return nation === "persian" ? withMissingPersianRoomFloors(finished, typeId, detailed) : finished;
};
