import {
  Bone, BufferGeometry, Float32BufferAttribute, Group, MeshStandardMaterial, Object3D,
  Skeleton, SkinnedMesh, Sphere, SRGBColorSpace, TextureLoader, Uint16BufferAttribute,
Vector3} from "three";

import highTextureUrl from "../../../../assets/models/animals/pig/albedo-high.jpg?url";
import minimalTextureUrl from "../../../../assets/models/animals/pig/albedo-minimal.jpg?url";
import { IMPORTED_PIG_DATA } from "../../../render-common/wares/imported-pig-data";
import { smoothstep } from "../../../shared/world/noise";

export const PIG_HEAD_PIVOT = [0, .17, .12] as const;
/** Measured centre of the source snout's foremost vertices, relative to the head pivot. */
export const PIG_MUZZLE = [0, -.091, .11] as const;
const packs = new Map<boolean, { geometry: BufferGeometry; material: MeshStandardMaterial }>();
const pending: Promise<unknown>[] = [];
/** Source has no artist rig. These anatomical blend weights are an explicitly derived rig. */
const getPack = (detailed: boolean) => {
  let pack = packs.get(detailed); if (pack) return pack;
  const source = detailed ? IMPORTED_PIG_DATA.high : IMPORTED_PIG_DATA.minimal;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(source.position!, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(source.normal!, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(source.uv!, 2));
  geometry.setIndex(source.index!);
  const joints: number[] = [], weights: number[] = [];
  for (let at = 0; at < source.position!.length; at += 3) {
    const x = source.position![at]!, y = source.position![at + 1]!, z = source.position![at + 2]!;
    const leg = (1 - smoothstep(.07, .13, y)) * (1 - smoothstep(.105, .15, z));
    const head = smoothstep(.055, .13, z) * (1 - leg);
    const tail = smoothstep(.196, .224, -z) * smoothstep(.16, .19, y);
    const limb = (z > -.04 ? 2 : 4) + (x > 0 ? 0 : 1);
    let part = 6;
    if (leg > head && leg > tail) part = limb;
    else if (head > tail) part = 1;
    const weight = Math.max(leg, head, tail);
    joints.push(0, part, 0, 0); weights.push(1 - weight, weight, 0, 0);
  }
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(joints, 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: .86, metalness: 0 });
  if (typeof document !== "undefined") {
    pending.push(new Promise<void>((resolve, reject) => {
      const texture = new TextureLoader().load(detailed ? highTextureUrl : minimalTextureUrl,
        () => resolve(), undefined, error => reject(error));
      texture.colorSpace = SRGBColorSpace; texture.flipY = false;
      material.map = texture; material.needsUpdate = true;
    }));
  }
  pack = { geometry, material }; packs.set(detailed, pack); return pack;
};

/** Asset previews await this so no untextured placeholder is baked into icons. */
export const waitForImportedPigTextures = () => Promise.all(pending);
export const prepareImportedPigTexture = (detailed: boolean) => { getPack(detailed); return waitForImportedPigTextures(); };

/** One shared mesh/material per quality; each live pig owns only its small skeleton. */
export const createImportedPig = (detailed: boolean) => {
  const pack = getPack(detailed), pig = new Group();
  pig.userData.importedPig = true;
  const body = new Bone(), head = new Bone(), tail = new Bone();
  head.name = "pig_feeding_head"; head.position.set(...PIG_HEAD_PIVOT);
  tail.position.set(0, .205, -.207);
  const feet = [0, 1, 2, 3].map(index => {
    const bone = new Bone(); bone.position.set(index % 2 ? -.045 : .045, .105, index < 2 ? .095 : -.17);
    body.add(bone); return bone;
  });
  body.add(head, tail);
  const mesh = new SkinnedMesh(pack.geometry, pack.material);
  mesh.name = "imported_lowpoly_pig"; mesh.userData.liveAnimalGeometry = true;
  mesh.userData.sourceAsset = "fabiotambone/lowpoly-pig"; mesh.castShadow = detailed; mesh.receiveShadow = detailed;
  mesh.add(body); pig.add(mesh);
  const skeleton = new Skeleton([body, head, ...feet, tail]); mesh.bind(skeleton);
  const muzzle = new Object3D(); muzzle.name = "pig_muzzle_contact";
  muzzle.position.set(...PIG_MUZZLE); head.add(muzzle);
  // Conservative animated envelope; wandering is managed by the existing pen controller.
  mesh.boundingSphere = new Sphere(new Vector3(0, .12, 0), .37);
  return { pig, head, feet, muzzle, tail, mesh, dispose: () => { skeleton.dispose(); pig.removeFromParent(); } };
};
