import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Vector3 } from "three";

import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { sourceClothContactCoverage } from "./source-cloth-coverage";
import { clothHullRayInterval } from "./source-cloth-hull-ray";
import { clothPosePoints, type PreparedClothPose } from "./source-cloth-weight-contacts";
import type { createClothWeightGroups } from "./source-cloth-weight-groups";

export const inspectPinnedClothObstruction = async (output: string, poses: Iterable<PreparedClothPose>,
  skin: ReturnType<typeof createClothWeightGroups>, costumeIndices: number[], mutable: ReadonlySet<number>,
  boundary: ReadonlySet<number>) => {
  const a = 6656, b = 6655, groupA = skin.byVertex.get(a)!, groupB = skin.byVertex.get(b)!;
  assert(boundary.has(groupA) && boundary.has(groupB) && !mutable.has(groupA) && !mutable.has(groupB));
  const records = [];
  for (const pose of poses) {
    const points = clothPosePoints(pose, skin.groups), edge = points[b]!.clone().sub(points[a]!);
    const length = edge.length(), direction = edge.clone().divideScalar(length);
    const crossing = pose.body.raycast(points[a]!, direction, .0002, length - .0002);
    if (!crossing) continue;
    const point = points[a]!.clone().addScaledVector(direction, crossing.distance);
    const grid = new TriangleGrid(points, costumeIndices);
    const coverage = sourceClothContactCoverage(point, crossing.triangle, pose.body, pose.source, grid);
    if (!coverage.newExposure) continue;
    const normal = pose.body.corner(crossing.triangle, 1).clone().sub(pose.body.corner(crossing.triangle, 0))
      .cross(pose.body.corner(crossing.triangle, 2).clone().sub(pose.body.corner(crossing.triangle, 0))).normalize();
    const origin = point.clone().addScaledVector(normal, .0001), potential = [], invariantFaces = [];
    let mutableFaces = 0;
    for (let at = 0; at < costumeIndices.length; at += 3) {
      const vertices = costumeIndices.slice(at, at + 3), groups = vertices.map(vertex => skin.byVertex.get(vertex));
      if (groups.includes(groupA) && groups.includes(groupB)) {
        invariantFaces.push(at / 3); continue;
      }
      if (!groups.some(group => group !== undefined && mutable.has(group))) continue;
      mutableFaces++;
      const cloud = vertices.flatMap((vertex, corner) => {
        const id = groups[corner];
        if (id === undefined || !mutable.has(id)) return [points[vertex]!];
        // These five original cloth groups contain no hand contamination. Their literal
        // source point is the clean reference;20.001mm boxes conservatively CONTAIN the
        // complete allowed20mm spheres. This strengthens no acceptance tolerance.
        const centre = pose.points[vertex]!;
        return [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z =>
          centre.clone().add(new Vector3(x, y, z).multiplyScalar(.020001)))));
      });
      const interval = clothHullRayInterval(cloud, origin, normal, .00002, .25);
      if (interval) potential.push({ face: at / 3, vertices, interval });
    }
    const fixedHit = grid.raycast(origin, normal, .00002, .25, hit => {
      const vertices = costumeIndices.slice(hit.triangle * 3, hit.triangle * 3 + 3);
      return !vertices.some(vertex => mutable.has(skin.byVertex.get(vertex)!));
    });
    assert(!fixedHit, "The unchanged source coverage predicate unexpectedly found a fixed cover");
    records.push({ pose: pose.label, edge: [a, b], edgeWorld: [points[a]!.toArray(), points[b]!.toArray()],
      bodyTriangle: crossing.triangle, bodyVertices: [0, 1, 2].map(corner => pose.body.corner(crossing.triangle, corner).toArray()),
      point: point.toArray(), normal: normal.toArray(), coverage, invariantFaces, mutableFaces,
      potentialCoverFaces: potential, restrictedObstructionProved: potential.length === 0 });
  }
  await writeFile(resolve(output, "source-cloth-pinned-edge-proof.json"), JSON.stringify({ records,
    rawGeometryUnchanged: true, anatomyVariables: 0, toleranceUnchanged: true,
    scope: "Restricted proof ONLY for the five authorized mutable garment groups with all15source-waist boundary groups fixed. No claim that every possible four-weight repair is impossible. A pinned edge/body intersection is invariant; incident faces cannot cover its outward ray beyond the fixed intersection. Every alternate mutable triangle is bounded by a conservative20.001mm hull." }, null, 2));
  console.log(JSON.stringify(records.map(record => ({ pose: record.pose, bodyTriangle: record.bodyTriangle,
    candidates: record.potentialCoverFaces, restrictedObstructionProved: record.restrictedObstructionProved }))));
};
