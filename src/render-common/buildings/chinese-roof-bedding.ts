import type { BuildingPart, Point3 } from "./building-recipe";
import { getEndSlope, getOccupationRoofHeight } from "./occupation-roof-height";

type Point = readonly [number, number];
export interface ChineseRoofPitch {
  depth: number;
  breaks?: readonly number[];
  point: (q: number, s: number) => Point;
  width: number;
}
export interface ChineseRoofBeddingCell {
  points: [Point3, Point3, Point3, Point3];
  outside: readonly number[];
}

/** The four pitches meet exactly on the hip/ridge breaks; a rectangular grid cannot represent them. */
export const chineseRoofPitches = (part: BuildingPart): ChineseRoofPitch[] => {
  const pyramid = part.occupationRoof === "pyramid";
  const hipped = pyramid || part.occupationRoof === "hip" || part.occupationRoof === "half-hip";
  const pitches: ChineseRoofPitch[] = [];
  for (const side of [-1, 1]) {
    pitches.push({ depth: part.size[0] / 2, width: part.size[2],
      breaks: part.occupationRoof === "half-hip" ? [.4 * getEndSlope(part.occupationRoof) / 1.74] : [],
      point: (q, s) => {
      const x = q * .5;
      let reach = .5;
      if (pyramid) reach = x;
      else if (hipped) reach = Math.min(.5, .3 + x * 1.74 / getEndSlope(part.occupationRoof));
      return [side * x, s * reach];
    } });
    if (hipped) pitches.push({ depth: part.size[2] * (pyramid ? .5 : .2),
      width: part.size[0], point: (q, s) => {
        if (pyramid) return [s * q * .5, side * q * .5];
        return [s * q * Math.min(.5, .2 * getEndSlope(part.occupationRoof) / 1.74), side * (.3 + q * .2)];
      } });
  }
  return pitches;
};

const beddingChordInset = (part: BuildingPart, points: ChineseRoofBeddingCell["points"]) => {
  let inset = 0;
  for (const indices of [[0, 1, 2], [0, 2, 3]]) {
      const [a, b, c] = indices.map(index => points[index]!);
      for (let u = 0; u <= 16; u++) for (let v = 0; v <= 16 - u; v++) {
        const p = u / 16, q = v / 16, r = 1 - p - q;
        const x = a![0] * p + b![0] * q + c![0] * r;
        const z = a![2] * p + b![2] * q + c![2] * r;
        const chord = a![1] * p + b![1] * q + c![1] * r;
        const surface = getOccupationRoofHeight(part.occupationRoof, x, z, part.roofSweep, part.roofCurve);
        inset = Math.max(inset, chord - (surface - .018));
      }
    }
  return inset;
};

const beddingCache = new WeakMap<BuildingPart, Map<string, ChineseRoofBeddingCell[]>>();
export const chineseRoofBeddingCells = (part: BuildingPart, detailed: boolean): ChineseRoofBeddingCell[] => {
  const key = `${part.occupationRoof}/${part.roofSweep}/${part.roofCurve}/${detailed}`;
  const cached = beddingCache.get(part)?.get(key);
  if (cached) return cached;
  const rows = detailed ? 4 : 2, columns = detailed ? 6 : 2;
  const gable = part.occupationRoof === "gable", output: ChineseRoofBeddingCell[] = [];
  const regular = Array.from({ length: rows + 1 }, (_, index) => index / rows);
  const halfHipClip = .4 * getEndSlope(part.occupationRoof) / 1.74;
  const hipSeam = part.occupationRoof === "half-hip" ? [...new Set([...regular,
    ...regular.filter(q => q < halfHipClip).map(q => q / halfHipClip)])] : regular;
  for (const [index, pitch] of chineseRoofPitches(part).entries()) {
    // Minimal end pitches use one underlay strip; their ceramic pans retain both columns.
    // Spend the recovered hidden faces on matching every structural hip seam node instead.
    const pitchColumns = !detailed && part.occupationRoof === "half-hip" && index % 2 === 1 ? 1 : columns;
    // Side and end pitches parameterize their shared hip differently. Both must contain the
    // union of seam nodes; otherwise their curved edge chords assign two heights to one point.
    const shared = part.occupationRoof === "half-hip" ?
      hipSeam.map(q => index % 2 === 0 ? q * halfHipClip : q) : [];
    const breaks = [...new Set([...Array.from({ length: rows + 1 }, (_, index) => index / rows),
      ...pitch.breaks ?? [], ...shared])].sort((a, b) => a - b);
    const at = (q: number, s: number): Point3 => {
      const [x, z] = pitch.point(q, s);
      return [x, Math.min(.495, getOccupationRoofHeight(part.occupationRoof, x, z,
        part.roofSweep, part.roofCurve) - .018), z];
    };
    for (let row = 0; row < breaks.length - 1; row++) for (let column = 0; column < pitchColumns; column++) {
      const q0 = breaks[row]!, q1 = breaks[row + 1]!;
      const s0 = column / pitchColumns * 2 - 1, s1 = (column + 1) / pitchColumns * 2 - 1;
      const outside: number[] = [];
      if (row === breaks.length - 2) outside.push(1);
      // Once a half-hip side pitch reaches the clipped eave, both lateral edges become
      // exterior perimeter. Leaving them open exposes the sloping bed underside as dark fins.
      const clippedSideEave = part.occupationRoof === "half-hip" && index % 2 === 0 && q0 >= halfHipClip - 1e-10;
      if ((gable || clippedSideEave) && column === 0) outside.push(0);
      if ((gable || clippedSideEave) && column === pitchColumns - 1) outside.push(2);
      output.push({ points: [at(q0, s0), at(q1, s0), at(q1, s1), at(q0, s1)], outside });
    }
  }
  // A convex swept surface lies below the chords between its coarse bed vertices. Keep the
  // complete bed inset by that interpolation error, rather than letting its dark facets pierce
  // ceramic pans. A uniform inset retains the exact shared pitch seams and the existing LOD cost.
  const inset = part.roofSweep || part.roofCurve ?
    Math.max(0, ...output.map(cell => beddingChordInset(part, cell.points))) : 0;
  if (inset > 1e-9) for (const cell of output)
    cell.points = cell.points.map(([x, y, z]) => [x, y - inset - .002, z]) as ChineseRoofBeddingCell["points"];
  let variants = beddingCache.get(part);
  if (!variants) { variants = new Map(); beddingCache.set(part, variants); }
  variants.set(key, output);
  return output;
};

/** Exact triangle interpolation on the same roof bedding used by native geometry and its bearings. */
export const chineseRoofBeddingHeight = (part: BuildingPart, x: number, z: number, detailed: boolean,
  underside = false): number | null => {
  for (const { points } of chineseRoofBeddingCells(part, detailed)) for (const indices of [[0, 1, 2], [0, 2, 3]]) {
    const [a, b, c] = indices.map(index => points[index]!);
    const denominator = (b![2] - c![2]) * (a![0] - c![0]) + (c![0] - b![0]) * (a![2] - c![2]);
    if (Math.abs(denominator) < 1e-12) continue;
    const u = ((b![2] - c![2]) * (x - c![0]) + (c![0] - b![0]) * (z - c![2])) / denominator;
    const v = ((c![2] - a![2]) * (x - c![0]) + (a![0] - c![0]) * (z - c![2])) / denominator;
    const w = 1 - u - v;
    if (Math.min(u, v, w) < -1e-8) continue;
    const height = (point: Point3) => underside ? Math.max(-.5, point[1] - .07) : point[1];
    return height(a!) * u + height(b!) * v + height(c!) * w;
  }
  return null;
};

/** Exact piecewise-linear contact along an arbitrary ceramic edge crossing the bed's triangles. */
export const chineseRoofContactSamples = (part: BuildingPart, from: Point, to: Point, detailed: boolean) => {
  const shares = [0, 1], dx = to[0] - from[0], dz = to[1] - from[1];
  for (const cell of chineseRoofBeddingCells(part, detailed)) for (const triangle of [[0, 1, 2], [0, 2, 3]])
    for (let edge = 0; edge < 3; edge++) {
      const a = cell.points[triangle[edge]!]!, b = cell.points[triangle[(edge + 1) % 3]!]!;
      const ex = b[0] - a[0], ez = b[2] - a[2], denominator = dx * ez - dz * ex;
      if (Math.abs(denominator) < 1e-12) continue;
      const ax = a[0] - from[0], az = a[2] - from[1];
      const t = (ax * ez - az * ex) / denominator, u = (ax * dz - az * dx) / denominator;
      if (t > 1e-8 && t < 1 - 1e-8 && u >= -1e-8 && u <= 1 + 1e-8) shares.push(t);
    }
  const samples: { height: number; share: number }[] = [];
  for (const share of shares.sort((a, b) => a - b)) {
    if (samples.length && Math.abs(share - samples.at(-1)!.share) < 1e-8) continue;
    const height = chineseRoofBeddingHeight(part, from[0] + dx * share, from[1] + dz * share, detailed);
    if (height !== null) samples.push({ height, share });
    while (samples.length >= 3) {
      const [a, b, c] = samples.slice(-3);
      const straight = a!.height + (c!.height - a!.height) * (b!.share - a!.share) / (c!.share - a!.share);
      if (Math.abs(straight - b!.height) > 1e-9) break;
      samples.splice(samples.length - 2, 1);
    }
  }
  return samples;
};
