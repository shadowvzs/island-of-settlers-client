import type { BuildingPart, BuildingRecipe } from "./building-recipe";

/** Six fitted cedar boards per recipe metre, shared with the national plank material. */
export const JAPANESE_FLOOR_TILES_PER_UNIT = 1;

/** Authored room slabs only: foundations, work benches, stock and roof/deck parts stay distinct. */
export const isJapaneseInteriorFloor = (part: BuildingPart) => {
  if (part.stock || part.workyardAssembly || part.rotation || part.shape !== "box") return false;
  if (part.size[1] > .04 || Math.min(part.size[0], part.size[2]) <= .4) return false;
  if (part.surface === "mosaic" && part.stage === 0) return true;
  if (part.surface !== "planks") return false;
  if (part.stage === 0) return true;
  // The bamboo cottage and the Commander's covered side room author their room slab at stage1.
  return part.stage === 1 && Math.abs(part.position[1] - .012) < .00001;
};

/** Actual enclosed lower-storey bases, not courtyard paving or the open working deck above. */
const isRoomBearingFoundation = (part: BuildingPart, typeId: number) => {
  if (part.interiorFloorFaces) return false;
  if (part.shape !== "box" || part.surface !== "stone" || part.stock || part.rotation) return false;
  if (Math.abs(part.size[1] - .12) > .00001 || Math.abs(part.position[1] - .06) > .00001) return false;
  if ([4, 9].includes(typeId)) return Boolean(part.topScale);
  return typeId === 16 && part.stage === 2 && part.size[0] === 1.05 && part.size[2] === 1.05;
};

/** Apply after every Japanese early-return design, including the Lodge and bamboo Forester. */
export const withJapaneseInteriorFloors = (recipe: BuildingRecipe, typeId: number): BuildingRecipe => ({
  ...recipe,
  parts: recipe.parts.flatMap(part => {
    if (isRoomBearingFoundation(part, typeId)) return [
      { ...part, interiorFloorFaces: "sides" as const },
      { ...part, interiorFloorFaces: "top" as const, surface: "planks" as const,
        worldUv: JAPANESE_FLOOR_TILES_PER_UNIT }
    ];
    return isJapaneseInteriorFloor(part)
      ? [{ ...part, surface: "planks" as const, worldUv: JAPANESE_FLOOR_TILES_PER_UNIT }]
      : [part];
  })
});
