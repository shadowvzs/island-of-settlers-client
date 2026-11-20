import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { NodeIO } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/core/dist/index.js";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/extensions/dist/index.js";
import { dequantize, weld } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/functions/dist/index.js";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "../../../island-of-settlers-worker-generation/node_modules/meshoptimizer/index.js";
import { commanderRiderIdentity, guardCommanderClothSource, VIKING_CLOTH_SOURCE_SHA,
  VIKING_CLOTH_STAGE_SHA, VIKING_CLOTH_VERTICES, type VikingClothProfile } from "../assets/commander-cloth-source-guard";
import { COMMANDER_RIDER_GEOMETRY_BYTES, COMMANDER_RIDER_TRIANGLES } from "../assets/commander-surface-policy";
import { mountVertexSignatures } from "../assets/mount-hand-lod";
import { riderFaceAttributes, riderVertexAttributeKeys, simplifyRiderSurface } from "../assets/mount-surface-lod";

// Diagnostic derivation only. Publication and real-runtime selection need separate native acceptance.
const review = resolve("../resources/project-reviews/commander-possession-2026-11-03");
const stage = resolve(review, "viking-cloth-spine-approved-a"), output = resolve(review, "rider-surface-e");
const source = resolve("../island-of-settlers-worker-generation/game_ready/mounts/riders/viking-woman-blue/model.glb");
const near = resolve(stage, "model.glb"), hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
assert.equal(hash(source), VIKING_CLOTH_SOURCE_SHA); assert.equal(hash(near), VIKING_CLOTH_STAGE_SHA);
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder
});
const original = await io.read(source), document = await io.read(near);
const profile = JSON.parse(readFileSync(resolve(stage, "profile.json"), "utf8")) as VikingClothProfile;
await guardCommanderClothSource(io, original, document, profile);
const identity = await commanderRiderIdentity(io, document);
await document.transform(dequantize());
const cloth = document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives())[1]!;
const keys = riderVertexAttributeKeys(cloth), patch = new Set(VIKING_CLOTH_VERTICES.map(vertex => keys[vertex]!));
await document.transform(weld());
const primitives = document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
const originals = primitives.map(mountVertexSignatures);
const sourceTriangles = primitives.reduce((sum, primitive) => sum + primitive.getIndices()!.getCount() / 3, 0);
let index = 0;
const proofs = document.getRoot().listMeshes().flatMap(mesh => {
  const skin = document.getRoot().listNodes().find(node => node.getMesh() === mesh)!.getSkin()!;
  return mesh.listPrimitives().map(primitive => simplifyRiderSurface(primitive, skin, 3000 / sourceTriangles, false,
    index++ === 1 ? patch : undefined));
});
document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
mkdirSync(output, { recursive: true });
const candidate = resolve(output, "viking-rider-minimal.glb"); await io.write(candidate, document);
const written = await io.read(candidate);
assert.deepEqual(await commanderRiderIdentity(io, written), identity);
for (const [index, primitive] of written.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives()).entries()) {
  for (const vertex of mountVertexSignatures(primitive)) assert(originals[index]!.has(vertex));
  const faces = riderFaceAttributes(primitive);
  for (const face of proofs[index]!.protectedFaceAttributes) assert(faces.has(face), "Decoded original critical and explicit cloth patch faces stay exact");
}
const triangles = proofs.reduce((sum, proof) => sum + proof.triangles, 0);
const geometryBytes = written.getRoot().listAccessors().reduce((sum, accessor) => sum + (accessor.getArray()?.byteLength ?? 0), 0);
assert(triangles <= COMMANDER_RIDER_TRIANGLES); assert(geometryBytes <= COMMANDER_RIDER_GEOMETRY_BYTES);
const report = { source, sourceSha256: VIKING_CLOTH_SOURCE_SHA, near, nearSha256: VIKING_CLOTH_STAGE_SHA,
  candidate, candidateSha256: hash(candidate), triangles, geometryBytes, bytes: statSync(candidate).size,
  protectedOriginalClothVertices: VIKING_CLOTH_VERTICES, explicitPatchAndHaloLocked: true,
  decodedCriticalAndPatchFacesExact: true, exactRestBodyRigMaterialsTextures: true,
  runtimeAssetsChanged: false, nativeAcceptance: "pending", proofs: proofs.map(({ protectedFaceAttributes: _, ...proof }) => proof) };
assert.equal(hash(source), VIKING_CLOTH_SOURCE_SHA); assert.equal(hash(near), VIKING_CLOTH_STAGE_SHA);
writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
