import { type BufferAttribute, BufferGeometry, Float32BufferAttribute, type Group, Matrix3,
  Matrix4, Mesh, type MeshStandardMaterial, Vector3 } from "three";

interface Plane { x: number; z: number; distance: number }
interface Vertex { values: Record<string, number[]>; point: number[] }
const identity = (name: string) => name.replace(/[._]/g, "");
const attributesOf = (geometry: BufferGeometry) => Object.entries(geometry.attributes) as [string, BufferAttribute][];

const hallPlanes = (root: Group, anchor: Vector3) => {
  const planes = new Map<string, Plane>(), rootInverse = root.matrixWorld.clone().invert();
  root.traverse(object => {
    if (!(object instanceof Mesh) || identity(object.name) !== "Architecturevermilion") return;
    const relative = new Matrix4().multiplyMatrices(rootInverse, object.matrixWorld);
    const normalMatrix = new Matrix3().getNormalMatrix(relative);
    const positions = object.geometry.getAttribute("position"), normals = object.geometry.getAttribute("normal");
    const index = object.geometry.index, count = index?.count ?? positions.count;
    for (let at = 0; at < count; at += 3) {
      const indices = [0, 1, 2].map(step => index ? index.getX(at + step) : at + step);
      const normal = new Vector3().fromBufferAttribute(normals, indices[0]!).applyNormalMatrix(normalMatrix);
      if (Math.abs(normal.y) > .01) continue;
      const center = indices.reduce((sum, vertex) =>
        sum.add(new Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(relative)), new Vector3()).divideScalar(3);
      if (center.y < anchor.y + .02 || center.y > anchor.y + 1.2) continue;
      const distance = normal.x * center.x + normal.z * center.z;
      if (distance <= Math.hypot(anchor.x, anchor.z)) continue;
      const key = Math.atan2(normal.z, normal.x).toFixed(3), previous = planes.get(key);
      if (!previous || previous.distance > distance) planes.set(key, { distance, x: normal.x, z: normal.z });
    }
  });
  return [...planes.values()];
};

const interpolate = (from: Vertex, to: Vertex, share: number): Vertex => ({
  point: from.point.map((value, axis) => value + (to.point[axis]! - value) * share),
  values: Object.fromEntries(Object.entries(from.values).map(([name, values]) => [name,
    values.map((value, axis) => value + (to.values[name]![axis]! - value) * share)]))
});

/** Complementary convex cuts: emitted outside pieces plus the final inside exactly partition a face. */
const split = (polygon: Vertex[], plane: Plane) => {
  const inside: Vertex[] = [], outside: Vertex[] = [];
  const distance = (vertex: Vertex) => vertex.point[0]! * plane.x + vertex.point[2]! * plane.z - plane.distance;
  for (let at = 0; at < polygon.length; at++) {
    const from = polygon[(at + polygon.length - 1) % polygon.length]!, to = polygon[at]!;
    const first = distance(from), last = distance(to);
    if ((first <= 0) !== (last <= 0)) {
      const crossing = interpolate(from, to, first / (first - last));
      inside.push(crossing); outside.push(crossing);
    }
    if (last <= 0) inside.push(to); else outside.push(to);
  }
  return { inside, outside };
};

const triangles = (polygon: Vertex[]) => {
  const result: Vertex[] = [];
  for (let at = 1; at < polygon.length - 1; at++) {
    const a = polygon[0]!, b = polygon[at]!, c = polygon[at + 1]!;
    const ab = new Vector3(...b.point).sub(new Vector3(...a.point));
    const ac = new Vector3(...c.point).sub(new Vector3(...a.point));
    if (ab.cross(ac).lengthSq() > 1e-14) result.push(a, b, c);
  }
  return result;
};

const geometryOf = (vertices: Vertex[], source: BufferGeometry, floor: boolean) => {
  const geometry = new BufferGeometry();
  for (const [name, attribute] of attributesOf(source)) {
    const values = vertices.flatMap(vertex => name === "uv" && floor
      ? [vertex.point[0]!, vertex.point[2]!] : vertex.values[name]!);
    geometry.setAttribute(name, new Float32BufferAttribute(values, attribute.itemSize, attribute.normalized));
  }
  if (floor && !geometry.hasAttribute("color"))
    geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(vertices.length * 3).fill(1), 3));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};

/** Instance-only floor finish; original shared GLBs, exterior porch, steps and stone sides stay intact. */
export const finishJapaneseMonumentFloor = (root: Group, material: MeshStandardMaterial) => {
  root.updateMatrixWorld(true);
  let anchor: Vector3 | undefined;
  root.traverse(object => {
    if (identity(object.name) === "AnchorInterior") anchor = object.getWorldPosition(new Vector3());
  });
  if (!anchor) return [];
  const rootInverse = root.matrixWorld.clone().invert(); anchor.applyMatrix4(rootInverse);
  const planes = hallPlanes(root, anchor);
  // A changed supplied asset must not silently paint its exterior as a room.
  if (planes.length !== 8) return [];
  const owned: BufferGeometry[] = [], targets: Mesh[] = [];
  root.traverse(object => {
    if (object instanceof Mesh && identity(object.name) === "Architecturestone" && !Array.isArray(object.material))
      targets.push(object);
  });
  for (const target of targets) {
    const source = target.geometry, relative = new Matrix4().multiplyMatrices(rootInverse, target.matrixWorld);
    const normalMatrix = new Matrix3().getNormalMatrix(relative);
    const positions = source.getAttribute("position"), normals = source.getAttribute("normal");
    const index = source.index, count = index?.count ?? positions.count;
    const stone: Vertex[] = [], floor: Vertex[] = [];
    for (let at = 0; at < count; at += 3) {
      const indices = [0, 1, 2].map(step => index ? index.getX(at + step) : at + step);
      const original: Vertex[] = indices.map(vertex => ({
        point: new Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(relative).toArray(),
        values: Object.fromEntries(attributesOf(source).map(([name, attribute]) => [name,
          Array.from({ length: attribute.itemSize }, (_, component) => attribute.getComponent(vertex, component))]))
      }));
      const isTop = indices.every(vertex => new Vector3().fromBufferAttribute(normals, vertex)
        .applyNormalMatrix(normalMatrix).y > .999);
      const isFloorLevel = original.every(vertex => vertex.point[1]! >= anchor!.y - .04 &&
        vertex.point[1]! <= anchor!.y + .002);
      if (!isTop || !isFloorLevel) { stone.push(...original); continue; }
      let pending = original;
      const outside: Vertex[] = [];
      for (const plane of planes) {
        if (!pending.length) break;
        const cut = split(pending, plane); pending = cut.inside; outside.push(...triangles(cut.outside));
      }
      const fitted = triangles(pending);
      if (fitted.length) { floor.push(...fitted); stone.push(...outside); } else stone.push(...original);
    }
    if (!floor.length) continue;
    const sides = geometryOf(stone, source, false), boards = geometryOf(floor, source, true);
    target.geometry = sides;
    target.userData.japaneseInteriorFloorBase = { sourceTriangles: count / 3 };
    const mesh = new Mesh(boards, material); mesh.name = "JapaneseInteriorFloor";
    mesh.userData.japaneseInteriorFloor = true; target.add(mesh);
    owned.push(sides, boards);
  }
  return owned;
};
