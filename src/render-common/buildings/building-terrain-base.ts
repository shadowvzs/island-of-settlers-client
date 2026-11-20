import { DMath } from "../../shared/math/deterministic-math";
import { getBuildingDefinition } from "./building-catalog";
import { getRomanPartBounds } from "./building-recipe-fit";
import { getRomanBuildingWorldSizing } from "./building-world-sizing";

const bases = new Map<number, { minX: number; maxX: number; minZ: number; maxZ: number }>();

/** Ground beneath masonry only: roof overhangs, inventory bays and reserved yard add no dirt. */
export const getBuildingTerrainBase = (type: number, x: number, z: number, rotation: number) => {
  let base = bases.get(type);
  if (!base) {
    const { recipe, scale } = getRomanBuildingWorldSizing(getBuildingDefinition(type));
    const walls = recipe.parts.filter(part => !part.stock && part.stage === 1 &&
      ["stone", "lime", "brick"].includes(part.surface));
    if (!walls.length) return null;
    const bounds = walls.map(part => getRomanPartBounds(part));
    base = {
      minX: Math.min(...bounds.map(part => part.min[0])) * scale,
      maxX: Math.max(...bounds.map(part => part.max[0])) * scale,
      minZ: Math.min(...bounds.map(part => part.min[2])) * scale,
      maxZ: Math.max(...bounds.map(part => part.max[2])) * scale
    };
    bases.set(type, base);
  }
  const angle = rotation * Math.PI / 2;
  const cosine = Math.round(DMath.cos(angle)), sine = Math.round(DMath.sin(angle));
  const localX = (base.minX + base.maxX) / 2, localZ = (base.minZ + base.maxZ) / 2;
  const width = base.maxX - base.minX, depth = base.maxZ - base.minZ;
  return { x: x + localX * cosine + localZ * sine, z: z - localX * sine + localZ * cosine,
    width: rotation % 2 ? depth : width, depth: rotation % 2 ? width : depth };
};
