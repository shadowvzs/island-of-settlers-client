import { Group, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { alignChineseSwordWrist, chineseSwordTravelPose } from "../src/renderers/three/worker-chinese-sword-grip";
import { type MeleePose, weaponDirection, weaponEdge } from "../src/renderers/three/worker-melee-tracks";

const guard: MeleePose = { bend: 0, leftAlong: -.15, leftHand: [0, 0, 0], pitch: 0,
  rightHand: [0, 0, 0], shield: false, sweep: false, twist: 0, yaw: 0 };

describe("Chinese long-sword grip", () => {
  it("constrains the free ninety-degree wrist roll in the soldier's rotated frame", () => {
    const root = new Group(), hand = new Group(), index = new Group(), pinky = new Group();
    root.rotation.y = .73; root.add(hand); hand.add(index, pinky);
    index.position.set(.03, .015, 0); pinky.position.set(.03, -.015, 0);
    alignChineseSwordWrist(root, hand, index, pinky, guard);
    const a = index.getWorldPosition(new Vector3()), b = pinky.getWorldPosition(new Vector3());
    const direction = root.localToWorld(new Vector3(...weaponEdge(guard))).normalize();
    const knuckles = a.clone().add(b).multiplyScalar(.5).sub(hand.getWorldPosition(new Vector3())).normalize();
    expect(knuckles.dot(direction)).toBeCloseTo(1, 10);
    expect(a.sub(b).normalize().y).toBeCloseTo(1, 10);
  });

  it("keeps both travelling palms on the same full-length weapon shaft without a lower-body override", () => {
    const pose = chineseSwordTravelPose(guard);
    const delta = new Vector3(...pose.leftHand).sub(new Vector3(...pose.rightHand));
    const shaft = new Vector3(...weaponDirection(pose.pitch, pose.yaw));
    expect(delta.length()).toBeCloseTo(.15, 10);
    expect(delta.normalize().dot(shaft)).toBeCloseTo(-1, 10);
    expect(pose.body).toBeUndefined();
  });
});
