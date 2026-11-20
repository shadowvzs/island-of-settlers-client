import { type Mesh, type Object3D, type PerspectiveCamera, Raycaster, type SkinnedMesh, Vector2, type Vector3 } from "three";

/** The exact visible renderer surface at a known body-hole witness, including actual props. */
export const captureArmourFitWitness = (root: Object3D, camera: PerspectiveCamera, point: Vector3) => {
  const meshes: Mesh[] = [];
  root.traverse(node => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isMesh) return;
    for (let parent: Object3D | null = mesh; parent; parent = parent.parent) if (!parent.visible) return;
    if (mesh.isSkinnedMesh) mesh.computeBoundingSphere();
    meshes.push(mesh);
  });
  const direction = point.clone().sub(camera.position), distance = direction.length();
  const ray = new Raycaster(camera.position, direction.divideScalar(distance), .00002, distance + .25);
  const hit = ray.intersectObjects(meshes, false)[0], projected = point.clone().project(camera);
  return { point: point.toArray(), pixel: [(projected.x + 1) * 160, (1 - projected.y) * 160],
    witnessDistance: distance, hit: hit && { name: hit.object.name, distance: hit.distance,
      face: hit.faceIndex, vertices: hit.face && [hit.face.a, hit.face.b, hit.face.c], uv: hit.uv?.toArray() } };
};

/** Exact native in-frame ownership and equipped bone matrices; review only, no model edits. */
export const captureArmourFitDiagnostics = (root: Object3D, camera: PerspectiveCamera, probes: boolean) => {
  root.updateMatrixWorld(true);
  const meshes: Mesh[] = [], skins: SkinnedMesh[] = [];
  root.traverse(node => {
    if (!(node as Mesh).isMesh) return;
    for (let parent: Object3D | null = node; parent; parent = parent.parent) if (!parent.visible) return;
    const mesh = node as SkinnedMesh;
    meshes.push(mesh);
    if (mesh.isSkinnedMesh) {
      mesh.computeBoundingSphere();
      skins.push(mesh);
    }
  });
  const skeletons = new Map<string, { bones: { name: string; matrixWorld: number[] }[]; inverses: number[][] }>();
  const posedMeshes = skins.map(mesh => {
    const key = mesh.skeleton.uuid;
    if (!skeletons.has(key)) skeletons.set(key, { bones: mesh.skeleton.bones.map(bone =>
      ({ name: bone.name, matrixWorld: bone.matrixWorld.toArray() })),
      inverses: mesh.skeleton.boneInverses.map(inverse => inverse.toArray()) });
    return { name: mesh.name, skeleton: [...skeletons.keys()].indexOf(key),
      matrixWorld: mesh.matrixWorld.toArray(), bindMatrix: mesh.bindMatrix.toArray(),
      bindMatrixInverse: mesh.bindMatrixInverse.toArray() };
  });
  const owners = [], ray = new Raycaster();
  if (probes) for (let y = 112; y <= 256; y += 16) for (let x = 16; x <= 304; x += 16) {
    ray.setFromCamera(new Vector2(x / 160 - 1, 1 - y / 160), camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit?.face) continue;
    const mesh = hit.object as SkinnedMesh, face = hit.face;
    const material = Array.isArray(mesh.material) ? mesh.material[face.materialIndex] : mesh.material;
    const vertices = [face.a, face.b, face.c], uv = mesh.geometry.getAttribute("uv");
    const names = [];
    for (let parent: Object3D | null = mesh; parent; parent = parent.parent) if (parent.name) names.push(parent.name);
    owners.push({ pixel: [x, y], name: mesh.name, owners: names, material: material?.name,
      point: hit.point.toArray(), face: hit.faceIndex, uv: hit.uv?.toArray(), vertices,
      triangleUvs: uv && vertices.map(vertex => [uv.getX(vertex), uv.getY(vertex)]) });
  }
  return { schema: 1, posedMeshes, skeletons: [...skeletons.values()], owners };
};
