import { DMath } from "../../shared/math/deterministic-math";
import type { Point3 } from "./building-recipe";

/** Row-major 3×3 rotation, matching a recipe part's rotation (rotateX, then Y, then Z: R = Rz·Ry·Rx). */
export type Rotation3 = readonly [Point3, Point3, Point3];

export const multiplyRotations = (a: Rotation3, b: Rotation3): Rotation3 =>
  [0, 1, 2].map(row => [0, 1, 2].map(column =>
    a[row]![0] * b[0]![column]! + a[row]![1] * b[1]![column]! + a[row]![2] * b[2]![column]!)) as unknown as Rotation3;

/** Cosines and sines of XYZ Euler angles, computed once for every point a rotation turns. */
export interface EulerTurn { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number }

export const eulerTurn = ([x, y, z]: Point3): EulerTurn => ({ cx: DMath.cos(x), cy: DMath.cos(y), cz: DMath.cos(z),
  sx: DMath.sin(x), sy: DMath.sin(y), sz: DMath.sin(z) });

export const rotationFromEuler = (angles: Point3): Rotation3 => {
  const { cx, cy, cz, sx, sy, sz } = eulerTurn(angles);
  const rotateX: Rotation3 = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const rotateY: Rotation3 = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const rotateZ: Rotation3 = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  return multiplyRotations(rotateZ, multiplyRotations(rotateY, rotateX));
};

/** The recipe Euler angles of a rotation (inverse of rotationFromEuler). */
export const eulerFromRotation = (matrix: Rotation3): Point3 => {
  const y = DMath.asin(Math.max(-1, Math.min(1, -matrix[2][0])));
  if (Math.abs(matrix[2][0]) > .99999) return [DMath.atan2(-matrix[1][2], matrix[1][1]), y, 0];
  return [DMath.atan2(matrix[2][1], matrix[2][2]), y, DMath.atan2(matrix[1][0], matrix[0][0])];
};

const normalised = (vector: Point3): Point3 => {
  const length = DMath.hypot(...vector);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
};

const cross = (a: Point3, b: Point3): Point3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Rotation turning local +Y onto `up` and local +Z as close as possible onto `forward`. */
export const rotationFromUpForward = (up: Point3, forward: Point3): Rotation3 => {
  const yAxis = normalised(up), xAxis = normalised(cross(yAxis, forward)), zAxis = cross(xAxis, yAxis);
  return [[xAxis[0], yAxis[0], zAxis[0]], [xAxis[1], yAxis[1], zAxis[1]], [xAxis[2], yAxis[2], zAxis[2]]];
};

export const rotatePoint = (matrix: Rotation3, point: Point3): Point3 =>
  [0, 1, 2].map(row => matrix[row]![0] * point[0] + matrix[row]![1] * point[1] + matrix[row]![2] * point[2]) as Point3;

/** (x, y, z) turned by an Euler turn (x first, then y, then z). */
export const turnPoint = (x: number, y: number, z: number, { cx, cy, cz, sx, sy, sz }: EulerTurn): Point3 => {
  const firstY = y * cx - z * sx;
  const firstZ = y * sx + z * cx;
  const secondX = x * cy + firstZ * sy;
  const secondZ = -x * sy + firstZ * cy;
  return [secondX * cz - firstY * sz, secondX * sz + firstY * cz, secondZ];
};

/** `point` rotated by XYZ Euler angles (x first, then y, then z). */
export const rotateByEuler = ([x, y, z]: Point3, rotation: Point3): Point3 => turnPoint(x, y, z, eulerTurn(rotation));
