import { Group, Matrix4, Mesh, type PerspectiveCamera, Vector3 } from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import type { EliteHelmetIconSource } from "./race-helmet-types";

/** Preserve the real fitted headpiece, restoring its Head-local frame to the same icon brow baseline. */
export const loadEliteHelmetIcon = async (source: EliteHelmetIconSource) => {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(source.url);
  const headpiece = gltf.scene.getObjectByName("armour_head");
  if (!headpiece) throw new Error(`Missing elite headpiece: ${source.url}`);
  headpiece.traverse(object => {
    if (object.name.endsWith("_lod1")) object.visible = false;
  });
  const radius = source.radii[0]!;
  if (!(radius > 0) || source.headMatrix.length !== 16) throw new Error("Invalid elite head frame");
  const scale = new Matrix4().makeScale(1 / radius, 1 / radius, 1 / radius);
  const origin = new Matrix4().makeTranslation(-source.centre[0]!, -source.brow, -source.centre[2]!);
  const transform = scale.multiply(origin).multiply(new Matrix4().fromArray(source.headMatrix));
  const restored = new Group(); restored.applyMatrix4(transform); restored.add(headpiece);
  const root = new Group(); root.add(restored);
  return root;
};

/** Match the original icons' roughly210px subject extent, including wide feathers and long mail. */
export const fitEliteHelmetIcon = (helmet: Group, camera: PerspectiveCamera) => {
  const vertex = new Vector3();
  camera.updateMatrixWorld(true);
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const halfSpan = camera.position.distanceTo(new Vector3(0, .66, 0))
    * Math.tan(camera.fov * Math.PI / 360);
  const bounds = () => {
    helmet.updateMatrixWorld(true);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    helmet.traverseVisible(object => {
      if (!(object instanceof Mesh)) return;
      const positions = object.geometry.getAttribute("position");
      for (let at = 0; at < positions.count; at++) {
        vertex.fromBufferAttribute(positions, at).applyMatrix4(object.matrixWorld).project(camera);
        minX = Math.min(minX, vertex.x); maxX = Math.max(maxX, vertex.x);
        minY = Math.min(minY, vertex.y); maxY = Math.max(maxY, vertex.y);
      }
    });
    return { maxX, maxY, minX, minY };
  };
  for (let pass = 0; pass < 5; pass++) {
    const before = bounds();
    const extent = Math.max(before.maxX - before.minX, before.maxY - before.minY);
    if (!(extent > 0) || !Number.isFinite(extent)) throw new Error("Invalid elite icon silhouette");
    helmet.scale.multiplyScalar(1.64 / extent);
    const after = bounds();
    helmet.position.addScaledVector(right, -(after.minX + after.maxX) * .5 * halfSpan);
    helmet.position.addScaledVector(up, -(after.minY + after.maxY) * .5 * halfSpan);
  }
};
