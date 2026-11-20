import { readFile } from "node:fs/promises";
import { AnimationMixer, Group, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { expect, it } from "vitest";

import { VIKING_AXE_GRIP_RADIUS } from "../src/render-common/workers/viking-axe";
import { WORKER_SCALE } from "../src/render-common/workers/worker-dimensions";
import { buildTwoHanded } from "../src/renderers/three/military-equipment-two-handed";
import { createUnitEyeOffset } from "../src/renderers/three/unit-eye-offset";
import { createWorkerCombatPose } from "../src/renderers/three/worker-combat-pose";
import { createMountedEquipment, mountedWeaponPose } from "../src/renderers/three/worker-mounted-equipment";
import { militaryManualBowOrigin } from "../src/shared/settlement/military-bow-origin";
import { militaryBowOrigin, MOUNTED_BOW_FORWARD, MOUNTED_BOW_LIFT } from "../src/shared/settlement/military-bow-origin";

interface Node { children?: number[]; matrix?: number[]; name?: string; rotation?: number[]; translation?: number[] }
const asset = (path: string) => new URL(`../../island-of-settlers-worker-generation/game_ready/mounts/${path}`, import.meta.url);
const nodes = (bytes: Buffer): Node[] => JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()).nodes;

it("derives the mounted bow offset from the actual horse saddle and Nubian riding-pelvis source assets", async () => {
  const horse = nodes(await readFile(asset("horse/model.glb")));
  let index = horse.findIndex(node => node.name === "Saddle");
  expect(index).toBeGreaterThanOrEqual(0);
  const seat = [0, 0, 0];
  while (index >= 0) {
    const node = horse[index]!;
    expect(node.matrix).toBeUndefined(); expect(node.rotation).toBeUndefined();
    node.translation?.forEach((value, axis) => { seat[axis]! += value; });
    index = horse.findIndex(node => node.children?.includes(index));
  }
  const rider = nodes(await readFile(asset("riders/nubian-man-kilt/model.glb")));
  const standing = rider.find(node => node.name === "Hips")!.translation![1]!;
  const bytes = await readFile(asset("riders/nubian-man-kilt/actions.glb"));
  const clips = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  const seated = clips.animations.find(clip => clip.name === "idle")!.tracks.find(track => track.name === "Hips.position")!.values[1]!;
  expect(MOUNTED_BOW_LIFT).toBeCloseTo((seat[1]! + seated - standing) * WORKER_SCALE, 7);
  expect(MOUNTED_BOW_FORWARD).toBeCloseTo(seat[2]! * WORKER_SCALE, 7);
});

it("leaves ordinary standing arrows unchanged and rotates the mounted saddle offset with the actor", () => {
  const actor = { x: 10, y: 2, z: 20, yaw: 0, mounted: false };
  expect(militaryBowOrigin(actor)).toEqual({ x: 10.146, y: 2.815, z: 20.33 });
  const foot = militaryBowOrigin({ ...actor, yaw: Math.PI / 2 });
  const mounted = militaryBowOrigin({ ...actor, yaw: Math.PI / 2, mounted: true });
  expect(mounted.x - foot.x).toBeCloseTo(MOUNTED_BOW_FORWARD, 10);
  expect(mounted.z).toBeCloseTo(foot.z, 10);
  expect(mounted.y - foot.y).toBeCloseTo(MOUNTED_BOW_LIFT, 10);
});

/** Geometry/rig only: keep original asset bytes intact and omit GPU textures in this CPU fixture. */
const loadCpuRider = async (variant = "nubian-man-kilt") => {
  const bytes = await readFile(asset(`riders/${variant}/model.glb`));
  const jsonLength = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  json.images = []; json.textures = []; json.materials = [{}];
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) primitive.material = 0;
  json.extensionsRequired = json.extensionsRequired?.filter((name: string) => name !== "KHR_texture_basisu");
  const encoded = Buffer.from(JSON.stringify(json)), padded = Math.ceil(encoded.length / 4) * 4;
  const buffer = Buffer.alloc(20 + padded + bytes.length - 20 - jsonLength, 0x20);
  bytes.copy(buffer, 0, 0, 12); buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(padded, 12); buffer.writeUInt32LE(0x4e4f534a, 16); encoded.copy(buffer, 20);
  bytes.copy(buffer, 20 + padded, 20 + jsonLength);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const rider = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "");
  const animation = await readFile(asset(`riders/${variant}/actions.glb`));
  const clips = await loader.parseAsync(animation.buffer.slice(animation.byteOffset,
    animation.byteOffset + animation.byteLength), "");
  return { rider: rider.scene, clips: clips.animations };
};

it.each([-1.2, -.5, 0, .5, 1.2])("places the actual mounted Nubian bow hand at its shared origin for pitch=%s", async pitch => {
  const { clips, rider } = await loadCpuRider(), root = new Group(), saddle = new Group();
  saddle.position.set(0, 1.0023366723491127, .12474956278342057);
  root.scale.setScalar(WORKER_SCALE); root.add(saddle); saddle.add(rider);
  const hips = rider.getObjectByName("Hips")!, standing = hips.position.y;
  const combat = createWorkerCombatPose(rider, clips), mixer = new AnimationMixer(rider);
  mixer.clipAction(clips.find(clip => clip.name === "idle")!).play(); mixer.setTime(.2);
  const finger = rider.getObjectByName("RightHandIndex2")!, fingerBefore = finger.quaternion.clone();
  const frame = { actorId: 0, clip: "idle" as const, clipTime: .2, coat: "bay", commanderLoadout: "bow" as const,
    manualBowPitch: pitch, nation: "nubian" as const, rider: "nubian-man-kilt", heading: 0, turnRate: 0,
    x: 0, y: 0, z: 0, attackProgress: .5 };
  combat.apply({ combat: { attackProgress: .5, faction: 0, manualBowPitch: pitch, type: "archer" }, nation: "nubian" } as never,
    mountedWeaponPose(frame, standing - hips.position.y));
  const socket = (rider.getObjectByName("socket_hand_L") ?? rider.getObjectByName("LeftHand"))!
    .getWorldPosition(new Vector3());
  const expected = militaryManualBowOrigin({ x: 0, y: 0, z: 0, yaw: 0, mounted: true }, pitch);
  expect(socket.distanceTo(new Vector3(expected.x, expected.y, expected.z)), JSON.stringify({
    socket: socket.toArray(), expected, hips: hips.position.toArray(), standing,
    eye: createUnitEyeOffset(rider, root)(),
    shoulder: rider.getObjectByName("LeftArm")!.getWorldPosition(new Vector3()).toArray(),
    pose: mountedWeaponPose(frame, standing - hips.position.y)
  })).toBeLessThan(.015);
  expect(finger.quaternion.angleTo(fingerBefore)).toBeGreaterThan(.5);
  combat.reset();
  expect(finger.quaternion.angleTo(fingerBefore)).toBeLessThan(1e-6);
  root.traverse(object => { const mesh = object as import("three").Mesh; mesh.geometry?.dispose(); });
});

const vikingPoses = [false, true].flatMap(manualControl => [null, 0, .2, .4, .5, .7, .8, 1]
  .map(progress => ({ manualControl, progress })));
it.each(vikingPoses)("holds actual Viking axe original palms and restores fingers: manual=$manualControl progress=$progress", async ({ manualControl, progress }) => {
  const { clips, rider } = await loadCpuRider("viking-woman-blue");
  if (progress !== null) rider.rotation.y = .8;
  const hips = rider.getObjectByName("Hips")!, standing = hips.position.y;
  const combat = createWorkerCombatPose(rider, clips, true), mixer = new AnimationMixer(rider);
  mixer.clipAction(clips.find(clip => clip.name === "idle")!).play(); mixer.setTime(.2);
  const originals = new Map<string, import("three").Quaternion>();
  rider.traverse(bone => {
    if (/^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)[123]$/.test(bone.name)) originals.set(bone.name, bone.quaternion.clone());
  });
  const frame = { actorId: 0, clip: "idle" as const, clipTime: .2, coat: "bay", commanderLoadout: "axe" as const,
    nation: "viking" as const, rider: "viking-woman-blue", heading: 0, turnRate: 0,
    x: 0, y: 0, z: 0, manualControl, manualGuard: progress === null, guard: progress === null ? 1 : 0,
    attackProgress: progress, engage: progress !== null ? 1 : 0 };
  combat.apply({ combat: { attackProgress: progress, faction: 0, type: "heavy" }, nation: "viking" } as never,
    mountedWeaponPose(frame, standing - hips.position.y));
  const prop = new Group(), axe = new Mesh(buildTwoHanded("viking", false), new MeshBasicMaterial());
  prop.add(axe);
  const equipment = createMountedEquipment(rider, { create: () => prop } as never);
  equipment.update(frame, mountedWeaponPose(frame, standing - hips.position.y));
  const origin = prop.getWorldPosition(new Vector3()), axis = new Vector3(0, 1, 0).transformDirection(prop.matrixWorld);
  if (progress === .7 || progress === .8)
    expect(Math.abs(Math.atan2(axis.x, axis.z)), "Actual axe must strike toward the canonical target while its horse turns").toBeLessThan(.08);
  const distance = (point: Vector3) => point.sub(origin).addScaledVector(axis, -point.dot(axis)).length();
  const measurements = ["Left", "Right"].map(side => ({ side,
    contact: distance(rider.getObjectByName(`socket_axe_${side === "Left" ? "L" : "R"}`)!.getWorldPosition(new Vector3())),
    tips: ["Index", "Middle", "Ring", "Pinky"].map(name => distance(rider.getObjectByName(`${side}Hand${name}4`)!.getWorldPosition(new Vector3()))) }));
  expect(measurements.every(hand => hand.contact < .012), JSON.stringify(measurements)).toBe(true);
  expect(measurements.every(hand => hand.tips.every(value => value < .035)), JSON.stringify(measurements)).toBe(true);
  const pose = mountedWeaponPose(frame, standing - hips.position.y);
  // FPS targets must be reachable; unchanged AI targets may retain their original IK clamp.
  // Both paths still require actual palm/shaft contact and original-skin clearance below.
  if (manualControl) for (const [index, side] of ["L", "R"].entries()) {
    const target = rider.localToWorld(new Vector3().fromArray(index === 0 ? pose.leftHand : pose.rightHand));
    const contact = rider.getObjectByName(`socket_axe_${side}`)!.getWorldPosition(new Vector3());
    expect(contact.distanceTo(target), JSON.stringify({ progress, side, contact, target })).toBeLessThan(.015);
  }
  const eye = createUnitEyeOffset(rider, rider)()!;
  let headFront = -Infinity;
  rider.traverse(object => {
    const mesh = object as import("three").SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.skeleton.update();
    const head = mesh.skeleton.bones.findIndex(bone => bone.name === "Head");
    const indices = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
    const names = mesh.skeleton.bones.map(bone => bone.name);
    for (let vertex = 0; vertex < indices.count; vertex++) {
      let influence = 0;
      const handWeights = { Left: 0, Right: 0 };
      for (let channel = 0; channel < 4; channel++)
        if (indices.getComponent(vertex, channel) === head) influence += weights.getComponent(vertex, channel);
      for (const side of ["Left", "Right"] as const) {
        for (let channel = 0; channel < 4; channel++)
          if (names[indices.getComponent(vertex, channel)]!.startsWith(`${side}Hand`))
            handWeights[side] += weights.getComponent(vertex, channel);
        if (handWeights[side] < .4) continue;
        const point = mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(mesh.matrixWorld);
        const clearance = distance(point) - VIKING_AXE_GRIP_RADIUS[side];
        expect(clearance, JSON.stringify({ progress, side, vertex, clearance })).toBeGreaterThan(-.00001);
      }
      if (influence < .65) continue;
      headFront = Math.max(headFront, mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(mesh.matrixWorld).z);
    }
  });
  expect((headFront - eye.z) * WORKER_SCALE, JSON.stringify({ eye, headFront })).toBeLessThan(.09);
  const closure = [1, 2, 3].reduce((sum, part) => {
    const name = `RightHandIndex${part}`;
    return sum + rider.getObjectByName(name)!.quaternion.angleTo(originals.get(name)!);
  }, 0);
  expect(closure).toBeGreaterThan(1);
  combat.reset();
  for (const [name, original] of originals) expect(rider.getObjectByName(name)!.quaternion.toArray()).toEqual(original.toArray());
  equipment.dispose();
  axe.geometry.dispose(); axe.material.dispose();
  rider.traverse(object => { const mesh = object as import("three").Mesh; mesh.geometry?.dispose(); });
});

it("tracks the real mounted head through visual attack advance instead of leaving the camera at actor base", async () => {
  const { rider } = await loadCpuRider("viking-woman-blue"), world = new Group(), mount = new Group();
  const base = new Vector3(10, .005, 20);
  mount.position.copy(base); mount.scale.setScalar(WORKER_SCALE); world.add(mount); mount.add(rider);
  const tracked = createUnitEyeOffset(rider, mount, () => base), relative = createUnitEyeOffset(rider, mount);
  expect(tracked()).toEqual(relative());
  mount.position.z += .36; mount.rotation.y = .8;
  const absolute = createUnitEyeOffset(rider, world)()!, offset = tracked()!, old = relative()!;
  expect(new Vector3(offset.x, offset.y, offset.z).add(base).distanceTo(new Vector3(absolute.x, absolute.y, absolute.z))).toBeLessThan(1e-8);
  expect(new Vector3(old.x, old.y, old.z).add(base).distanceTo(new Vector3(absolute.x, absolute.y, absolute.z))).toBeGreaterThan(.35);
  rider.traverse(object => { const mesh = object as import("three").Mesh; mesh.geometry?.dispose(); });
});
