import type { Vec3 } from "../props/mesh-builder";
import { toWorld, turnPectoral, type WhalePose } from "./whale-pose";
import { sampleProfile, WHALE_SHAPES, type WhaleShape } from "./whale-species";

/**
 * Points on the body that throw water where they cross the surface: a fast entry splashes (its
 * strength from the speed and the point's share of the body), a fast exit streams water off.
 * Positions are rest model points in body lengths; pectoral tips turn with the fins.
 */
interface SplashPoint {
  /** Rest point (pectoral tips: before the fin turns). */
  at: Vec3;
  /** Root of the pectoral fin the point turns with (null: a body point). */
  hinge: Vec3 | null;
  /** -1 / 1 for the right / left pectoral tip, 0 elsewhere. */
  pectoral: number;
  /** Splash radius per body length at a reference entry speed. */
  weight: number;
}

/** Entry / exit speeds (world units / s) that throw water, and the speed of a full splash. */
const ENTRY_SPEED = 0.9;
const EXIT_SPEED = 1.1;
const FULL_SPEED = 2.2;
/** Seconds a point stays quiet after a splash (no double splashes on a bobbing crossing). */
const COOLDOWN = 0.35;

/** The dorsal / ventral midline of the body (its ring spans -bottom .. top about the axis). */
const bodyTop = (shape: WhaleShape, along: number): Vec3 => [0.5 - along, sampleProfile(shape.top, along), 0];

const bodyBottom = (shape: WhaleShape, along: number): Vec3 =>
  [0.5 - along, -sampleProfile(shape.bottom, along), 0];

const finTip = (shape: WhaleShape, side: number): Vec3 => {
  const { pectoral } = shape;
  const tip: Vec3 = [
    pectoral.root[0] + pectoral.spanDirection[0] * pectoral.span - sampleProfile(pectoral.sweep, 1),
    pectoral.root[1] + pectoral.spanDirection[1] * pectoral.span,
    pectoral.root[2] + pectoral.spanDirection[2] * pectoral.span
  ];
  return [tip[0], tip[1], tip[2] * side];
};

const flukeTip = (shape: WhaleShape, side: number): Vec3 => {
  const { fluke } = shape;
  return [fluke.root[0] - sampleProfile(fluke.sweep, 0.8), fluke.root[1], fluke.span * 0.8 * side];
};

const bodyPoint = (at: Vec3, weight: number): SplashPoint => ({ at, hinge: null, pectoral: 0, weight });

const finPoint = (shape: WhaleShape, side: number): SplashPoint => {
  const [x, y, z] = shape.pectoral.root;
  return { at: finTip(shape, side), hinge: [x, y, z * side], pectoral: side, weight: 0.12 };
};

const createSplashPoints = (shape: WhaleShape): SplashPoint[] => [
  bodyPoint([0.49, 0, 0], 0.14),
  bodyPoint(bodyTop(shape, 0.16), 0.2),
  bodyPoint(bodyTop(shape, 0.4), 0.26),
  bodyPoint(bodyBottom(shape, 0.38), 0.3),
  bodyPoint(bodyTop(shape, 0.72), 0.16),
  bodyPoint([shape.fluke.root[0] - 0.02, shape.fluke.root[1], 0], 0.2),
  bodyPoint(flukeTip(shape, 1), 0.1),
  bodyPoint(flukeTip(shape, -1), 0.1),
  finPoint(shape, 1),
  finPoint(shape, -1)
];

const SPLASH_POINTS = WHALE_SHAPES.map(createSplashPoints);

export interface SplashSink {
  /** A splash of `strength` (about its radius, world units) at a point on the water. */
  splash: (x: number, z: number, strength: number) => void;
  /** Water streaming off a point leaving the water at `speed`. */
  stream: (x: number, y: number, z: number, speed: number) => void;
}

/** Tracks the splash points of the posed whale from frame to frame. */
export const createSplashTracker = () => {
  const count = SPLASH_POINTS[0]!.length;
  const previous = new Float32Array(count);
  const cooldown = new Float32Array(count);
  const world = { x: 0, y: 0, z: 0 };
  let primed = false;

  const pointOf = (pose: WhalePose, point: SplashPoint) => {
    const rest = point.hinge ? turnPectoral(point.at, point.hinge, pose.pectoral, point.pectoral) : point.at;
    return toWorld(pose, rest, world);
  };

  const track = (
    pose: WhalePose,
    seconds: number,
    waterAt: (x: number, z: number) => number,
    sink: SplashSink
  ) => {
    const points = SPLASH_POINTS[pose.species]!;
    const length = WHALE_SHAPES[pose.species]!.length;
    for (let index = 0; index < count; index += 1) {
      const { x, y, z } = pointOf(pose, points[index]!);
      const height = y - waterAt(x, z);
      cooldown[index] = Math.max(0, cooldown[index]! - seconds);
      const before = previous[index]!;
      previous[index] = height;
      if (!primed || seconds <= 0 || cooldown[index]! > 0) continue;
      const speed = (height - before) / seconds;
      if (before > 0 && height <= 0 && speed < -ENTRY_SPEED) {
        const share = Math.min(1.6, Math.max(0.35, -speed / FULL_SPEED));
        sink.splash(x, z, points[index]!.weight * length * share);
        cooldown[index] = COOLDOWN;
      } else if (before <= 0 && height > 0 && speed > EXIT_SPEED) {
        sink.stream(x, y, z, speed);
        cooldown[index] = COOLDOWN * 0.5;
      }
    }
    primed = true;
  };

  return {
    reset: () => {
      primed = false;
      cooldown.fill(0);
    },
    track
  };
};
