import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import type { Add, KitContext } from "./nation-kit-parts";
import { onWall, wallNormal } from "./nation-kit-parts";
import { addPersianMillYard } from "./persian-mill-yard";

interface Prop { width: number; depth: number; height: number; build: (at: Point3, detailed: boolean) => BuildingPart[] }

const part = (shape: BuildingPart["shape"], surface: BuildingPart["surface"], position: Point3, size: Point3,
  extra: Partial<BuildingPart> = {}): BuildingPart => ({ position, shape, size, stage: 4, surface, ...extra });

const jar: Prop = { depth: .24, height: .36, width: .24, build: ([x, y, z], detailed) => [
  part("clay-jar", "paint", [x, y + .17, z], [.22, .34, .22],
    { radialSegments: detailed ? undefined : 6, tint: [.61, .35, .18] }),
  part("ring", "paint", [x, y + .31, z], [.09, .025, .09],
    { radialSegments: detailed ? 12 : 6, tint: [.89, .73, .47] }),
  ...detailed ? [part("bowl", "paint", [x + .08, y + .055, z + .06], [.12, .1, .12],
    { radialSegments: 12, tint: [.77, .57, .31] })] : []
] };

const textiles: Prop = { depth: .25, height: .21, width: .37, build: ([x, y, z], detailed) => [
  part("linen-bolt", "cloth", [x, y + .08, z], [.34, .16, .2], { tint: [.62, .31, .25] }),
  ...detailed ? [part("linen-bolt", "cloth", [x + .015, y + .17, z + .015], [.3, .095, .15],
    { tint: [.77, .6, .39] })] : []
] };

const ropeCargo: Prop = { depth: .24, height: .2, width: .26, build: ([x, y, z], detailed) => [
  part("cylinder", "wood", [x, y + .045, z], [.25, .09, .23], { radialSegments: detailed ? 12 : 6 }),
  ...Array.from({ length: detailed ? 3 : 1 }, (_, index) => part("ring", "rope",
    [x, y + .1 + index * .025, z], [.2 - index * .025, .025, .2 - index * .025],
    { radialSegments: detailed ? 16 : 6 }))
] };

const rocks: Prop = { depth: .26, height: .23, width: .31, build: ([x, y, z], detailed) => [
  part("rock", "stone", [x - .05, y + .07, z], [.2, .14, .2]),
  part("rock", "stone", [x + .07, y + .055, z + .04], [.15, .11, .16]),
  ...detailed ? [part("rock", "stone", [x + .015, y + .17, z + .015], [.13, .13, .13])] : []
] };

const tools: Prop = { depth: .25, height: .39, width: .31, build: ([x, y, z], detailed) => [
  part("box", "wood", [x, y + .035, z], [.3, .07, .24]),
  ...[-1, 1].map(side => part("cylinder", "wood", [x + side * .09, y + .23, z], [.024, .36, .024],
    { radialSegments: detailed ? 6 : 4 })),
  part("box", "wood", [x, y + .29, z], [.25, .035, .04]),
  part("cylinder", "paint", [x, y + .16, z + .055], [.22, .035, .22],
    { radialSegments: detailed ? 16 : 6, rotation: [Math.PI / 2, 0, 0], tint: [.61, .38, .2] })
] };

const propFor = (definition: BuildingDefinition): Prop => {
  if ([3, 8, 15, 24, 61, 62].includes(definition.id)) return textiles;
  if ([10, 11, 12, 13, 19, 25, 26, 27, 34].includes(definition.id)) return rocks;
  if ([17, 20, 33, 36, 39].includes(definition.id)) return ropeCargo;
  if ([1, 2, 4, 9, 14, 40].includes(definition.id)) return tools;
  return jar;
};

const overlaps = (a: ReturnType<typeof getRomanPartBounds>, b: ReturnType<typeof getRomanPartBounds>) =>
  [0, 1, 2].every(axis => a.min[axis]! < b.max[axis]! + .035 && a.max[axis]! > b.min[axis]! - .035);

/** Yard goods stand on actual free ground, outside the shared worker/carrier lanes and inventories. */
export const addPersianOccupationProps = (context: KitContext, definition: BuildingDefinition,
  original: BuildingRecipe, standing: readonly BuildingPart[]) => {
  if (definition.id === 31) {
    addPersianMillYard(context);
    return;
  }
  const { detailed, limit } = context, prop = propFor(definition), candidates: Point3[] = [];
  for (const sx of [1, -1]) for (const sz of [1, -1]) for (const fraction of [.82, .63, .44])
    candidates.push([sx * (limit.extentX - prop.width / 2 - .035) * fraction, 0,
      sz * (limit.extentZ - prop.depth / 2 - .035)]);
  const doorX = original.door[0] + (original.doorDimensions?.width ?? .46) / 2;
  const contacts = [original.workPoint, original.workerExit];
  const added: BuildingPart[] = [];
  const desired = detailed ? 2 : 1;
  let placed = 0;
  for (const at of candidates) {
    if (Math.abs(at[0] - doorX) < .55 && at[2] > original.door[2] - .2) continue;
    if (contacts.some(contact => Math.hypot(at[0] - contact[0], at[2] - contact[2]) < .42)) continue;
    let floor = 0;
    for (const existing of standing) {
      if (existing.stock) continue;
      const bounds = getRomanPartBounds(existing);
      if (bounds.min[1] > .05 || bounds.max[1] > .22) continue;
      if (at[0] >= bounds.min[0] && at[0] <= bounds.max[0] && at[2] >= bounds.min[2] && at[2] <= bounds.max[2])
        floor = Math.max(floor, bounds.max[1]);
    }
    at[1] = floor;
    const bounds = getRomanPartBounds(part("box", "wood", [at[0], floor + prop.height / 2, at[2]],
      [prop.width, prop.height, prop.depth]));
    const blocked = [...standing, ...added].some(existing => {
      const other = getRomanPartBounds(existing);
      if (other.max[1] <= floor + .01 && !existing.stock) return false;
      return overlaps(bounds, other);
    });
    if (blocked) continue;
    const built = prop.build(at, detailed); built.forEach(context.add); added.push(...built);
    if (++placed >= desired) return;
  }
};

/** A narrow woven pack hangs from a wooden rail firmly attached to a side wall. */
export const addPersianWallTextile = (context: KitContext, standing: readonly BuildingPart[]) => {
  const walls = context.walls.filter(candidate =>
    candidate.along === 2 && candidate.length > .75 && candidate.height > .7);
  const wall = walls.find(candidate => wallNormal(candidate, context.center).sign > 0) ?? walls[0];
  if (!wall) return;
  const normal = wallNormal(wall, context.center);
  const yaw = normal.axis === 0 ? Math.PI / 2 : 0;
  const size: Point3 = normal.axis === 0 ? [.025, .32, .22] : [.22, .32, .025];
  const centre = [.24, .76, .5].map(share => onWall(wall, context.center, share,
    wall.base + Math.min(.55, wall.height * .44), normal.thickness / 2 + .018)).find(at => {
    const bounds = getRomanPartBounds(part("box", "cloth", at, size));
    return !standing.some(existing => (existing.stock || existing.surface === "dark") &&
      overlaps(bounds, getRomanPartBounds(existing)));
  });
  if (!centre) return;
  context.add(part("box", "cloth", centre, size, { tint: [.58, .28, .2] }));
  context.add(part("cylinder", "wood", [centre[0], centre[1] + .17, centre[2]], [.025, .28, .025],
    { radialSegments: context.detailed ? 8 : 4, rotation: [0, yaw, Math.PI / 2] }));
  if (!context.detailed) return;
  for (const share of [-.1, 0, .1]) {
    const at: Point3 = [...centre];
    at[wall.along] += share; at[normal.axis] = at[normal.axis]! + normal.sign * .016;
    context.add(part("box", "cloth", at, normal.axis === 0 ? [.008, .035, .028] : [.028, .035, .008],
      { tint: [.87, .68, .38] }));
  }
};

/** Small paired roundels are modeled plaster relief, not a painted wall mural. */
export const addPersianRelief = (add: Add, at: Point3, detailed: boolean) => {
  add(part("cylinder", "paint", at, [.14, .025, .14], { rotation: [Math.PI / 2, 0, 0],
    radialSegments: detailed ? 16 : 8, tint: [.91, .82, .65] }));
  if (detailed) add(part("ring", "plaster", [at[0], at[1], at[2] + .015], [.18, .025, .18],
    { rotation: [Math.PI / 2, 0, 0], radialSegments: 16 }));
};
