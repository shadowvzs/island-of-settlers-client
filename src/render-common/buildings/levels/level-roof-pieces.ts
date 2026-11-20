import type { BuildingPart, Point3 } from "../building-recipe";
import { type Box, boxOf, heightCap, isFree, type LevelKit, type LevelPart } from "./level-kit";
import { isRoofCovering } from "./level-roof-surface";

/** Roof slope angle of the small pitched roofs on dormers, louvers and hoods. */
export const SMALL_ROOF_PITCH = .6;

/**
 * A piece standing on the roof touches no ornament, chimney or crown already there (the roof
 * covering it rests in and everything under the roof do not count).
 */
export const isRoofSpotFree = (kit: LevelKit, centre: Point3, size: Point3, bottom: number, removable = 0) =>
  isFree(kit.site, boxOf(centre, size), .03, (bounds, part) => isRoofStructure(part, bounds) ||
    bounds.max[1] < bottom + .12 || isRemovable(part, removable));

/** Small cones (merlons) up to `size` that a piece may replace. */
const isRemovable = (part: BuildingPart, size: number) => part.shape === "cone" && Math.max(...part.size) <= size;

/** Domes stand on the roof: a piece may not cut into one. */
const ROOF_FEATURES: ReadonlySet<BuildingPart["shape"]> = new Set(["dome", "ogive-dome"]);
/** Ridge logs, wall plates and roof underlays run the whole roof: pieces rest on them. */
const SPANNING = 1;

const isRoofStructure = (part: BuildingPart, bounds: Box) => !ROOF_FEATURES.has(part.shape) &&
  (isRoofCovering(part) || part.shape === "tile" || part.roofLayer !== undefined ||
    Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]) > SPANNING);

/** Ridge axis of the main roof; flat terraces use their long side. */
export const ridgeAxisOf = (kit: LevelKit): 0 | 2 => {
  const roof = kit.site.roof!;
  if (roof.ridgeAxis !== null) return roof.ridgeAxis;
  return roof.envelope.max[0] - roof.envelope.min[0] >= roof.envelope.max[2] - roof.envelope.min[2] ? 0 : 2;
};

/**
 * A small pitched roof of two slabs over a box `width` across, `length` along `axis`, its eave at
 * `eave`. Returns the ridge height.
 */
export const addSmallGableRoof = (kit: LevelKit, centre: Point3, axis: 0 | 2,
  size: { length: number; width: number; eave: number }, part: Partial<BuildingPart> = {}) => {
  const run = size.width / 2 + .04, rise = Math.tan(SMALL_ROOF_PITCH) * run, slab = Math.hypot(run, rise);
  for (const side of [-1, 1]) {
    const across = side * run / 2, position: Point3 = [...centre];
    position[1] = size.eave + rise / 2 + .015;
    position[axis === 0 ? 2 : 0] += across;
    const rotation: Point3 = axis === 0 ? [side * SMALL_ROOF_PITCH, 0, 0] : [0, 0, -side * SMALL_ROOF_PITCH];
    const dimensions: Point3 = axis === 0 ? [size.length, .035, slab] : [slab, .035, size.length];
    kit.add({ position, rotation, shape: "box", size: dimensions, stage: 4, surface: "roof", ...part });
  }
  return size.eave + rise;
};

/** Gable infill under a small roof, facing along `facing` (the axis across its ridge). */
export const addGableEnd = (kit: LevelKit, centre: Point3, axis: 0 | 2, width: number, rise: number,
  part: Pick<LevelPart, "stage" | "surface" | "tint">) => {
  kit.add({ ...part, position: [centre[0], centre[1] + rise / 2, centre[2]],
    rotation: axis === 0 ? [0, Math.PI / 2, 0] : undefined, shape: "gable", size: [width, rise, .04] });
};

/** Highest top this piece may reach (the 130 % cap), or null when it does not fit at all. */
export const fitTop = (kit: LevelKit, wanted: number, minimum: number) => {
  const top = Math.min(wanted, heightCap(kit.site) - .01);
  return top < minimum ? null : top;
};

/**
 * Loose roof tiles (and merlons up to `removable`) a piece now covers are taken off: they would
 * show through its walls.
 */
export const liftTilesUnder = (kit: LevelKit, centre: Point3, size: Point3, removable = 0) => {
  const box = boxOf(centre, size);
  for (let index = kit.site.parts.length - 1; index >= 0; index--) {
    const part = kit.site.parts[index]!;
    if (part.shape !== "tile" && !isRemovable(part, removable)) continue;
    const [x, y, z] = part.position;
    if (x > box.min[0] && x < box.max[0] && y > box.min[1] - .1 && y < box.max[1] && z > box.min[2] && z < box.max[2])
      kit.site.parts.splice(index, 1);
  }
};
