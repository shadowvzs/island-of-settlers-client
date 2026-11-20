import { Box3, Matrix4, type Mesh, type Object3D, Triangle, Vector3 } from "three";

/** Held-ware descendants have fixed local transforms; a folded skin changes vertex positions in place. */
export const createPropSurfaceSampler = (prop: Object3D) => {
  prop.updateWorldMatrix(true, true);
  const inverse = prop.matrixWorld.clone().invert();
  const pieces: { mesh: Mesh; matrix: Matrix4 }[] = [];
  prop.traverse(object => {
    const mesh = object as Mesh;
    if (mesh.isMesh) pieces.push({ mesh, matrix: new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld) });
  });
  const triangle = new Triangle(), nearest = new Vector3(), box = new Box3();
  return {
    bounds(target: Box3) {
      target.makeEmpty();
      for (const { matrix, mesh } of pieces) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        target.union(box.copy(mesh.geometry.boundingBox!).applyMatrix4(matrix));
      }
      return target;
    },
    closest(wanted: Vector3, target: Vector3) {
      let distance = Infinity;
      for (const { matrix, mesh } of pieces) {
        const positions = mesh.geometry.getAttribute("position"), index = mesh.geometry.index;
        const count = index?.count ?? positions.count;
        const corner = (at: number, point: Vector3) => point.fromBufferAttribute(positions, index ? index.getX(at) : at)
          .applyMatrix4(matrix);
        for (let at = 0; at < count; at += 3) {
          corner(at, triangle.a); corner(at + 1, triangle.b); corner(at + 2, triangle.c);
          triangle.closestPointToPoint(wanted, nearest);
          const next = wanted.distanceToSquared(nearest);
          if (next >= distance) continue;
          distance = next; target.copy(nearest);
        }
      }
      return target;
    }
  };
};
