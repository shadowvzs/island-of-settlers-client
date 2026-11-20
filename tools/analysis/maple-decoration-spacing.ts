import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Box3, Matrix4, Vector3 } from "three";

import type { RoadDecorationItemId } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { roadDecorationClearance } from "../../src/render-common/road-decoration-clearance";
import { createOrnamentalPlantModels } from "../../src/renderers/three/plants/ornamental-plant-model";
import { getRoadDecoration } from "../../src/shared/settlement/road-decoration-catalog";
import { createRoadDecorationState } from "../../src/shared/settlement/road-decoration-state";

const models = createOrnamentalPlantModels(true), results = [];
const context = () => ({ nation: "roman" as const, roads: [], heightAt: () => 0,
  isOwned: () => true, isFree: () => true });
for (const variant of [0, 1, 2] as const) {
  const item = `roadDecoration:plant-red-maple-standalone-ground-${variant}:native` as RoadDecorationItemId;
  const definition = getRoadDecoration(`plant-red-maple-standalone-ground-${variant}`)!;
  const contract = roadDecorationClearance(definition), model = models.create(definition.plant!, "near");
  const near = new Box3().setFromObject(model.root), physical = new Box3();
  for (const box of contract.volumes) {
    physical.expandByPoint(new Vector3(...box.min)); physical.expandByPoint(new Vector3(...box.max));
  }
  const samples = [];
  for (const yaw of [0, Math.PI / 4, Math.PI / 2]) for (const direction of [0, Math.PI / 2]) {
    const state = createRoadDecorationState(context);
    state.place({ item, position: { x: 20, z: 20 }, yaw: 0 }, () => true);
    let closestLegal: number | undefined, separatedGeometryRejected: number | undefined;
    for (let step = 2; step <= 120; step++) {
      const distance = step / 10, x = 20 + Math.cos(direction) * distance, z = 20 + Math.sin(direction) * distance;
      const plan = state.plan({ item, position: { x, z }, yaw });
      const transform = new Matrix4().makeRotationY(yaw); transform.setPosition(x, 0, z);
      const second = near.clone().applyMatrix4(transform), first = near.clone().translate(new Vector3(20, 0, 20));
      if (!plan.ok && !first.intersectsBox(second)) separatedGeometryRejected = distance;
      if (plan.ok) { closestLegal = distance; break; }
    }
    samples.push({ yaw, direction, closestLegalAtPointOneMetreSampling: closestLegal,
      lastRejectedDespiteSeparatedWholeNearGeometryAabbs: separatedGeometryRejected });
  }
  let broadphaseOverlapAccepted;
  const state = createRoadDecorationState(context);
  state.place({ item, position: { x: 20, z: 20 }, yaw: 0 }, () => true);
  outer: for (let x = 2; x <= 8; x += .2) for (let z = 2; z <= 8; z += .2) {
    if (!physical.intersectsBox(physical.clone().translate(new Vector3(x, 0, z)))) continue;
    if (state.plan({ item, position: { x: 20 + x, z: 20 + z }, yaw: 0 }).ok) {
      broadphaseOverlapAccepted = { x, z }; break outer;
    }
  }
  results.push({ variant, nearGeometryBounds: { min: near.min.toArray(), max: near.max.toArray(), size: near.getSize(new Vector3()).toArray() },
    physicalBounds: { min: physical.min.toArray(), max: physical.max.toArray(), size: physical.getSize(new Vector3()).toArray() },
    physicalVolumes: contract.volumes.length, samples, broadphaseOverlapAccepted });
  model.dispose();
}
const files = ["src/render-common/plants/maple-tree-graph.ts", "src/render-common/plants/ornamental-plant-clearance.ts",
  "src/render-common/road-decoration-clearance.ts", "src/shared/settlement/road-decoration-state.ts",
  "src/shared/settlement/road-decoration-placement.ts", "src/shared/settlement/road-decoration-context.ts"];
const hashes = Object.fromEntries(files.map(file => [file, createHash("sha256").update(readFileSync(file)).digest("hex")]));
const report = { note: "Read-only CPU audit; no model, placement semantics, offers or live account changes. Sampled distances are not universal minima.", hashes, results };
writeFileSync("../resources/project-reviews/ornamental-plant-runtime-2026-11-04/maple-spacing-audit-a.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(results, null, 2));
