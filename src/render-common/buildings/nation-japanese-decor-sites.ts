import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { japaneseSoffitHeight, type NationRoofProfile } from "./nation-roof-profile";
import { type Bounds, type DecorSite,overlaps } from "./nubian-decor-faces";

/** Below this height a free-standing prop could brush a passing worker. */
export const HEAD_HEIGHT = .85;
/** Half width kept free round the door axis, from the door to the worker exit. */
const LANE_HALF_WIDTH = .34;
/** Ground kept free round the work point. */
const WORK_RADIUS = .3;
/** Moving mechanisms (cranes, arms, wheels) and the player flag sweep round their anchors. */
const MECHANISM_REACH = .55;
const FLAG_REACH = .47;

export interface JapaneseDecorSite extends DecorSite {
  detailed: boolean;
  /** Tiled Japanese roofs (not their soffit or rafter layers). */
  roofs: BuildingPart[];
  doorCenter: number;
  doorTop: number;
}

export const partBounds = (part: BuildingPart): Bounds => getRomanPartBounds(part);

/** Keep-out boxes for the moving mechanism and the flag, which are not recipe parts. */
const sweepBoxes = (recipe: BuildingRecipe, mechanism: boolean): Bounds[] => {
  const boxes: Bounds[] = [];
  if (mechanism) {
    const [x, , z] = recipe.mechanism;
    boxes.push({ max: [x + MECHANISM_REACH, 3, z + MECHANISM_REACH], min: [x - MECHANISM_REACH, 0, z - MECHANISM_REACH] });
  }
  if (recipe.flagAnchor) {
    const [x, y, z] = recipe.flagAnchor;
    boxes.push({ max: [x + FLAG_REACH, y + 1.2, z + FLAG_REACH], min: [x - FLAG_REACH, y - .05, z - FLAG_REACH] });
  }
  return boxes;
};

const isTiledRoof = (part: BuildingPart) =>
  part.shape === "nation-roof" && !part.roofLayer && (part.roofProfile ?? "viking") !== "viking";

export const createJapaneseDecorSite = (recipe: BuildingRecipe, detailed: boolean, limit: DecorSite["limit"],
  mechanism: boolean, walls: Bounds[]): JapaneseDecorSite => ({
  boxes: [...recipe.parts.map(partBounds), ...sweepBoxes(recipe, mechanism)],
  detailed,
  doorCenter: recipe.door[0] + (recipe.doorDimensions?.width ?? .46) / 2,
  doorTop: recipe.doorDimensions?.height ?? .77,
  limit,
  recipe,
  roofs: recipe.parts.filter(isTiledRoof),
  walls
});

export const insidePlot = (box: Bounds, limit: DecorSite["limit"]) =>
  Math.max(Math.abs(box.min[0]), Math.abs(box.max[0])) <= limit.extentX &&
  Math.max(Math.abs(box.min[2]), Math.abs(box.max[2])) <= limit.extentZ;

/** Plan distance from a point to a segment. */
const segmentDistance = (x: number, z: number, from: Point3, to: Point3) => {
  const dx = to[0] - from[0], dz = to[2] - from[2], length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((x - from[0]) * dx + (z - from[2]) * dz) / length)) : 0;
  return DMath.hypot(x - from[0] - dx * t, z - from[2] - dz * t);
};

/** Low props stay off the door lane, the walk from the exit to the work point and the work point. */
const keepsWorkersClear = (box: Bounds, site: JapaneseDecorSite) => {
  if (box.min[1] > HEAD_HEIGHT) return true;
  const { recipe } = site;
  if (box.min[0] < site.doorCenter + LANE_HALF_WIDTH && box.max[0] > site.doorCenter - LANE_HALF_WIDTH &&
    box.max[2] > recipe.door[2] - .05 && box.min[2] < recipe.workerExit[2] + .2) return false;
  const x = (box.min[0] + box.max[0]) / 2, z = (box.min[2] + box.max[2]) / 2;
  const radius = DMath.hypot(box.max[0] - box.min[0], box.max[2] - box.min[2]) / 2;
  return segmentDistance(x, z, recipe.workerExit, recipe.workPoint) > radius + .2 &&
    DMath.hypot(x - recipe.workPoint[0], z - recipe.workPoint[2]) > radius + WORK_RADIUS;
};

/** Free of every recorded part (except those `ignored`), inside the plot and clear of workers. */
export const isFree = (box: Bounds, site: JapaneseDecorSite, ignored: readonly Bounds[] = [], gap = .01) =>
  insidePlot(box, site.limit) && keepsWorkersClear(box, site) &&
  !site.boxes.some(other => !ignored.includes(other) && overlaps(other, box, gap));

/** A square box round a plan point. */
export const plotBox = (x: number, z: number, half: number, bottom: number, top: number): Bounds =>
  ({ max: [x + half, top, z + half], min: [x - half, bottom, z - half] });

/** World point of a unit roof point (x across, z along the ridge) on a tiled roof part. */
export const roofPoint = (roof: BuildingPart, x: number, z: number, y: number): Point3 => {
  const across = x * roof.size[0], along = z * roof.size[2];
  const turned = Math.abs((roof.rotation?.[1] ?? 0) - Math.PI / 2) < .01;
  return turned ? [roof.position[0] + along, y, roof.position[2] - across]
    : [roof.position[0] + across, y, roof.position[2] + along];
};

/** Unit roof coordinates of a world plan point (inverse of roofPoint). */
export const roofUnit = (roof: BuildingPart, x: number, z: number) => {
  const dx = x - roof.position[0], dz = z - roof.position[2];
  const turned = Math.abs((roof.rotation?.[1] ?? 0) - Math.PI / 2) < .01;
  return turned ? { x: -dz / roof.size[0], z: dx / roof.size[2] } : { x: dx / roof.size[0], z: dz / roof.size[2] };
};

/** Height of a tiled roof's soffit (underside) over a unit point: where hanging decor attaches. */
export const soffitY = (roof: BuildingPart, x: number, z: number) =>
  roof.position[1] + roof.size[1] * japaneseSoffitHeight(roof.roofProfile as NationRoofProfile, x, z);

/** Records added props (tagged as nation decor) so later ones keep clear of them. */
export const occupy = (site: JapaneseDecorSite, parts: readonly BuildingPart[]) => {
  site.boxes.push(...parts.map(partBounds));
  return parts.map(part => ({ ...part, nationDecor: true }));
};
