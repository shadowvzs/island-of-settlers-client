import { Bone, Group, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { createWorkerTerrainFeet } from "../src/renderers/three/worker-terrain-feet";

const fixture = () => {
  const root = new Group(), torso = new Bone();
  root.add(torso); torso.position.y = .9;
  for (const side of ["Left", "Right"]) {
    const upper = new Bone(), lower = new Bone(), foot = new Bone();
    upper.name = `${side}UpLeg`; lower.name = `${side}Leg`; foot.name = `${side}Foot`;
    torso.add(upper); upper.add(lower); lower.add(foot);
    upper.position.x = side === "Left" ? -.12 : .12;
    lower.position.set(0, -.4, .16); foot.position.set(0, -.4, -.16);
  }
  root.updateMatrixWorld(true);
  const frame = { x: 0, y: 0, z: 0, action: "walk", runBlend: 0, gaitPhase: 0 } as WorkerFrame;
  return { root, torso, frame };
};

describe("worker terrain support", () => {
  it("follows uphill and downhill contacts without changing the pelvis or foot orientation", () => {
    for (const slope of [-.35, .35]) {
      const { frame, root, torso } = fixture();
      const height = (x: number) => x * slope;
      const before = new Map(["Left", "Right"].map(side => {
        const foot = root.getObjectByName(`${side}Foot`)!;
        return [side, { position: foot.getWorldPosition(new Vector3()), rotation: foot.getWorldQuaternion(new Quaternion()) }];
      }));
      createWorkerTerrainFeet(root, height)(frame);
      for (const side of ["Left", "Right"]) {
        const foot = root.getObjectByName(`${side}Foot`)!;
        const position = foot.getWorldPosition(new Vector3()), original = before.get(side)!;
        expect(position.y).toBeCloseTo(original.position.y + height(position.x), 7);
        expect(position.x).toBeCloseTo(original.position.x, 7);
        expect(position.z).toBeCloseTo(original.position.z, 7);
        expect(foot.getWorldQuaternion(new Quaternion()).angleTo(original.rotation)).toBeLessThan(1e-7);
      }
      expect(torso.position.toArray()).toEqual([0, .9, 0]);
      expect(torso.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    }
  });

  it("preserves flat ground, raised decks, work contacts, transfers and mounted poses", () => {
    for (const change of [{}, { y: .5 }, { action: "build_hammer" }, { action: "ride" },
      { fall: .2 }, { lean: .1 }, { wareTransfer: {} }, { combat: { attackProgress: .5 } }]) {
      const { frame, root } = fixture();
      const original = root.getObjectByName("LeftLeg")!.quaternion.clone();
      const height = Object.keys(change).length ? (x: number) => x * .35 : () => 0;
      createWorkerTerrainFeet(root, height)({ ...frame, ...change } as WorkerFrame);
      expect(root.getObjectByName("LeftLeg")!.quaternion.angleTo(original)).toBe(0);
    }
  });

  it("keeps authored flight clearance and works for infantry and loaded carriers", () => {
    for (const action of ["walk", "run", "carry_shoulder", "carry_back"] as const) {
      const { frame, root } = fixture();
      root.getObjectByName("LeftUpLeg")!.position.y = .08;
      root.updateMatrixWorld(true);
      const foot = root.getObjectByName("LeftFoot")!;
      const clearance = foot.getWorldPosition(new Vector3()).y;
      createWorkerTerrainFeet(root, x => x * .35)({ ...frame, action,
        combat: { type: "shield", faction: 0, attackProgress: null } });
      const position = foot.getWorldPosition(new Vector3());
      expect(position.y - position.x * .35).toBeCloseTo(clearance, 7);
    }
  });
  it("limits unreachable steps without stretching bones or introducing nonfinite poses", () => {
    const { frame, root } = fixture();
    const lower = root.getObjectByName("LeftLeg")!, foot = root.getObjectByName("LeftFoot")!;
    const localShin = foot.position.clone(), localThigh = lower.position.clone();
    createWorkerTerrainFeet(root, x => x * 1.2)(frame);
    root.traverse(joint => {
      expect(joint.quaternion.toArray().every(Number.isFinite)).toBe(true);
      expect(joint.quaternion.length()).toBeCloseTo(1, 7);
    });
    expect(foot.position.distanceTo(localShin)).toBe(0);
    expect(lower.position.distanceTo(localThigh)).toBe(0);
  });

});
