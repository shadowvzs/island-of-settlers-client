import {
  type AnimationClip,
  AnimationMixer,
  type Group,
  Mesh,
  type MeshStandardMaterial,
  type WebGLRenderer
} from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { type GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";

/** Where and how a drawn horse stands inside its unit root (`root.userData.transportHorse`). */
export interface TransportHorseSpecification {
  clip: string;
  heading: number;
  position: readonly [number, number, number];
  scale: number;
}
interface TransportHorseModel {
  clip: string;
  clips: AnimationClip[];
  horse: Group;
  mixer: AnimationMixer;
}
/** The horse sits this far to its side of the unit origin (the placement the mounts were tuned with). */
const SIDE_OFFSET = .12;
const packs = new WeakMap<WebGLRenderer, Promise<GLTF>>();
const models = new WeakMap<Group, TransportHorseModel>();

const loadPack = (renderer: WebGLRenderer) => {
  const loaded = packs.get(renderer);
  if (loaded) return loaded;
  const base = new URL("./workers/", document.baseURI).href;
  const textures = new KTX2Loader().setTranscoderPath(`${base}basis/`).detectSupport(renderer);
  const pack = new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .setKTX2Loader(textures)
    .loadAsync(`${base}mounts/horse/model.glb`)
    .finally(() => textures.dispose());
  packs.set(renderer, pack);
  return pack;
};

const ownMeshes = (horse: Group) => horse.traverse((object) => {
  if (!(object instanceof Mesh)) return;
  object.geometry = object.geometry.clone();
  object.material = (object.material as MeshStandardMaterial).clone();
  object.userData.ownedMaterial = true;
  object.userData.liveAnimalGeometry = true;
  object.castShadow = true;
  object.receiveShadow = true;
});

/** A live animated horse (a commander's waiting or led mount) from the shared horse pack. */
export const attachTransportHorse = async (root: Group, renderer: WebGLRenderer) => {
  const specification = root.userData.transportHorse as TransportHorseSpecification | undefined;
  if (!specification || models.has(root)) return;
  const source = await loadPack(renderer);
  if (root.userData.disposed) return;
  const horse = clone(source.scene) as Group;
  horse.name = "transport_horse_model";
  horse.scale.setScalar(specification.scale);
  const [x, y, z] = specification.position;
  horse.position.set(x + SIDE_OFFSET, y, z);
  horse.rotation.y = specification.heading;
  ownMeshes(horse);
  const mixer = new AnimationMixer(horse);
  const idle = source.animations.find((clip) => clip.name === specification.clip);
  if (idle) mixer.clipAction(idle).play();
  root.add(horse);
  models.set(root, { clip: specification.clip, clips: source.animations, horse, mixer });
};

/** Plays `clip` (when given) at `time` seconds. */
export const updateTransportHorse = (root: Group, time: number, clip?: string) => {
  const model = models.get(root);
  if (!model) return;
  if (clip && clip !== model.clip) {
    const selected = model.clips.find((animation) => animation.name === clip);
    if (selected) {
      model.mixer.stopAllAction();
      model.mixer.clipAction(selected).play();
      model.clip = clip;
    }
  }
  model.mixer.setTime(time);
};

export const disposeTransportHorse = (root: Group) => {
  const model = models.get(root);
  if (!model) return;
  model.mixer.stopAllAction();
  model.mixer.uncacheRoot(model.horse);
  models.delete(root);
};
