import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Group, Object3D, Vector3 } from "three";
import { expect, it } from "vitest";

import { wellCrankHandTarget } from "../src/render-common/buildings/well-work-cycle";
import { WORKER_SCALE } from "../src/render-common/workers/worker-dimensions";
import { createWorkerWellCrank } from "../src/renderers/three/worker-well-crank";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { wellWorkstation } from "../src/shared/settlement/settlement-well-work";

interface RigNode { name?: string; children?: number[]; translation?: [number, number, number];
  rotation?: [number, number, number, number]; scale?: [number, number, number] }
const folder = resolve("../island-of-settlers-worker-generation/game_ready/tripo");
const manifest = JSON.parse(readFileSync(resolve(folder, "manifest.json"), "utf8"));
const worker = manifest.workers.find((entry: any) => entry.variant === "indigenous-male-1");
const bytes = readFileSync(resolve(folder, worker.model));
const source = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as {
  nodes: RigNode[]; scenes: { nodes: number[] }[]; scene?: number
};

/** The actual exported Indigenous body's bone transforms, without loading meshes/textures into a unit test. */
const realSkeleton = () => {
  const nodes = source.nodes.map(node => {
    const object = new Object3D(); object.name = node.name ?? "";
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    return object;
  });
  source.nodes.forEach((node, index) => node.children?.forEach(child => nodes[index]!.add(nodes[child]!)));
  const root = new Group(); root.scale.setScalar(WORKER_SCALE);
  for (const node of source.scenes[source.scene ?? 0]!.nodes) root.add(nodes[node]!);
  return root;
};

it.each([0, 1, 2, 3])("rotation %s keeps the real-body right hand on the ordinary crank contact", rotation => {
  for (const elapsed of [0, .5, 1.25, 1.6, 12.3, 12.7, 14]) {
    const building = { x: 4, z: 6, y: .3, rotation } as SettlementBuilding;
    const station = wellWorkstation(building, "indigenous");
    const root = realSkeleton(); root.position.set(station.point.x, building.y, station.point.z);
    root.rotation.y = station.yaw; root.updateMatrixWorld(true);
    const feet = ["LeftFoot", "RightFoot"].map(name => root.getObjectByName(name)!.getWorldPosition(new Vector3()));
    const pose = createWorkerWellCrank(root), frame = { ...station.frame, elapsed };
    pose(frame); root.updateMatrixWorld(true);
    const target = wellCrankHandTarget(frame);
    const hand = root.getObjectByName("socket_hand_R") ?? root.getObjectByName("RightHand")!;
    const error = hand.getWorldPosition(new Vector3()).distanceTo(new Vector3(...target));
    expect(error, `${rotation}/${elapsed}/Right`).toBeLessThan(.01);
    for (const [index, name] of ["LeftFoot", "RightFoot"].entries())
      expect(root.getObjectByName(name)!.getWorldPosition(new Vector3()).distanceTo(feet[index]!)).toBeLessThan(1e-8);
    pose.reset();
  }
});
