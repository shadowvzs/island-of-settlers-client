import { Box3, InstancedMesh, Matrix4, Mesh, type Object3D, Triangle, Vector3 } from "three";

/** World bounds of the meshes actually drawn (hidden figureheads or hulls of other styles excluded). */
export const visibleMeshBounds = (root: Object3D) => {
  root.updateMatrixWorld(true);
  const bounds = new Box3(), part = new Box3();
  root.traverseVisible(object => {
    if (!(object instanceof Mesh)) return;
    object.geometry.computeBoundingBox();
    bounds.union(part.copy(object.geometry.boundingBox!).applyMatrix4(object.matrixWorld));
  });
  return bounds;
};

/** Triangles of every visible mesh under `root`, in `root`'s local space (instanced meshes skipped). */
export const visibleTriangles = (root: Object3D) => {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(), triangles: Triangle[] = [];
  root.traverseVisible(object => {
    if (!(object instanceof Mesh) || "isInstancedMesh" in object) return;
    const geometry = object.geometry, index = geometry.index, matrix = inverse.clone().multiply(object.matrixWorld);
    const count = index ? index.count : geometry.getAttribute("position").count;
    const corner = (i: number) => new Vector3().fromBufferAttribute(geometry.getAttribute("position"),
      index ? index.getX(i) : i).applyMatrix4(matrix);
    for (let i = 0; i < count; i += 3) triangles.push(new Triangle(corner(i), corner(i + 1), corner(i + 2)));
  });
  return triangles;
};

/** Every drawn vertex under `root` in world space, each drawn instance of an instanced mesh included. */
export const visibleWorldPoints = (root: Object3D) => {
  root.updateMatrixWorld(true);
  const points: Vector3[] = [], instance = new Matrix4(), matrix = new Matrix4();
  root.traverseVisible(object => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute("position");
    const instances = object instanceof InstancedMesh ? object.count : 1;
    for (let copy = 0; copy < instances; copy++) {
      if (object instanceof InstancedMesh) object.getMatrixAt(copy, instance);
      matrix.multiplyMatrices(object.matrixWorld, object instanceof InstancedMesh ? instance : IDENTITY);
      for (let vertex = 0; vertex < position.count; vertex++)
        points.push(new Vector3().fromBufferAttribute(position, vertex).applyMatrix4(matrix));
    }
  });
  return points;
};
const IDENTITY = new Matrix4();

/** Triangles drawn under `root`: an instanced mesh counts once per drawn instance. */
export const meshTriangleCount = (root: Object3D) => {
  let count = 0;
  root.traverseVisible(object => {
    if (!(object instanceof Mesh)) return;
    const instances = object instanceof InstancedMesh ? object.count : 1;
    count += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3 * instances;
  });
  return count;
};
