import { setArmourLod } from "@workers/game-three-armour";
import { shareWorkerSkeletons } from "@workers/game-three-skeletons";
import { applyBodyGirth, applyRigidBodyGirth, bodyGirthProfile } from "@workers/worker-body-girth";
import { type Bone, type Object3D, Skeleton, SkinnedMesh } from "three";
import type { GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { NATION_RIDERS } from "../../render-common/mounts/nation-riders";
import { WORKER_ASSET_BASE } from "../../render-common/workers/worker-assets";
import { settlerNation } from "../../render-common/workers/worker-nation";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { mountedRiderArmourModel } from "./mount-rider-armour-variants";

/**
 * Cavalry wear their nation's infantry armour (owner, 2026-10-12): the "soldier" rank pieces of the
 * armour sets (game_ready/armour) on the riding rigs. Skinned pieces (cuirass, belt, arm guards,
 * shoes) are rebound to the rider's own skeleton by joint name, rigid pieces (helmet) go under their
 * joint. Every nation's rider body is the riding variant of the armour body (NATION_RIDERS), so the
 * pieces fit it exactly. A High rider keeps both armour LODs and shows LOD 1 while it is small on
 * screen (mount-detail.ts); a Minimal rider only gets LOD 1.
 */
const ARMOUR_BASE = `${WORKER_ASSET_BASE}armour/`;
const ARMOUR_LOD = /_lod(\d)$/;

interface ArmourPiece { attach: { joints?: string[]; kind: "rigid" | "skinned" }; id: string; ranks: string[];
  roots: string[] }
interface ArmourManifest {
  sets: { bodies: { files: Record<string, string>; id: string; models: Record<string, string> }[];
    nation: string; pieces: ArmourPiece[] }[];
}
export interface RiderArmour { body: GLTF; rigid: { gltf: GLTF; piece: ArmourPiece }[]; variant: string }

/** Loads the nation's armoured body (for its skinned pieces) and its rigid rank pieces. */
export const loadRiderArmour = async (
  loader: GLTFLoader, nation: WorkerNation, rank: "centurion" | "soldier"
): Promise<RiderArmour> => {
  const response = await fetch(`${ARMOUR_BASE}manifest.json`);
  if (!response.ok) throw new Error(`Armour manifest HTTP ${response.status}`);
  const manifest = await response.json() as ArmourManifest;
  const fittedSource = (equipmentNation: WorkerNation) => {
    const set = manifest.sets.find(candidate => candidate.nation === equipmentNation);
    const body = set?.bodies.find(candidate => candidate.id === NATION_RIDERS[nation]);
    return set && body ? { body, set } : undefined;
  };
  // National identity is independent of the temporary riding asset. A national foot roster
  // does not imply that its armour manifest contains this exact legacy riding body.
  const source = fittedSource(nation) ?? fittedSource(settlerNation(nation));
  if (!source) throw new Error(`No rider armour for ${nation}`);
  const { body, set } = source;
  const pieces = set.pieces.filter(piece => piece.attach.kind === "rigid" && piece.ranks.includes(rank));
  const [armouredBody, ...rigid] = await Promise.all([
    loader.loadAsync(mountedRiderArmourModel(nation, rank, body.id, `${ARMOUR_BASE}${body.models[rank]}`)),
    ...pieces.map(piece => loader.loadAsync(`${ARMOUR_BASE}${body.files[piece.id]}`))
  ]);
  return { body: armouredBody!, rigid: pieces.map((piece, index) => ({ gltf: rigid[index]!, piece })),
    variant: body.id };
};

const listJoints = (root: Object3D) => {
  const joints = new Map<string, Object3D>();
  root.traverse(object => { if (!joints.has(object.name)) joints.set(object.name, object); });
  return joints;
};

/** Rebinds one skinned armour piece to the rider's joints of the same names. */
const rebind = (piece: SkinnedMesh, joints: Map<string, Object3D>) => {
  const bones = piece.skeleton.bones.map(bone => joints.get(bone.name) as Bone | undefined);
  if (bones.some(bone => !bone)) return null;
  const worn = piece.clone();
  worn.bind(new Skeleton(bones as Bone[], piece.skeleton.boneInverses.map(inverse => inverse.clone())),
    piece.bindMatrix.clone());
  return worn;
};

const isWornLod = (object: Object3D, lods: readonly number[]) =>
  object instanceof SkinnedMesh && object.name.startsWith("armour_") &&
  lods.includes(Number(ARMOUR_LOD.exec(object.name)?.[1]));

/**
 * Dresses a rider template (its scene is cloned per mount afterwards) in the nation's armour at
 * the armour levels of detail `lods`; the first one is shown.
 */
export const dressRider = (rider: Object3D, armour: RiderArmour, lods: readonly number[]) => {
  const joints = listJoints(rider);
  let skin: SkinnedMesh | undefined;
  rider.traverse(object => { if (!skin && object instanceof SkinnedMesh) skin = object; });
  if (!skin?.parent) return;
  const { skeleton } = skin, girth = bodyGirthProfile(armour.variant);
  // The rider body's girth fit; the template geometry the worn clones share is fitted once.
  applyBodyGirth(armour.body.scene, girth);
  const worn: SkinnedMesh[] = [];
  armour.body.scene.traverse(object => {
    if (!isWornLod(object, lods)) return;
    const piece = rebind(object as SkinnedMesh, joints);
    if (piece) worn.push(piece);
  });
  skin.parent.add(...worn);
  for (const { gltf, piece } of armour.rigid)
    piece.roots.forEach((root, side) => {
      const node = gltf.scene.getObjectByName(root)?.clone();
      const joint = joints.get(piece.attach.joints?.[side] ?? "");
      if (!node || !joint) return;
      applyRigidBodyGirth(node, joint.name, skeleton, girth);
      joint.add(node);
    });
  // C02 (d): worn pieces of one skin (and a matching body) update one skeleton, one bone upload.
  shareWorkerSkeletons(rider);
  setArmourLod(rider, lods[0]!);
};
