import { Box3, BufferGeometry, Group, type Mesh, type Object3D, Vector3 } from "three";

import { CATAPULT_SCOOP, CATAPULT_STONE_SEAT_LIFT } from "../../../render-common/buildings/catapult-mechanism";
import type { CatapultAmmoKind } from "../../../shared/settlement/catapult-ammo-kinds";
import { markBuildingRuntimeProp } from "./building-runtime-props";
import { createCatapultBundleKit } from "./catapult-granite-bundle";
import { createMarbleShotKit } from "./catapult-marble-shot";

const EMPTY_GEOMETRY = new BufferGeometry();

interface BundleOverlay { bundle: Object3D; marble: Object3D; solid: BufferGeometry }

const isCatapultStoneMesh = (object: Object3D): object is Mesh => {
  if (!(object as Mesh).isMesh || !object.userData.catapultRockMaterial) return false;
  const stock = object.userData.stock as { kind?: string; ware?: string } | undefined;
  return object.userData.catapultPart === "loaded" || (stock?.kind === "input" && stock.ware === "stone");
};

const fitBundleToStone = (bundle: Object3D, stone: Mesh) => {
  stone.geometry.computeBoundingBox();
  const target = stone.geometry.boundingBox!;
  bundle.updateMatrixWorld(true);
  const own = new Box3().setFromObject(bundle);
  bundle.position.set(
    (target.min.x + target.max.x - own.min.x - own.max.x) / 2,
    target.min.y - own.min.y,
    (target.min.z + target.max.z - own.min.z - own.max.z) / 2
  );
};

/**
 * The cup stone is centred on the scoop axis, which is tilted in the engine frame. The bundle gets
 * a holder along that axis so it stands upright in the cup with its base on the scoop floor.
 */
const seatBundleInCup = (bundle: Object3D, stone: Mesh, diameter: number) => {
  stone.geometry.computeBoundingBox();
  const centre = stone.geometry.boundingBox!.getCenter(new Vector3());
  const axis = new Vector3(0, Math.cos(CATAPULT_SCOOP.pitch), Math.sin(CATAPULT_SCOOP.pitch));
  const holder = new Group();
  holder.name = "catapult_cup_bundle";
  holder.rotation.x = CATAPULT_SCOOP.pitch;
  holder.position.copy(centre).addScaledVector(axis, -(diameter / 2 + CATAPULT_STONE_SEAT_LIFT));
  bundle.updateMatrixWorld(true);
  const own = new Box3().setFromObject(bundle), middle = own.getCenter(new Vector3());
  bundle.position.set(-middle.x, -own.min.y, -middle.z);
  holder.add(bundle);
  return holder;
};

/** The polished marble sphere takes the solid stone's place: same centre, same diameter. */
const placeMarbleShot = (marble: Mesh, stone: Mesh, size: number) => {
  stone.geometry.boundingBox!.getCenter(marble.position);
  marble.scale.setScalar(size);
};

interface SharedShotKits {
  kit: ReturnType<typeof createCatapultBundleKit>; marbleKit: ReturnType<typeof createMarbleShotKit>; users: number
}
const sharedShotKits = new Map<boolean, SharedShotKits>();

/** Every tower of one detail level shares the same bundle and marble geometry, textures and materials. */
const acquireShotKits = (detailed: boolean) => {
  let shared = sharedShotKits.get(detailed);
  if (!shared) {
    shared = { kit: createCatapultBundleKit(detailed), marbleKit: createMarbleShotKit(detailed), users: 0 };
    sharedShotKits.set(detailed, shared);
  }
  shared.users++;
  return shared;
};

const releaseShotKits = (detailed: boolean, shared: SharedShotKits) => {
  if (--shared.users > 0) return;
  shared.kit.dispose(); shared.marbleKit.dispose();
  sharedShotKits.delete(detailed);
};

/**
 * Adds a hidden granite bundle and a hidden marble sphere to each roof-rack stone and to the cup stone.
 * One shared kit per shot kind and detail level serves every slot of every tower; a granite or
 * marble slot swaps the solid stone for an empty geometry so only its own shot draws. The overlays
 * are runtime props, outside the static building budget. Returns this tower's kit release.
 */
export const attachCatapultRoofBundles = (root: Object3D, detailed: boolean) => {
  const stones: Mesh[] = [];
  root.traverse(object => { if (isCatapultStoneMesh(object)) stones.push(object); });
  if (!stones.length) return () => {};
  const shared = acquireShotKits(detailed), { kit, marbleKit } = shared;
  for (const stone of stones) {
    const bounds = stone.geometry.boundingBox ?? (stone.geometry.computeBoundingBox(), stone.geometry.boundingBox!);
    const size = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
    const bundle = kit.create(size), marble = marbleKit.create(size);
    const cup = stone.userData.catapultPart === "loaded";
    if (!cup) fitBundleToStone(bundle, stone);
    placeMarbleShot(marble, stone, size);
    const placed = cup ? seatBundleInCup(bundle, stone, size) : bundle;
    placed.visible = false; marble.visible = false; stone.add(placed, marble);
    markBuildingRuntimeProp(placed); markBuildingRuntimeProp(marble);
    stone.userData.catapultBundleOverlay = { bundle: placed, marble, solid: stone.geometry } satisfies BundleOverlay;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true; releaseShotKits(detailed, shared);
  };
};

/** Shows the granite bundle or the marble sphere instead of the solid stone for those kinds. */
export const presentCatapultShot = (stone: Object3D, kind: CatapultAmmoKind | undefined) => {
  const overlay = stone.userData.catapultBundleOverlay as BundleOverlay | undefined;
  if (!overlay) return;
  overlay.bundle.visible = kind === "granite";
  overlay.marble.visible = kind === "marble";
  (stone as Mesh).geometry = overlay.bundle.visible || overlay.marble.visible ? EMPTY_GEOMETRY : overlay.solid;
};
