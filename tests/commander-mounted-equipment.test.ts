import { Group, Object3D, Quaternion, Vector3 } from "three";
import { expect, it, vi } from "vitest";

import type { MountFrame } from "../src/render-common/mounts/mount-frame";
import type { MilitaryEquipmentKit } from "../src/renderers/three/military-equipment";
import { cavalrySwordPose } from "../src/renderers/three/worker-mounted-cut";
import { createMountedEquipment, mountedWeaponPose } from "../src/renderers/three/worker-mounted-equipment";

const frame = (loadout: MountFrame["commanderLoadout"]): MountFrame => ({ actorId: 0, commanderLoadout: loadout,
  clip: "idle", clipTime: 0, coat: "bay", faction: 0, heading: 0, nation: "nubian",
  rider: "nubian-man-kilt", turnRate: 0, x: 0, y: 0, z: 0 });

it("owns one mounted bow/string, reuses it on unchanged frames and releases replaced props exactly once", () => {
  const root = new Group(), left = new Object3D(), right = new Object3D();
  left.name = "socket_hand_L"; right.name = "socket_hand_R";
  left.position.set(.2, .4, .3); right.position.set(-.1, .4, .1); root.add(left, right);
  const props: Group[] = [], disposal: ReturnType<typeof vi.fn>[] = [];
  const create = vi.fn(() => {
    const prop = new Group(), dispose = vi.fn();
    prop.userData.disposeOwned = dispose; prop.userData.updateBowString = vi.fn();
    props.push(prop); disposal.push(dispose); return prop;
  });
  const equipment = createMountedEquipment(root, { create, release: vi.fn() } as MilitaryEquipmentKit);
  const bow = frame("bow");
  for (let tick = 0; tick < 20; tick++) equipment.update(bow, mountedWeaponPose(bow, .5));
  expect(create).toHaveBeenCalledExactlyOnceWith("bow", "nubian", "archer");
  expect(props[0]!.parent).toBe(left);
  expect(props[0]!.userData.updateBowString).toHaveBeenCalledTimes(20);
  const axe = frame("axe"); equipment.update(axe, mountedWeaponPose(axe, .5));
  expect(create).toHaveBeenCalledTimes(2); expect(props[1]!.parent).toBe(right);
  expect(disposal[0]).toHaveBeenCalledOnce(); expect(props[0]!.parent).toBeNull();
  equipment.dispose(); equipment.dispose();
  expect(disposal[1]).toHaveBeenCalledOnce(); expect(props[1]!.parent).toBeNull();
});

it("keeps accepted mounted sword cuts byte-for-byte while seating two-handed weapon poses", () => {
  for (const progress of [null, 0, .4, .78, 1]) {
    const sword = { ...frame("sword"), attackProgress: progress, guard: .7 };
    expect(mountedWeaponPose(sword, .5)).toEqual(cavalrySwordPose(progress, .7, "nubian"));
    for (const loadout of ["bow", "axe"] as const) {
      const pose = mountedWeaponPose({ ...frame(loadout), attackProgress: progress }, .5);
      expect(pose.body).toBeUndefined();
      expect(pose.leftHand.every(Number.isFinite)).toBe(true);
      expect(pose.rightHand.every(Number.isFinite)).toBe(true);
      expect(pose.leftHand[1]).toBeLessThan(.6);
    }
  }
});

it("draws the real riding-asset bow string when the source rig supplies hand bones without sockets", () => {
  const root = new Group(), left = new Object3D(), right = new Object3D();
  left.name = "LeftHand"; right.name = "RightHand";
  left.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 1);
  left.position.set(.12, .4, .3); right.position.set(-.1, .4, .1); root.add(left, right);
  const bow = new Group(), update = vi.fn();
  bow.userData.updateBowString = update;
  const equipment = createMountedEquipment(root, { create: () => bow } as unknown as MilitaryEquipmentKit);
  const value = { ...frame("bow"), attackProgress: .5, manualBowPitch: .4 };
  equipment.update(value, mountedWeaponPose(value, .5));
  expect(bow.parent).toBe(left);
  expect(update).toHaveBeenCalledOnce();
  expect(update.mock.calls[0]![1]).toBe(true);
  const up = new Vector3(0, 1, 0).applyQuaternion(bow.getWorldQuaternion(new Quaternion()));
  expect(up.x).toBeCloseTo(0, 8); expect(up.y).toBeCloseTo(Math.cos(.4), 8);
  expect(up.z).toBeCloseTo(-Math.sin(.4), 8);
  equipment.dispose();
});
