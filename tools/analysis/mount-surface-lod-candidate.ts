import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { type Document, NodeIO } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/core/dist/index.js";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/extensions/dist/index.js";
import { dequantize, weld } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/functions/dist/index.js";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "../../../island-of-settlers-worker-generation/node_modules/meshoptimizer/index.js";
import { COMMANDER_RIDER_GEOMETRY_BYTES, COMMANDER_RIDER_TRIANGLES } from "../assets/commander-surface-policy";
import { mountVertexSignatures } from "../assets/mount-hand-lod";
import { riderFaceAttributes, simplifyRiderSurface } from "../assets/mount-surface-lod";

const strict = !process.argv.includes("--weighted");
const output = resolve(`../resources/project-reviews/commander-possession-2026-11-03/rider-surface-${strict ? "c" : "d"}`);
mkdirSync(output, { recursive: true });
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder
});
const metadata = async (document: Document) => {
  const { json } = await io.writeJSON(document);
  return { materials: json.materials, nodes: json.nodes, samplers: json.samplers, textures: json.textures,
    meshes: document.getRoot().listMeshes().map(mesh => ({ name: mesh.getName(),
      primitives: mesh.listPrimitives().map(primitive => ({ mode: primitive.getMode(),
        material: document.getRoot().listMaterials().indexOf(primitive.getMaterial()!) })) })),
    images: document.getRoot().listTextures().map(texture => ({ name: texture.getName(), mime: texture.getMimeType(),
      hash: createHash("sha256").update(texture.getImage()!).digest("hex") })),
    skins: document.getRoot().listSkins().map(skin => ({ name: skin.getName(), joints: skin.listJoints().map(joint => joint.getName()),
      inverseBindMatrices: Array.from(skin.getInverseBindMatrices()!.getArray()!) })) };
};
const reports = [];
for (const [nation, body] of [["nubian", "nubian-man-kilt"], ["viking", "viking-woman-blue"]]) {
  const source = resolve(`../island-of-settlers-worker-generation/game_ready/mounts/riders/${body}/model.glb`);
  const sourceHash = createHash("sha256").update(readFileSync(source)).digest("hex");
  const doc = await io.read(source), originalMetadata = await metadata(doc);
  await doc.transform(dequantize(), weld());
  assert.deepEqual(await metadata(doc), originalMetadata);
  const primitives = doc.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
  const originalSignatures = primitives.map(mountVertexSignatures);
  const sourceTriangles = primitives.reduce((sum, primitive) => sum + primitive.getIndices()!.getCount() / 3, 0);
  const proofs = doc.getRoot().listMeshes().flatMap(mesh => {
    const skin = doc.getRoot().listNodes().find(node => node.getMesh() === mesh)?.getSkin(); assert(skin);
    return mesh.listPrimitives().map(primitive => simplifyRiderSurface(primitive, skin, 3000 / sourceTriangles, strict));
  });
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const candidate = resolve(output, `${nation}-rider-minimal.glb`); await io.write(candidate, doc);
  const written = await io.read(candidate); assert.deepEqual(await metadata(written), originalMetadata);
  for (const [index, primitive] of written.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives()).entries()) {
    for (const value of mountVertexSignatures(primitive)) assert(originalSignatures[index]!.has(value), "Every decoded attribute is an exact original source value");
    const faces = riderFaceAttributes(primitive);
    for (const face of proofs[index]!.protectedFaceAttributes)
      assert(faces.has(face), "Decoded critical face topology, winding and all attributes stay exact");
  }
  assert.equal(createHash("sha256").update(readFileSync(source)).digest("hex"), sourceHash);
  const existingPath = resolve(`assets/mounts/${nation}-rider-minimal.glb`), existing = await io.read(existingPath);
  const geometryBytes = (document: Document) => document.getRoot().listAccessors()
    .reduce((sum, accessor) => sum + (accessor.getArray()?.byteLength ?? 0), 0);
  const report = { nation, source, sourceHash, candidate, sourceTriangles,
    candidateTriangles: proofs.reduce((sum, proof) => sum + proof.triangles, 0), bytes: statSync(candidate).size,
    candidateGeometryBytes: geometryBytes(written),
    currentOrdinaryMinimal: { bytes: statSync(existingPath).size, geometryBytes: geometryBytes(existing),
      triangles: existing.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives())
        .reduce((sum, primitive) => sum + primitive.getIndices()!.getCount() / 3, 0) },
    ratio: proofs.reduce((sum, proof) => sum + proof.triangles, 0) / sourceTriangles,
    exactOriginalRestUvNormalSkinVertices: true, exactRigMaterialsTexturesNodes: true,
    protectedCriticalSeamSkinFaces: true, decodedCriticalFaceTopologyExact: true,
    policy: strict ? "exact critical/all seam/all blended faces" : "exact head/neck/arms/hands and skin-seam faces; bounded UV/normal/noncritical bone-weight fields",
    runtimeAssetsChanged: false, nativeAcceptance: "pending", proofs: proofs.map(({ protectedFaceAttributes: _, ...proof }) => proof) };
  if (!strict) {
    assert(report.candidateTriangles <= COMMANDER_RIDER_TRIANGLES, "Bounded Commander-only surface triangle budget");
    assert(report.candidateGeometryBytes <= COMMANDER_RIDER_GEOMETRY_BYTES, "Bounded Commander-only decoded body geometry budget");
  }
  reports.push(report); console.log(JSON.stringify(report));
}
writeFileSync(resolve(output, "report.json"), JSON.stringify(reports, null, 2));
