import { Matrix4, Mesh, type Object3D, Triangle, Vector3 } from "three";

/** Palm positions lie on the real leather mesh, on its near edge rather than inside its centre. */
export const tabletopGripTargets = (prop: Object3D, worker: Object3D, stockDirection?: Vector3): readonly [Vector3, Vector3] => {
  prop.updateWorldMatrix(true, true);
  const center = new Vector3(), direction = prop.worldToLocal(worker.getWorldPosition(new Vector3()));
  if (stockDirection) direction.copy(stockDirection);
  direction.y = 0; direction.normalize();
  const tangent = new Vector3(-direction.z, 0, direction.x);
  const inverse = prop.matrixWorld.clone().invert(), matrix = new Matrix4();
  const triangles: Triangle[] = [];
  const minimum = new Vector3(Infinity, Infinity, Infinity), maximum = minimum.clone().negate();
  prop.traverse(object => {
    if (!(object instanceof Mesh)) return;
    matrix.multiplyMatrices(inverse, object.matrixWorld);
    const position = object.geometry.getAttribute("position"), index = object.geometry.index;
    const count = index?.count ?? position.count;
    const vertex = (at: number) => new Vector3().fromBufferAttribute(position, index ? index.getX(at) : at)
      .applyMatrix4(matrix);
    for (let at = 0; at < count; at += 3) {
      const triangle = new Triangle(vertex(at), vertex(at + 1), vertex(at + 2)); triangles.push(triangle);
      for (const point of [triangle.a, triangle.b, triangle.c]) { minimum.min(point); maximum.max(point); }
    }
  });
  center.addVectors(minimum, maximum).multiplyScalar(.5);
  const extent = maximum.clone().sub(minimum).multiplyScalar(.5);
  const near = Math.abs(direction.x) * extent.x + Math.abs(direction.z) * extent.z;
  const spread = Math.min(.075, (Math.abs(tangent.x) * extent.x + Math.abs(tangent.z) * extent.z) * .65);
  return [1, -1].map(side => {
    const wanted = center.clone().addScaledVector(direction, near).addScaledVector(tangent, side * spread);
    wanted.y += extent.y * .75;
    const nearest = new Vector3(), candidate = new Vector3(); let distance = Infinity;
    for (const triangle of triangles) {
      triangle.closestPointToPoint(wanted, candidate);
      const next = wanted.distanceToSquared(candidate);
      if (next < distance) { distance = next; nearest.copy(candidate); }
    }
    return nearest;
  }) as [Vector3, Vector3];
};
