import { type Object3D, type SkinnedMesh, Vector3 } from "three";

import { readArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/armour-body";
import { skinnedNode } from "../../../island-of-settlers-worker-generation/src/armour/armour-gltf";
import { prepareArmourSource } from "../../../island-of-settlers-worker-generation/src/armour/armour-source";
import { sourceArmAnatomy } from "../../../island-of-settlers-worker-generation/src/national-workers/source-anatomy";
import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";

const keyOf = (point: number[], uv: number[]) => [...point, ...uv].map(value => value.toFixed(6)).join(",");
export const armourPointOf = (mesh: SkinnedMesh, vertex: number) => mesh.applyBoneTransform(vertex,
  new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex)).applyMatrix4(mesh.matrixWorld);

/** Match the independently proven original arm streams, never garment material names or inward normals. */
export const createArmourSourceSamples = async (root: Object3D, id: string) => {
  const io = await createRetargetIO(), name = id === "nubian-man-scarf" ? "model-repaired.glb" : "model.glb";
  const document = await io.read(`../island-of-settlers-worker-generation/game_ready/tripo/${id}/${name}`);
  prepareArmourSource(document, id);
  const body = readArmourBody(document), anatomy = sourceArmAnatomy(body), keys = new Set<string>();
  let offset = 0;
  for (const primitive of skinnedNode(document).getMesh()!.listPrimitives()) {
    const positions = primitive.getAttribute("POSITION")!, uvs = primitive.getAttribute("TEXCOORD_0")!;
    for (let vertex = 0; vertex < positions.getCount(); vertex++) if (anatomy.has(offset + vertex))
      keys.add(keyOf(positions.getElement(vertex, []), uvs.getElement(vertex, [])));
    offset += positions.getCount();
  }
  const samples: { fraction: number; mesh: SkinnedMesh; side: string; vertex: number }[] = [];
  let matched = 0, smallestFraction = Infinity, largestFraction = -Infinity;
  root.traverse(node => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isSkinnedMesh || !/^body(?:_|$)/.test(node.name)) return;
    const position = mesh.geometry.getAttribute("position"), uv = mesh.geometry.getAttribute("uv");
    for (const vertex of new Set(Array.from(mesh.geometry.index!.array))) {
      if (!keys.has(keyOf([position.getX(vertex), position.getY(vertex), position.getZ(vertex)],
        [uv.getX(vertex), uv.getY(vertex)]))) continue;
      matched++;
      const point = armourPointOf(mesh, vertex), side = point.x > 0 ? "Left" : "Right";
      const start = mesh.skeleton.bones.find(bone => bone.name === `${side}Arm`)!.getWorldPosition(new Vector3());
      const end = mesh.skeleton.bones.find(bone => bone.name === `${side}ForeArm`)!.getWorldPosition(new Vector3());
      const axis = end.clone().sub(start), fraction = point.clone().sub(start).dot(axis) / axis.lengthSq();
      smallestFraction = Math.min(smallestFraction, fraction); largestFraction = Math.max(largestFraction, fraction);
      // Cloth ends at .55; leave a .03-length guard before the actual opening.
      if (fraction < -.10 || fraction > .52 || point.distanceTo(start.clone().addScaledVector(axis, fraction))
        > .14 * WORKER_SCALE) continue;
      samples.push({ fraction, mesh, side, vertex });
    }
  });
  if (!samples.length) throw new Error(`${id}: original anatomical shoulder coverage is required: ${
    JSON.stringify({ sourceKeys: keys.size, matched, smallestFraction, largestFraction })}`);
  return samples;
};
