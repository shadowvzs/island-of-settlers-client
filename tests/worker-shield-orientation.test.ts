import { Group, Mesh, MeshBasicMaterial, Object3D, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { buildShield } from "../src/renderers/three/military-equipment-shields";
import { meleePose } from "../src/renderers/three/worker-melee-moves";
import { orientShield } from "../src/renderers/three/worker-melee-weapon";

const material = new MeshBasicMaterial();
const front = new Vector3(0, 0, 1), up = new Vector3(0, 1, 0);

const expectFacing = (shield: Object3D, target: Vector3) => {
  const rotation = shield.getWorldQuaternion(new Quaternion());
  expect(front.clone().applyQuaternion(rotation).distanceTo(target)).toBeLessThan(1e-8);
  const upright = up.clone().addScaledVector(target, -up.dot(target)).normalize();
  expect(up.clone().applyQuaternion(rotation).distanceTo(upright)).toBeLessThan(1e-8);
};

describe.each([true, false])("Roman shield orientation (High=%s)", detailed => {
  it("measures a fresh shield independently of its soldier's initial heading", () => {
    const geometry = buildShield("roman", detailed);
    for (let degrees = 0; degrees < 360; degrees += 15) {
      const soldier = new Group(), shield = new Mesh(geometry, material);
      soldier.rotation.y = degrees * Math.PI / 180;
      soldier.position.set(12, .7, -9);
      soldier.scale.setScalar(.85);
      soldier.add(shield);
      shield.position.set(.2, .64, .16);
      shield.rotation.set(.8, -.4, 1.2);
      soldier.updateMatrixWorld(true);
      const grip = shield.getWorldPosition(new Vector3());
      orientShield(shield, soldier, false);
      expectFacing(shield, new Vector3(0, .05, 1).normalize().applyQuaternion(soldier.quaternion));
      expect(shield.getWorldPosition(new Vector3()).distanceTo(grip)).toBeLessThan(1e-10);
    }
    geometry.dispose();
  });

  it.each(["root", "hand"])("keeps the %s attachment through guard and attacks at a moving target", parentKind => {
    const soldier = new Group(), hand = new Object3D();
    hand.name = "socket_hand_L";
    soldier.add(hand);
    const geometry = buildShield("roman", detailed), shield = new Mesh(geometry, material);
    const parent = parentKind === "root" ? soldier : hand;
    parent.add(shield);
    shield.scale.setScalar(.92);
    // Production standing props copy the real hand socket into the soldier's frame.
    for (const blocking of [true, false]) for (const progress of [null, 0, .35, .75, 1]) {
      const pose = meleePose({ nation: "roman", combat: {
        attackProgress: progress, defending: blocking, faction: 0, type: "shield", variant: 0
      } })!;
      for (let step = 0; step < 12; step++) {
        soldier.rotation.y = (30 + step * 27) * Math.PI / 180;
        soldier.position.set(3 + step * .1, .2, -5 + step * .06);
        hand.position.fromArray(pose.leftHand);
        hand.rotation.set(.2 + step * .1, -.4 + step * .07, .6);
        soldier.updateMatrixWorld(true);
        const grip = hand.getWorldPosition(new Vector3());
        shield.position.copy(parent.worldToLocal(grip.clone()));
        shield.quaternion.copy(parent.getWorldQuaternion(new Quaternion()).invert()
          .multiply(hand.getWorldQuaternion(new Quaternion())));
        soldier.updateMatrixWorld(true);
        const target = new Vector3(5 * Math.sin(step * .47), 0, 5 * Math.cos(step * .47));
        const bearing = Math.atan2(target.x - soldier.position.x, target.z - soldier.position.z);
        // Alternate regular and already-updated/baked-pose entry paths on the same cached prop.
        orientShield(shield, soldier, blocking, bearing, step % 2 === 0);
        expectFacing(shield, new Vector3(Math.sin(bearing), blocking ? .3 : .05, Math.cos(bearing)).normalize());
        expect(shield.parent).toBe(parent);
        expect(shield.scale.toArray()).toEqual([.92, .92, .92]);
        expect(shield.getWorldPosition(new Vector3()).distanceTo(grip)).toBeLessThan(1e-9);
        const boardCentre = shield.localToWorld(new Vector3(0, 0, .082));
        expect(boardCentre.distanceTo(grip)).toBeCloseTo(.082 * .92, 10);
      }
    }
    geometry.dispose();
  });

  it("includes transformed child geometry when inferring the shield's own axes", () => {
    const soldier = new Group(), shield = new Group(), nested = new Group();
    const geometry = buildShield("roman", detailed), board = new Mesh(geometry, material);
    soldier.add(shield); shield.add(nested); nested.add(board);
    nested.rotation.y = Math.PI / 2;
    nested.position.x = .01;
    soldier.rotation.y = Math.PI / 4;
    soldier.updateMatrixWorld(true);
    orientShield(shield, soldier, true, -.7);
    expectFacing(board, new Vector3(Math.sin(-.7), .3, Math.cos(-.7)).normalize());
    geometry.dispose();
  });
});
