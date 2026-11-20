import type { Vec3 } from "../props/mesh-builder";
import { WHALE_SHAPES, type WhaleSpecies } from "./whale-species";

/**
 * The pose of the one animated whale: where it is, how it is turned and how its spine bends.
 * The vertex shader bends the mesh with the same formulas (WHALE_BEND_GLSL), so splash points
 * computed here sit on the drawn body.
 */
export interface WhalePose {
  /** Spine curvature in body lengths: < 0 arches the back (ends down), > 0 lifts both ends. */
  arch: number;
  /** World position of the body's middle (body position 0.5). */
  x: number;
  y: number;
  z: number;
  /** Rest-to-world rotation (columns: forward, up, left), times the length in `matrix`. */
  basis: Float32Array;
  /** Pectoral fins turned about their roots (radians, > 0 raises the tips). */
  pectoral: number;
  pitch: number;
  roll: number;
  /** Fluke stroke: amplitude (body lengths) and phase (radians). */
  strokeAmplitude: number;
  strokePhase: number;
  species: WhaleSpecies;
  yaw: number;
}

export const createWhalePose = (): WhalePose => ({
  arch: 0, basis: new Float32Array(9), pectoral: 0, pitch: 0, roll: 0, species: 0,
  strokeAmplitude: 0, strokePhase: 0, x: 0, y: 0, yaw: 0, z: 0
});

/** Spine waves per body length: one long wave, mostly moving the tail. */
export const STROKE_WAVE = 2.4;
/** Body position the arch bends about. */
export const ARCH_CENTRE = 0.45;
/** Body position where the fluke stroke starts to move the spine. */
export const STROKE_START = 0.3;

const strokeEnvelope = (along: number) => {
  const share = Math.max(0, (along - STROKE_START) / (1 - STROKE_START));
  return share * Math.sqrt(share);
};

/** Spine lift (body lengths) at a body position and its slope along the model x axis. */
export const bendSpine = (pose: WhalePose, along: number, out: { lift: number; slope: number }) => {
  const share = Math.max(0, (along - STROKE_START) / (1 - STROKE_START));
  const envelope = strokeEnvelope(along);
  const envelopeSlope = share > 0 ? (1.5 * Math.sqrt(share)) / (1 - STROKE_START) : 0;
  const wave = pose.strokePhase - STROKE_WAVE * along;
  const offset = along - ARCH_CENTRE;
  out.lift = pose.strokeAmplitude * envelope * Math.sin(wave) + pose.arch * offset * offset;
  const liftPerAlong = pose.strokeAmplitude * (envelopeSlope * Math.sin(wave)
    - envelope * STROKE_WAVE * Math.cos(wave)) + 2 * pose.arch * offset;
  out.slope = -liftPerAlong;
  return out;
};

/** Fills the basis: yaw about y, then pitch about the body's side axis, then roll about its length. */
export const updateWhaleBasis = (pose: WhalePose) => {
  const [cy, sy] = [Math.cos(pose.yaw), Math.sin(pose.yaw)];
  const [cp, sp] = [Math.cos(pose.pitch), Math.sin(pose.pitch)];
  const [cr, sr] = [Math.cos(pose.roll), Math.sin(pose.roll)];
  // R = Ry(yaw) * Rz(pitch) * Rx(roll), stored by columns.
  const basis = pose.basis;
  basis[0] = cy * cp; basis[1] = sp; basis[2] = -sy * cp;
  basis[3] = -cy * sp * cr + sy * sr; basis[4] = cp * cr; basis[5] = sy * sp * cr + cy * sr;
  basis[6] = cy * sp * sr + sy * cr; basis[7] = -cp * sr; basis[8] = -sy * sp * sr + cy * cr;
};

const bend = { lift: 0, slope: 0 };

/** World point of a rest model point (body lengths) on the bent, posed body. */
export const toWorld = (pose: WhalePose, point: Vec3, out: { x: number; y: number; z: number }) => {
  const length = WHALE_SHAPES[pose.species]!.length;
  bendSpine(pose, 0.5 - point[0], bend);
  const angle = Math.atan(bend.slope);
  const x = point[0] - point[1] * Math.sin(angle);
  const y = bend.lift + point[1] * Math.cos(angle);
  const z = point[2];
  const basis = pose.basis;
  out.x = pose.x + length * (basis[0]! * x + basis[3]! * y + basis[6]! * z);
  out.y = pose.y + length * (basis[1]! * x + basis[4]! * y + basis[7]! * z);
  out.z = pose.z + length * (basis[2]! * x + basis[5]! * y + basis[8]! * z);
  return out;
};

/** A rest point turned with a pectoral fin about its root (side +1 left fin, -1 right). */
export const turnPectoral = (point: Vec3, root: Vec3, angle: number, side: number): Vec3 => {
  const turn = angle * side;
  const [y, z] = [point[1] - root[1], point[2] - root[2]];
  return [point[0], root[1] + y * Math.cos(turn) + z * Math.sin(turn),
    root[2] - y * Math.sin(turn) + z * Math.cos(turn)];
};
