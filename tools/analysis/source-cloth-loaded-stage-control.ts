import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SkinnedMesh } from "three";

import { createHatchAuditAssets } from "./catapult-hatch-assets";
import { applyLoadedSourceClothProfile } from "./source-cloth-loaded-profile";

const root = resolve("../resources/project-reviews/armour-shared-repair-2026-11-02");
const ready = resolve("../island-of-settlers-worker-generation/game_ready"), id = "nubian-man-scarf";
const expectedPath = resolve(ready, "source-cloth-profile-v-literal-diagnostic", id, "model.glb");
const actualPath = resolve(ready, "source-cloth-profile-af-literal-diagnostic", id, "model.glb");
const profilePath = resolve(root, "source-cloth-left-af-profile.json");
const hash = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
const profileSha256 = await hash(profilePath), expectedBaseSha256 = await hash(expectedPath), actualSha256 = await hash(actualPath);
const profile = JSON.parse(await readFile(profilePath, "utf8"));
const assets = await createHatchAuditAssets();
const semantics = [];
try {
  const expected = await assets.pack.load("nubian", id, pathToFileURL(expectedPath).href);
  const actual = await assets.pack.load("nubian", id, pathToFileURL(actualPath).href);
  const a = expected.root.getObjectByName("body") as SkinnedMesh, b = actual.root.getObjectByName("body") as SkinnedMesh;
  const owned = new Set<number>(profile.fittedProfile.weights.flatMap((group: { vertices: number[] }) => group.vertices));
  assert.equal(owned.size, 924);
  applyLoadedSourceClothProfile(a, profile.fittedProfile.weights, owned, new Set());
  assert.equal(b.geometry.getAttribute("position").count, 11505); assert.equal(b.geometry.getIndex()!.count, 30258);
  assert.deepEqual(Object.keys(a.geometry.attributes), Object.keys(b.geometry.attributes));
  for (const name of Object.keys(a.geometry.attributes)) {
    assert.deepEqual(Array.from(a.geometry.getAttribute(name).array), Array.from(b.geometry.getAttribute(name).array));
    semantics.push(name);
  }
  assert.deepEqual(Array.from(a.geometry.getIndex()!.array), Array.from(b.geometry.getIndex()!.array));
  assert.deepEqual(a.skeleton.bones.map(bone => bone.name), b.skeleton.bones.map(bone => bone.name));
  assert.deepEqual(a.skeleton.boneInverses.map(matrix => matrix.toArray()), b.skeleton.boneInverses.map(matrix => matrix.toArray()));
  expected.dispose(); actual.dispose();
} finally { assets.restore(); }
assert.equal(await hash(profilePath), profileSha256); assert.equal(await hash(expectedPath), expectedBaseSha256);
assert.equal(await hash(actualPath), actualSha256);
const result = { actualPath, actualSha256, expectedBaseSha256, appliedProfileSha256: profileSha256,
  loadedAllAttributesExact: true, loadedIndexRigExact: true, semantics,
  scope: "Actual AF GLB after GLTFLoader normalization matches the complete in-memory visible-gate representation byte-for-byte; original source/body preservation separately guarded by staging." };
await writeFile(resolve(root, "source-cloth-af-loaded-stage-control.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
