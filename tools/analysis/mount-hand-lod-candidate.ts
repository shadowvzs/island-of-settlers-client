import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Matrix4, Vector3 } from "three";

import { type Document, NodeIO } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/core/dist/index.js";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/extensions/dist/index.js";
import { dequantize, weld } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/functions/dist/index.js";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "../../../island-of-settlers-worker-generation/node_modules/meshoptimizer/index.js";
import { mountVertexSignatures, simplifyMountWithOriginalHands } from "../assets/mount-hand-lod";
import { SEAMED_MOUNT_TRIANGLES } from "../assets/mount-lod-policy";

// Staged derivative only. Original Tripo, runtime GLBs, manifests and catalogues are never written.
const output = resolve("../resources/project-reviews/commander-possession-2026-11-03/minimal-rider-hands-a");
const source = resolve("../island-of-settlers-worker-generation/game_ready/mounts/riders/nubian-man-kilt/model.glb");
mkdirSync(output, { recursive: true });
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder
});
const doc = await io.read(source);
const metadata = async (document: Document) => {
  const { json } = await io.writeJSON(document);
  return { materials: json.materials, nodes: json.nodes, samplers: json.samplers, textures: json.textures,
    images: document.getRoot().listTextures().map(texture => ({ name: texture.getName(), mime: texture.getMimeType(),
      hash: createHash("sha256").update(texture.getImage()!).digest("hex") })),
    skins: document.getRoot().listSkins().map(skin => ({ name: skin.getName(),
      joints: skin.listJoints().map(joint => joint.getName()),
      inverseBindMatrices: Array.from(skin.getInverseBindMatrices()!.getArray()!) })) };
};
const bounds = (document: Document) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const node of document.getRoot().listNodes()) {
    const matrix = new Matrix4().fromArray(node.getWorldMatrix()), skin = node.getSkin();
    const jointMatrices = skin?.listJoints().map((joint, index) => new Matrix4().fromArray(joint.getWorldMatrix())
      .multiply(new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(index, Array(16).fill(0)))));
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const positions = primitive.getAttribute("POSITION")!, vertex = [0, 0, 0];
      const joints = primitive.getAttribute("JOINTS_0"), weights = primitive.getAttribute("WEIGHTS_0");
      const ids = [0, 0, 0, 0], values = [0, 0, 0, 0];
      const point = new Vector3(), transformed = new Vector3(), result = new Vector3();
      for (let index = 0; index < positions.getCount(); index++) {
        positions.getElement(index, vertex); point.fromArray(vertex);
        if (jointMatrices && joints && weights) {
          joints.getElement(index, ids); weights.getElement(index, values); result.set(0, 0, 0);
          for (let channel = 0; channel < values.length; channel++) if (values[channel]! > 0)
            result.addScaledVector(transformed.copy(point).applyMatrix4(jointMatrices[ids[channel]!]!), values[channel]!);
        } else result.copy(point).applyMatrix4(matrix);
        for (let axis = 0; axis < 3; axis++) {
          const value = result.getComponent(axis);
          min[axis] = Math.min(min[axis]!, value); max[axis] = Math.max(max[axis]!, value);
        }
      }
    }
  }
  return { max, min };
};
const originalMetadata = await metadata(doc);
await doc.transform(dequantize(), weld());
assert.deepEqual(await metadata(doc), originalMetadata, "Dequantizing/welding retains rig, material, texture and node identities");
const originalBounds = bounds(doc);
const primitives = doc.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
const sourceTriangles = primitives.reduce((sum, primitive) => sum + primitive.getIndices()!.getCount() / 3, 0);
const ratio = SEAMED_MOUNT_TRIANGLES / sourceTriangles;
const protectedProof = doc.getRoot().listMeshes().flatMap(mesh => {
  const skin = doc.getRoot().listNodes().find(node => node.getMesh() === mesh)?.getSkin();
  assert(skin, "Expected the actual skinned Nubian riding body");
  return mesh.listPrimitives().map(primitive => simplifyMountWithOriginalHands(primitive, skin, ratio));
});
// No second quantization: preserve original hand positions/UVs/normals/skin data byte for byte.
doc.createExtension(EXTMeshoptCompression).setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
const candidate = resolve(output, "nubian-rider-minimal.glb");
await io.write(candidate, doc);
const written = await io.read(candidate);
assert.deepEqual(await metadata(written), originalMetadata, "Staged output retains exact rig/material/texture/node identities");
const afterPrimitives = written.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
for (const [index, proof] of protectedProof.entries()) {
  const decoded = mountVertexSignatures(afterPrimitives[index]!);
  for (const signature of proof.protectedSignatures)
    assert(decoded.has(signature), "Decoded staged hand geometry/UV/normal/skin remains exact");
}
const candidateBounds = bounds(written);
const existing = await io.read(resolve("assets/mounts/nubian-rider-minimal.glb"));
const existingPrimitives = existing.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
const geometryBytes = (document: Document) => document.getRoot().listAccessors()
  .reduce((sum, accessor) => sum + (accessor.getArray()?.byteLength ?? 0), 0);
const maximumBoundsDelta = Math.max(...originalBounds.min.map((value, axis) => Math.abs(value - candidateBounds.min[axis]!)),
  ...originalBounds.max.map((value, axis) => Math.abs(value - candidateBounds.max[axis]!)));
assert(maximumBoundsDelta < .015, "Original whole-body proxy bounds must stay within1.5cm model units");
const report = { status: "cpu-guard-passed-native-pending", source, candidate,
  sourceTriangles, targetTriangles: SEAMED_MOUNT_TRIANGLES,
  candidateTriangles: protectedProof.reduce((sum, proof) => sum + proof.triangles, 0),
  bytes: statSync(candidate).size, originalBounds, candidateBounds, maximumBoundsDelta,
  existingMinimal: { bytes: statSync("assets/mounts/nubian-rider-minimal.glb").size,
    triangles: existingPrimitives.reduce((sum, primitive) => sum + primitive.getIndices()!.getCount() / 3, 0),
    vertices: existingPrimitives.reduce((sum, primitive) => sum + primitive.getAttribute("POSITION")!.getCount(), 0),
    geometryBytes: geometryBytes(existing), bounds: bounds(existing) },
  candidateVertices: afterPrimitives.reduce((sum, primitive) => sum + primitive.getAttribute("POSITION")!.getCount(), 0),
  candidateGeometryBytes: geometryBytes(written), proxyBounds: "actual skinned bind pose, using original joint matrices",
  primitives: protectedProof.map(({ protectedSignatures, ...proof }) => ({ ...proof,
    exactProtectedSignatures: protectedSignatures.length })),
  exactHandAttributesAfterDecode: true, exactRigMaterialsTexturesNodeIdentities: true,
  runtimeAssetsChanged: false, visualAcceptance: "pending actual native comparison" };
writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
