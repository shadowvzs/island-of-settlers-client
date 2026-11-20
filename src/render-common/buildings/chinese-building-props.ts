import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import type { Add } from "./nation-kit-parts";

const FOOD_TRADES = new Set([5, 6, 18, 21, 23, 28, 32, 35, 37]);
const TEXTILE_TRADES = new Set([3, 8, 15, 57, 58, 59, 60, 61]);
const TIMBER_TRADES = new Set([17, 20, 33, 36, 39]);

/** A small supported service assembly occupies a verified free yard corner, never a stock or door lane. */
export const addChineseWorkProps = (add: Add, parts: readonly BuildingPart[], original: BuildingRecipe,
  definition: BuildingDefinition, limit: { extentX: number; extentZ: number }, detailed: boolean) => {
  if (definition.style === "tower" || definition.id === 31 || definition.id === 7) return;
  const radius = .18, doorX = original.door[0] + (original.doorDimensions?.width ?? .46) / 2;
  const walls = parts.filter(part => !part.stock && part.stage === 1 &&
    part.surface === "plaster" && part.size[1] > .4).map(part => getRomanPartBounds(part));
  if (!walls.length) return;
  const minX = Math.min(...walls.map(wall => wall.min[0])), maxX = Math.max(...walls.map(wall => wall.max[0]));
  const minZ = Math.min(...walls.map(wall => wall.min[2])), maxZ = Math.max(...walls.map(wall => wall.max[2]));
  const gap = radius + .055, centreX = (minX + maxX) / 2, centreZ = (minZ + maxZ) / 2;
  // Start beside the actual hall, not at the distant edge of a plot expanded by its stock bays.
  const candidates: Point3[] = [-1, 1].flatMap(side => [-.3, 0, .3].map(row =>
    [side < 0 ? minX - gap : maxX + gap, 0, centreZ + row * (maxZ - minZ)] as Point3));
  for (const share of [-.3, 0, .3]) candidates.push([centreX + share * (maxX - minX), 0, minZ - gap]);
  const safe = ([x, , z]: Point3) => {
    if (Math.abs(x) + radius > limit.extentX || Math.abs(z) + radius > limit.extentZ) return false;
    if (Math.abs(x - doorX) < .6 && z > original.door[2] - .12) return false;
    for (const anchor of [original.workerExit, original.workPoint, original.mechanism])
      if (Math.hypot(x - anchor[0], z - anchor[2]) < .48) return false;
    return parts.every(part => {
      const { max, min } = getRomanPartBounds(part);
      if (max[1] < .035 || min[1] > .6) return true;
      return x + radius < min[0] || x - radius > max[0] || z + radius < min[2] || z - radius > max[2];
    });
  };
  const at = candidates.find(safe);
  if (!at) return;
  const [x, , z] = at;
  const base = { stage: 4, compactGeometry: true };
  // Low plank stand, its feet and cargo remain one supported cluster on both detail levels.
  add({ ...base, position: [x, .16, z], shape: detailed ? "bevel-box" : "box",
    size: [.3, .035, .28], surface: "wood" });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add({ ...base,
    position: [x + sx * .12, .075, z + sz * .1], shape: "box", size: [.035, .15, .035], surface: "wood" });
  if (detailed) for (const side of [-1, 1]) add({ ...base,
    position: [x, .055, z + side * .1], shape: "box", size: [.26, .025, .025], surface: "wood" });
  if (FOOD_TRADES.has(definition.id)) {
    add({ ...base, position: [x - .065, .275, z], radialSegments: detailed ? 12 : 6,
      shape: "clay-jar", size: [.13, .2, .13], surface: "paint", tint: [.35, .48, .39] });
    add({ ...base, position: [x + .08, .215, z + .025], radialSegments: detailed ? 10 : 5,
      shape: "bowl", size: [.13, .075, .13], surface: "paint", tint: [.73, .65, .48] });
    return;
  }
  if (TEXTILE_TRADES.has(definition.id)) {
    add({ ...base, position: [x, .225, z], rotation: [0, 0, Math.PI / 2], shape: "linen-bolt",
      size: [.11, .25, .11], surface: "cloth", tint: [.7, .51, .24] });
    if (detailed) add({ ...base, position: [x + .025, .325, z], rotation: [0, 0, Math.PI / 2],
      shape: "linen-bolt", size: [.09, .22, .09], surface: "cloth", tint: [.33, .46, .5] });
    return;
  }
  if (TIMBER_TRADES.has(definition.id)) {
    for (let index = 0; index < (detailed ? 4 : 2); index++) add({ ...base,
      position: [x - .09 + index * .055, .205, z], rotation: [Math.PI / 2, 0, 0],
      radialSegments: detailed ? 7 : 4, shape: "cylinder", size: [.035, .24, .035],
      surface: "paint", tint: [.38, .43, .24] });
    return;
  }
  add({ ...base, position: [x, .265, z], radialSegments: detailed ? 12 : 5,
    shape: "clay-jar", size: [.18, .18, .18], surface: "paint", tint: [.35, .48, .39] });
};
