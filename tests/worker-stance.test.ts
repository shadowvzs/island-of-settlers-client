import { Bone, Group, Quaternion,Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { createWorkerStance } from "../src/renderers/three/worker-stance";

const rig = () => {
  const root = new Group(),
    hips = new Bone();
  hips.name = "Hips";
  hips.position.y = 0.42;
  root.add(hips);
  for (const [side, x] of [
    ["Left", -0.09],
    ["Right", 0.09]
  ] as const) {
    const thigh = new Bone(),
      knee = new Bone(),
      foot = new Bone();
    thigh.name = `${side}UpLeg`;
    knee.name = `${side}Leg`;
    foot.name = `${side}Foot`;
    thigh.position.x = x;
    knee.position.set(0, -0.22, 0.16);
    foot.position.set(0, -0.2, -0.16);
    hips.add(thigh);
    thigh.add(knee);
    knee.add(foot);
  }
  root.updateMatrixWorld(true);
  return root;
};
describe("body-proportioned locomotion stance", () => {
  it.each([0, 0.57, 1])(
    "straightens compression while preserving both footprints/orientations at blend %s",
    (blend) => {
      const root = rig();
      root.rotation.y = 0.78;
      root.scale.setScalar(0.916);
      root.updateMatrixWorld(true);
      const feet = ["LeftFoot", "RightFoot"].map((name) => root.getObjectByName(name)!);
      const targets = feet.map((foot) => foot.getWorldPosition(new Vector3()));
      const rotations = feet.map((foot) => foot.getWorldQuaternion(new Quaternion()));
      const initialScale = root.scale.clone();
      const lift = createWorkerStance(root).update(blend);
      expect(lift).toBeGreaterThan(0);
      expect(lift).toBeLessThanOrEqual(0.075);
      feet.forEach((foot, i) => {
        expect(foot.getWorldPosition(new Vector3()).distanceTo(targets[i]!)).toBeLessThan(1e-6);
        expect(foot.getWorldQuaternion(new Quaternion()).angleTo(rotations[i]!)).toBeLessThan(1e-6);
      });
      expect(root.scale.equals(initialScale)).toBe(true);
      expect(root.position.y).toBe(0);
    }
  );
  it("keeps pelvis height continuous when the supporting foot changes", () => {
    const sample = (height: number) => {
      const root = rig();
      root.getObjectByName("RightLeg")!.position.z = 0.12;
      const right = root.getObjectByName("RightFoot")!;
      right.position.z = -0.12;
      right.position.y += height;
      root.updateMatrixWorld(true);
      const feet = ["LeftFoot", "RightFoot"].map((name) => root.getObjectByName(name)!);
      const targets = feet.map((foot) => foot.getWorldPosition(new Vector3()));
      const lift = createWorkerStance(root).update(0.7);
      feet.forEach((foot, index) => {
        expect(foot.getWorldPosition(new Vector3()).distanceTo(targets[index]!)).toBeLessThan(1e-6);
      });
      return lift;
    };
    expect(Math.abs(sample(-1e-6) - sample(1e-6))).toBeLessThan(1e-5);
  });
  it("leaves unsupported or already straight rigs alone", () => {
    expect(createWorkerStance(new Group()).update(0)).toBe(0);
    const root = rig();
    for (const name of ["LeftLeg", "RightLeg", "LeftFoot", "RightFoot"])
      root.getObjectByName(name)!.position.z = 0;
    root.updateMatrixWorld(true);
    expect(createWorkerStance(root).update(0)).toBe(0);
  });
});
