import type { Random } from "../../shared/world/rng";
import type { WhaleWater } from "./whale-water";

/**
 * Where a whale may surface: deep, visible sea the camera looks at now. The renderer answers the
 * view questions with its active camera (iso or possessed), so nothing is placed off screen.
 */
export interface WhaleView {
  /** Where a viewport point (-1..1 both ways) meets the plane at `height`; false above the horizon. */
  castToPlane: (viewX: number, viewY: number, height: number, out: { x: number; z: number }) => boolean;
  /** The eye, for the distance limits (only with `limitDistance`: the possessed eye at sea level). */
  eyeX: number;
  eyeZ: number;
  limitDistance: boolean;
  /** Horizontal view direction (unit). */
  forwardX: number;
  forwardZ: number;
  /** A world point inside the view (with a small screen margin). */
  inView: (x: number, y: number, z: number) => boolean;
}

export interface WhaleSite {
  x: number;
  yaw: number;
  z: number;
}

/** Sea at least this deep (the beach shelf is about 1, the open sea 5) under the whole event. */
export const DEEP_WATER = 3;
/** Horizontal distance of the event from the possessed eye (world units; the iso view only needs it on screen). */
const DISTANCE = { max: 150, min: 10 } as const;
const TRIES = 10;
/** Viewport share sampled (keeps the event away from the screen border). */
const VIEW_SPAN = { x: 0.7, y: 0.6 } as const;
/** Heading spread about broadside to the viewer (radians). */
const HEADING_SPREAD = 0.45;
/** Footprint sampling: body lengths beyond the path's ends, lateral offsets, step. */
const FOOTPRINT = { ends: 0.6, step: 0.25 } as const;
const FOOTPRINT_SIDES = [-0.35, 0, 0.35] as const;

const hit = { x: 0, z: 0 };

/** Why a viewport sample was not used (review statistics). */
export type SiteRejection = "distance" | "horizon" | "offScreen" | "water";

/** Explored sea counts (the fog of war dims it on screen); hidden sea does not. */
const isSwimmable = (water: WhaleWater, x: number, z: number) =>
  water.inside(x, z) && water.depth(x, z) > DEEP_WATER && water.fog(x, z) >= 0.5;

/** Deep, visible sea along the path from `start` (`travel` world units along the heading) and around it. */
export const isClearPath = (
  water: WhaleWater,
  site: WhaleSite,
  length: number,
  travel: number
) => {
  const forwardX = Math.cos(site.yaw);
  const forwardZ = -Math.sin(site.yaw);
  const step = FOOTPRINT.step * length;
  for (let along = -FOOTPRINT.ends * length; along <= travel + FOOTPRINT.ends * length; along += step) {
    for (const side of FOOTPRINT_SIDES) {
      const x = site.x + forwardX * along - forwardZ * side * length;
      const z = site.z + forwardZ * along + forwardX * side * length;
      if (!isSwimmable(water, x, z)) return false;
    }
  }
  return true;
};

/**
 * Heading that shows the event best (the whale's forward is (cos yaw, -sin yaw)): broadside to the
 * viewer (the view direction turned a quarter towards `side`), or swimming away with its flukes
 * turned to the viewer (`away`, the tail slaps).
 */
export const getViewHeading = (view: Pick<WhaleView, "forwardX" | "forwardZ">, side: number, away: boolean) =>
  away
    ? Math.atan2(-view.forwardZ, view.forwardX)
    : Math.atan2(-view.forwardX * side, -view.forwardZ * side);

const pickHeading = (view: WhaleView, away: boolean, random: Random) =>
  getViewHeading(view, random() < 0.5 ? -1 : 1, away) + (random() * 2 - 1) * HEADING_SPREAD;

/**
 * A start point and heading for an event `travel` world units long whose path lies in deep,
 * explored sea in view; false when none of a few viewport samples qualifies.
 */
export const findWhaleSite = (
  water: WhaleWater,
  view: WhaleView,
  seaLevel: number,
  plan: { away: boolean; length: number; travel: number },
  random: Random,
  out: WhaleSite,
  rejected?: Record<SiteRejection, number>
) => {
  const reject = (reason: SiteRejection) => {
    if (rejected) rejected[reason] += 1;
  };
  for (let tries = 0; tries < TRIES; tries += 1) {
    const viewX = (random() * 2 - 1) * VIEW_SPAN.x;
    const viewY = (random() * 2 - 1) * VIEW_SPAN.y;
    if (!view.castToPlane(viewX, viewY, seaLevel, hit)) {
      reject("horizon");
      continue;
    }
    const distance = Math.hypot(hit.x - view.eyeX, hit.z - view.eyeZ);
    if (view.limitDistance && (distance < DISTANCE.min || distance > DISTANCE.max)) {
      reject("distance");
      continue;
    }
    out.yaw = pickHeading(view, plan.away, random);
    out.x = hit.x - Math.cos(out.yaw) * plan.travel / 2;
    out.z = hit.z + Math.sin(out.yaw) * plan.travel / 2;
    const endX = out.x + Math.cos(out.yaw) * plan.travel;
    const endZ = out.z - Math.sin(out.yaw) * plan.travel;
    if (!view.inView(out.x, seaLevel, out.z) || !view.inView(endX, seaLevel, endZ)) {
      reject("offScreen");
      continue;
    }
    if (isClearPath(water, out, plan.length, plan.travel)) return true;
    reject("water");
  }
  return false;
};
