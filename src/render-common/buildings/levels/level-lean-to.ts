import type { Point3 } from "../building-recipe";
import type { WallRun } from "../nation-kit-classify";
import {
  type Box, boxOf, groundWalls, isFree, isInsidePlot, type LevelKit, type LevelPart, onWallFace, wallFace
} from "./level-kit";
import { CANOPY_SURFACE, coversWindow, oriented } from "./level-wall-pieces";
import { blocksTraffic, findYardSpots, nubianJars, type YardProp, type YardSpot } from "./level-yard-props";

/**
 * Level 5 lean-to store: a shingled (Nubian: palm-frond) pent roof carried by a wall ledger and two
 * ground posts, sheltering the household's firewood (Nubian: water jars) against a side wall.
 */
interface LeanToSize { depth: number; width: number }
/** Bay sizes tried in turn: the full bay, then a narrow one for tight yards. */
const SIZES: readonly LeanToSize[] = [{ depth: .3, width: .58 }, { depth: .25, width: .46 }];
const PITCH = .3;
const OVERHANG = .05;
/** Ledger heights tried, highest first; the roof's low edge must still clear the stored goods. */
const HEIGHTS = [.82, .72, .62, .56] as const;
/** The ledger keeps under the wall top (eaves and plates above it), the low edge over the goods. */
const WALL_TOP_MARGIN = .04;
const MIN_LOW_EDGE = .42;
/** Window openings within this of the lean-to keep their light. */
const WINDOW_MARGIN = .04;
const TIMBER = .05;

interface LeanToSite { size: LeanToSize; spot: YardSpot; top: number }

const wallTop = (wall: WallRun) => wall.base + wall.height;
/** Height of the roof's outer (low) edge over the posts. */
const lowEdge = ({ size, spot, top }: LeanToSite) => top - Math.tan(PITCH) * (spot.standoff + size.depth);

/** True when a window opening on the spot's wall face lies behind the lean-to's roof or goods. */
const hidesWindow = (kit: LevelKit, { size, spot, top }: LeanToSite) => {
  const along = spot.wall.along, centre = spot.at[along]!, half = size.width / 2 + WINDOW_MARGIN;
  const min: Point3 = [...spot.at], max: Point3 = [...spot.at];
  min[along] = centre - half; max[along] = centre + half;
  min[1] = 0; max[1] = top + WINDOW_MARGIN;
  return coversWindow(kit, spot.wall, { max, min });
};

const fits = (kit: LevelKit, site: LeanToSite) => wallTop(site.spot.wall) - WALL_TOP_MARGIN >= site.top &&
  lowEdge(site) >= MIN_LOW_EDGE && !hidesWindow(kit, site);

/** The best wall spot (camera side first) with room for the lean-to, the largest bay and ledger first. */
const findLeanToSite = (kit: LevelKit): LeanToSite | null => {
  for (const size of SIZES) for (const top of HEIGHTS) {
    const box: YardProp["size"] = [size.width + .06, top + .04, size.depth + OVERHANG];
    for (const spot of findYardSpots(kit, box)) {
      const site = { size, spot, top };
      if (fits(kit, site)) return site;
    }
  }
  return null;
};

/** Plan point `out` from the spot's wall face and `shift` along it, at height `y`. */
const wallPoint = (kit: LevelKit, spot: YardSpot, y: number, out: number, shift = 0) => {
  const point = onWallFace(kit.site, spot.wall, spot.t, y, out);
  point[spot.wall.along] += shift;
  return point;
};

/** The lean-to's frame: ledger, pent roof, front plate and the two posts down to the ground. */
const addFrame = (kit: LevelKit, site: LeanToSite) => {
  const { size, spot, top } = site, { sign } = wallFace(kit.site, spot.wall), along = spot.wall.along;
  const at = (y: number, out: number, shift = 0) => wallPoint(kit, spot, y, out, shift);
  const reach = spot.standoff + size.depth, low = lowEdge(site), timber = kit.detailed ? "bevel-box" : "box";
  kit.add({ position: at(top - TIMBER / 2, TIMBER / 2), shape: timber,
    size: oriented(along, size.width, TIMBER, TIMBER), surface: "wood" });
  const overhang = reach + OVERHANG, length = overhang / Math.cos(PITCH);
  const slope: Point3 = along === 0 ? [sign * PITCH, 0, 0] : [0, 0, -sign * PITCH];
  kit.add({ position: at(top + .018 - Math.tan(PITCH) * overhang / 2, overhang / 2), rotation: slope,
    shape: "box", size: oriented(along, size.width + .06, .035, length), stage: 4,
    surface: CANOPY_SURFACE[kit.site.nation] });
  const postOut = reach - TIMBER / 2;
  kit.add({ position: at(low - TIMBER / 2, postOut), shape: timber,
    size: oriented(along, size.width, TIMBER, TIMBER), surface: "wood" });
  for (const side of [-1, 1]) {
    const height = low - TIMBER;
    kit.add({ position: at(height / 2, postOut, side * (size.width / 2 - TIMBER / 2)), shape: timber,
      size: [TIMBER, height, TIMBER], surface: "wood" });
  }
};

/** Firewood pile rows (across the bay, height of the log centre): full bay on High 3-2-1, else 2-1. */
const LOG_DIAMETER = .1;
const PILE_FULL: readonly (readonly [number, number])[] = [[-.1, .05], [0, .05], [.1, .05], [-.05, .137],
  [.05, .137], [0, .224]];
const PILE_SMALL: readonly (readonly [number, number])[] = [[-.055, .05], [.055, .05], [0, .137]];

/** Split logs lying along the wall, stacked in a pyramid under the roof. */
const logPile = (kit: LevelKit, [x, , z]: Point3, alongX: boolean, size: LeanToSize): LevelPart[] => {
  const rotation: Point3 = alongX ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0];
  const rows = kit.detailed && size.depth >= .3 ? PILE_FULL : PILE_SMALL;
  return rows.map(([across, y]) => ({
    position: alongX ? [x, y, z + across] : [x + across, y, z], radialSegments: kit.detailed ? 7 : 5, rotation,
    shape: "cylinder", size: [LOG_DIAMETER, size.width - .1, LOG_DIAMETER], surface: "bark" }));
};

/** The stored goods under the roof: the firewood pile, or the Nubian water jars. */
const addGoods = (kit: LevelKit, { size, spot }: LeanToSite) => {
  const at = onWallFace(kit.site, spot.wall, spot.t, 0, spot.standoff + (size.depth - TIMBER) / 2);
  const goods = kit.site.nation === "nubian" ? nubianJars.build(kit, at, spot.alongX)
    : logPile(kit, at, spot.alongX, size);
  for (const part of goods) kit.add({ stage: 3, ...part });
};

/** Level 5 lean-to store against a wall (camera side first); false when no wall has room for it. */
export const addLeanToStore = (kit: LevelKit) => {
  const site = findLeanToSite(kit);
  if (!site) return false;
  addFrame(kit, site);
  addGoods(kit, site);
  return true;
};

/**
 * Work shelter: the same pent roof on a ledger and two posts, but standing over the yard's work
 * benches and tubs (the work area itself) rather than over free ground; only its posts need open
 * ground. Sizes tried: the largest bay first.
 */
const SHELTER_SIZES: readonly LeanToSize[] = [{ depth: .55, width: .9 }, { depth: .45, width: .72 },
  { depth: .36, width: .58 }];
const SHELTER_STEPS = [.5, .3, .7, .15, .85];
const SHELTER_STANDOFF = .05;
/** Posts keep this far from the worker's exit and work points (the worker stands under the roof). */
const POST_CLEARANCE = .18;
/** Work goods under the roof keep this much headroom below its low edge. */
const HEADROOM = .04;

/** The wall's spot for a shelter of this size, as a yard spot (its centre out from the face). */
const shelterSpot = (kit: LevelKit, wall: WallRun, t: number, size: LeanToSize): YardSpot => {
  const { axis, sign } = wallFace(kit.site, wall);
  return { alongX: wall.along === 0, at: onWallFace(kit.site, wall, t, 0, SHELTER_STANDOFF + size.depth / 2),
    facing: axis === 2 ? sign * .8 : sign * .6, standoff: SHELTER_STANDOFF, t, wall };
};


/** The two posts' boxes (with a little room round them). */
const postBoxes = (kit: LevelKit, { size, spot, top }: LeanToSite): Box[] => {
  const low = lowEdge({ size, spot, top }), out = spot.standoff + size.depth - TIMBER / 2;
  return [-1, 1].map(side => boxOf(wallPoint(kit, spot, low / 2, out, side * (size.width / 2 - TIMBER / 2)),
    [TIMBER + .04, low, TIMBER + .04]));
};

/** The roof's plan box from its low edge up (with the overhang): only goods under the low edge may stand there. */
const roofBox = (kit: LevelKit, site: LeanToSite): Box => {
  const { size, spot, top } = site, low = lowEdge(site), reach = spot.standoff + size.depth + OVERHANG;
  const centre = wallPoint(kit, spot, (low + top) / 2, reach / 2), plan: [number, number, number] =
    oriented(spot.wall.along, size.width + .06, top - low + HEADROOM * 2, reach);
  return boxOf(centre, plan);
};

const isShelterOpen = (kit: LevelKit, site: LeanToSite) => {
  const { axis, face, sign } = wallFace(kit.site, site.spot.wall), roof = roofBox(kit, site), low = lowEdge(site);
  const behind = (bounds: Box) => sign > 0 ? bounds.max[axis]! <= face + .08 : bounds.min[axis]! >= face - .08;
  if (!isInsidePlot(kit.site, roof)) return false;
  if (!isFree(kit.site, roof, .01, bounds => behind(bounds) || bounds.max[1] < low - HEADROOM)) return false;
  return postBoxes(kit, site).every(post => isFree(kit.site, post, .01, behind) &&
    !blocksTraffic(kit, post, POST_CLEARANCE));
};

/** The first camera-side wall spot where a shelter stands over the yard, largest first. */
const findWorkShelterSite = (kit: LevelKit): LeanToSite | null => {
  const walls = groundWalls(kit.site, .6).map(wall => ({ facing: shelterSpot(kit, wall, .5, SHELTER_SIZES[0]!).facing,
    wall })).sort((a, b) => b.facing - a.facing);
  const sites = SHELTER_SIZES.flatMap(size => HEIGHTS.flatMap(top => walls.flatMap(({ wall }) =>
    SHELTER_STEPS.map(t => ({ size, spot: shelterSpot(kit, wall, t, size), top })))));
  return sites.find(site => fits(kit, site) && isShelterOpen(kit, site)) ?? null;
};

/**
 * Level 3 work annex on the most camera-facing wall that has room: the work shelter over the yard,
 * else the lean-to store where it faces the camera better. Returns how well its wall faces the
 * camera (> 0: a front or east wall), or null when neither fits.
 */
export const addWorkAnnex = (kit: LevelKit) => {
  const shelter = findWorkShelterSite(kit), store = findLeanToSite(kit);
  if (shelter && (!store || shelter.spot.facing >= store.spot.facing)) {
    addFrame(kit, shelter);
    return shelter.spot.facing;
  }
  if (!store) return null;
  addFrame(kit, store);
  addGoods(kit, store);
  return store.spot.facing;
};
