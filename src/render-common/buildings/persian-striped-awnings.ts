import { BuildingType } from "../../shared/settlement/building-type-ids";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "./building-recipe-fit";
import { type Add, runBetween } from "./nation-kit-parts";

const TRADES = new Set<number>([BuildingType.Weaver, BuildingType.Winery, BuildingType.Leatherworks,
  BuildingType.Brewery, BuildingType.Storehouse, BuildingType.MediumResidence]);
interface AwningSite { body: BuildingPart; centreZ: number; outer: number; side: number; top: number; width: number }
const overlap = (a: ReturnType<typeof getRomanPartBounds>, b: ReturnType<typeof getRomanPartBounds>) =>
  [0, 1, 2].every(axis => a.min[axis]! < b.max[axis]! + .012 && a.max[axis]! > b.min[axis]! - .012);

const awningSite = (recipe: BuildingRecipe, original: BuildingRecipe, limit: ReturnType<typeof getRomanRecipeBounds>) => {
  const bodies = recipe.parts.filter(part => part.shape === "persian-room" && !part.occupationRoof &&
    part.size[1] > 1 && part.size[0] > .9 && part.size[2] > .9)
    .sort((a, b) => b.size[0] * b.size[2] - a.size[0] * a.size[2]);
  const doorX = recipe.door[0] + (recipe.doorDimensions?.width ?? .46) / 2;
  for (const body of bodies) for (const side of [1, -1]) for (const offset of [0, -.20, .20]) {
    const width = Math.min(.72, body.size[2] * .44), centreZ = body.position[2] + offset * body.size[2];
    const radius = body.size[0] / 2 * Math.sqrt(1 - (offset * 2) ** 2);
    const inner = body.position[0] + side * radius;
    const projection = Math.min(.32, limit.extentX - Math.abs(inner) - .045);
    const top = Math.min(1.50, body.position[1] + body.size[1] / 2 - .035);
    if (projection < .18 || top < 1 || Math.abs(centreZ) + width / 2 > limit.extentZ - .045) continue;
    const outer = inner + side * projection;
    const posts = [-1, 1].map(end => [outer, top / 2, centreZ + end * width / 2] as Point3);
    if (posts.some(([x, , z]) => Math.abs(x - doorX) < .48 && z > recipe.door[2] - .2)) continue;
    if (posts.some(([x, , z]) => [original.workerExit, original.workPoint, original.mechanism]
      .some(point => Math.hypot(x - point[0], z - point[2]) < .38))) continue;
    if (posts.some(position => {
      const bounds = getRomanPartBounds({ position, shape: "box", size: [.045, top, .045], stage: 3, surface: "wood" });
      return recipe.parts.some(part => {
        const other = getRomanPartBounds(part);
        return other.max[1] > .20 && overlap(bounds, other);
      });
    })) continue;
    const bounds = getRomanPartBounds({ position: [(inner + outer) / 2, top - .07, centreZ],
      shape: "box", size: [projection, .16, width], stage: 3, surface: "cloth" });
    if (recipe.parts.some(part => {
      if (part === body || Math.hypot(part.position[0] - body.position[0], part.position[2] - body.position[2]) < .015)
        return false;
      return overlap(bounds, getRomanPartBounds(part));
    })) continue;
    return { body, centreZ, outer, side, top, width } satisfies AwningSite;
  }
  return null;
};

const addAwning = (add: Add, site: AwningSite, standing: readonly BuildingPart[], detailed: boolean) => {
  const { body, centreZ, outer, side, top, width } = site;
  const rx = body.size[0] / 2, rz = body.size[2] / 2, offset = centreZ - body.position[2];
  const radius = (z: number) => rx * Math.sqrt(Math.max(0, 1 - ((z - body.position[2]) / rz) ** 2));
  const innerMin = Math.min(radius(centreZ - width / 2), radius(centreZ + width / 2));
  const outerRadius = (outer - body.position[0]) * side;
  const depth = outerRadius - innerMin, centre = (outerRadius + innerMin) / 2;
  add({ position: [body.position[0] + side * centre, top - .07, centreZ],
    rotation: [0, side * Math.PI / 2, 0], shape: "persian-striped-awning", size: [width, .14, depth],
    persianAwningWall: [rx / depth, rz / width, -side * offset / width, centre / depth],
    stage: 3, surface: "cloth" });
  const timber = { stage: 3, surface: "wood", shape: detailed ? "bevel-box" : "box" } as const;
  const ends = [-1, 1].map(end => centreZ + end * width / 2);
  const rail = (z: number): Point3 => [body.position[0] + side * (radius(z) - .01), top - .017, z];
  for (const z of ends) {
    let floor = 0;
    for (const part of standing) {
      const bounds = getRomanPartBounds(part);
      if (!part.stock && bounds.max[1] <= .20 && outer >= bounds.min[0] && outer <= bounds.max[0] &&
        z >= bounds.min[2] && z <= bounds.max[2]) floor = Math.max(floor, bounds.max[1]);
    }
    const head = top - .055;
    add({ position: [outer, (floor + head) / 2, z], shape: "cylinder", radialSegments: detailed ? 8 : 4,
      size: [.038, head - floor, .038], stage: 3, surface: "wood" });
    runBetween(add, rail(z), [outer, top - .055, z], [.035, .035], timber);
    add({ position: [rail(z)[0] - side * .02, top + .025, z], shape: "box", size: [.07, .018, .018],
      stage: 3, surface: "wood" });
    runBetween(add, [rail(z)[0] - side * .005, top + .025, z], [rail(z)[0] + side * .010, top, z],
      [.007, .007], { stage: 3, surface: "rope" });
  }
  runBetween(add, [outer, top - .055, ends[0]!], [outer, top - .055, ends[1]!], [.035, .04], timber);
  const segments = detailed ? 4 : 2;
  for (let index = 0; index < segments; index++)
    runBetween(add, rail(ends[0]! + width * index / segments), rail(ends[0]! + width * (index + 1) / segments),
      [.045, .035], timber);
};

/** A few appropriate side yards receive supported blue/ochre/cream canopies inside their original plots. */
export const withPersianStripedAwning = (recipe: BuildingRecipe, original: BuildingRecipe,
  definition: BuildingDefinition, detailed: boolean): BuildingRecipe => {
  if (!TRADES.has(definition.id)) return recipe;
  const site = awningSite(recipe, original, getRomanRecipeBounds(definition, original));
  if (!site) return recipe;
  const parts = [...recipe.parts];
  const add: Add = part => parts.push({ architecture: true, stage: 3, ...part });
  addAwning(add, site, recipe.parts, detailed);
  return { ...recipe, parts };
};
