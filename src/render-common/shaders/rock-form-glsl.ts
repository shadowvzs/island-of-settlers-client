import { glslLiteral } from "./glsl-literal";
import {
  ROCK_PLANE_SECTORS,
  ROCK_PLANE_SOFTNESS,
  ROCK_PLANE_TILT
} from "./rock-tuning";

/**
 * Rock form read in the material (needs NOISE_GLSL), macro to meso: broad planes with soft
 * edges, strata beds that follow the form, and a few major fractures from two regional joint
 * sets (High adds a sparse diagonal secondary set, ROCK_LITE leaves it out).
 */
export const ROCK_FORM_GLSL = `
float hashRockId(float id) {
  return fract(sin(id * 12.9898 + 4.1) * 43758.5453);
}

/** Azimuth sectors and tilt steps (radians) of the broad rock planes. */
const float PLANE_SECTORS = ${glslLiteral(ROCK_PLANE_SECTORS)};
const float PLANE_SECTOR = 6.2831853 / PLANE_SECTORS;
const float PLANE_TILT = ${glslLiteral(ROCK_PLANE_TILT)};
const float PLANE_SOFTNESS = ${glslLiteral(ROCK_PLANE_SOFTNESS)};

struct RockPlanes {
  /** Shading normal pulled toward its plane: large flat lit planes, soft edges between them. */
  vec3 normal;
  /** Value of the plane -1..1: neighbouring planes differ a little, never jump. */
  float tone;
  /** 1 on the soft edge between two planes. */
  float edge;
};

/** Soft staircase: flat treads at whole numbers, smooth risers between them (continuous). */
float softSnap(float value) {
  float tread = floor(value);
  return tread + smoothstep(0.5 - PLANE_SOFTNESS, 0.5 + PLANE_SOFTNESS, value - tread);
}

/** Tone per azimuth sector, blended over the same risers (the wrap at +-pi stays seamless). */
float getPlaneTone(float sector) {
  float tread = floor(sector);
  float next = smoothstep(0.5 - PLANE_SOFTNESS, 0.5 + PLANE_SOFTNESS, sector - tread);
  float current = hashRockId(mod(tread, PLANE_SECTORS));
  return mix(current, hashRockId(mod(tread + 1.0, PLANE_SECTORS)), next);
}

float getRiser(float value) {
  return smoothstep(PLANE_SOFTNESS + 0.08, 0.0, abs(fract(value) - 0.5));
}

/**
 * Broad planes: the smooth normal's azimuth and tilt softly snapped to a few orientations, the
 * sector set turned regionally (turn 0..1), so each formation has its own planes. The normal is
 * turned before atan, so its +-pi wrap falls on a riser midpoint (seamless with an odd count).
 */
RockPlanes getRockPlanes(vec3 normal, float turn, float strength) {
  float offset = (turn - 0.5) * 2.4;
  vec2 turned = mat2(cos(offset), sin(offset), -sin(offset), cos(offset)) * normal.xz;
  float sector = atan(turned.y, turned.x) / PLANE_SECTOR;
  float tilt = atan(normal.y, length(normal.xz)) / PLANE_TILT;
  float azimuth = mix(sector, softSnap(sector), strength) * PLANE_SECTOR - offset;
  float elevation = mix(tilt, softSnap(tilt), strength) * PLANE_TILT;
  vec3 planeNormal = vec3(cos(azimuth), 0.0, sin(azimuth)) * cos(elevation);
  planeNormal.y = sin(elevation);
  float wall = 1.0 - smoothstep(0.75, 0.95, normal.y);
  float edge = max(getRiser(sector) * wall, getRiser(tilt));
  float tone = (getPlaneTone(sector) * 2.0 - 1.0) * wall;
  return RockPlanes(planeNormal, tone * strength, edge * strength);
}

struct RockStrata {
  /** Tone of the bed 0..1 (one per bed). */
  float band;
  /** Recessed seam between two beds (dark). */
  float seam;
  /** Lit top edge of the bed below a seam. */
  float lip;
};

/**
 * Strata beds of varying thickness in world height, dipping regionally (warp 0..1) and bending
 * a little with the form (higher on tops); seams are broken (gaps) and vary in width per bed:
 * a thin recess with a soft shade under the bed above it, a lit lip on the bed below.
 */
RockStrata getStrata(vec3 world, vec3 normal, float warp, float broken) {
  float dip = (warp - 0.5) * 4.0 + world.x * 0.06 - world.z * 0.035 + normal.y * 0.35;
  float height = world.y + dip;
  float layer = height * 0.55 + sin(height * 0.37 + 1.7) * 0.3;
  float index = floor(layer);
  float within = layer - index;
  float band = mix(hashRockId(index), hashRockId(index + 1.0), smoothstep(0.86, 1.0, within));
  float footprint = max(fwidth(layer), 1e-4);
  float width = 0.02 + hashRockId(index + 31.0) * 0.05;
  float present = smoothstep(0.4, 0.58, broken + hashRockId(index + 57.0) * 0.3 - 0.15);
  float distance = min(within, 1.0 - within);
  float line = 1.0 - smoothstep(width - footprint, width + footprint, distance);
  float shade = 1.0 - smoothstep(0.0, width * 4.0 + footprint, within);
  float seam = (line * min(width / footprint, 1.0) * 0.5 + shade * 0.5) * present;
  float lip = smoothstep(0.78, 0.94, within) * (1.0 - line) * present;
  return RockStrata(band, seam, lip);
}

/**
 * One set of vertical joint planes (horizontal normal across; shape: x spacing in world units,
 * y share of open joints, z lean with height) as clefts where the surface cuts a joint: wavy
 * (wiggle 0..1), varying in width and broken along the length. x: darkness (a soft dark core
 * fading into the shadowed wall on one side), y: the lit lip on the other side. Faces parallel
 * to the joint (where it would smear) do not show it.
 */
vec2 getJointCleft(vec3 world, vec3 normal, vec2 across, vec3 shape, float wiggle) {
  float spacing = shape.x;
  float u = dot(world.xz, across) / spacing + (wiggle - 0.5) * 0.4 + world.y * shape.z;
  float footprint = max(fwidth(u) * spacing, 1e-4);
  float joint = floor(u + 0.5);
  float open = step(1.0 - shape.y, hashRockId(joint + spacing * 7.3));
  vec2 alongPoint = vec2(joint * 3.7 + spacing, world.y * 0.28 + dot(world.xz, across.yx) * 0.1);
  float along = valueNoise(alongPoint);
  float width = (0.04 + along * 0.1) * spacing * 0.2 + footprint;
  float offset = (u - joint) * spacing;
  float core = 1.0 - smoothstep(0.0, width, abs(offset));
  float wall = 1.0 - smoothstep(0.0, width * 3.5, -offset);
  float lipEdge = smoothstep(width * 1.4, width * 3.0, offset);
  float lip = smoothstep(width * 0.6, width * 1.4, offset) * (1.0 - lipEdge);
  float facing = 1.0 - smoothstep(0.55, 0.9, abs(dot(normal.xz, across)));
  float shown = open * smoothstep(0.35, 0.5, along) * facing;
  return vec2(max(core * 0.9, wall * step(offset, 0.0) * 0.55), lip) * shown;
}

/**
 * Clefts (x darkness, y lit lip): two major joint sets crossing at about 75 degrees (regional
 * strike from turn 0..1), wide-spaced and few; High adds a sparse, subtle diagonal secondary set.
 */
vec2 getFractures(vec3 world, vec3 normal, float turn) {
  float strike = turn * 1.6;
  vec2 acrossA = vec2(cos(strike), sin(strike));
  vec2 acrossB = vec2(cos(strike + 1.3), sin(strike + 1.3));
  vec4 wiggle = valueNoise4(vec2(world.x + world.z, world.y * 1.6) * 0.3 + 5.1);
  vec2 major = max(
    getJointCleft(world, normal, acrossA, vec3(7.5, 0.55, 0.04), wiggle.r),
    getJointCleft(world, normal, acrossB, vec3(9.5, 0.5, -0.06), wiggle.g)
  );
#ifndef ROCK_LITE
  vec2 acrossC = vec2(cos(strike + 0.6), sin(strike + 0.6));
  vec2 minor = getJointCleft(world, normal, acrossC, vec3(2.6, 0.25, 0.45), wiggle.b);
  major = max(major, minor * 0.35);
#endif
  float tops = smoothstep(0.75, 0.95, normal.y);
  return major * (1.0 - tops * 0.6);
}
`;
