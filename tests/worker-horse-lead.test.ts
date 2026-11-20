import { Group, type Mesh,Object3D, Vector3 } from "three";
import { expect, it } from "vitest";

import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { createWorkerHorseLead } from "../src/renderers/three/worker-horse-lead";

it.each([0, 1, 2, 3])("keeps a reused lead attached to the nearest posed hand and halter at rotation %i", rotation => {
  const root = new Group(); root.position.set(8, .3, 6); root.rotation.y = rotation * Math.PI / 2;
  root.scale.setScalar(.8);
  for (const [side, sign, suffix] of [["Left", 1, "L"], ["Right", -1, "R"]] as const) {
    const upper = new Object3D(), lower = new Object3D(), hand = new Object3D(), socket = new Object3D();
    upper.name = `${side}Arm`; lower.name = `${side}ForeArm`; hand.name = `${side}Hand`; socket.name = `socket_hand_${suffix}`;
    upper.position.set(sign * .2, .8, 0); lower.position.y = -.2; hand.position.y = -.2; socket.position.y = -.04;
    root.add(upper); upper.add(lower); lower.add(hand); hand.add(socket);
  }
  const lead = createWorkerHorseLead(root);
  let geometry: unknown;
  for (const sign of [-1, 1, -1]) {
    lead.reset();
    const target = root.localToWorld(new Vector3(sign * .5, .7, -.8));
    lead.apply({ horseLead: { horseId: -1, target: { x: target.x, y: target.y, z: target.z } } } as WorkerFrame);
    const rope = root.getObjectByName("horse_lead_rope") as Mesh;
    expect(rope.visible).toBe(true);
    expect(rope.userData.handSocketName).toBe(`socket_hand_${sign > 0 ? "L" : "R"}`);
    const socket = root.getObjectByName(rope.userData.handSocketName)!.getWorldPosition(new Vector3());
    expect(socket.distanceTo(new Vector3(...rope.userData.handSocket))).toBeLessThan(1e-7);
    expect(target.distanceTo(new Vector3(...rope.userData.halterSocket))).toBeLessThan(1e-7);
    const position = rope.geometry.getAttribute("position");
    for (const [ring, actual] of [[0, socket], [8, target]] as const) {
      const centre = new Vector3();
      for (let index = 0; index < 4; index++) centre.add(new Vector3().fromBufferAttribute(position, ring * 4 + index));
      root.localToWorld(centre.multiplyScalar(.25));
      expect(centre.distanceTo(actual)).toBeLessThan(1e-6);
    }
    expect(rope.geometry.index!.count / 3).toBe(64);
    expect(rope.geometry.getAttribute("normal")).toBeUndefined();
    if (geometry) expect(rope.geometry).toBe(geometry); geometry = rope.geometry;
  }
  lead.reset(); expect(root.getObjectByName("horse_lead_rope")!.visible).toBe(false);
  lead.dispose(); expect(root.getObjectByName("horse_lead_rope")).toBeUndefined();
});
