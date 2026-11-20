import { BufferGeometry, Float32BufferAttribute } from "three";


type Vertex = [number, number, number, number, number, number, number, number];
type Plane = [axis: 0 | 1 | 2, sign: number, limit: number];

/** Split a cloth polygon at an opening boundary, interpolating its woven texture coordinates. */
const split = (polygon: Vertex[], [axis, sign, limit]: Plane) => {
  const inside: Vertex[] = [], outside: Vertex[] = [];
  for (let index = 0; index < polygon.length; index++) {
    const from = polygon[index]!, to = polygon[(index + 1) % polygon.length]!;
    const a = from[axis] * sign - limit, b = to[axis] * sign - limit;
    (a <= 0 ? inside : outside).push(from);
    if ((a <= 0) === (b <= 0)) continue;
    const fraction = a / (a - b);
    const crossing = from.map((value, component) => value + (to[component]! - value) * fraction) as Vertex;
    inside.push(crossing); outside.push(crossing);
  }
  return { inside, outside };
};

const subtractRegion = (polygon: Vertex[], planes: readonly Plane[]) => {
  const kept: Vertex[][] = [];
  let remaining = polygon;
  for (const plane of planes) {
    if (remaining.length < 3) break;
    const { inside, outside } = split(remaining, plane);
    if (outside.length >= 3) kept.push(outside);
    remaining = inside;
  }
  return kept;
};

const subtractOpening = (polygon: Vertex[], opening: readonly [number, number, number], rear: boolean) =>
  subtractRegion(polygon, [[0, -1, -opening[0]], [0, 1, opening[1]],
    [2, rear ? 1 : -1, 0], [1, 1, opening[2]]]);


/** Real cutaways preserve the cone's slope instead of stretching a broad flat brim over a doorway. */
export const cutIndigenousClothOpenings = (source: BufferGeometry,
  entrance?: readonly [number, number, number], rearEntrance?: readonly [number, number, number]) => {
  const position = source.getAttribute("position"), uv = source.getAttribute("uv"), index = source.index!;
  const normal = source.getAttribute("normal");
  const positions: number[] = [], uvs: number[] = [], normals: number[] = [];
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const vertices = [0, 1, 2].map(offset => {
      const vertex = index.getX(triangle + offset);
      return [position.getX(vertex), position.getY(vertex), position.getZ(vertex),
        uv.getX(vertex), uv.getY(vertex), normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex)] as Vertex;
    });
    let polygons = [vertices];
    if (entrance) polygons = polygons.flatMap(polygon => subtractOpening(polygon, entrance, false));
    if (rearEntrance) polygons = polygons.flatMap(polygon => subtractOpening(polygon, rearEntrance, true));
    for (const polygon of polygons) for (let corner = 1; corner < polygon.length - 1; corner++)
      for (const vertex of [polygon[0]!, polygon[corner]!, polygon[corner + 1]!]) {
        positions.push(vertex[0], vertex[1], vertex[2]); uvs.push(vertex[3], vertex[4]);
        normals.push(vertex[5], vertex[6], vertex[7]);
      }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  source.dispose();
  return geometry;
};
