import { CatmullRomCurve3, type Matrix4, Vector3 } from "three";

import type { RoadDecorationBounds } from "./road-decoration-clearance";
import type { RoadDecorationPart } from "./road-decoration-recipe";
import type { WisteriaRoadFrame } from "./road-decoration-wisteria";
import { createWisteriaHeroFrame } from "./wisteria-hero-frame";
import { createWisteriaHeroGraph, type WisteriaWoodPoint } from "./wisteria-hero-graph";
import { groupWisteriaBotany, wisteriaRacemeTransform, wisteriaSprayTransform } from "./wisteria-lod-layout";
import { WISTERIA_PRODUCTION_ATLAS } from "./wisteria-production-atlas-data";

const boundsOf = (points: readonly WisteriaWoodPoint[], margin = 0): RoadDecorationBounds => ({
  min: [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis]!)) - margin) as [number, number, number],
  max: [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis]!)) + margin) as [number, number, number]
});
const crossCardCorners = (matrix: Matrix4): WisteriaWoodPoint[] => {
  const result: WisteriaWoodPoint[] = [];
  for (const u of [-.5, .5]) for (const v of [-.5, .5]) {
    result.push(new Vector3(u, v, 0).applyMatrix4(matrix).toArray() as [number, number, number]);
    result.push(new Vector3(0, v, -u).applyMatrix4(matrix).toArray() as [number, number, number]);
  }
  return result;
};

/** Canonical connected stems and botanical groups, shared by both LODs and every placement. */
export const wisteriaStructureClearance = (frame: WisteriaRoadFrame,
  boundsForPart: (part: RoadDecorationPart) => RoadDecorationBounds) => {
  const graph = createWisteriaHeroGraph(frame);
  const volumes = [true, false].flatMap(minimal =>
    createWisteriaHeroFrame(frame, minimal).map(boundsForPart));
  for (const branch of graph.limbs) {
    if (branch.settings.fine) continue;
    const high = Math.max(1, branch.points.length - 1);
    const minimal = branch.settings.keepCurve ? high : Math.max(1, Math.ceil(high / 2));
    const curve = new CatmullRomCurve3(branch.points.map(point => new Vector3(...point)));
    // Include every emitted ring at both LODs. Faces between rings remain inside their boxes.
    const fractions = [...new Set([high, minimal].flatMap(count =>
      Array.from({ length: count + 1 }, (_, index) => index / count)))].sort((a, b) => a - b);
    const centres = fractions.map(fraction => curve.getPointAt(fraction).toArray() as [number, number, number]);
    const margin = Math.max(branch.base, branch.tip) * 1.6;
    for (let index = 1; index < centres.length; index++) {
      const box = boundsOf([centres[index - 1]!, centres[index]!], margin);
      if (branch.settings.grounded) box.min[1] = Math.max(0, box.min[1]);
      volumes.push(box);
    }
  }
  const flowers = new Map<number, WisteriaWoodPoint[]>();
  for (const flower of graph.flowers) {
    const points = flowers.get(flower.cluster!) ?? [];
    const radius = flower.scale;
    points.push([flower.position[0] - radius, flower.position[1] - radius, flower.position[2] - radius],
      [flower.position[0] + radius, flower.position[1] + radius, flower.position[2] + radius]);
    if (flower.clusterOrigin) points.push(flower.clusterOrigin);
    flowers.set(flower.cluster!, points);
  }
  for (const points of flowers.values()) volumes.push(boundsOf(points, .004));
  for (const cluster of groupWisteriaBotany(graph.flowers, "cluster"))
    volumes.push(boundsOf(crossCardCorners(wisteriaRacemeTransform(cluster, WISTERIA_PRODUCTION_ATLAS)), .001));
  const leaves = new Map<number, WisteriaWoodPoint[]>();
  for (const leaf of graph.leaves) {
    const points = leaves.get(leaf.spray!) ?? [], direction = new Vector3(...leaf.direction).normalize();
    const centre = new Vector3(...leaf.position).addScaledVector(direction, leaf.length / 2);
    const radius = leaf.length * .64;
    points.push([centre.x - radius, centre.y - radius, centre.z - radius],
      [centre.x + radius, centre.y + radius, centre.z + radius]);
    if (leaf.sprayOrigin) points.push(leaf.sprayOrigin);
    leaves.set(leaf.spray!, points);
  }
  for (const points of leaves.values()) volumes.push(boundsOf(points, .004));
  for (const spray of groupWisteriaBotany(graph.leaves, "spray"))
    volumes.push(boundsOf(crossCardCorners(wisteriaSprayTransform(spray, WISTERIA_PRODUCTION_ATLAS)), .001));
  return volumes;
};
