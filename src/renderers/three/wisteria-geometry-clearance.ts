import { Box3, InstancedMesh, Matrix4, Mesh, type Object3D, SkinnedMesh, Triangle, Vector3 } from "three";

/** Actual posed, visible render vertices, excluding the commander's non-solid ground aura. */
export const wisteriaActorBounds = (root: Object3D) => {
  root.updateMatrixWorld(true);
  const bounds = new Box3(), point = new Vector3();
  root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    let parent: Object3D | null = node;
    while (parent) {
      if (!parent.visible || parent.name === "commander_aura") return;
      parent = parent.parent;
    }
    if (node instanceof SkinnedMesh) node.skeleton.update();
    const position = node.geometry.getAttribute("position");
    for (let vertex = 0; vertex < position.count; vertex++) {
      node.getVertexPosition(vertex, point); point.applyMatrix4(node.matrixWorld); bounds.expandByPoint(point);
    }
  });
  if (bounds.isEmpty()) throw new Error("No actual visible actor geometry for Wisteria clearance");
  return bounds;
};

/** One-shot proof cache only; never attached to per-frame validation or the production navigation loop. */
export const createWisteriaGeometryClearance = (root: Object3D) => {
  root.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  root.traverse(node => { if (node instanceof Mesh) meshes.push(node); });
  const count = meshes.reduce((sum, mesh) => sum +
    (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) *
    (mesh instanceof InstancedMesh ? mesh.count : 1), 0);
  const vertices = new Float32Array(count * 3), point = new Vector3(), matrix = new Matrix4(), local = new Matrix4();
  let cursor = 0;
  for (const mesh of meshes) {
    const index = mesh.geometry.index, position = mesh.geometry.getAttribute("position");
    for (let instance = 0; instance < (mesh instanceof InstancedMesh ? mesh.count : 1); instance++) {
      matrix.copy(mesh.matrixWorld);
      if (mesh instanceof InstancedMesh) { mesh.getMatrixAt(instance, local); matrix.multiply(local); }
      for (let vertex = 0; vertex < (index?.count ?? position.count); vertex++) {
        point.fromBufferAttribute(position, index?.getX(vertex) ?? vertex).applyMatrix4(matrix);
        vertices[cursor++] = point.x; vertices[cursor++] = point.y; vertices[cursor++] = point.z;
      }
    }
  }
  const triangle = new Triangle();
  return { triangles: count / 3, intersects: (box: Box3) => {
    for (let vertex = 0; vertex < vertices.length; vertex += 9) {
      triangle.a.fromArray(vertices, vertex); triangle.b.fromArray(vertices, vertex + 3);
      triangle.c.fromArray(vertices, vertex + 6);
      if (box.intersectsTriangle(triangle)) return true;
    }
    return false;
  } };
};
