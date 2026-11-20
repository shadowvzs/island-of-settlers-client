import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "./building-recipe-fit";
import type { NationBody, WallRun } from "./nation-kit-classify";
import { type Add, bodyCenter } from "./nation-kit-parts";

export interface MayaBuildingKit {
  add: Add;
  body: NationBody;
  centre: Point3;
  definition: BuildingDefinition;
  detailed: boolean;
  limit: { extentX: number; extentZ: number };
  original: BuildingRecipe;
  parts: BuildingPart[];
}

export const MAYA_STONE: Point3 = [.99, .96, .86];
export const MAYA_PLASTER: Point3 = [1, .98, .93];
export const MAYA_WOOD: Point3 = [.65, .48, .29];

export const MAYA_CIVIC_IDS = new Set([0, 1, 2, 4, 9, 14, 24, 29, 34, 40, 62]);

/** Every added structural member is authored inside the existing national building envelope. */
export const createMayaBuildingKit = (original: BuildingRecipe, definition: BuildingDefinition,
  body: NationBody, detailed: boolean, parts: BuildingPart[]): MayaBuildingKit => {
  const limit = getRomanRecipeBounds(definition, original);
  const add: Add = part => {
    const stone = ["plaster", "stone", "cut-stone"].includes(part.surface);
    const built: BuildingPart = { stage: 3, worldUv: stone ? 1 : undefined, ...part };
    const { max, min } = getRomanPartBounds(built);
    if (Math.max(Math.abs(min[0]), Math.abs(max[0])) > limit.extentX + .00001 ||
      Math.max(Math.abs(min[2]), Math.abs(max[2])) > limit.extentZ + .00001) return;
    parts.push(built);
  };
  return { add, body, centre: bodyCenter(body.walls), definition, detailed, limit, original, parts };
};

/** Frame coordinates shared by carved friezes, shutters and occupation-specific wall objects. */
export const mayaWallFace = (wall: WallRun, centre: Point3) => {
  const axis: 0 | 2 = wall.along === 0 ? 2 : 0;
  const sign = (wall.min[axis] + wall.max[axis]) / 2 >= centre[axis] ? 1 : -1;
  const face = sign > 0 ? wall.max[axis] : wall.min[axis];
  return { axis, face, sign };
};

/** A carved stone fret, made of connected relief members, never a painted mural. */
export const addMayaFret = (add: Add, position: Point3, width: number, height: number,
  depth: number, yaw = 0, detailed = true) => {
  const transformed = (x: number, y: number): Point3 => [position[0] + Math.cos(yaw) * x,
    position[1] + y, position[2] - Math.sin(yaw) * x];
  const member = (x: number, y: number, w: number, h: number) => add({
    position: transformed(x, y), rotation: yaw ? [0, yaw, 0] : undefined,
    shape: "bevel-box", size: [w, h, depth], stage: 4, surface: "cut-stone", tint: MAYA_STONE
  });
  member(0, -height * .4, width, height * .16);
  member(-width * .42, 0, width * .16, height * .9);
  member(-width * .03, height * .38, width * .84, height * .16);
  member(width * .3, height * .13, width * .16, height * .6);
  if (!detailed) return;
  member(width * .1, -height * .1, width * .52, height * .16);
  member(-width * .08, height * .02, width * .15, height * .25);
};

/** Resource-tier goods keep their mineral colours; Maya architectural stone stays warm and light. */
export const withMayaStonePalette = (recipe: BuildingRecipe): BuildingRecipe => ({
  ...recipe,
  parts: recipe.parts.map(part => {
    if (part.stock || !["plaster", "stone", "cut-stone"].includes(part.surface)) return part;
    return { ...part, tint: part.surface === "plaster" ? MAYA_PLASTER : MAYA_STONE };
  })
});
