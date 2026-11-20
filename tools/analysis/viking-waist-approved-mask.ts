import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type SkinnedMesh, Vector3 } from "three";

import { readCpuGltf } from "../assets/read-cpu-gltf";

// Fast metadata export only. No animation fit, skin mutation, browser, GPU or GLB write.
const folder = resolve("../resources/project-reviews/commander-possession-2026-11-03/viking-cloth-native-a");
const path = resolve("../island-of-settlers-worker-generation/game_ready/mounts/riders/viking-woman-blue/model.glb");
const sourceSha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
assert.equal(sourceSha256, "a3ff0a7e7bbdbbf4be338d29a0764508f3d702ab3a17822868cd8d4962fc6907");
const prior = JSON.parse(readFileSync(resolve(folder, "visible-source-map.json"), "utf8"));
const donorIds = new Set<number>(prior.inMemoryOnlyDonorControl.donors.map((record: { vertex: number }) => record.vertex));
const source = await readCpuGltf(path);
source.scene.updateMatrixWorld(true);
let vertices: number[] = [];
source.scene.traverse(object => {
  const mesh = object as SkinnedMesh;
  if (!mesh.isSkinnedMesh || source.parser.associations.get(mesh)?.primitives !== 1) return;
  vertices = [...donorIds].filter(vertex => Math.abs(mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(mesh.matrixWorld).x) >= .085)
    .sort((a, b) => a - b);
});
assert.equal(vertices.length, 135);
writeFileSync(resolve(folder, "approved-bilateral-mask.json"), JSON.stringify({ source: path, sourceSha256,
  originalPrimitive: 1, vertices, maximumCanonicalWorldSkinShift: .065, influences: 4,
  sourceGeometryBodyRestNormalUvTopologyRigTextureMustRemainExact: true,
  scope: "Root-approved staged skin-only bilateral side band, both authored shell layers; original135-point mask, not compacted LOD IDs",
  selection: "Source absX>=.085, Y.425–.555, Z>=-.005; closest original protected-thigh source surface within.035",
  nativeAccepted: false, publicationAllowed: false, stageWritten: false,
  taskStatus: "unfinished; all tested expanded fields fail dense coverage or leave visible broad apertures",
  originalSourceUnchanged: true }, null, 2));
console.log(JSON.stringify({ vertices: vertices.length, sourceSha256, stageWritten: false }));
