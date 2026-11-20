import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { skinnedNode } from "../../../island-of-settlers-worker-generation/src/armour/armour-gltf";
import { buildSourceKiltPanels } from "../../../island-of-settlers-worker-generation/src/national-workers/source-kilt-panels";
import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";

const { values } = parseArgs({ options: { profile: { type: "string" }, folder: { type: "string" },
  "diagnostic-failure": { type: "boolean" } } });
assert(values.profile && values.folder && /^source-cloth-profile-[a-z0-9-]+$/.test(values.folder),
  "Choose a frozen profile and a new source-cloth-profile-* diagnostic folder");
const id = "nubian-man-scarf", ready = resolve("../island-of-settlers-worker-generation/game_ready");
const folder = resolve(ready, values.folder), sourcePath = resolve(ready, "original-clothes-review", id, "model.glb");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const profileBytes = await readFile(values.profile), profileSha256 = hash(profileBytes);
const profile = JSON.parse(profileBytes.toString("utf8"));
assert.equal(hash(await readFile(sourcePath)), profile.inputSha256);
assert(profile.originalUnchanged && profile.allPositionsNormalsUVIndicesExact && profile.allNonCostumeSkinExact);
assert(profile.records.length && profile.fittedProfile?.weights.length);
const cpuPassed = profile.records.every((record: { maximumNewExposures: number; maximumPoseShift: number }) =>
  record.maximumNewExposures === 0 && record.maximumPoseShift <= .02);
assert(cpuPassed || values["diagnostic-failure"], "A failed profile needs explicit diagnostic-only staging");
const io = await createRetargetIO(), document = await io.read(sourcePath), node = skinnedNode(document);
const primitive = node.getMesh()!.listPrimitives()[0]!;
assert.equal(primitive.getAttribute("POSITION")!.getCount(), 11505);
assert.equal(primitive.getIndices()!.getCount(), 30258);
const streams = primitive.listSemantics().map(name => ({ name,
  values: Array.from(primitive.getAttribute(name)!.getArray()!) }));
const indices = Array.from(primitive.getIndices()!.getArray()!);
// This legacy pattern author appends/replaces garment geometry. Ownership discovery must run
// on a separate throwaway document; the candidate starts from the literal unmodified source.
const support = buildSourceKiltPanels(await io.read(sourcePath), id);
const owned = new Set(support.ownedVertices), legs = new Set(support.originalLegVertices), written = new Set<number>();
const joints = primitive.getAttribute("JOINTS_0")!, weights = primitive.getAttribute("WEIGHTS_0")!;
assert.deepEqual(Array.from(primitive.getIndices()!.getArray()!), indices);
for (const stream of streams) assert.deepEqual(Array.from(primitive.getAttribute(stream.name)!.getArray()!), stream.values);
const skeleton = node.getSkin()!, boneNames = skeleton.listJoints().map(joint => joint.getName());
const inverseBinds = Array.from(skeleton.getInverseBindMatrices()!.getArray()!);
const nodes = document.getRoot().listNodes().map(node => ({ name: node.getName(), matrix: node.getMatrix() }));
const textures = document.getRoot().listTextures().map(texture => hash(texture.getImage()!));
for (const group of profile.fittedProfile.weights) {
  assert(group.joints.every((joint: number, slot: number) => boneNames[joint] === group.jointNames[slot]),
    "Frozen profile joint names/order differ from the literal donor");
  assert(group.weights.every((weight: number) => Number.isFinite(weight) && weight >= 0));
  assert(Math.abs(group.weights.reduce((sum: number, weight: number) => sum + weight, 0) - 1) < .00001);
  for (const vertex of group.vertices) {
    assert(owned.has(vertex) && !legs.has(vertex) && !written.has(vertex));
    joints.setElement(vertex, [0, 1, 2, 3].map(slot => group.joints[slot] ?? 0));
    weights.setElement(vertex, [0, 1, 2, 3].map(slot => group.weights[slot] ?? 0));
    written.add(vertex);
  }
}
assert.equal(written.size, owned.size);
const expectedJoints = Array.from(joints.getArray()!), expectedWeights = Array.from(weights.getArray()!);
// Deliberately fail if this immutable review folder already exists; never overwrite a captured candidate.
await mkdir(folder);
await mkdir(resolve(folder, id));
const output = resolve(folder, id, "model.glb");
await io.write(output, document);
const loaded = await io.read(output), actualNode = skinnedNode(loaded);
const actual = actualNode.getMesh()!.listPrimitives()[0]!;
assert.deepEqual(Array.from(actual.getAttribute("JOINTS_0")!.getArray()!), expectedJoints);
assert.deepEqual(Array.from(actual.getAttribute("WEIGHTS_0")!.getArray()!), expectedWeights);
for (const stream of streams) {
  const accessor = actual.getAttribute(stream.name)!, size = accessor.getElementSize(), result = accessor.getArray()!;
  assert.equal(result.length, stream.values.length, `Literal source stream count changed: ${stream.name}`);
  for (let vertex = 0; vertex < accessor.getCount(); vertex++) {
    if (owned.has(vertex) && ["JOINTS_0", "WEIGHTS_0"].includes(stream.name)) continue;
    assert.deepEqual(Array.from(result.slice(vertex * size, (vertex + 1) * size)),
      stream.values.slice(vertex * size, (vertex + 1) * size));
  }
}
assert.deepEqual(Array.from(actual.getIndices()!.getArray()!), indices);
assert.deepEqual(Array.from(actualNode.getSkin()!.getInverseBindMatrices()!.getArray()!), inverseBinds);
for (const expected of nodes)
  assert.deepEqual(loaded.getRoot().listNodes().find(node => node.getName() === expected.name)!.getMatrix(), expected.matrix);
assert.deepEqual(loaded.getRoot().listTextures().map(texture => hash(texture.getImage()!)), textures);
assert.equal(hash(await readFile(sourcePath)), profile.inputSha256);
assert.equal(hash(await readFile(values.profile)), profileSha256);
const receipt = { id, sourcePath, inputSha256: profile.inputSha256, output, outputSha256: hash(await readFile(output)),
  profilePath: resolve(values.profile), profileSha256, cpuPassed, nativeAccepted: false, reviewOnly: true,
  exactOriginalGeometryAndNonCostumeSkin: true, exactOriginalTexturesAndRig: true, ownedClothVertices: owned.size,
  literalSourceVertices: primitive.getAttribute("POSITION")!.getCount(), literalSourceIndices: indices.length,
  scope: "Immutable diagnostic source-clothes skin-weight candidate only; original anatomy/source assets unchanged; never publish a failed CPU/native candidate" };
await writeFile(resolve(folder, id, "provenance.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
