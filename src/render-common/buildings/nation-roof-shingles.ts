import { DMath } from "../../shared/math/deterministic-math";
import type { Point3 } from "./building-recipe";
import type { Add } from "./nation-kit-parts";

/** Shingle rows in one texture tile of the Viking roof map (its painter reads the same count). */
export const VIKING_SHINGLE_ROWS_PER_TILE = 4;
/** Slope length of one shingle course, in recipe units. */
const SHINGLE_COURSE = .15;
/** How far each High course's butt stands proud of the course below. */
const COURSE_LIFT = .02;
const COURSE_THICKNESS = .025;
const SLAB_THICKNESS = .1;

/**
 * One roof slope: `yaw` turns local z (down the slope) toward its eave, `length` runs along the
 * ridge and `depth` down the slope. `bare` leaves verge strips free for barge boards.
 */
export interface ShingledSlab {
  bare: number; centre: Point3; depth: number; length: number; slope: number; yaw: number;
}

/** Slope-local (along ridge, off the slab, down the slope) to recipe coordinates. */
const slabPoint = (slab: ShingledSlab, along: number, off: number, down: number): Point3 => {
  const y = off * DMath.cos(slab.slope) - down * DMath.sin(slab.slope);
  const across = off * DMath.sin(slab.slope) + down * DMath.cos(slab.slope);
  const cos = DMath.cos(slab.yaw), sin = DMath.sin(slab.yaw);
  return [slab.centre[0] + along * cos + across * sin, slab.centre[1] + y, slab.centre[2] - along * sin + across * cos];
};

/** Texture density that makes one shingle row of the roof map exactly `course` long. */
const rowDensity = (course: number) => 1 / (VIKING_SHINGLE_ROWS_PER_TILE * course);

/**
 * A shingled roof slope: the slab carries the shingle map (all a Minimal roof needs); High lays
 * stepped courses on it, each tilted so its butt stands proud of the one below, a real sawtooth
 * relief instead of a flat board.
 */
export const addShingledSlab = (add: Add, slab: ShingledSlab, detailed: boolean) => {
  add({ position: slab.centre, rotation: [slab.slope, slab.yaw, 0], shape: "box",
    size: [slab.length, SLAB_THICKNESS, slab.depth], stage: 4, surface: "roof", worldUv: rowDensity(SHINGLE_COURSE) });
  if (!detailed) return;
  const courses = Math.max(3, Math.round(slab.depth / SHINGLE_COURSE)), course = slab.depth / courses;
  const tilt = DMath.atan2(COURSE_LIFT, course);
  for (let index = 0; index < courses; index++) {
    const down = -slab.depth / 2 + (index + .5) * course;
    add({ position: slabPoint(slab, 0, SLAB_THICKNESS / 2 + COURSE_THICKNESS / 2 + COURSE_LIFT / 2, down),
      rotation: [slab.slope - tilt, slab.yaw, 0], shape: "box",
      size: [slab.length - slab.bare * 2, COURSE_THICKNESS, course / DMath.cos(tilt)], stage: 4, surface: "roof",
      worldUv: rowDensity(course) });
  }
};

/** Yaw of a slope falling toward `side` (±1) across a ridge along x (`alongX`) or along z. */
export const shingledSlopeYaw = (alongX: boolean, side: number) =>
  (alongX ? 0 : Math.PI / 2) + (side < 0 ? Math.PI : 0);
