import { DMath } from "../shared/math/deterministic-math";
/**
 * The isometric view: camera yawed 45 degrees, pitched 30 degrees, so a ground cell is a 2:1
 * diamond. Three.js reproduces it with an orthographic camera, the sprite baker (ISO_GLSL) and
 * screen picking use the numbers below.
 */
export const ISO_PITCH = Math.PI / 6;

/** Screen width of one cell diamond at zoom 1. */
const TILE_WIDTH = 64;

/** Screen pixels per world unit along any horizontal screen direction at zoom 1. */
export const PIXELS_PER_UNIT = TILE_WIDTH / Math.SQRT2;

const HALF_TILE_WIDTH = TILE_WIDTH / 2;
const HALF_TILE_HEIGHT = HALF_TILE_WIDTH * DMath.sin(ISO_PITCH);

/** Screen pixels one unit of height lifts a point. */
const HEIGHT_PIXELS = PIXELS_PER_UNIT * DMath.cos(ISO_PITCH);

/** Direction from the scene towards the camera (normalised world vector). */
export const VIEW_DIRECTION = {
  x: DMath.cos(ISO_PITCH) / Math.SQRT2,
  y: DMath.sin(ISO_PITCH),
  z: DMath.cos(ISO_PITCH) / Math.SQRT2
} as const;

export const projectToScreen = (x: number, y: number, z: number) => ({
  screenX: (x - z) * HALF_TILE_WIDTH,
  screenY: (x + z) * HALF_TILE_HEIGHT - y * HEIGHT_PIXELS
});

/** A world point on screen: CSS pixels in the viewport, depth smaller = nearer the camera. */
export interface ViewportPoint {
  depth: number;
  x: number;
  y: number;
}

/** Inverse projection onto the horizontal plane at height `y`. */
export const unprojectToPlane = (screenX: number, screenY: number, y: number) => {
  const difference = screenX / HALF_TILE_WIDTH;
  const sum = (screenY + y * HEIGHT_PIXELS) / HALF_TILE_HEIGHT;
  return { x: (sum + difference) / 2, z: (sum - difference) / 2 };
};

/** GLSL constants of the same projection, for the sprite baker's vertex shader. */
export const ISO_GLSL = `
const float HALF_TILE_WIDTH = ${HALF_TILE_WIDTH.toFixed(6)};
const float HALF_TILE_HEIGHT = ${HALF_TILE_HEIGHT.toFixed(6)};
const float HEIGHT_PIXELS = ${HEIGHT_PIXELS.toFixed(6)};
vec2 isoProject(vec3 world) {
  return vec2((world.x - world.z) * HALF_TILE_WIDTH,
    (world.x + world.z) * HALF_TILE_HEIGHT - world.y * HEIGHT_PIXELS);
}
`;
