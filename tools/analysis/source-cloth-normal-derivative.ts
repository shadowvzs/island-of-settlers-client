import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Vector3 } from "three";

import { skinnedNode } from "../../../island-of-settlers-worker-generation/src/armour/armour-gltf";
import { buildSourceKiltPanels } from "../../../island-of-settlers-worker-generation/src/national-workers/source-kilt-panels";
import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";

const ready = resolve("../island-of-settlers-worker-generation/game_ready"), id = "nubian-man-scarf";
const basePath = resolve(ready, "source-cloth-profile-af-literal-diagnostic", id, "model.glb");
const sourcePath = resolve(ready, "original-clothes-review", id, "model.glb");
const folder = resolve(ready, "source-cloth-profile-af-cloth-normal-diagnostic");
const output = resolve(folder, id, "model.glb");
const hash = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
const baseSha256 = await hash(basePath), sourceSha256 = await hash(sourcePath);
const io = await createRetargetIO(), document = await io.read(basePath), node = skinnedNode(document);
const primitive = node.getMesh()!.listPrimitives()[0]!;
assert.equal(primitive.getAttribute("POSITION")!.getCount(), 11505);
assert.equal(primitive.getIndices()!.getCount(), 30258);
const streams = primitive.listSemantics().map(name => ({ name, values: Array.from(primitive.getAttribute(name)!.getArray()!) }));
const indices = Array.from(primitive.getIndices()!.getArray()!);
const rig = { joints: node.getSkin()!.listJoints().map(joint => joint.getName()),
  inverses: Array.from(node.getSkin()!.getInverseBindMatrices()!.getArray()!),
  nodes: document.getRoot().listNodes().map(node => ({ name: node.getName(), matrix: node.getMatrix() })) };
const textureHashes = document.getRoot().listTextures().map(texture => createHash("sha256").update(texture.getImage()!).digest("hex"));
const support = buildSourceKiltPanels(await io.read(sourcePath), id);
assert.deepEqual(Array.from(primitive.getIndices()!.getArray()!), indices);
const owned = new Set(support.ownedVertices), legs = new Set(support.originalLegVertices);
const positions = primitive.getAttribute("POSITION")!, normals = primitive.getAttribute("NORMAL")!;
const joints = primitive.getAttribute("JOINTS_0")!, weights = primitive.getAttribute("WEIGHTS_0")!;
const point = (vertex: number) => new Vector3().fromArray(positions.getElement(vertex, []));
const normal = (vertex: number) => new Vector3().fromArray(normals.getElement(vertex, []));
interface SourceClothFace { face: number; vertices: number[]; area: Vector3; unit: Vector3 }
const faces: SourceClothFace[] = support.referenceTriangleOffsets.map(at => {
  const vertices = indices.slice(at, at + 3), a = point(vertices[0]!), b = point(vertices[1]!), c = point(vertices[2]!);
  const area = b.sub(a).cross(c.sub(a));
  return { face: at / 3, vertices, area, unit: area.clone().normalize() };
});
const signature = (vertex: number) => JSON.stringify({ point: positions.getElement(vertex, []), normal: normals.getElement(vertex, []),
  skin: joints.getElement(vertex, []).map((joint, slot) => [joint, weights.getElement(vertex, [])[slot]]) });
const aliases = new Map<string, number[]>();
for (const vertex of owned) {
  const key = signature(vertex), values = aliases.get(key) ?? []; values.push(vertex); aliases.set(key, values);
}
const proposals = new Map<number, Vector3>(), evidence = [];
for (const target of [2058, 4836]) {
  const face = faces.find(face => face.face === target); assert(face);
  for (const vertex of face.vertices) {
    assert(owned.has(vertex) && !legs.has(vertex), "Only proven garment corners may change normals");
    const before = normal(vertex), alignment = before.dot(face.unit);
    if (alignment >= 0) continue;
    const seam = aliases.get(signature(vertex))!;
    const neighbors: SourceClothFace[] = faces.filter(value => value.vertices.some(vertex => seam.includes(vertex))
      && value.vertices.every(vertex => owned.has(vertex)) && value.unit.dot(face.unit) > Math.SQRT1_2);
    const after: Vector3 = neighbors.reduce((sum, value) => sum.add(value.area), new Vector3()).normalize();
    assert(after.lengthSq() > .99 && after.dot(face.unit) > Math.SQRT1_2);
    for (const member of seam) {
      const prior = proposals.get(member);
      assert(!prior || prior.dot(after) > .999, "Contradictory source seam normal charts require manual review");
      proposals.set(member, after);
    }
    evidence.push({ target, vertex, aliases: seam, before: before.toArray(), after: after.toArray(),
      geometricNormal: face.unit.toArray(), oldDot: alignment, newDot: after.dot(face.unit),
      compatibleIncidentFaces: neighbors.map(value => value.face) });
  }
}
assert(proposals.size > 0, "No proven inward source normals were found; do not create an unsolicited derivative");
for (const [vertex, value] of proposals) normals.setElement(vertex, value.toArray());
await mkdir(folder); await mkdir(resolve(folder, id));
await io.write(output, document);
const loaded = await io.read(output), actualNode = skinnedNode(loaded), actual = actualNode.getMesh()!.listPrimitives()[0]!;
for (const stream of streams) {
  const array = Array.from(actual.getAttribute(stream.name)!.getArray()!), size = actual.getAttribute(stream.name)!.getElementSize();
  assert.equal(array.length, stream.values.length);
  for (let vertex = 0; vertex < 11505; vertex++) {
    if (stream.name === "NORMAL" && proposals.has(vertex)) continue;
    assert.deepEqual(array.slice(vertex * size, (vertex + 1) * size), stream.values.slice(vertex * size, (vertex + 1) * size));
  }
}
assert.deepEqual(Array.from(actual.getIndices()!.getArray()!), indices);
assert.deepEqual(actualNode.getSkin()!.listJoints().map(joint => joint.getName()), rig.joints);
assert.deepEqual(Array.from(actualNode.getSkin()!.getInverseBindMatrices()!.getArray()!), rig.inverses);
assert.deepEqual(loaded.getRoot().listNodes().map(node => ({ name: node.getName(), matrix: node.getMatrix() })), rig.nodes);
assert.deepEqual(loaded.getRoot().listTextures().map(texture => createHash("sha256").update(texture.getImage()!).digest("hex")), textureHashes);
assert.equal(await hash(basePath), baseSha256); assert.equal(await hash(sourcePath), sourceSha256);
const provenance = { sourcePath, sourceSha256, basePath, baseSha256, output, outputSha256: await hash(output),
  weightOnly: false, clothNormalDerivative: true, reviewOnly: true, cpuPassed: false, nativeAccepted: false,
  exactPositionsUvIndicesSkinRigTexturesToAF: true, exactAllNonCostumeNormals: true,
  changedGarmentNormalVertices: [...proposals.keys()], evidence,
  scope: "Separate authorized correction of proven inward normals on source costume faces2058/4836 and identical position/normal/skin seam aliases. Area-weighted compatible incident faces only; no whole-body smoothing, anatomy/rest-position/UV/skin/rig/texture change. No publication before material visual review." };
await writeFile(resolve(folder, id, "provenance.json"), JSON.stringify(provenance, null, 2));
console.log(JSON.stringify(provenance));
