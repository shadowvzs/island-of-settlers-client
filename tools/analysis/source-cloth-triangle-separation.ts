import { Vector3 } from "three";

/** Signed separating-axis gap for two finite source triangles. Positive means a proven
 * separating plane; unlike infinite body-plane pushes, edge axes allow tangential escape. */
export const sourceClothTriangleSeparation = (cloth: readonly Vector3[], body: readonly Vector3[]) => {
  const edges = (points: readonly Vector3[]) => points.map((point, at) => points[(at + 1) % 3]!.clone().sub(point));
  const a = edges(cloth), b = edges(body), na = a[0]!.clone().cross(a[1]!), nb = b[0]!.clone().cross(b[1]!);
  const axes = [na, nb, ...a.flatMap(first => b.map(second => first.clone().cross(second))),
    ...a.map(edge => na.clone().cross(edge)), ...b.map(edge => nb.clone().cross(edge))];
  let gap = -Infinity;
  for (const axis of axes) {
    if (axis.lengthSq() < 1e-24) continue; axis.normalize();
    const ca = cloth.map(point => point.dot(axis)), cb = body.map(point => point.dot(axis));
    gap = Math.max(gap, Math.min(...ca) - Math.max(...cb), Math.min(...cb) - Math.max(...ca));
  }
  return { gap };
};
