import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import type { IndigenousBuildingMotif, IndigenousPigmentRegion } from "./indigenous-building-motifs";

const frontRegion = (skin: BuildingPart, x: number, y: number, width: number,
  height: number): IndigenousPigmentRegion => [
  .5 + (x - skin.position[0]) / skin.size[0],
  .5 - (y - skin.position[1]) / skin.size[1], width / skin.size[0] / 2, height / skin.size[1] / 2
];

/** Paint follows the original wall; changing a picture never changes the lodge or its doorway. */
export const indigenousFrontPainting = (recipe: BuildingRecipe, skin: BuildingPart, typeId: number,
  motif: IndigenousBuildingMotif): BuildingPart | undefined => {
  const right = recipe.door[0] + (recipe.doorDimensions?.width ?? .46);
  let x: number, y: number, width: number, height: number;
  if (typeId === 4) {
    x = recipe.door[0] + (recipe.doorDimensions?.width ?? .46) / 2;
    y = (recipe.doorDimensions?.height ?? .77) + .53;
    width = .59; height = .63;
  } else if ([10, 11, 12, 13].includes(typeId)) {
    x = Math.min(skin.position[0] + skin.size[0] * .29, right + .43);
    y = skin.position[1] * .94; width = .32; height = .32;
  } else if ([19, 43, 47, 51, 55].includes(typeId)) {
    x = right + .25;
    y = skin.position[1] * .52; width = .20; height = .24;
  } else if (typeId === 21) {
    x = right + .37; y = skin.position[1]; width = .46; height = .46;
  } else if (typeId === 22) {
    x = recipe.door[0] + (recipe.doorDimensions?.width ?? .46) / 2;
    y = (recipe.doorDimensions?.height ?? .77) + .30;
    width = .34; height = .20;
  } else if (typeId === 40) {
    x = skin.position[0]; y = skin.position[1] + skin.size[1] * .36;
    width = .48; height = .20;
  } else return undefined;
  return { ...skin, architecture: true, indigenousPigment: motif, indigenousPigmentProjection: "front",
    indigenousPigmentRegion: frontRegion(skin, x, y, width, height), shape: "indigenous-pigment",
    surface: "paint", tint: [1, 1, 1], worldUv: undefined };
};

/** The drink house's existing front reed bay has a clear space between its real horizontal rails. */
export const indigenousDrinkPainting = (recipe: BuildingRecipe): BuildingPart | undefined => {
  const panels = recipe.parts.filter(part => part.shape === "bevel-box" && part.surface === "cloth-reeds" &&
    part.size[2] < .04 && part.size[0] > .3 && part.position[2] > recipe.door[2] - .1);
  const right = recipe.door[0] + (recipe.doorDimensions?.width ?? .46);
  const panel = panels.filter(part => part.position[0] > right)
    .sort((first, second) => first.position[0] - second.position[0])[0];
  if (!panel) return undefined;
  const width = Math.min(.25, panel.size[0] - .22), height = Math.min(.29, panel.size[1] * .27);
  return { architecture: true, compactGeometry: true, indigenousPigment: "berry-drink",
    indigenousPigmentFlat: true, indigenousPigmentProjection: "front",
    indigenousPigmentRegion: [.5, .5, .5, .5], position: [panel.position[0] + .045,
      panel.position[1] + panel.size[1] * .20, panel.position[2] + panel.size[2] / 2],
    shape: "indigenous-pigment", size: [width, height, .002], stage: panel.stage,
    surface: "paint", tint: [1, 1, 1] };
};
