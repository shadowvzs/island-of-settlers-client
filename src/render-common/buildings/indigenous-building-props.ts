import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { type Add, runBetween } from "./nation-kit-parts";

interface Bounds { min: Point3; max: Point3 }
const intersects = (a: Bounds, b: Bounds) => [0, 1, 2].every(axis =>
  a.min[axis]! < b.max[axis]! + .035 && a.max[axis]! > b.min[axis]! - .035);

/** Woven cargo basket with a real mouth, wall weave bands and binding at its rim. */
const basket = (add: Add, x: number, z: number, detailed: boolean) => {
  add({ position: [x, .13, z], radialSegments: detailed ? 14 : 7, shape: "cylinder",
    size: [.23, .24, .23], stage: 4, surface: "straw", topScale: [1.12, 1, 1.12] });
  add({ position: [x, .255, z], radialSegments: detailed ? 16 : 8, shape: "ring",
    size: [.265, .035, .265], stage: 4, surface: "rope" });
  add({ position: [x, .245, z], radialSegments: detailed ? 12 : 6, shape: "cylinder",
    size: [.205, .007, .205], stage: 4, surface: "dark" });
  if (!detailed) return;
  for (let index = 0; index < 4; index++) add({ position: [x, .055 + index * .045, z],
    radialSegments: 16, shape: "ring", size: [.235 + index * .005, .014, .235 + index * .005],
    stage: 4, surface: "rope" });
};

/** Low hide bundles and baskets fit spare ground; they never occupy a stock or worker approach. */
export const addIndigenousWorkProps = (add: Add, parts: readonly BuildingPart[], recipe: BuildingRecipe,
  definition: BuildingDefinition, limit: { extentX: number; extentZ: number }, detailed: boolean) => {
  const doorX = recipe.door[0] + (recipe.doorDimensions?.width ?? .46) / 2;
  // A spare basket belongs beside its shelter, not at an arbitrary distant plot corner.
  // Use the real grounded wall/skin, keeping the complete basket just outside its bearing.
  const shelters = parts.filter(part => !part.stock &&
    (part.shape === "indigenous-roof" && part.indigenousEntrance ||
      part.shape === "cloth-panel" && part.position[1] - part.size[1] / 2 < .06));
  const candidates: Point3[] = shelters.flatMap(part => {
    const bounds = getRomanPartBounds(part), [x, , z] = part.position;
    return [.19, .25, .31].flatMap(out => [-.25, 0, .25].flatMap(along => [
      [bounds.min[0] - out, 0, z + part.size[2] * along],
      [bounds.max[0] + out, 0, z + part.size[2] * along],
      [x + part.size[0] * along, 0, bounds.min[2] - out],
      [x + part.size[0] * along, 0, bounds.max[2] + out]
    ] as Point3[]));
  });
  const freeSpot = ([x, , z]: Point3) => {
    if (Math.abs(x) + .15 > limit.extentX || Math.abs(z) + .15 > limit.extentZ) return false;
    if (Math.abs(x - doorX) < .65 && z > recipe.door[2] - .3) return false;
    if ([recipe.workerExit, recipe.workPoint].some(point => Math.hypot(x - point[0], z - point[2]) < .46)) return false;
    const bounds: Bounds = { min: [x - .15, .025, z - .15], max: [x + .15, .3, z + .15] };
    const blocked = parts.some(part => {
      const other = getRomanPartBounds(part);
      if (other.max[1] < .025) return false;
      if (part.shape === "indigenous-roof" && part.indigenousEntrance) {
        const u = (x - part.position[0]) / part.size[0], v = (z - part.position[2]) / part.size[2];
        // Outside a circular tent's skirt, the empty corner is usable ground.
        if (part.indigenousRoof === "tipi" && Math.hypot(u * 2, v * 2) > 1.2) return false;
      }
      return intersects(bounds, other);
    });
    return !blocked;
  };

  // Keep the original decoration allowance: relocation must not populate previously bare plots.
  const formerCorners: Point3[] = [
    [-limit.extentX + .18, 0, limit.extentZ - .2], [limit.extentX - .18, 0, limit.extentZ - .2],
    [-limit.extentX + .18, 0, -limit.extentZ + .2], [limit.extentX - .18, 0, -limit.extentZ + .2]
  ];
  const allowance = Math.min(detailed ? 2 : 1, formerCorners.filter(freeSpot).length);
  if (!allowance) return;
  let count = 0;
  for (const point of candidates) {
    if (!freeSpot(point)) continue;
    const [x, , z] = point;
    basket(part => add({ ...part, workyardAssembly: "indigenous-spare-basket" }), x, z, detailed);
    if (detailed && [3, 8, 15, 22, 61].includes(definition.id)) {
      runBetween(add, [x - .08, .28, z], [x + .08, .28, z], [.11, .08],
        { stage: 4, surface: "hide" });
    }
    if (++count >= allowance) break;
  }
};
