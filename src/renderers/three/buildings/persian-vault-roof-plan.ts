import { BufferGeometry, Float32BufferAttribute } from "three";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";

type Vertex = number[];
const cross = (a: readonly number[], b: readonly number[], p: readonly number[]) =>
  (b[0]! - a[0]!) * (p[2]! - a[2]!) - (b[2]! - a[2]!) * (p[0]! - a[0]!);

/** Clip the existing tiled barrel shell to its actual oval masonry, retaining its original curvature. */
export const clipPersianVaultRoof = (source: BufferGeometry, part: BuildingPart, detailed: boolean) => {
  const plan = part.persianRoofPlan!;
  const count = detailed ? 32 : 16;
  const boundary = Array.from({ length: count }, (_, i) => {
    const angle = i / count * Math.PI * 2;
    return [Math.cos(angle) * plan[0] / 2, 0, Math.sin(angle) * plan[1] / 2];
  });
  const position = source.getAttribute("position"), uv = source.getAttribute("uv"), color = source.getAttribute("color");
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
  const push = (vertex: Vertex) => {
    positions.push(...vertex.slice(0, 3)); uvs.push(...vertex.slice(3, 5)); colors.push(...vertex.slice(5, 8));
  };
  const triangle = (a: Vertex, b: Vertex, c: Vertex) => {
    const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    if (Math.hypot(ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!) < 1e-10) return;
    push(a); push(b); push(c);
  };
  const vertex = (index: number): Vertex => [position.getX(index), position.getY(index), position.getZ(index),
    uv.getX(index), uv.getY(index), color.getX(index), color.getY(index), color.getZ(index)];
  for (let i = 0; i < position.count; i += 3) {
    let polygon = [vertex(i), vertex(i + 1), vertex(i + 2)];
    for (let edge = 0; edge < count && polygon.length; edge++) {
      const a = boundary[edge]!, b = boundary[(edge + 1) % count]!, clipped: Vertex[] = [];
      for (let j = 0; j < polygon.length; j++) {
        const first = polygon[j]!, next = polygon[(j + 1) % polygon.length]!;
        const da = cross(a, b, first), db = cross(a, b, next);
        if (da >= -1e-10) clipped.push(first);
        if ((da >= 0) !== (db >= 0)) {
          const t = da / (da - db);
          clipped.push(first.map((value, axis) => value + (next[axis]! - value) * t));
        }
      }
      polygon = clipped;
    }
    for (let j = 1; j < polygon.length - 1; j++) triangle(polygon[0]!, polygon[j]!, polygon[j + 1]!);
  }
  // Subdivide each closed cut edge at every barrel row, so the rim follows the exact faceted skin.
  const rows = part.radialSegments ?? (detailed ? 8 : 4);
  const topAt = (x: number) => {
    const at = Math.max(0, Math.min(rows, (x + .5) * rows));
    const index = Math.min(rows - 1, Math.floor(at)), t = at - index;
    const height = (i: number) => -.44 + .87 * Math.sqrt(Math.max(0, 1 - 4 * (i / rows - .5) ** 2));
    return height(index) * (1 - t) + height(index + 1) * t;
  };
  for (let i = 0; i < count; i++) {
    const a = boundary[i]!, b = boundary[(i + 1) % count]!, cuts = [0, 1];
    if (Math.abs(b[0]! - a[0]!) > 1e-9) for (let row = 1; row < rows; row++) {
      const t = (row / rows - .5 - a[0]!) / (b[0]! - a[0]!);
      if (t > 1e-8 && t < 1 - 1e-8) cuts.push(t);
    }
    cuts.sort((x, y) => x - y);
    const edgeVertex = (t: number, below: boolean): Vertex => {
      const x = a[0]! + (b[0]! - a[0]!) * t, z = a[2]! + (b[2]! - a[2]!) * t;
      return [x, topAt(x) - (below ? .06 : 0), z, x + .5, z + .5, .96, .96, .96];
    };
    for (let j = 0; j < cuts.length - 1; j++) {
      const a = edgeVertex(cuts[j]!, false), b = edgeVertex(cuts[j + 1]!, false);
      const c = edgeVertex(cuts[j + 1]!, true), d = edgeVertex(cuts[j]!, true);
      triangle(a, b, c); triangle(a, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  source.dispose();
  return geometry;
};
