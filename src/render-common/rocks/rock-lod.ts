import type { RockMeshData } from "./rock-mesh";

const NORMAL_DOT = 0.985;
const PLANE_ERROR = 0.035;
const EDGE_LENGTH = 0.8;

/** Collapse only interior, locally planar edges. Original boundary vertices and attributes
 * remain byte-identical, so arbitrary adjacent chunk levels share the same closed seam. */
export const buildRockLodIndices = (
  data: RockMeshData,
  targetTriangles = 0,
  normalDot = NORMAL_DOT,
  planeError = PLANE_ERROR,
  triangleAlignment = 0.9
) => {
  const triangles = Array.from({ length: data.indices.length / 3 }, (_, index) =>
    Array.from(data.indices.subarray(index * 3, index * 3 + 3))
  );
  const incident = Array.from({ length: data.vertexCount }, () => new Set<number>());
  const edges = new Map<string, { a: number; b: number; count: number; length: number }>();
  const point = (vertex: number) => data.positions.subarray(vertex * 3, vertex * 3 + 3);
  triangles.forEach((triangle, id) => {
    triangle.forEach((vertex) => incident[vertex]!.add(id));
    for (let index = 0; index < 3; index++) {
      const a = Math.min(triangle[index]!, triangle[(index + 1) % 3]!);
      const b = Math.max(triangle[index]!, triangle[(index + 1) % 3]!);
      const key = `${a}/${b}`,
        known = edges.get(key);
      if (known) {
        known.count++;
        continue;
      }
      const pa = point(a),
        pb = point(b);
      edges.set(key, {
        a,
        b,
        count: 1,
        length: Math.hypot(...pa.map((value, axis) => value - pb[axis]!))
      });
    }
  });
  const boundary = new Set<number>();
  edges.forEach(({ a, b, count }) => {
    if (count !== 2) {
      boundary.add(a);
      boundary.add(b);
    }
  });
  const neighbours = (vertex: number) => {
    const result = new Set<number>();
    incident[vertex]!.forEach((id) =>
      triangles[id]!.forEach((other) => {
        if (other !== vertex) result.add(other);
      })
    );
    return result;
  };
  const normal = (triangle: number[]) => {
    const [a, b, c] = triangle.map(point);
    const ab = [0, 1, 2].map((axis) => b![axis]! - a![axis]!);
    const ac = [0, 1, 2].map((axis) => c![axis]! - a![axis]!);
    return [
      ab[1]! * ac[2]! - ab[2]! * ac[1]!,
      ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!
    ];
  };
  // Keep each collapsed cluster close to its original faces, so successive small collapses
  // cannot accumulate enough error to erase a shallow geological ridge.
  const sourceFaces = incident.map((faces) => new Set(faces));
  const planes = triangles.map((triangle) => {
    const n = normal(triangle),
      length = Math.hypot(...n) || 1,
      origin = point(triangle[0]!);
    const unit = n.map((value) => value / length);
    return [...unit, -unit.reduce((sum, value, axis) => sum + value * origin[axis]!, 0)];
  });
  const keepsSourceSurface = (a: number, b: number) => {
    const position = point(a);
    for (const faces of [sourceFaces[a]!, sourceFaces[b]!])
      for (const face of faces) {
        const plane = planes[face]!;
        const error =
          plane[0]! * position[0]! +
          plane[1]! * position[1]! +
          plane[2]! * position[2]! +
          plane[3]!;
        if (Math.abs(error) > planeError) return false;
      }
    return true;
  };
  const similar = (a: number, b: number) => {
    let dot = 0;
    for (let axis = 0; axis < 3; axis++)
      dot += data.normals[a * 3 + axis]! * data.normals[b * 3 + axis]!;
    if (dot < normalDot) return false;
    for (const attribute of [data.mask, data.extra])
      for (let channel = 0; channel < 4; channel++)
        if (Math.abs(attribute[a * 4 + channel]! - attribute[b * 4 + channel]!) > 10) return false;
    return true;
  };
  const candidates = [...edges.values()].filter(
    (edge) => edge.count === 2 && edge.length < EDGE_LENGTH
  );
  candidates.sort((a, b) => a.length - b.length || a.a - b.a);
  let remaining = triangles.length;
  for (const { a, b } of candidates) {
    if (remaining <= targetTriangles) break;
    if (
      boundary.has(a) ||
      boundary.has(b) ||
      !incident[a]!.size ||
      !incident[b]!.size ||
      !similar(a, b) ||
      !keepsSourceSurface(a, b)
    )
      continue;
    const an = neighbours(a),
      bn = neighbours(b);
    if (!an.has(b) || [...an].filter((vertex) => bn.has(vertex)).length !== 2) continue;
    const affected = [...incident[b]!];
    let valid = true;
    for (const id of affected) {
      const triangle = triangles[id]!;
      if (triangle.includes(a)) continue;
      const oldNormal = normal(triangle),
        length = Math.hypot(...oldNormal);
      const pa = point(a),
        pb = point(b);
      const error = oldNormal.reduce(
        (sum, value, axis) => sum + value * (pa[axis]! - pb[axis]!),
        0
      );
      if (length <= 1e-8 || Math.abs(error) > length * planeError) {
        valid = false;
        break;
      }
      const next = normal(triangle.map((vertex) => (vertex === b ? a : vertex)));
      const nextLength = Math.hypot(...next);
      const alignment = oldNormal.reduce((sum, value, axis) => sum + value * next[axis]!, 0);
      if (nextLength <= 1e-8 || alignment < length * nextLength * triangleAlignment) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    sourceFaces[b]!.forEach((face) => sourceFaces[a]!.add(face));
    sourceFaces[b]!.clear();
    for (const id of affected) {
      const triangle = triangles[id]!;
      triangle.forEach((vertex) => incident[vertex]!.delete(id));
      const next = triangle.map((vertex) => (vertex === b ? a : vertex));
      triangles[id] = new Set(next).size === 3 ? next : [];
      if (!triangles[id]!.length) remaining--;
      triangles[id]!.forEach((vertex) => incident[vertex]!.add(id));
    }
  }
  return Uint32Array.from(triangles.flat());
};
