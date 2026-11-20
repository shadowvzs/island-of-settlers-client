import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Matrix4, Vector3 } from "three";

import { NodeIO } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/core/dist/index.js";
import { ALL_EXTENSIONS } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/extensions/dist/index.js";
import { MeshoptDecoder } from "../../../island-of-settlers-worker-generation/node_modules/meshoptimizer/index.js";

const root = resolve(import.meta.dirname, "../../..");
const review = resolve(root, "resources/project-reviews/horse-slim-2026-10-26");
const highPath = resolve(root, "island-of-settlers-worker-generation/game_ready/mounts/horse/model.glb");
const minimalPath = resolve(root, "island-of-settlers-client/assets/mounts/horse-minimal.glb");
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const [original, high, minimal] = await Promise.all([
  io.read(resolve(review, "original/horse-high.glb")), io.read(highPath), io.read(minimalPath)
]);
const rig = (document: typeof high) => document.getRoot().listNodes()
  .filter(node => !node.getMesh()).map(node => ({ name: node.getName(),
    rotation: node.getRotation(), scale: node.getScale(), translation: node.getTranslation() }));
const animations = (document: typeof high) => document.getRoot().listAnimations().map(animation => ({
  name: animation.getName(), channels: animation.listChannels().map(channel => ({
    node: channel.getTargetNode()?.getName(), path: channel.getTargetPath(),
    interpolation: channel.getSampler()!.getInterpolation(),
    input: Array.from(channel.getSampler()!.getInput()!.getArray()!),
    output: Array.from(channel.getSampler()!.getOutput()!.getArray()!)
  }))
}));
assert.deepEqual(rig(high), rig(original), "High horse rig and attachments changed");
assert.deepEqual(rig(minimal), rig(high), "Minimal horse rig and attachments differ");
assert.deepEqual(animations(high), animations(original), "Horse animation data changed");
assert.deepEqual(animations(minimal), animations(high), "Minimal horse animations differ");
const vertices = (document: typeof high, primitiveIndex: number) => {
  const node = document.getRoot().listNodes().find(node => node.getMesh())!;
  const primitive = node.getMesh()!.listPrimitives()[primitiveIndex]!;
  const positions = primitive.getAttribute("POSITION")!;
  const matrix = new Matrix4().fromArray(node.getSkin()!.getInverseBindMatrices()!.getElement(0, []));
  return Array.from({ length: positions.getCount() }, (_, vertex) =>
    new Vector3().fromArray(positions.getElement(vertex, [])).applyMatrix4(matrix));
};
const before = vertices(original, 0), after = vertices(high, 0);
assert.equal(after.length, before.length, "High horse vertex count changed");
let maxXChange = 0, maxYChange = 0, maxZChange = 0, changed = 0, lowerLegChange = 0;
before.forEach((point, index) => {
  const other = after[index]!;
  const dx = Math.abs(other.x - point.x);
  maxXChange = Math.max(maxXChange, dx);
  maxYChange = Math.max(maxYChange, Math.abs(other.y - point.y));
  maxZChange = Math.max(maxZChange, Math.abs(other.z - point.z));
  if (dx > .0001) changed++;
  if (point.y <= .48 || point.y >= 1.04) lowerLegChange = Math.max(lowerLegChange, point.distanceTo(other));
});
assert.ok(maxXChange > .025 && changed > 500, "Torso was not visibly slimmed");
assert.ok(maxYChange < .0001 && maxZChange < .0001 && lowerLegChange < .0001,
  "Height, length or protected upper-back/lower-leg geometry changed");
const tackBefore = vertices(original, 1), tackAfter = vertices(high, 1);
assert.equal(tackBefore.length, tackAfter.length);
const maxTackChange = Math.max(...tackBefore.map((point, index) => point.distanceTo(tackAfter[index]!)));
assert.ok(maxTackChange < .0001, "Rider tack changed");
const hashes = await Promise.all([highPath, minimalPath].map(async path => ({
  path, sha256: createHash("sha256").update(await readFile(path)).digest("hex")
})));
const report = { rigAndAttachmentsUnchanged: true, animationsUnchanged: true,
  detailRigsMatch: true, changedVertices: changed, maxXChange, maxYChange, maxZChange,
  protectedGeometryChange: lowerLegChange, maxTackChange, hashes };
await writeFile(resolve(review, "asset-validation.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
