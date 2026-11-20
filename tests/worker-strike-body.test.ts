import { Object3D, Vector3 } from "three";
import { expect, it } from "vitest";

import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { createWorkerStrikeBody,strikeBodyWeight } from "../src/renderers/three/worker-strike-body";

it("winds up, drives through contact, recoils and returns to its starting pose each swing", () => {
  expect(strikeBodyWeight(0)).toBe(0);
  expect(strikeBodyWeight(.52)).toBeCloseTo(-1);
  expect(strikeBodyWeight(.72)).toBeGreaterThan(.999);
  expect(strikeBodyWeight(1.1)).toBeLessThan(0);
  expect(strikeBodyWeight(1.3)).toBe(0);
  expect(strikeBodyWeight(.72 + 1.3)).toBeCloseTo(strikeBodyWeight(.72));
});

it.each(["Builder", "Stonemason", "Miner", "Shipwright"])("plants both feet during %s body recoil and resets before walking", job => {
  const root = new Object3D();
  const bone = (parent: Object3D, name: string, x: number, y: number) => {
    const item = new Object3D(); item.name = name; item.position.set(x, y, 0); parent.add(item);
    return item;
  };
  const hips = bone(root, "Hips", 0, .6), spine = bone(hips, "Spine", 0, .16);
  const arm = bone(spine, "RightArm", -.18, .17);
  const lower = bone(arm, "RightForeArm", 0, -.2);
  bone(lower, "RightHand", 0, -.18);
  const feet = ["Left", "Right"].map((side, index) => {
    const upper = bone(hips, `${side}UpLeg`, index === 0 ? -.1 : .1, 0);
    const leg = bone(upper, `${side}Leg`, 0, -.25);
    return bone(leg, `${side}Foot`, 0, -.25);
  });
  root.updateMatrixWorld(true);
  const startingFeet = feet.map(foot => foot.getWorldPosition(new Vector3()));
  const body = createWorkerStrikeBody(root);
  body.apply({ workerJob: job, shipHullWork: job === "Shipwright", workerTool: job === "Builder" ? "hammer" : "pickaxe", action: "build_hammer", animationTime: .72 } as WorkerFrame);
  expect(spine.quaternion.angleTo(new Object3D().quaternion)).toBeGreaterThan(.1);
  expect(hips.position.y).toBeLessThan(.585);
  feet.forEach((foot, index) => expect(foot.getWorldPosition(new Vector3()).distanceTo(startingFeet[index]!))
    .toBeLessThan(1e-5));
  body.reset();
  expect(spine.quaternion.angleTo(new Object3D().quaternion)).toBeLessThan(1e-8);
  expect(hips.position.y).toBe(.6);
  body.apply({ workerJob: job, workerTool: "pickaxe", action: "walk", animationTime: .72 } as WorkerFrame);
  expect(hips.position.y).toBe(.6);
});
