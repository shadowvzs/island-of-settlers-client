import type { SkinnedMesh } from "three";
import { Vector3 } from "three";

interface ClothCuff { mesh: SkinnedMesh; side: "Left" | "Right"; vertices: number[] }
export interface PosedClothCuff {
  normal: Vector3; origin: Vector3; polygon: [number, number][]; side: "Left" | "Right"; u: Vector3; v: Vector3;
}

/** Physical open cuffs, excluding the shirt's neck and hem. No anatomical geometry is hidden. */
export const findClothCuffs = (mesh: SkinnedMesh): ClothCuff[] => {
  const index = mesh.geometry.index!;
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (let at = 0; at < index.count; at += 3) for (let side = 0; side < 3; side++) {
    const a = index.getX(at + side), b = index.getX(at + (side + 1) % 3);
    const key = [a, b].sort((first, last) => first - last).join(",");
    const edge = edges.get(key) ?? { a, b, count: 0 }; edge.count++; edges.set(key, edge);
  }
  const neighbours = new Map<number, number[]>();
  for (const { a, b, count } of edges.values()) {
    if (count !== 1) continue;
    neighbours.set(a, [...neighbours.get(a) ?? [], b]); neighbours.set(b, [...neighbours.get(b) ?? [], a]);
  }
  const pending = new Set(neighbours.keys()), cuffs: ClothCuff[] = [];
  const joints = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
  while (pending.size) {
    const first = pending.values().next().value!, loop = [first];
    let previous = -1, current = first;
    do {
      pending.delete(current);
      const next = neighbours.get(current)!;
      if (next.length !== 2) throw new Error("Cloth boundary is not one closed cuff/neck/hem loop");
      const following = next.find(vertex => vertex !== previous)!;
      previous = current; current = following;
      if (current !== first) loop.push(current);
    } while (current !== first && loop.length <= neighbours.size);
    if (current !== first) throw new Error("Cloth boundary did not close");
    for (const side of ["Left", "Right"] as const) {
      const rigidArm = loop.every(vertex => {
        let share = 0;
        for (let slot = 0; slot < 4; slot++) if (mesh.skeleton.bones[joints.getComponent(vertex, slot)]!.name === `${side}Arm`)
          share += weights.getComponent(vertex, slot);
        return share > .9999;
      });
      if (rigidArm) cuffs.push({ mesh, side, vertices: loop });
    }
  }
  return cuffs;
};

export const poseClothCuffs = (cuffs: ClothCuff[]): PosedClothCuff[] => cuffs.map(({ mesh, side, vertices }) => {
  const position = mesh.geometry.getAttribute("position");
  const points = vertices.map(vertex => mesh.applyBoneTransform(vertex,
    new Vector3().fromBufferAttribute(position, vertex)).applyMatrix4(mesh.matrixWorld));
  const origin = points.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(points.length);
  const u = points[0]!.clone().sub(origin).normalize();
  const normal = points[1]!.clone().sub(origin).cross(points[2]!.clone().sub(origin)).normalize();
  if (points.some(point => Math.abs(point.clone().sub(origin).dot(normal)) > .00002))
    throw new Error("A rigid sleeve cuff must remain planar through the actual skin pose");
  const v = normal.clone().cross(u).normalize();
  const polygon = points.map(point => { const offset = point.clone().sub(origin);
    return [offset.dot(u), offset.dot(v)] as [number, number]; });
  return { normal, origin, polygon, side, u, v };
});

const insidePolygon = (x: number, y: number, polygon: [number, number][]) => {
  let inside = false;
  for (let at = 0, previous = polygon.length - 1; at < polygon.length; previous = at++) {
    const [ax, ay] = polygon[at]!, [bx, by] = polygon[previous]!;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
};

/** A visible arm can legitimately be seen through its open cuff before the cloth wall. */
export const rayThroughClothCuff = (origin: Vector3, direction: Vector3, cuffs: PosedClothCuff[]) => {
  let nearest: { distance: number; side: "Left" | "Right" } | undefined;
  for (const cuff of cuffs) {
    const denominator = direction.dot(cuff.normal);
    if (Math.abs(denominator) < 1e-9) continue;
    const distance = cuff.origin.clone().sub(origin).dot(cuff.normal) / denominator;
    if (distance <= .0001 || nearest && distance >= nearest.distance) continue;
    const point = origin.clone().addScaledVector(direction, distance).sub(cuff.origin);
    if (insidePolygon(point.dot(cuff.u), point.dot(cuff.v), cuff.polygon)) nearest = { distance, side: cuff.side };
  }
  return nearest;
};
