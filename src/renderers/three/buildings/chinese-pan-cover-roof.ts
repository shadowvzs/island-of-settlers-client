import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";
import { chineseRoofBeddingCells, chineseRoofContactSamples, chineseRoofPitches } from "../../../render-common/buildings/chinese-roof-bedding";
import { getEndSlope, getOccupationRoofHeight }
  from "../../../render-common/buildings/occupation-roof-height";

type Point = readonly [number, number];
const UP = new Vector3(0, 1, 0), DOWN = new Vector3(0, -1, 0);

/** Individually lapped concave pans and rounded ceramic covers, on the canonical curved roof. */
export const createChinesePanCoverRoof = (part: BuildingPart, detailed: boolean) => {
  const positions: number[] = [], colours: number[] = [], uvs: number[] = [];
  let shade = 1;
  const at = (x: number, z: number, lift = 0) => new Vector3(x,
    Math.min(.495, getOccupationRoofHeight(part.occupationRoof, x, z, part.roofSweep, part.roofCurve) + lift), z);
  const triangle = (a: Vector3, b: Vector3, c: Vector3, hint = UP) => {
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    if (normal.lengthSq() < 1e-16) return;
    const points = normal.dot(hint) >= 0 ? [a, b, c] : [a, c, b];
    for (const point of points) {
      positions.push(...point.toArray());colours.push(shade, shade, shade);
      uvs.push((point.z + .5) * part.size[2], (point.x + .5) * part.size[0]);
    }
  };
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3, hint = UP) => {
    triangle(a, b, c, hint);triangle(a, c, d, hint);
  };
  // Ceramic edge thickness follows the actual triangulated bed, including coarse Minimal hips.
  // Without this closure a long tile bank/cap can bridge above a swept silhouette like a loose wire.
  const contactSkirt = (a: Vector3, b: Vector3, hint: Vector3) => {
    const samples = chineseRoofContactSamples(part, [a.x, a.z], [b.x, b.z], detailed);
    for (let index = 1; index < samples.length; index++) {
      const first = samples[index - 1]!, next = samples[index]!;
      const p = a.clone().lerp(b, first.share), q = a.clone().lerp(b, next.share);
      quad(p, q, new Vector3(q.x, next.height - .001, q.z),
        new Vector3(p.x, first.height - .001, p.z), hint);
    }
  };
  // One closed inexpensive bedding shell remains opaque between every ceramic piece.
  for (const cell of chineseRoofBeddingCells(part, detailed)) {
    const points = cell.points.map(point => new Vector3(...point));
    const low = points.map(point => new Vector3(point.x, Math.max(-.5, point.y - .07), point.z));
    shade = .90; quad(points[0]!, points[1]!, points[2]!, points[3]!);
    quad(low[0]!, low[1]!, low[2]!, low[3]!, DOWN);
    for (const edge of cell.outside) {
      const next = (edge + 1) % 4, a = points[edge]!, b = points[next]!;
      quad(a, b, low[next]!, low[edge]!, new Vector3(a.x + b.x, 0, a.z + b.z));
    }
  }
  const pyramid = part.occupationRoof === "pyramid";
  const hipped = pyramid || part.occupationRoof === "hip" || part.occupationRoof === "half-hip";
  const pitches = chineseRoofPitches(part);
  for (const pitch of pitches) {
    const spacing = detailed ? part.roofTileSpacing ?? 1 : 1;
    const broadMinimal = !detailed && part.size[0] * part.size[2] > 12;
    const gableMinimal = !detailed && part.occupationRoof === "gable";
    const minimumRows = detailed ? 2 : 1;
    const maximumRows = detailed ? 7 : 1;
    const rows = Math.max(minimumRows, Math.min(maximumRows,
      Math.ceil(pitch.depth / (detailed ? .29 * spacing : .6))));
    let maximumColumns = detailed ? 16 : 2;
    if (broadMinimal) maximumColumns = 3;
    if (gableMinimal) maximumColumns = 4;
    let minimumColumns = detailed ? 3 : 2;
    if (gableMinimal) minimumColumns = 4;
    const columns = Math.max(minimumColumns, Math.min(maximumColumns,
      Math.ceil(pitch.width / (detailed ? .26 * spacing : .55))));
    const strips = detailed ? 3 : 2;
    const point = (q: number, s: number, lift = 0) => {
      const [x, z] = pitch.point(q, Math.max(-.999, Math.min(.999, s)));
      return at(x, z, lift);
    };
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const q0 = Math.max(0, (row - .12) / rows), q1 = (row + 1) / rows;
      const s0 = column / columns * 2 - 1, s1 = (column + 1) / columns * 2 - 1;
      const centre = (s0 + s1) / 2, half = (s1 - s0) * .24;
      shade = .96 + ((row * 13 + column * 7) % 5) * .008;
      // Concave pans have a shallow central trough and physically separate uphill/downhill lips.
      const panMiddle = .002, panEdge = .014;
      const lap = (q: number) => .024 * (q - q0) / (q1 - q0);
      const arch = (q: number, cross: number) =>
        point(q, centre + cross * half, .015 + lap(q)
          + Math.sqrt(Math.max(0, 1 - cross * cross)) * .052);
      // A half-hip pitch changes plan direction where it reaches the eave. A ceramic bank
      // must contain that same corner; bridging it leaves a triangular hole beside the hip.
      const cuts = [q0, ...(pitch.breaks ?? []).filter(q => q > q0 && q < q1), q1];
      const ceramicSegment = (from: number, to: number) => {
        quad(point(from, s0, panEdge + lap(from)), point(to, s0, panEdge + lap(to)),
          point(to, centre, panMiddle + lap(to)), point(from, centre, panMiddle + lap(from)));
        quad(point(from, centre, panMiddle + lap(from)), point(to, centre, panMiddle + lap(to)),
          point(to, s1, panEdge + lap(to)), point(from, s1, panEdge + lap(from)));
        if (column === 0 || column === columns - 1) {
          const edge = column === 0 ? s0 : s1;
          const a = point(from, edge, panEdge + lap(from)), b = point(to, edge, panEdge + lap(to));
          // The outer sample is clamped to ±.999; probe farther inside or the normal hint
          // collapses to zero and half the FrontSide skirts face inward.
          const inner = point(to, edge + (column === 0 ? .01 : -.01));
          contactSkirt(a, b, new Vector3(b.x - inner.x, 0, b.z - inner.z));
        }
        for (let strip = 0; strip < strips; strip++) {
          const a = strip / strips * 2 - 1, b = (strip + 1) / strips * 2 - 1;
          quad(arch(from, a), arch(to, a), arch(to, b), arch(from, b));
        }
      };
      for (let segment = 1; segment < cuts.length; segment++) ceramicSegment(cuts[segment - 1]!, cuts[segment]!);
      // Close the exposed downhill pan edge. At the eave it meets the bedding;
      // between courses it meets the overlapping course below it.
      const from = pitch.point(q0, centre), to = pitch.point(q1, centre);
      const outward = new Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize();
      const lip = [point(q1, s0, panEdge + lap(q1)), point(q1, centre, panMiddle + lap(q1)),
        point(q1, s1, panEdge + lap(q1))];
      for (let index = 1; index < lip.length; index++) {
        const a = lip[index - 1]!, b = lip[index]!;
        if (row === rows - 1) contactSkirt(a, b, outward);
        else quad(a, b, new Vector3(b.x, b.y - .024, b.z), new Vector3(a.x, a.y - .024, a.z), outward);
      }
      for (let strip = 0; strip < strips; strip++) {
        const a = strip / strips * 2 - 1, b = (strip + 1) / strips * 2 - 1;
        // Only authored row boundaries have filled lips; a curvature split is not another tile.
        const front = point(q1, centre, .015 + lap(q1)), back = point(q0, centre, .015);
        shade *= .94;
        // Coarse Minimal caps become large dark triangles on the roof face. The cover is
        // hollow at its downhill end; the opaque pan and closed eave remain underneath.
        if (detailed) {
          triangle(front, arch(q1, a), arch(q1, b), outward);
          triangle(back, arch(q0, b), arch(q0, a), outward.clone().negate());
        }
        shade /= .94;
      }
    }
  }
  // Broad curved ridge/hip caps hide the junction of the four tile pitches.
  const caps: [Point, Point][] = [];
  if (pyramid) for (const x of [-1, 1]) for (const z of [-1, 1])
    caps.push([[0, 0], [x * .499, z * .499]]);
  else {
    // The recipe supplies the straight ridge beam; Minimal keeps only the four ceramic hip seams.
    if (detailed) caps.push([[0, -.3], [0, .3]]);
    if (hipped) for (const x of [-1, 1]) for (const z of [-1, 1])
      caps.push([[0, z * .3], [x * Math.min(.499, .2 * getEndSlope(part.occupationRoof) / 1.74), z * .499]]);
  }
  for (const [from, to] of caps) {
    const direction = new Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize();
    const capPoint = (q: number, cross: number) => {
      const x = from[0] + (to[0] - from[0]) * q - direction.z * cross * .022;
      const z = from[1] + (to[1] - from[1]) * q + direction.x * cross * .022;
      return at(Math.max(-.499, Math.min(.499, x)), Math.max(-.499, Math.min(.499, z)),
        .024 + Math.sqrt(Math.max(0, 1 - cross * cross)) * .038);
    };
    const segments = detailed ? 6 : 2, strips = detailed ? 4 : 2;
    for (let segment = 0; segment < segments; segment++) {
      const q0 = segment / segments, q1 = (segment + 1) / segments;
      for (const side of [-1, 1]) contactSkirt(capPoint(q0, side), capPoint(q1, side),
        new Vector3(-direction.z * side, 0, direction.x * side));
      for (let strip = 0; strip < strips; strip++) {
      const a = strip / strips * 2 - 1, b = (strip + 1) / strips * 2 - 1;
      shade = .92;
      quad(capPoint(q0, a), capPoint(q1, a), capPoint(q1, b), capPoint(q0, b));
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  const smooth = mergeVertices(geometry, .000001);geometry.dispose();
  smooth.computeVertexNormals();
  return smooth;
};
