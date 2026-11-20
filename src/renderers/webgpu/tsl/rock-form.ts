import {
  abs,
  atan,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  normalize,
  sin,
  smoothstep,
  step,
  vec2,
  vec3
} from "three/tsl";

import { SNOW_PALETTE } from "../../../render-common/snow-palette";
import {
  ROCK_PLANE_SECTOR,
  ROCK_PLANE_SECTORS,
  ROCK_PLANE_SOFTNESS,
  ROCK_PLANE_TILT,
  ROCK_SNOW_LINE,
  ROCK_WINTER_SNOW_LINE_DROP
} from "../../../render-common/shaders/rock-tuning";
import { PREVAILING_WIND_DIRECTION } from "../../../shared/world/prevailing-wind";

/**
 * TSL twin of `rock-form-glsl.ts` and `rock-snow-glsl.ts`: broad planes, strata beds, joint
 * fractures and the snow cover of the sculpted rock. Pure node builders; the material binds the
 * noise and snow textures.
 */
type TslNode = any; // TSL's generated types do not model the proxied node methods.
type NoiseNode = (point: TslNode) => TslNode;

const SNOW_WIND = vec2(PREVAILING_WIND_DIRECTION.x, PREVAILING_WIND_DIRECTION.z);
const ROCK_LEE = vec3(...SNOW_PALETTE.rockLee);

/** `hashRockId`: shared deterministic per-id hash of the form layers. */
export const hashRockId = (id: TslNode): TslNode =>
  fract(sin(id.mul(12.9898).add(4.1)).mul(43758.5453));

/** GLSL smoothstep with descending edges, safe on WGSL where the builtin is undefined. */
export const smoothstepDescending = (high: number, low: number, value: TslNode): TslNode =>
  float(1).sub(smoothstep(low, high, value));

/** Soft staircase: flat treads at whole numbers, smooth risers between them. */
const softSnap = (value: TslNode): TslNode => {
  const tread = floor(value);
  return tread.add(smoothstep(0.5 - ROCK_PLANE_SOFTNESS, 0.5 + ROCK_PLANE_SOFTNESS, value.sub(tread)));
};

/** Tone per azimuth sector, blended over the same risers. */
const getPlaneTone = (sector: TslNode): TslNode => {
  const tread = floor(sector);
  const next = smoothstep(0.5 - ROCK_PLANE_SOFTNESS, 0.5 + ROCK_PLANE_SOFTNESS, sector.sub(tread));
  return mix(hashRockId(tread.mod(ROCK_PLANE_SECTORS)),
    hashRockId(tread.add(1).mod(ROCK_PLANE_SECTORS)), next);
};

const getRiser = (value: TslNode): TslNode =>
  smoothstepDescending(ROCK_PLANE_SOFTNESS + 0.08, 0, abs(fract(value).sub(0.5)));

export interface RockPlanes {
  edge: TslNode;
  normal: TslNode;
  tone: TslNode;
}

/**
 * Broad planes: the normal's azimuth and tilt softly snapped to a few orientations, the sector
 * set turned regionally (turn 0..1). The normal is turned before atan, so its +-pi wrap falls on
 * a riser midpoint (seamless with an odd count).
 */
export const getRockPlanes = (normalInput: TslNode, turn: TslNode,
  strength: TslNode): RockPlanes => {
  const normal: TslNode = normalize(normalInput);
  const offset: TslNode = turn.sub(0.5).mul(2.4);
  const turnCos: TslNode = cos(offset);
  const turnSin: TslNode = sin(offset);
  const turnedX: TslNode = turnCos.mul(normal.x).sub(turnSin.mul(normal.z));
  const turnedZ: TslNode = turnSin.mul(normal.x).add(turnCos.mul(normal.z));
  const sector: TslNode = atan(turnedZ, turnedX).div(ROCK_PLANE_SECTOR);
  const tilt: TslNode = atan(normal.y, length(normal.xz)).div(ROCK_PLANE_TILT);
  const azimuth: TslNode = mix(sector, softSnap(sector), strength).mul(ROCK_PLANE_SECTOR).sub(offset);
  const elevation: TslNode = mix(tilt, softSnap(tilt), strength).mul(ROCK_PLANE_TILT);
  const plane = vec3(cos(azimuth).mul(cos(elevation)), sin(elevation),
    sin(azimuth).mul(cos(elevation)));
  const wall = float(1).sub(smoothstep(0.75, 0.95, normal.y));
  const edge = max(getRiser(sector).mul(wall), getRiser(tilt));
  const tone = getPlaneTone(sector).mul(2).sub(1).mul(wall);
  return { edge: edge.mul(strength), normal: plane, tone: tone.mul(strength) };
};

export interface RockStrata {
  band: TslNode;
  lip: TslNode;
  seam: TslNode;
}

/**
 * Strata beds of varying thickness in world height, dipping regionally (warp 0..1) and bending a
 * little with the form; seams are broken (gaps) and vary in width per bed. `layerFootprint` is
 * `fwidth(layer)` in the material; the parity bench passes it so the kernel stays testable.
 */
export const getStrata = (world: TslNode, normal: TslNode, warp: TslNode,
  broken: TslNode, layerFootprint?: TslNode): RockStrata => {
  const dip = warp.sub(0.5).mul(4).add(world.x.mul(0.06)).sub(world.z.mul(0.035))
    .add(normal.y.mul(0.35));
  const height = world.y.add(dip);
  const layer = height.mul(0.55).add(sin(height.mul(0.37).add(1.7)).mul(0.3));
  const index = floor(layer);
  const within = layer.sub(index);
  const band = mix(hashRockId(index), hashRockId(index.add(1)), smoothstep(0.86, 1, within));
  const footprint = max(layerFootprint ?? fwidth(layer), 1e-4);
  const width = float(0.02).add(hashRockId(index.add(31)).mul(0.05));
  const present = smoothstep(0.4, 0.58,
    broken.add(hashRockId(index.add(57)).mul(0.3)).sub(0.15));
  const distance = min(within, float(1).sub(within));
  const line = float(1).sub(smoothstep(width.sub(footprint), width.add(footprint), distance));
  const shade = float(1).sub(smoothstep(0, width.mul(4).add(footprint), within));
  const seam = line.mul(min(width.div(footprint), 1)).mul(0.5).add(shade.mul(0.5)).mul(present);
  const lip = smoothstep(0.78, 0.94, within).mul(float(1).sub(line)).mul(present);
  return { band, lip, seam };
};

export interface RockFormNodes {
  getFractures(world: TslNode, normal: TslNode, turn: TslNode,
    uFootprint?: TslNode): TslNode;
}

/**
 * One set of vertical joint planes (horizontal normal across; shape: x spacing, y share of open
 * joints, z lean with height) as clefts where the surface cuts a joint. `uFootprint` is
 * `fwidth(u)` in the material; the parity bench passes it so the kernel stays testable.
 */
const createJointCleft = (valueNoise: NoiseNode) =>
  (world: TslNode, normal: TslNode, across: TslNode, shape: TslNode,
    wiggle: TslNode, uFootprint?: TslNode): TslNode => {
    const spacing = shape.x;
    const u = dot(world.xz, across).div(spacing).add(wiggle.sub(0.5).mul(0.4))
      .add(world.y.mul(shape.z));
    const footprint = max((uFootprint ?? fwidth(u)).mul(spacing), 1e-4);
    const joint = floor(u.add(0.5));
    const open = step(float(1).sub(shape.y), hashRockId(joint.add(spacing.mul(7.3))));
    const alongPoint = vec2(joint.mul(3.7).add(spacing),
      world.y.mul(0.28).add(dot(world.xz, across.yx).mul(0.1)));
    const along = valueNoise(alongPoint);
    const width = float(0.04).add(along.mul(0.1)).mul(spacing).mul(0.2).add(footprint);
    const offset = u.sub(joint).mul(spacing);
    const core = float(1).sub(smoothstep(0, width, abs(offset)));
    const wall = float(1).sub(smoothstep(0, width.mul(3.5), offset.negate()));
    const lipEdge = smoothstep(width.mul(1.4), width.mul(3), offset);
    const lip = smoothstep(width.mul(0.6), width.mul(1.4), offset).mul(float(1).sub(lipEdge));
    const facing = float(1).sub(smoothstep(0.55, 0.9, abs(dot(normal.xz, across))));
    const shown = open.mul(smoothstep(0.35, 0.5, along)).mul(facing);
    const darkness: TslNode = max(core.mul(0.9), wall.mul(step(offset, 0)).mul(0.55));
    const litLip: TslNode = lip;
    return vec2(darkness, litLip).mul(shown);
  };

/**
 * Clefts (x darkness, y lit lip): two major joint sets crossing at about 75 degrees (regional
 * strike from turn 0..1); High adds a sparse, subtle diagonal secondary set.
 */
export const createRockFormNodes = (valueNoise: NoiseNode, valueNoise4: NoiseNode,
  detailed: boolean): RockFormNodes => {
  const getJointCleft = createJointCleft(valueNoise);

  const getFractures = (world: TslNode, normal: TslNode, turn: TslNode,
    uFootprint?: TslNode): TslNode => {
    const strike = turn.mul(1.6);
    const acrossA = vec2(cos(strike), sin(strike));
    const acrossB = vec2(cos(strike.add(1.3)), sin(strike.add(1.3)));
    const wiggle = valueNoise4(vec2(world.x.add(world.z), world.y.mul(1.6)).mul(0.3).add(5.1));
    let major = max(
      getJointCleft(world, normal, acrossA, vec3(7.5, 0.55, 0.04), wiggle.r, uFootprint),
      getJointCleft(world, normal, acrossB, vec3(9.5, 0.5, -0.06), wiggle.g, uFootprint)
    );
    if (detailed) {
      const acrossC = vec2(cos(strike.add(0.6)), sin(strike.add(0.6)));
      const minor = getJointCleft(world, normal, acrossC, vec3(2.6, 0.25, 0.45), wiggle.b,
        uFootprint);
      major = max(major, minor.mul(0.35));
    }
    const tops = smoothstep(0.75, 0.95, normal.y);
    return major.mul(float(1).sub(tops.mul(0.6)));
  };

  return { getFractures };
};

/** Snow line here: lower where the theme brings winter (the snow map). */
export const getRockSnowLine = (world: TslNode,
  snowAt: (xz: TslNode) => TslNode): TslNode => {
  const warmLine = float(ROCK_SNOW_LINE);
  const coldLine = warmLine.sub(snowAt(world.xz).mul(ROCK_WINTER_SNOW_LINE_DROP));
  const alwaysWarm = world.y.lessThan(ROCK_SNOW_LINE - ROCK_WINTER_SNOW_LINE_DROP - 1);
  return alwaysWarm.select(warmLine, coldLine);
};

/** Lee exposure -1 (windward) .. 1 (lee) of a sloped face. */
export const getSnowLee = (normal: TslNode): TslNode =>
  dot(normalize(normal.xz.add(vec2(1e-4))), SNOW_WIND).mul(float(1).sub(normal.y));

/**
 * Snow cover 0..1: lies only on gentle upward faces above the snow line, drifts on lee faces and
 * in hollows, and breaks up at its edge (the stone texture shows through). `snowLine` is computed
 * by `getRockSnowLine` so the kernel stays free of the snow map (parity-testable).
 */
export const getSnowCover = (world: TslNode, normal: TslNode, mask: TslNode, materials: TslNode,
  patches: TslNode, snowLine: TslNode): TslNode => {
  const lee = getSnowLee(normal);
  const line = snowLine.add(patches.x.sub(0.5).mul(1.2)).sub(lee.mul(0.3));
  const altitude = smoothstep(line.sub(0.12), line.add(0.45), world.y);
  const stone = materials.g.sub(materials.r).mul(0.35);
  const hold = normal.y.add(patches.x.sub(0.5).mul(0.22)).add(lee.mul(0.14))
    .add(mask.w.mul(0.06)).add(stone);
  const lying = smoothstep(0.72, 0.94, hold.add(patches.y.sub(0.5).mul(0.25)));
  const edge = lying.mul(float(1).sub(lying)).mul(4);
  const speckle = materials.g.sub(0.5).mul(1.4).add(materials.b.sub(0.5).mul(0.6));
  const cover = smoothstep(0.3, 0.7, lying.add(speckle.mul(edge).mul(0.9)));
  const specks = smoothstep(0.56, 0.68, materials.g.add(patches.y.sub(0.5).mul(0.5)));
  const dusting = smoothstep(0.65, 0.84, hold).mul(specks);
  return altitude.lessThanEqual(0).select(float(0), altitude.mul(max(cover, dusting.mul(0.5))));
};

/** Snow surface normal: leans up (snow softens the form and hides the facets beneath). */
export const getSnowNormal = (normal: TslNode): TslNode =>
  normalize(normal.add(vec3(0, 0.35, 0)));

/**
 * Snow albedo: below pure white (as the ground's snow); wind ripples across the drift direction,
 * brighter drifts, cool blue on lee faces and where the snow turns from the sky.
 */
export const getSnowColor = (world: TslNode, normal: TslNode, patches: TslNode): TslNode => {
  const warp = patches.x.sub(0.5).mul(6).add(patches.y.sub(0.5).mul(4));
  const ripples = sin(dot(world.xz, SNOW_WIND).mul(3.1).add(world.y.mul(0.8)).add(warp))
    .mul(0.5).add(0.5);
  const tone = float(0.54).add(smoothstep(0.4, 0.7, patches.y).mul(0.05))
    .sub(ripples.mul(0.035));
  const lee = clamp(getSnowLee(normal).mul(2), 0, 1);
  const turned = float(1).sub(smoothstep(0.75, 0.98, normal.y));
  return vec3(tone).mul(mix(vec3(1), ROCK_LEE, max(lee.mul(0.6), turned.mul(0.7))));
};
