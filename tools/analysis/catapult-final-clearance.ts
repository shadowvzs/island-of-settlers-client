import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";

import { getAuthoredBuildingPlot } from "../../src/render-common/buildings/building-plot-profile";
import { CATAPULT_DECK_HEIGHT } from "../../src/render-common/buildings/catapult-dimensions";
import { CATAPULT_HATCH_WELL, catapultStairManeuver } from "../../src/render-common/buildings/catapult-hatch";
import { CATAPULT_ENGINE_ORIGIN, CATAPULT_HATCH, CATAPULT_TRAVERSE } from "../../src/render-common/buildings/catapult-mechanism";
import { createCatapultTowerRecipe } from "../../src/render-common/buildings/catapult-tower-recipe";
import { createCatapultDeckGeometry } from "../../src/renderers/three/buildings/catapult-deck-geometry";
import { CATAPULT_RESUPPLY_ROOF_ROUTE } from "../../src/shared/settlement/catapult-cycle";

const folder = resolve("../resources/project-reviews/catapult-hatch-cpu-2026-11-02");
const profile = JSON.parse(await readFile(`${folder}/proposed-common-profile-well.json`, "utf8"));
const proof = JSON.parse(await readFile(`${folder}/${process.env.HATCH_FINAL_SOURCE ?? profile.source}`, "utf8"));
const scale = getAuthoredBuildingPlot(16)!.structureScale, floor = CATAPULT_HATCH_WELL;
assert.equal(floor.top, profile.proposedHatchModelWidth); assert.equal(floor.lower, profile.lowerWidthModel);
assert.equal(floor.depth, profile.slabThicknessModel); assert.equal(floor.throat, profile.throatModel);
assert.equal(floor.chamfer, profile.chamferModel); assert.equal(CATAPULT_HATCH.size, floor.top);
assert.deepEqual(CATAPULT_HATCH.position, floor.center); assert.deepEqual(CATAPULT_RESUPPLY_ROOF_ROUTE[0], floor.center);
for (const [path, hash] of Object.entries(proof.poseSourceHashes) as [string, string][])
  if (path.includes("three-worker.ts") || path.includes("worker-stone") || path.includes("worker-cradle") || path.includes("stair-tuck"))
    assert.equal(createHash("sha256").update(await readFile(path)).digest("hex"), hash, `Posed rig changed: ${path}`);
const expected = (height: number, down: boolean) => {
  const knots = profile.knots as { height: number; x: number; z: number }[];
  if (height <= 0 || height >= knots.at(-1)!.height) return { x: 0, z: 0 };
  const at = knots.findIndex(knot => knot.height >= height), a = knots[at - 1]!, b = knots[at]!;
  const t = (height - a.height) / (b.height - a.height), smooth = t * t * (3 - 2 * t), sign = down ? -1 : 1;
  return { x: (a.x + (b.x - a.x) * smooth) * sign, z: (a.z + (b.z - a.z) * smooth) * sign };
};
let maximumPathError = 0;
for (const descending of [false, true]) for (let sample = 0; sample <= 3100; sample++) {
  const height = sample / 2000, actual = catapultStairManeuver(height, descending), wanted = expected(height, descending);
  maximumPathError = Math.max(maximumPathError, Math.abs(actual.x - wanted.x), Math.abs(actual.z - wanted.z));
  assert.equal(actual.heading, descending ? profile.headingDown : profile.headingUp);
}
assert(maximumPathError < 1e-12);
const recipe = createCatapultTowerRecipe("roman", true), part = recipe.parts.find(part => part.shape === "catapult-deck")!;
assert(part); assert.deepEqual(part.size, [1.65, .16, 1.65]);
assert.equal(part.position[0], 0); assert.equal(part.position[2], 0);
assert(Math.abs(part.position[1] - (CATAPULT_DECK_HEIGHT - .08)) < 1e-12);
const geometry = createCatapultDeckGeometry(); geometry.scale(...part.size!); geometry.translate(...part.position);
const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })); mesh.updateMatrixWorld(true);
const depthSamples = [1e-5, floor.throat / 2, floor.throat + floor.chamfer / 2, floor.throat + floor.chamfer + .001, floor.depth - 1e-5];
const cutouts = [];
for (const depth of depthSamples) {
  const half = floor.top / 2 + (floor.lower - floor.top) / 2 * Math.max(0, Math.min(1, (depth - floor.throat) / floor.chamfer));
  const rays = [];
  for (const direction of [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)]) {
    const hit = new Raycaster(new Vector3(floor.center[0], floor.center[1] - depth, floor.center[2]), direction, 0, 1)
      .intersectObject(mesh, false)[0];
    assert(hit, `Actual deck has no well wall at depth ${depth}`);
    assert(Math.abs(hit.distance - half) < 2e-6, `Actual well wall differs at depth ${depth}: ${hit.distance}/${half}`);
    rays.push(hit.distance);
  }
  cutouts.push({ depthModel: depth, expectedHalfModel: half, actualHalfModel: rays });
}
const bearing = recipe.parts.filter(part => part.shape === "ring" || part.shape === "cylinder")
  .filter(part => part.position[0] === CATAPULT_ENGINE_ORIGIN[0] && part.position[2] === CATAPULT_ENGINE_ORIGIN[2]);
const bearingClearance = bearing.map(part => {
  const bottom = part.position[1] - part.size![1] / 2;
  assert(bottom >= floor.center[1] - 1e-12, "Bearing intrudes into lower counterbore");
  const cornerX = floor.center[0] + floor.top / 2, cornerZ = floor.center[2] + floor.top / 2;
  const gap = Math.hypot(CATAPULT_ENGINE_ORIGIN[0] - cornerX, CATAPULT_ENGINE_ORIGIN[2] - cornerZ) - part.size![0] / 2;
  assert(gap > 0); return { shape: part.shape, bottomModel: bottom, radialCornerGapWorld: gap * scale };
});
assert(Math.abs(CATAPULT_TRAVERSE.body[0] - CATAPULT_ENGINE_ORIGIN[0] - .18) < 1e-12);
assert(Math.abs(CATAPULT_TRAVERSE.body[2] - CATAPULT_ENGINE_ORIGIN[2] + .466) < 1e-12);
assert(Math.abs(CATAPULT_TRAVERSE.facing - Math.atan2(-.466, -.18)) < 1e-12);
const report = { generatedAt: new Date().toISOString(), bodyRankLodCases: proof.reports.length,
  wholeWellMinimumClearanceWorld: profile.minimumClearance, maximumPathError, pathSamples: 6202, cutouts, bearingClearance,
  operatorStation: CATAPULT_TRAVERSE.body, operatorFacing: CATAPULT_TRAVERSE.facing,
  operatorIndexedProof: "operator-support-rear-4995-indexed/review.json",
  scope: "Actual production maneuver, pose fingerprints, normalized deck mesh with recipe transform, all well depths, bearing and operator station",
  remainingNativeScope: "Open lid/hinge swept geometry and full supply journey remain the Catapult native review's responsibility" };
await writeFile(`${folder}/actual-final-contract.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
