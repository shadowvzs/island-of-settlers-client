import { DMath } from "../../shared/math/deterministic-math";
import { clamp } from "../../shared/world/noise";
import type { Random } from "../../shared/world/rng";
import { type CameraState,getViewHalfExtent } from "../camera-state";
import { ISO_PITCH } from "../iso-projection";

/** Ground v units one unit of height moves a point up the screen in the iso view. */
export const HEIGHT_TO_V = DMath.cos(ISO_PITCH) / DMath.sin(ISO_PITCH);

/**
 * Ground footprint of the view: a rectangle around the camera centre along the screen axes
 * (u = screen right, v = screen down on the ground), turned by the camera yaw. Birds are only
 * spawned and kept inside it (plus a margin).
 */
export interface ViewRegion {
  centerX: number;
  centerZ: number;
  cosYaw: number;
  /** Half extents in world units along u and v. */
  halfU: number;
  halfV: number;
  sinYaw: number;
}

export const createViewRegion = (): ViewRegion => ({
  centerX: 0,
  centerZ: 0,
  cosYaw: 1,
  halfU: 1,
  halfV: 1,
  sinYaw: 0
});

/** The flatter the view, the deeper the ground it shows (perspective cameras look further). */
export const updateViewRegion = (region: ViewRegion, camera: CameraState) => {
  const { halfHeight, halfWidth } = getViewHalfExtent(camera);
  const pitch = clamp(ISO_PITCH + camera.tilt, 0.25, 1.4);
  region.centerX = camera.centerX;
  region.centerZ = camera.centerZ;
  region.cosYaw = DMath.cos(camera.yaw);
  region.sinYaw = DMath.sin(camera.yaw);
  region.halfU = halfWidth;
  region.halfV = halfHeight / DMath.sin(pitch);
  return region;
};

/** Scratch result of toViewAxes (per frame hot path: no allocation). */
const axes = { u: 0, v: 0 };

/** View axes on the ground: u along screen right, v towards the bottom of the screen. */
const toViewAxes = (region: ViewRegion, x: number, z: number) => {
  const dx = x - region.centerX;
  const dz = z - region.centerZ;
  const rx = dx * region.cosYaw - dz * region.sinYaw;
  const rz = dx * region.sinYaw + dz * region.cosYaw;
  axes.u = (rx - rz) / Math.SQRT2;
  axes.v = (rx + rz) / Math.SQRT2;
  return axes;
};

/** Ground point of view axes (u along screen right, v towards the bottom of the screen). */
export const fromViewAxes = (region: ViewRegion, u: number, v: number) => {
  const rx = (u + v) / Math.SQRT2;
  const rz = (v - u) / Math.SQRT2;
  return {
    x: region.centerX + rx * region.cosYaw + rz * region.sinYaw,
    z: region.centerZ - rx * region.sinYaw + rz * region.cosYaw
  };
};

/**
 * Whether a bird (its ground point) is inside the view plus `margin` world units. Height lifts
 * a point up the screen, so high birds over the near edge are still seen: v shifts by height.
 */
export const isInView = (region: ViewRegion, x: number, y: number, z: number, margin: number) => {
  const { u, v } = toViewAxes(region, x, z);
  const lifted = v - y * HEIGHT_TO_V;
  return Math.abs(u) <= region.halfU + margin && Math.abs(lifted) <= region.halfV + margin;
};

/** Distance from the view centre relative to the view size (0 centre, 1 at the edge). */
export const getViewDistance = (region: ViewRegion, x: number, z: number) => {
  const { u, v } = toViewAxes(region, x, z);
  return Math.max(Math.abs(u) / region.halfU, Math.abs(v) / region.halfV);
};

/** As getViewDistance for a point `y` above the ground: height moves it up the screen. */
export const getLiftedViewDistance = (region: ViewRegion, x: number, y: number, z: number) => {
  const { u, v } = toViewAxes(region, x, z);
  return Math.max(Math.abs(u) / region.halfU, Math.abs(v - y * HEIGHT_TO_V) / region.halfV);
};

/** Random ground point inside the view, `inset` (0..1) away from the edges. */
export const pickPointInView = (region: ViewRegion, random: Random, inset: number) => {
  const scale = 1 - inset;
  const u = (random() * 2 - 1) * region.halfU * scale;
  const v = (random() * 2 - 1) * region.halfV * scale;
  return fromViewAxes(region, u, v);
};

/**
 * A point just outside a random view edge and a heading into the view (birds that fly in),
 * slanted so they cross the view on a diagonal rather than straight through the middle.
 */
export const pickEdgeEntry = (region: ViewRegion, random: Random, margin: number) => {
  const side = Math.floor(random() * 4);
  const along = random() * 1.6 - 0.8;
  const horizontal = side < 2;
  const sign = side % 2 === 0 ? -1 : 1;
  const u = horizontal ? sign * (region.halfU + margin) : along * region.halfU;
  const v = horizontal ? along * region.halfV : sign * (region.halfV + margin);
  const point = fromViewAxes(region, u, v);
  const target = fromViewAxes(region, -u * 0.3 + (random() - 0.5) * region.halfU, -v * 0.3);
  return { heading: DMath.atan2(target.z - point.z, target.x - point.x), x: point.x, z: point.z };
};
