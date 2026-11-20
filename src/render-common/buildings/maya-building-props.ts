import type { BuildingPart, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { type MayaBuildingKit, mayaWallFace } from "./maya-building-kit";

const overlaps = (a: ReturnType<typeof getRomanPartBounds>, b: ReturnType<typeof getRomanPartBounds>) =>
  [0, 1, 2].every(axis => a.min[axis]! < b.max[axis]! + .025 && a.max[axis]! > b.min[axis]! - .025);

const freePropSite = (kit: MayaBuildingKit, x: number, z: number, height: number) => {
  const candidate: BuildingPart = { position: [x, height / 2, z], shape: "box",
    size: [.25, height, .25], stage: 4, surface: "wood" };
  const bounds = getRomanPartBounds(candidate), { original } = kit;
  const doorCentre = original.door[0] + (original.doorDimensions?.width ?? .46) / 2;
  if (Math.abs(x - doorCentre) < .55 && z > original.door[2] - .3) return false;
  if ([original.workerExit, original.workPoint, original.mechanism].some(point =>
    Math.hypot(x - point[0], z - point[2]) < .4)) return false;
  return kit.parts.every(part => {
    if (part.surface.startsWith("roof") || part.surface === "straw" || part.shape === "occupation-roof") return true;
    const occupied = getRomanPartBounds(part);
    return occupied.max[1] < .04 || !overlaps(bounds, occupied);
  });
};

const addPottery = (kit: MayaBuildingKit, [x, , z]: Point3) => {
  const { add, detailed } = kit;
  add({ position: [x, .17, z], radialSegments: detailed ? undefined : 6, shape: "clay-jar",
    size: [.22, .34, .22], stage: 4, surface: "paint", tint: [.63, .28, .12], nationDecor: true });
  if (!detailed) return;
  for (const side of [-1, 1]) add({ position: [x, .23, z + side * .08], shape: "ring",
    rotation: [Math.PI / 2, 0, 0], size: [.07, .025, .07], stage: 4,
    surface: "paint", tint: [.43, .19, .08], nationDecor: true });
};

const addReedBasket = (kit: MayaBuildingKit, [x, , z]: Point3) => {
  const { add, detailed } = kit;
  add({ position: [x, .1, z], radialSegments: detailed ? 12 : 6, shape: "cylinder",
    size: [.23, .2, .23], topScale: [1.18, 1, 1.18], stage: 4,
    surface: "straw", tint: [.8, .65, .41], nationDecor: true });
  add({ position: [x, .19, z], radialSegments: detailed ? 12 : 6, shape: "ring",
    size: [.26, .035, .26], stage: 4, surface: "rope", nationDecor: true });
  if (!detailed) return;
  for (let index = 0; index < 5; index++) add({ position: [x, .035 + index * .031, z],
    radialSegments: 12, shape: "ring", size: [.235 + index * .004, .009, .235 + index * .004],
    stage: 4, surface: "rope", nationDecor: true });
};

/** Only occupations that use a container receive one, close to a clear exterior wall. */
export const addMayaOccupationProps = (kit: MayaBuildingKit) => {
  const { body, centre, definition, original } = kit;
  const pottery = [6, 23].includes(definition.id);
  const basket = [32, 37, 60].includes(definition.id);
  if (!pottery && !basket) return;
  const sites: Point3[] = [];
  for (const wall of body.walls) {
    if (wall.base > .2 || wall.length < .6) continue;
    const { axis, face, sign } = mayaWallFace(wall, centre);
    for (const fraction of [.25, .75, .5]) {
      const site: Point3 = [0, 0, 0];
      site[wall.along] = wall.min[wall.along] + wall.length * fraction;
      // About five centimetres of air separates the vessel from the masonry.
      site[axis] = face + sign * .18;
      if (Math.abs(site[0]) + .14 > kit.limit.extentX ||
        Math.abs(site[2]) + .14 > kit.limit.extentZ) continue;
      if (freePropSite(kit, site[0], site[2], .36)) sites.push(site);
    }
  }
  sites.sort((a, b) => Math.hypot(a[0] - original.workPoint[0], a[2] - original.workPoint[2]) -
    Math.hypot(b[0] - original.workPoint[0], b[2] - original.workPoint[2]));
  const site = sites[0];
  if (!site) return;
  if (pottery) addPottery(kit, site);
  else addReedBasket(kit, site);
};
