import type { BuildingPart, Point3 } from "../building-recipe";
import { boxOf, heightCap, isFree, type LevelKit, ridgeHalfLength, roofHalves } from "./level-kit";
import { ridgeAxisOf } from "./level-roof-pieces";
import { findYardSpot } from "./level-yard-props";

/** A round pole from `foot` (sunk a little into what it stands on) up to `top`. */
export const addPole = (kit: LevelKit, foot: Point3, top: number, diameter = .03,
  surface: BuildingPart["surface"] = "wood") => {
  const bottom = foot[1] - .05;
  kit.add({ position: [foot[0], (bottom + top) / 2, foot[2]], radialSegments: kit.detailed ? 8 : 4,
    shape: "cylinder", size: [diameter, top - bottom, diameter], stage: 4, surface });
};

/** Flat cloth hanging from `top`, spanning `width` along `axis`, painted on both faces. */
export const addCloth = (kit: LevelKit, top: Point3, axis: 0 | 2, cloth: { height: number; tint: Point3;
  width: number; offset?: number }) => {
  const centre: Point3 = [...top];
  centre[1] -= cloth.height / 2;
  centre[axis] += cloth.offset ?? 0;
  kit.add({ position: centre, shape: "box", size: axis === 0 ? [cloth.width, cloth.height, .012]
    : [.012, cloth.height, cloth.width], stage: 4, surface: "cloth", tint: cloth.tint });
  return centre;
};

/** Painted emblem on both faces of a cloth (normal across `axis`); High only, Minimal keeps the plain cloth. */
export const addEmblem = (kit: LevelKit, centre: Point3, axis: 0 | 2, size: number, tint: Point3,
  standoff = .009) => {
  if (!kit.detailed) return;
  for (const side of [-1, 1]) {
    const position: Point3 = [...centre];
    position[axis === 0 ? 2 : 0] += side * standoff;
    const yaw = (axis === 0 ? 0 : Math.PI / 2) + (side < 0 ? Math.PI : 0);
    kit.add({ position, rotation: [0, yaw, 0], shape: "paint-ellipse", size: [size, size, .001], stage: 4, surface: "paint",
      tint });
  }
};

/** Pole height that keeps the banner within the 130 % height cap, or null if too short to read. */
export const poleTop = (kit: LevelKit, foot: Point3, wanted: number, minimum = .35) => {
  const top = Math.min(foot[1] + wanted, heightCap(kit.site) - .02);
  return top - foot[1] < minimum ? null : top;
};

/** True when nothing already stands where the pole and its cloth would hang. */
export const isPoleFree = (kit: LevelKit, foot: Point3, top: number, reach: number) =>
  isFree(kit.site, boxOf([foot[0], (foot[1] + top) / 2 + .05, foot[2]], [reach, top - foot[1] - .1, reach]), .01,
    (bounds, part) => part.surface.startsWith("roof") || bounds.max[1] < foot[1] + .12);

/** Ridge positions tried for a banner pole: near the camera-side end, then further in along the ridge. */
const POLE_INSETS = [.2, .35, .5];
const POLE_SHARES = [.55, .4];

/**
 * A free spot on the ridge for a banner pole `wanted` tall (and `reach` wide with its cloth):
 * the foot, the ridge axis and the pole top inside the height cap.
 */
const ridgePole = (kit: LevelKit, wanted: number, reach: number) => {
  const roof = kit.site.roof;
  if (!roof) return null;
  const axis = ridgeAxisOf(kit), half = ridgeHalfLength(kit.site) || roofHalves(kit.site).along;
  const alongs = [...POLE_INSETS.map(inset => half - inset), ...POLE_SHARES.map(share => half * share)];
  for (const along of alongs.filter(value => value > .15)) {
    const foot: Point3 = [...roof.centre];
    foot[axis] += along;
    const height = kit.site.topAt(foot[0], foot[2]);
    if (height === null) continue;
    foot[1] = height;
    const top = poleTop(kit, foot, wanted);
    if (top !== null && isPoleFree(kit, foot, top, reach)) return { axis, foot, top };
  }
  return null;
};

/** A banner standing on the ground against a wall, where the ridge has no room for it. */
const groundPole = (kit: LevelKit, height: number) => {
  const spot = findYardSpot(kit, [.2, height, .2]);
  if (!spot) return null;
  const foot: Point3 = [spot.at[0], 0, spot.at[2]], top = poleTop(kit, foot, height);
  return top === null ? null : { axis: spot.alongX ? 0 as const : 2 as const, foot, top };
};

/** The banner's pole: on the ridge when there is room, else planted in the yard (`ground` tall). */
export const bannerPole = (kit: LevelKit, wanted: number, reach: number, ground = 1) =>
  ridgePole(kit, wanted, reach) ?? groundPole(kit, ground);
