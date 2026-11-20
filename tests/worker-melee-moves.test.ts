import { BoxGeometry, Mesh, Object3D, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  cavalrySwordPose,
  MELEE_VARIANTS,
  meleePose,
  weaponDirection,
  weaponEdge
} from "../src/renderers/three/worker-melee-moves";
import { alignTwoHandedGrip, orientMeleeWeapon } from "../src/renderers/three/worker-melee-weapon";

const combat = (type: "shield" | "heavy" | "archer", attackProgress: number | null, variant = 0, defending = false) =>
  ({ combat: { attackProgress, defending, faction: 0, type, variant } });

describe("melee moves", () => {
  it("keeps actual attacks and ordinary guards unchanged by the manual eye-clear guard marker", () => {
    const ai = combat("shield", null, 0, true);
    const manual = { combat: { ...ai.combat, manualGuard: true } };
    expect(meleePose(manual)!.leftHand[2]).toBeGreaterThan(meleePose(ai)!.leftHand[2]);
    expect(meleePose(manual)!.leftHand[1]).toBeLessThan(meleePose(ai)!.leftHand[1]);
    for (const progress of [0, .4, .78, 1]) {
      const normal = combat("shield", progress, 0, true);
      expect(meleePose({ combat: { ...normal.combat, manualGuard: true } })).toEqual(meleePose(normal));
      expect(cavalrySwordPose(progress, 1, "roman", true)).toEqual(cavalrySwordPose(progress, 1, "roman"));
    }
    expect(cavalrySwordPose(null, 0, "roman", true)).toEqual(cavalrySwordPose(null, 0, "roman"));
  });

  it("raises the Nubian khopesh behind the shoulder before cutting outwards", () => {
    const ready = cavalrySwordPose(null, 0, "nubian");
    const windUp = cavalrySwordPose(.4, 0, "nubian"), strike = cavalrySwordPose(.78, 0, "nubian");
    expect(windUp.rightHand[1]).toBeGreaterThan(ready.rightHand[1] + .35);
    expect(windUp.rightHand[2]).toBeLessThan(0);
    expect(strike.rightHand[0]).toBeLessThan(-.4);
    expect(strike.rightHand[1]).toBeLessThan(windUp.rightHand[1] - .4);
    const recovered = cavalrySwordPose(1, 0, "nubian");
    expect(recovered.pitch).toBeCloseTo(ready.pitch);
    expect(recovered.yaw).toBeCloseTo(ready.yaw);
    recovered.rightHand.forEach((value, axis) => expect(value).toBeCloseTo(ready.rightHand[axis]!));
  });

  it("measures a curved weapon independently of its parent's wrist rotation", () => {
    for (const angle of [0, .7, 1.4, 2.2]) {
      const soldier = new Object3D(), wrist = new Object3D(), weapon = new Object3D();
      soldier.add(wrist); wrist.add(weapon); wrist.rotation.set(angle, angle * .6, angle * .8);
      const geometry = new BoxGeometry(.25, .7, .02), blade = new Mesh(geometry);
      blade.position.set(.08, .25, 0); weapon.add(blade);
      const pose = cavalrySwordPose(.78, 0, "nubian");
      orientMeleeWeapon(weapon, soldier, pose);
      const actual = new Vector3(0, 1, 0).applyQuaternion(weapon.getWorldQuaternion(new Quaternion()));
      expect(actual.distanceTo(new Vector3().fromArray(weaponDirection(pose.pitch, pose.yaw))))
        .toBeLessThan(1e-8);
      geometry.dispose();
    }
  });
  it("offers several swings per weapon and none for archers in the field", () => {
    expect(MELEE_VARIANTS.shield).toBeGreaterThanOrEqual(2);
    expect(MELEE_VARIANTS.heavy).toBeGreaterThanOrEqual(2);
    expect(meleePose(combat("archer", .5))).toBeNull();
    expect(meleePose({ combat: { attackProgress: .5, doorMelee: true, faction: 0, type: "archer" } })).toBeNull();
  });

  it("strikes forward with every swing and moves the torso into it", () => {
    for (const [type, count] of [["shield", MELEE_VARIANTS.shield], ["heavy", MELEE_VARIANTS.heavy]] as const)
      for (let variant = 0; variant < count; variant++) {
        const strike = meleePose(combat(type, .7, variant))!;
        expect(weaponDirection(strike.pitch, strike.yaw)[2]).toBeGreaterThan(.3);
        expect(Math.abs(strike.bend) + Math.abs(strike.twist)).toBeGreaterThan(.1);
        const windUp = meleePose(combat(type, .35, variant))!;
        expect(windUp.pitch !== strike.pitch || windUp.yaw !== strike.yaw).toBe(true);
      }
  });

  it("raises the shield or the shaft to block, and keeps edges perpendicular to the blade", () => {
    const block = meleePose(combat("shield", null, 0, true))!, guard = meleePose(combat("shield", null))!;
    expect(block.leftHand[1]).toBeGreaterThan(guard.leftHand[1] + .2);
    const shaft = meleePose(combat("heavy", null, 0, true))!;
    expect(Math.abs(weaponDirection(shaft.pitch, shaft.yaw)[1])).toBeLessThan(.05);
    for (const pose of [block, guard, shaft, meleePose(combat("shield", .5, 1))!]) {
      const [a, b] = [weaponDirection(pose.pitch, pose.yaw), weaponEdge(pose)];
      const along = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(Math.abs(along)).toBeLessThan(.99);
    }
  });

  it("keeps both hands on the grip, with the spear support hand ahead of the thrusting hand", () => {
    for (const nation of ["roman", "nubian"] as const)
      for (let variant = 0; variant < Math.max(MELEE_VARIANTS.heavy, MELEE_VARIANTS.spear); variant++)
        for (const progress of [null, .2, .5, .78, .95]) {
          const pose = meleePose({ ...combat("heavy", progress, variant), nation })!;
          const direction = weaponDirection(pose.pitch, pose.yaw);
          pose.rightHand.forEach((value, axis) =>
            expect(value - pose.leftHand[axis]!).toBeCloseTo(direction[axis]! * (nation === "nubian" ? -.28 : .15), 5));
          expect(pose.shield).toBe(false);
        }
  });

  it("thrusts the Nubian spear forward instead of chopping", () => {
    const thrust = meleePose({ ...combat("heavy", .78), nation: "nubian" })!;
    const chop = meleePose({ ...combat("heavy", .4), nation: "roman" })!;
    expect(weaponDirection(thrust.pitch, thrust.yaw)[2]).toBeGreaterThan(.9);
    expect(weaponDirection(chop.pitch, chop.yaw)[2]).toBeLessThan(0);
  });

  it("cuts mounted on the sword side, clear of the horse's neck", () => {
    const strike = cavalrySwordPose(.78), windUp = cavalrySwordPose(.4);
    expect(weaponDirection(strike.pitch, strike.yaw)[0]).toBeLessThan(-.5);
    expect(strike.rightHand[0]).toBeLessThan(-.3);
    expect(weaponDirection(windUp.pitch, windUp.yaw)[1]).toBeGreaterThan(.7);
  });

  it("parries mounted: the sword hand comes up and the blade lies across above the head", () => {
    const rest = cavalrySwordPose(null), parry = cavalrySwordPose(null, 1), half = cavalrySwordPose(null, .5);
    expect(cavalrySwordPose(null, 0)).toEqual(rest);
    expect(parry.rightHand[1]).toBeGreaterThan(rest.rightHand[1] + .35);
    const blade = weaponDirection(parry.pitch, parry.yaw);
    expect(Math.abs(blade[1])).toBeLessThan(.35);
    expect(blade[0]).toBeGreaterThan(.8);
    expect(half.rightHand[1]).toBeGreaterThan(rest.rightHand[1]);
    expect(half.rightHand[1]).toBeLessThan(parry.rightHand[1]);
    // A cut under way ignores the guard.
    expect(cavalrySwordPose(.78, 1)).toEqual(cavalrySwordPose(.78));
  });

  it("runs a two-handed weapon through both hands where the arm IK left them", () => {
    const soldier = new Object3D(), left = new Object3D(), right = new Object3D();
    soldier.add(left, right);
    const pose = meleePose(combat("heavy", .78))!;
    right.position.fromArray(pose.rightHand);
    // The left arm fell 4 cm short of its target.
    left.position.fromArray(pose.leftHand).add({ x: .04, y: 0, z: 0 } as never);
    const aligned = alignTwoHandedGrip(pose, soldier, left, right);
    const axis = right.position.clone().sub(left.position).normalize();
    weaponDirection(aligned.pitch, aligned.yaw).forEach((value, index) =>
      expect(value).toBeCloseTo(axis.getComponent(index), 5));
  });
});
