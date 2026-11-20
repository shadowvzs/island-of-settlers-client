import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { COMMANDER_RIDER_GEOMETRY_BYTES, COMMANDER_RIDER_TRIANGLES } from "./commander-surface-policy";

// Local runtime integration only after the exact staged bytes and real posed surfaces are accepted.
const review = resolve("../resources/project-reviews/commander-possession-2026-11-03");
const json = (path: string) => JSON.parse(readFileSync(resolve(review, path), "utf8"));
const surfaces = json("rider-surface-d/report.json");
const native = json("loadout-surface-d/report.json"), inspected = json("loadout-surface-d/visual-review.json");
assert.equal(inspected.status, "accepted-surface-and-grip");
assert.equal(inspected.imagesIndividuallyInspected, 12);
assert.equal(native.captureCount, 12);
assert(native.reports.every((report: { errors: unknown[] }) => report.errors.length === 0));
const poses = json("rider-surface-d/pose-report.json");
assert.equal(poses.length, 16);
assert(poses.every((pose: { sourceToCandidate: number; candidateToSource: number }) =>
  pose.sourceToCandidate < .008 && pose.candidateToSource < .008));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
for (const source of native.sourceHashes) assert.equal(hash(source.path), source.sha256, "Proof source/asset bytes are still current");
const published = [];
for (const surface of surfaces) {
  assert(surface.candidateTriangles <= COMMANDER_RIDER_TRIANGLES);
  assert(surface.candidateGeometryBytes <= COMMANDER_RIDER_GEOMETRY_BYTES);
  assert(surface.exactOriginalRestUvNormalSkinVertices && surface.exactRigMaterialsTexturesNodes && surface.decodedCriticalFaceTopologyExact);
  assert.equal(hash(surface.source), surface.sourceHash);
  const witness = native.sourceHashes.find((source: { path: string }) => source.path === surface.candidate);
  assert(witness, "Exact staged body was covered by native proof");
  assert.equal(hash(surface.candidate), witness.sha256);
  const target = resolve(`assets/mounts/${surface.nation}-commander-surface.glb`);
  copyFileSync(surface.candidate, target);
  assert.equal(hash(target), witness.sha256);
  published.push({ nation: surface.nation, target, sha256: witness.sha256, triangles: surface.candidateTriangles,
    geometryBytes: surface.candidateGeometryBytes });
}
writeFileSync(resolve(review, "rider-surface-d/runtime-publication.json"), JSON.stringify({
  status: "accepted-bodies-copied-awaiting-runtime-selection-proof", originalModelsChanged: false,
  ordinaryMinimalModelsChanged: false, published
}, null, 2));
