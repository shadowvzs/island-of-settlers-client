import { smoothstep } from "../../../shared/world/noise";
import type { Random } from "../../../shared/world/rng";
import { MeshBuilder, type PropMesh, type Vec3 } from "../mesh-builder";
import {
  addShellSurface,
  finishStill,
  mixColor,
  scaleColor,
  type ShellSurface,
  SHELL_FAMILY,
  sinkSurfaces,
  toShellUv
} from "./shell-surface";

/**
 * Bivalve valves (scallop, cockle) for the beaches. One valve is a polar grid around its umbo:
 * the outline is a disc set off from the umbo, clipped by the straight hinge line (plus the
 * scallop's ears); the dome, the radial ribs and a rim that dips into the sand are geometry,
 * growth lines, colour bands, chevrons and nacre come from the shell shader.
 */

/** Shader patterns of the bivalve family (three-shell-shading.ts). */
export const VALVE_PATTERN = { clam: 2, cockle: 1, scallop: 0 } as const;

export interface ValveShape {
  /** Disc centre in front of the umbo, as a share of the disc radius. */
  discCentre: number;
  /** Dome height and steepness (share of the disc radius). */
  dome: number;
  domePower: number;
  /** Ear half-width and front reach (0: no ears). */
  earFront: number;
  ears: number;
  /** Hinge line distance behind the umbo. */
  hingeBack: number;
  pattern: number;
  ribDepth: number;
  /** Ribs per radian around the umbo (the shader's rib frequency for the same pattern). */
  ribs: number;
  /** Wavy (scalloped) rim: radial in-out of the outline with the ribs (share of the radius). */
  rimWave: number;
}

/** Scallop: about 18 broad corrugated ribs over the fan, wavy rim, hinge ears, slightly cupped. */
export const SCALLOP: ValveShape = {
  discCentre: 0.55, dome: 0.3, domePower: 0.6, earFront: 0.28, ears: 0.6, hingeBack: 0.1,
  pattern: VALVE_PATTERN.scallop, ribDepth: 0.09, ribs: 7, rimWave: 0.05
};

/** Smooth clam: oval, gently domed, no ribs (concentric bands come from the shader). */
export const CLAM: ValveShape = {
  discCentre: 0.3, dome: 0.26, domePower: 0.55, earFront: 0, ears: 0, hingeBack: 0.2,
  pattern: VALVE_PATTERN.clam, ribDepth: 0, ribs: 1, rimWave: 0
};

export const COCKLE: ValveShape = {
  discCentre: 0.38, dome: 0.34, domePower: 0.5, earFront: 0, ears: 0, hingeBack: 0.22,
  pattern: VALVE_PATTERN.cockle, ribDepth: 0.06, ribs: 9, rimWave: 0.035
};

/**
 * Light cream shell base: the instance tint (shore-details) turns it cream-tan, orange, coral pink,
 * lilac or yellow, and the shader's bands darken it in the same hue.
 */
export const SHELL_BASE: Vec3 = [1, 0.95, 0.86];
/** Inside of a valve: off-white, light grey-beige (the shader desaturates the instance tint). */
const NACRE_TONE: Vec3 = [0.9, 0.87, 0.82];

const VALVE_COLUMNS = 56;
/** Rows from the umbo to the rim: smooth colour gradients and a round rim on High. */
const VALVE_ROWS = 12;
/** Rim dip into the sand (share of the disc radius): no gap on gently sloped beaches. */
const RIM_SINK = 0.02;

/** Distance from the umbo to the outline along angle (0: towards the ventral rim). */
const getOutline = (shape: ValveShape, angle: number) => {
  const along = Math.cos(angle);
  const across = Math.sin(angle);
  const c = shape.discCentre;
  const disc = c * along + Math.sqrt(c * c * along * along + 1 - c * c);
  const hinge = along < -0.01 ? shape.hingeBack / -along : Infinity;
  const body = Math.min(disc, hinge);
  if (shape.ears === 0) return body;
  const sideways = Math.abs(across) > 1e-4 ? shape.ears / Math.abs(across) : Infinity;
  const ear = Math.min(sideways, along > 0 ? shape.earFront / along : hinge);
  return Math.max(body, ear);
};

/** Dome height (unit disc radius) at a local point; zero outside the disc (the flat ears). */
const getDome = (shape: ValveShape, x: number, z: number) => {
  const fromCentre = Math.hypot(x, z - shape.discCentre);
  if (fromCentre >= 1) return 0.015;
  return shape.dome * Math.pow(1 - fromCentre * fromCentre, shape.domePower) + 0.015;
};

/** Angle around the umbo (0: towards the ventral rim) of grid column u. */
const getValveAngle = (u: number) => (u - 0.5) * Math.PI * 2;

/** Local valve point (unit disc radius, umbo at the origin, convex side up) at grid (u, v). */
export const getValvePoint = (shape: ValveShape, u: number, radial: number): Vec3 => {
  const angle = getValveAngle(u);
  // Ribs and the wavy rim belong to the fan; they fade out towards the straight hinge line.
  const fan = smoothstep(-0.8, -0.35, Math.cos(angle));
  const wave = Math.cos(angle * shape.ribs) * fan;
  const plain = radial * getOutline(shape, angle);
  const onDisc = getDome(shape, Math.sin(angle) * plain, Math.cos(angle) * plain) > 0.02 ? 1 : 0;
  const distance = plain * (1 + shape.rimWave * wave * onDisc * radial);
  const x = Math.sin(angle) * distance, z = Math.cos(angle) * distance;
  const ribFade = smoothstep(0.05, 0.4, radial) * onDisc;
  const rib = Math.pow(0.5 + 0.5 * wave, 3) * shape.ribDepth * ribFade * radial * fan;
  const sink = RIM_SINK * smoothstep(0.82, 1, radial);
  return [x, getDome(shape, x, z) + rib - sink, z];
};

/** Darker grooves between the ribs in the vertex colour (the fan reads at any light angle). */
const getRibShade = (shape: ValveShape, u: number, radial: number) => {
  if (shape.ribDepth === 0) return 1;
  const angle = getValveAngle(u);
  const fan = smoothstep(-0.8, -0.35, Math.cos(angle)) * smoothstep(0.05, 0.35, radial);
  return 1 - 0.42 * fan * (0.5 - 0.5 * Math.cos(angle * shape.ribs));
};

export interface ValveOptions {
  /** Grid columns around the umbo (default VALVE_COLUMNS). */
  columns?: number;
  /** Interior face up (an upturned valve: the nacre side shows). */
  flipped?: boolean;
  pattern?: number;
  shape: ValveShape;
  /** Valve length from the umbo to the ventral rim (cells). */
  size: number;
  tone: Vec3;
}

export const getScale = (options: ValveOptions) => options.size / (options.shape.discCentre + 1);

/** The ribbed outer face. Flipped: mirrored down and lifted so the rim is the top. */
export const getValveOuter = (options: ValveOptions): ShellSurface => {
  const { flipped, shape, tone } = options;
  const scale = getScale(options);
  const pattern = options.pattern ?? shape.pattern;
  const lift = shape.dome * 0.8;
  const pointAt = (u: number, v: number): Vec3 => {
    const [x, y, z] = getValvePoint(shape, u, v);
    return [x * scale, (flipped ? lift - y : y) * scale, z * scale];
  };
  return {
    colorAt: (u, v) => scaleColor(mixColor(scaleColor(tone, 0.82), tone, smoothstep(0, 0.5, v)),
      getRibShade(shape, u, v)),
    columns: options.columns ?? VALVE_COLUMNS,
    insideAt: (u, v) => {
      const point = pointAt(u, v);
      return [point[0], point[1] + (flipped ? 1 : -1) * scale, point[2]];
    },
    pointAt,
    rows: VALVE_ROWS,
    uvAt: (u, v) => toShellUv(SHELL_FAMILY.bivalve, u, v, pattern)
  };
};

/** The smooth inner (nacre / porcelain) face, `thickness` inside the outer face. */
export const getValveInner = (options: ValveOptions, thickness: number): ShellSurface => {
  const outer = getValveOuter(options);
  const scale = getScale(options);
  const offset = (options.flipped ? 1 : -1) * thickness * scale;
  const pointAt = (u: number, v: number): Vec3 => {
    const [x, y, z] = outer.pointAt(u, v);
    const ribless = getValvePoint({ ...options.shape, ribDepth: 0 }, u, v)[1] * scale;
    const base = options.flipped ? options.shape.dome * 0.8 * scale - ribless : ribless;
    return [x, base + offset * (1 - v * v * 0.8) + (y - base) * 0.2, z];
  };
  return {
    colorAt: (u, v) => mixColor(NACRE_TONE, options.tone, smoothstep(0.82, 1, v) * 0.7),
    columns: options.columns ?? VALVE_COLUMNS,
    insideAt: (u, v) => {
      const point = pointAt(u, v);
      return [point[0], point[1] + (options.flipped ? -1 : 1) * scale, point[2]];
    },
    pointAt,
    rows: VALVE_ROWS,
    uvAt: (u, v) => toShellUv(SHELL_FAMILY.nacre, u, v, options.shape.pattern)
  };
};

/** A single valve always lies inside down: the ribbed, coloured outer side faces up. */
const SINGLE_VALVES = [SCALLOP, COCKLE, CLAM];

/**
 * Seashells for sandy beaches, single valves lying convex side up with the rim on the sand:
 * variant 0 scallop (ears, corrugated ribs, wavy rim), 1 cockle (domed, radial ribs), 2 smooth
 * clam (concentric bands). Length 0.12-0.16 cells. Colour comes from the instance tint.
 */
export const createSeashell = (random: Random, variant: number): PropMesh => {
  const builder = new MeshBuilder();
  const size = 0.12 + random() * 0.04;
  const shape = SINGLE_VALVES[variant % SINGLE_VALVES.length]!;
  const [outer] = sinkSurfaces([getValveOuter({ shape, size, tone: SHELL_BASE })], 0);
  addShellSurface(builder, outer!, size * 0.15);
  return finishStill(builder);
};
