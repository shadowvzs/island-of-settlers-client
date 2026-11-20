import { type Object3D, type SkinnedMesh, Vector3 } from "three";

import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";
import { snapshotHatchGeometry } from "./catapult-hatch-sections";

/** Actual posed torso/cloth triangles against the rough closed rock. Hands are intentional contacts. */
export const measureCatapultTorsoRock = (root: Object3D, stone: Object3D) => {
  const shapes = snapshotHatchGeometry(stone), positions: Vector3[] = [], indices: number[] = [];
  for (const shape of shapes) {
    const start = positions.length;
    for (let at = 0; at < shape.vertices.length; at += 3) positions.push(new Vector3().fromArray(shape.vertices, at));
    indices.push(...shape.indices.map(index => index + start));
  }
  const grid = new TriangleGrid(positions, indices), centre = stone.getWorldPosition(new Vector3());
  const hip = root.worldToLocal(root.getObjectByName("Hips")!.getWorldPosition(new Vector3()));
  const neck = root.worldToLocal(root.getObjectByName("Neck")!.getWorldPosition(new Vector3()));
  const shoulder = root.worldToLocal(root.getObjectByName("LeftArm")!.getWorldPosition(new Vector3()));
  let testedTriangles = 0, crossingEdges = 0, insideSamples = 0, deepestRadialPenetration = 0;
  let witness: number[] | undefined;
  const point = new Vector3(), local = new Vector3(), direction = new Vector3();
  const sample = (point: Vector3) => {
    direction.copy(point).sub(centre); const distance = direction.length();
    if (distance > .5 || distance < 1e-10) return;
    const hit = grid.raycast(centre, direction.normalize(), 0, .8);
    if (!hit || hit.distance < distance + .0001) return;
    insideSamples++;
    if (hit.distance - distance > deepestRadialPenetration) {
      deepestRadialPenetration = hit.distance - distance; witness = point.toArray();
    }
  };
  root.traverseVisible(node => {
    const mesh = node as SkinnedMesh; if (!mesh.isSkinnedMesh) return;
    const order = mesh.geometry.index?.array; if (!order) return;
    const joints = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
    const armShare = (vertex: number) => {
      let share = 0;
      for (let slot = 0; slot < 4; slot++) if (/^(Left|Right)(Arm|ForeArm|Hand)/
        .test(mesh.skeleton.bones[joints.getComponent(vertex, slot)]!.name)) share += weights.getComponent(vertex, slot);
      return share;
    };
    const world = (vertex: number) => mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(mesh.matrixWorld);
    for (let at = 0; at < order.length; at += 3) {
      const ids = [order[at]!, order[at + 1]!, order[at + 2]!];
      if (ids.some(vertex => armShare(vertex) > .35)) continue;
      const corners = ids.map(world);
      point.copy(corners[0]!).add(corners[1]!).add(corners[2]!).divideScalar(3);
      local.copy(point); root.worldToLocal(local);
      if (local.y < hip.y - .04 || local.y > neck.y + .02 || Math.abs(local.x) > Math.abs(shoulder.x) * .92) continue;
      testedTriangles++; sample(point);
      for (let edge = 0; edge < 3; edge++) {
        const a = corners[edge]!, b = corners[(edge + 1) % 3]!;
        sample(a); sample(point.copy(a).lerp(b, .5));
        direction.copy(b).sub(a); const length = direction.length();
        if (length < 1e-10) continue;
        const hit = grid.raycast(a, direction.normalize(), 1e-5, length - 1e-5);
        if (hit) crossingEdges++;
      }
    }
  });
  return { testedTriangles, crossingEdges, insideSamples, deepestRadialPenetration, witness,
    overlaps: crossingEdges > 0 || insideSamples > 0 };
};
