import assert from "node:assert/strict";

import type { Primitive, Skin } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/core/dist/index.js";
import { compactPrimitive } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/functions/dist/index.js";
import { MeshoptSimplifier } from "../../../island-of-settlers-worker-generation/node_modules/meshoptimizer/index.js";
import { SEAMED_MOUNT_ERROR } from "./mount-lod-policy";

/** Existing riding LOD simplification, with original hand-influenced vertices and their seam halo locked. */
export const simplifyMountWithOriginalHands = (primitive: Primitive, skin: Skin, ratio: number) => {
  const position = primitive.getAttribute("POSITION")!, indices = primitive.getIndices()!;
  const joints = primitive.getAttribute("JOINTS_0"), weights = primitive.getAttribute("WEIGHTS_0");
  assert(joints && weights, "A hand-preserving rider must retain its original skin attributes");
  const handJoints = new Set(skin.listJoints().flatMap((joint, index) =>
    /^(Left|Right)Hand/.test(joint.getName()) ? [index] : []));
  assert(handJoints.size > 0, "Source riding rig must identify its original hand/finger joints");
  const sourceIndices = Uint32Array.from(indices.getArray()!), lock = new Uint8Array(position.getCount());
  const bone = [0, 0, 0, 0], weight = [0, 0, 0, 0];
  for (let vertex = 0; vertex < lock.length; vertex++) {
    joints.getElement(vertex, bone); weights.getElement(vertex, weight);
    if (bone.some((joint, channel) => handJoints.has(joint) && weight[channel]! > 0)) lock[vertex] = 1;
  }
  const originalHandVertices = lock.reduce((sum, value) => sum + value, 0);
  const handSeed = lock.slice();
  // Keep every triangle incident on the original hands, including all of its existing UV seams.
  for (let index = 0; index < sourceIndices.length; index += 3) {
    const face = sourceIndices.subarray(index, index + 3);
    if (face.some(vertex => handSeed[vertex])) for (const vertex of face) lock[vertex] = 1;
  }
  const semantics = primitive.listSemantics().sort();
  const signature = (vertex: number) => semantics.map(semantic => {
    const accessor = primitive.getAttribute(semantic)!;
    return accessor.getElement(vertex, Array(accessor.getElementSize()).fill(0)).join(",");
  }).join(";");
  const protectedSignatures = new Set<string>();
  for (const vertex of sourceIndices) if (lock[vertex]) protectedSignatures.add(signature(vertex));
  const target = Math.floor(sourceIndices.length * ratio / 3) * 3;
  const [simplified, error] = MeshoptSimplifier.simplifyWithAttributes(sourceIndices,
    Float32Array.from(position.getArray()!), 3, new Float32Array(), 0, [], lock, target,
    SEAMED_MOUNT_ERROR, ["Permissive"]);
  const retained = new Set(simplified);
  for (const vertex of sourceIndices) if (lock[vertex]) assert(retained.has(vertex), "Every original hand/halo vertex survives");
  const faceKey = (a: number, b: number, c: number) => {
    const first = Math.min(a, b, c);
    if (a === first) return `${a},${b},${c}`;
    if (b === first) return `${b},${c},${a}`;
    return `${c},${a},${b}`;
  };
  const faces = new Set<string>();
  for (let index = 0; index < simplified.length; index += 3)
    faces.add(faceKey(simplified[index]!, simplified[index + 1]!, simplified[index + 2]!));
  let protectedFaces = 0;
  for (let index = 0; index < sourceIndices.length; index += 3) {
    const [a, b, c] = sourceIndices.subarray(index, index + 3);
    if (!handSeed[a!] && !handSeed[b!] && !handSeed[c!]) continue;
    assert(faces.has(faceKey(a!, b!, c!)), "Original hand triangles and winding must survive"); protectedFaces++;
  }
  indices.setArray(new Uint32Array(simplified)); compactPrimitive(primitive);
  const compacted = new Set(Array.from({ length: primitive.getAttribute("POSITION")!.getCount() }, (_, vertex) => signature(vertex)));
  for (const value of protectedSignatures) assert(compacted.has(value), "Original hand UV/normal/joints/weights stay exact");
  return { error, originalHandVertices, protectedFaces, protectedSignatures: [...protectedSignatures],
    sourceTriangles: sourceIndices.length / 3, targetTriangles: target / 3, triangles: simplified.length / 3 };
};

/** Exact post-write decoded attribute signatures, including skin indices/weights and all original seams. */
export const mountVertexSignatures = (primitive: Primitive) => {
  const semantics = primitive.listSemantics().sort();
  return new Set(Array.from({ length: primitive.getAttribute("POSITION")!.getCount() }, (_, vertex) =>
    semantics.map(semantic => {
      const attribute = primitive.getAttribute(semantic)!;
      return attribute.getElement(vertex, Array(attribute.getElementSize()).fill(0)).join(",");
    }).join(";")));
};
