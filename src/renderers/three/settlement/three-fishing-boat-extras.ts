import {
  BoxGeometry, BufferAttribute, BufferGeometry, DynamicDrawUsage, Euler, Group, InstancedMesh, Matrix4, Mesh,
  MeshStandardMaterial, Quaternion, Vector3
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { getFishModels } from "../../../render-common/fish-schools/fish-models";
import { NET_LIFT, NET_SIDE } from "./three-fishing-boat-net";

/**
 * FISHER-POLISH skiff extras: the catch (the fish-school silverside model, one instanced draw for every
 * skiff) and a small stern lantern whose glass glows at night (cheap emissive, not a light; owner 8).
 */
const CATCH_SCALE = .95, CATCH_CAPACITY = 256;
/** Fish lying on their side in the bow bottom (skiff space, +z toward the bow-side thwart). */
const BOAT_CATCH = [[-.07, .13, .3, 1.5], [.07, .13, .38, 1.75], [-.01, .16, .44, 1.35], [.05, .14, .22, 1.6]];
/** Fish gathered in the closing net (around the net centre, before the net's spread). */
const NET_CATCH = [[-.1, .03, -.08, .3], [.08, .03, .05, .1], [-.02, .05, .12, -.2], [.06, .04, -.15, .45]];
const LANTERN_GLOW = 2.2;
const local = new Matrix4(), world = new Matrix4(), position = new Vector3(), scale = new Vector3();
const turn = new Quaternion(), onSide = new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0));
const yawTurn = new Quaternion(), up = new Vector3(0, 1, 0);

const fishGeometry = () => {
  const { mesh } = getFishModels()[0]!;
  const geometry = new BufferGeometry();
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  return geometry;
};

/** Every skiff's visible fish in one instanced draw; `clear`, `add` per boat, then `commit` each frame. */
export const createFishingCatch = (detailed: boolean) => {
  const geometry = fishGeometry();
  const material = new MeshStandardMaterial({ color: 0x6f8796, metalness: .45, roughness: .32 });
  const mesh = new InstancedMesh(geometry, material, CATCH_CAPACITY);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false; mesh.castShadow = detailed; mesh.count = 0; mesh.name = "fishing_skiff_catch";
  const write = (parent: Matrix4, [x, y, z, yaw]: readonly number[], shrink: number, offsetX = 0) => {
    if (mesh.count >= CATCH_CAPACITY) return;
    yawTurn.setFromAxisAngle(up, yaw!);
    turn.multiplyQuaternions(yawTurn, onSide);
    local.compose(position.set(offsetX + x! * shrink, y!, z! * shrink), turn, scale.setScalar(CATCH_SCALE));
    mesh.setMatrixAt(mesh.count++, world.multiplyMatrices(parent, local));
  };
  /** Four fish in the boat bottom. */
  const inBoat = (skiff: Matrix4) => { for (const fish of BOAT_CATCH) write(skiff, fish, 1); };
  /** Four fish in the hauled net beside the skiff, drawn together as it closes (`spread` 1 .. 0). */
  const inNet = (skiff: Matrix4, spread: number) => {
    for (const fish of NET_CATCH) write(skiff, [fish[0]!, fish[1]! + NET_LIFT, fish[2]!, fish[3]!],
      Math.max(.4, spread), NET_SIDE);
  };
  const clear = () => { mesh.count = 0; };
  const commit = () => { mesh.instanceMatrix.needsUpdate = true; mesh.visible = mesh.count > 0; };
  const dispose = () => { geometry.dispose(); material.dispose(); };
  return { clear, commit, dispose, inBoat, inNet, mesh };
};

/** A stern post with a hooked arm and a small lantern; the glass is the shared night-glow material. */
export const createSkiffLanternKit = () => {
  const parts = [new BoxGeometry(.025, .42, .025).translate(0, .21, 0),
    new BoxGeometry(.025, .02, .12).translate(0, .41, .05), new BoxGeometry(.075, .012, .075).translate(0, .37, .1),
    new BoxGeometry(.06, .012, .06).translate(0, .29, .1)];
  const frame = mergeGeometries(parts, false)!;
  parts.forEach(part => part.dispose());
  const glass = new BoxGeometry(.05, .07, .05).translate(0, .33, .1);
  const frameMaterial = new MeshStandardMaterial({ color: 0x3a2c20, roughness: .8 });
  const glassMaterial = new MeshStandardMaterial({ color: 0x6b5a3a, emissive: 0xffb45e, emissiveIntensity: 0,
    roughness: .4 });
  const create = () => {
    const lantern = new Group();
    lantern.add(new Mesh(frame, frameMaterial), new Mesh(glass, glassMaterial));
    return lantern;
  };
  const setNight = (night: boolean) => { glassMaterial.emissiveIntensity = night ? LANTERN_GLOW : 0; };
  const dispose = () => { frame.dispose(); glass.dispose(); frameMaterial.dispose(); glassMaterial.dispose(); };
  return { create, dispose, setNight };
};
