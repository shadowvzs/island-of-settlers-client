import { BufferGeometry, Float32BufferAttribute } from "three";

type Vertex = { p: number[]; uv: number[]; c: number[] };
type Surface = Vertex[][];
const mix = (a: Vertex, b: Vertex, t: number): Vertex => {
  const blend = (x: number[], y: number[]) => x.map((value, axis) => value + (y[axis]! - value) * t);
  return { p: blend(a.p, b.p), uv: blend(a.uv, b.uv), c: blend(a.c, b.c) };
};

const clip = (polygon: Vertex[], axis: number, edge: number, greater: boolean, crossings?: Vertex[]) => {
  const output: Vertex[] = [];
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!, b = polygon[(index + 1) % polygon.length]!;
    const insideA = greater ? a.p[axis]! >= edge : a.p[axis]! <= edge;
    const insideB = greater ? b.p[axis]! >= edge : b.p[axis]! <= edge;
    if (insideA) output.push(a);
    if (insideA !== insideB) {
      const at = mix(a, b, (edge - a.p[axis]!) / (b.p[axis]! - a.p[axis]!));
      output.push(at); crossings?.push(at);
    }
  }
  return output;
};

/** Split a stone at a real opening plane, including the exposed cut-face bearing/reveal. */
const split = (surface: Surface, axis: number, edge: number, greater: boolean, capped: boolean) => {
  const inside: Surface = [], outside: Surface = [], crossings: Vertex[] = [];
  for (const polygon of surface) {
    const kept = clip(polygon, axis, edge, greater, crossings), removed = clip(polygon, axis, edge, !greater);
    if (kept.length >= 3) inside.push(kept);
    if (removed.length >= 3) outside.push(removed);
  }
  const unique = [...new Map(crossings.map(vertex => [vertex.p.map(value => value.toFixed(7)).join(","), vertex])).values()];
  if (capped && unique.length >= 3) {
    const a = (axis + 1) % 3, b = (axis + 2) % 3;
    const centre = [a, b].map(component => unique.reduce((sum, vertex) => sum + vertex.p[component]!, 0) / unique.length);
    unique.sort((x, y) => Math.atan2(x.p[b]! - centre[1]!, x.p[a]! - centre[0]!) -
      Math.atan2(y.p[b]! - centre[1]!, y.p[a]! - centre[0]!));
    if (greater) unique.reverse();
    inside.push(unique); outside.push([...unique].reverse());
  }
  return { inside, outside };
};

const subtract = (surface: Surface, min: readonly number[], max: readonly number[], capped: boolean) => {
  if ([0, 1, 2].some(axis => surface.every(polygon => polygon.every(vertex => vertex.p[axis]! < min[axis]!)) ||
    surface.every(polygon => polygon.every(vertex => vertex.p[axis]! > max[axis]!)))) return surface;
  // Uncapped wall triangles are independent. Keep faces whose bounds miss the aperture intact;
  // splitting them at its infinite cutting planes creates unnecessary stone facets and vertices.
  const output: Surface = [];
  let remaining = surface;
  if (!capped) remaining = surface.filter(polygon => {
    const misses = [0, 1, 2].some(axis => polygon.every(vertex => vertex.p[axis]! < min[axis]!) ||
      polygon.every(vertex => vertex.p[axis]! > max[axis]!));
    if (misses) output.push(polygon);
    return !misses;
  });
  for (const axis of [0, 1, 2]) for (const greater of [true, false]) {
    const result = split(remaining, axis, greater ? min[axis]! : max[axis]!, greater, capped);
    output.push(...result.outside); remaining = result.inside;
    if (!remaining.length) return output;
  }
  return output;
};

/** Model-time fitted masonry, with no per-frame validation or boolean operation. Input is world-local. */
export const clipCatapultRubbleOpenings = (source: BufferGeometry, capped = true) => {
  const p = source.getAttribute("position"), uv = source.getAttribute("uv"), c = source.getAttribute("color");
  const indices = source.index, count = indices?.count ?? p.count;
  let surface: Surface = [];
  for (let at = 0; at < count; at += 3) surface.push(Array.from({ length: 3 }, (_, corner) => {
    const index = indices ? indices.getX(at + corner) : at + corner;
    return { p: [p.getX(index), p.getY(index), p.getZ(index)], uv: [uv.getX(index), uv.getY(index)],
      c: [c.getX(index), c.getY(index), c.getZ(index)] };
  }));
  surface = subtract(surface, [-.31, -.1, .45], [.31, .87, 2], capped);
  surface = subtract(surface, [.50, 1.745, -.27], [2, 2.145, .115], capped);
  surface = subtract(surface, [-2, 1.745, -.27], [-.50, 2.145, .115], capped);
  const positions: number[] = [], uvs: number[] = [], colours: number[] = [];
  for (const polygon of surface) for (let index = 1; index < polygon.length - 1; index++) {
    const triangle = [polygon[0]!, polygon[index]!, polygon[index + 1]!];
    const [a, b, d] = triangle.map(vertex => vertex.p);
    const u = b!.map((value, axis) => value - a![axis]!), v = d!.map((value, axis) => value - a![axis]!);
    const area = (u[1]! * v[2]! - u[2]! * v[1]!) ** 2 + (u[2]! * v[0]! - u[0]! * v[2]!) ** 2 +
      (u[0]! * v[1]! - u[1]! * v[0]!) ** 2;
    if (area < 1e-15) continue;
    for (const vertex of triangle) { positions.push(...vertex.p); uvs.push(...vertex.uv); colours.push(...vertex.c); }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals(); source.dispose();
  return geometry;
};
