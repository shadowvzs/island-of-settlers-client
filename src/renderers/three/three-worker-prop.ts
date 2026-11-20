import type { ThreeWorkerPack } from "@workers/game-three-worker";
import { createFisherBasket } from "@workers/fisher-basket";
import * as placement from "@workers/worker-prop-placement";
import { Group, Mesh,Object3D, Quaternion, Vector3 } from "three";

import { WELL_BUCKET_HANDOFF } from "../../render-common/buildings/well-work-cycle";
import { FISHING_SKIFF_BEAM, FISHING_SKIFF_LENGTH } from "../../render-common/ships/fishing-skiff-dimensions";
import { LIGHTER_BEAM, LIGHTER_LENGTH } from "../../render-common/ships/lighter-dimensions";
import { stoneWareAppearance } from "../../render-common/wares/advanced-material-variants";
import { COIN_CARGO_VISUALS, HAND_CARRIED_INGREDIENTS } from "../../render-common/wares/ware-catalog";
import { handledWaterBucketScale, WATER_STOCK_CENTER_Y, WATER_WARE_SCALE } from "../../render-common/wares/water-bucket-dimensions";
import { hasDualTomahawks, rangedWeaponStyle } from "../../render-common/workers/military-weapon-style";
import { WORKER_SCALE } from "../../render-common/workers/worker-dimensions";
import {
  getWorkerHeldProp,
  getWorkerSecondaryProp,
  type WorkerHeldProp
} from "../../render-common/workers/worker-job-actions";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { tintCatapultObject } from "./buildings/catapult-ammo-material";
import { bundleLocalDiameter, createCatapultGraniteBundle } from "./buildings/catapult-granite-bundle";
import { createMarbleShotKit } from "./buildings/catapult-marble-shot";
import { createCatapultRockGeometry, createCatapultRockMaterial, disposeCatapultRockMaterial } from "./buildings/catapult-rock-geometry";
import {
  acquireMilitaryEquipment,
  isMilitaryEquipment,
  type MilitaryEquipmentKit,
  releaseEquipmentProp,
  setEquipmentFaction
} from "./military-equipment";
import { acquireWareMaterials } from "./settlement/ware-material-cache";
import { createWareModel } from "./settlement/ware-models";
import { buildNationalShuttleHull } from "./settlement/national-harbour-boat";
import { createFishingSkiffSurface } from "./settlement/fishing-skiff-surface";
import { meshMaterials } from "./three-mesh-resources";
import { placeCarriedCoinCargo } from "./worker-coin-cargo";
import { createBoatHandContacts } from "./worker-boat-hand-contacts";
import { boatLiftReferenceHeadY } from "./worker-boat-lift-path";
import { BOAT_CARRY_FORWARD, boatTransferStockOffsetWeight, boatTransferTransform, yardBoatLiftTransform, yardBoatWorldPose } from "./worker-boat-transfer";
import { farPropHoldable } from "./worker-far-props-mode";
import { createFishHandContacts, placeCarriedFish } from "./worker-fish-carry";
import { addFishingBobber, placeFishingLine } from "./worker-fishing-contact";
import { thickenFishingPole } from "./worker-fishing-pole-width";
import { createForesterHandContact, createForesterSeedling, placeForesterSeedling } from "./worker-forester-seedling";
import { CARRIED_UPRIGHT_TOOLS, createWalkingHammerGrip } from "./worker-hammer-grip";
import { orientWorkingHammer } from "./worker-hammer-strike";
import type { HandBlendTracker } from "./worker-hand-blend";
import { acquireHeldWareClone } from "./worker-held-ware-templates";
import { createWorkerHide, updateWorkerHideFold } from "./worker-hide-transfer";
import { meleePose } from "./worker-melee-moves";
import { orientMeleeWeapon, orientShield } from "./worker-melee-weapon";
import { createWorkerMilitaryPlacement } from "./worker-military-placement";
import { createTravelRodPlacement, setTravelRodLine } from "./worker-natural-rod";
import type { WorkerPackAssets } from "./worker-pack-assets";
import { gripToolShaftInFist, orientCarriedPickaxe, orientWorkingPickaxe } from "./worker-pickaxe-grip";
import { createWalkingScytheGrip } from "./worker-scythe-grip";
import { isSoftHandLoad, placeSoftHandLoad } from "./worker-soft-carry";
import { createSoftLoadHandContacts } from "./worker-soft-load-contacts";
import { createCradledWareHandContacts, placeCarriedStone } from "./worker-stone-carry";
import {
  applyCarriedWareScale, createTransferHandContacts, placeTransferredWare, transferCarryAction
} from "./worker-ware-transfer";
import { createWorkerWellBucket } from "./worker-well-bucket";
import { createWellBucketHandContacts } from "./worker-well-bucket-contact";

const tintCarriedStone = (prop: Object3D, heldId: string, frame?: WorkerFrame) => {
  if (heldId === "stone" && frame?.catapultStoneKind) tintCatapultObject(prop, frame.catapultStoneKind);
};

const isCompactCradledWare = (id: string) => id === "iron" || HAND_CARRIED_INGREDIENTS.includes(id) ||
  COIN_CARGO_VISUALS.some(visual => visual === id);

/** Wares both palms cradle in front of the chest (stone and its variants, bread, iron, hand-carried ingredients). */
const isCradledWare = (id: string) =>
  id === "stone" || id === "bread" || isCompactCradledWare(id) || !!stoneWareAppearance(id);

/**
 * A held prop that is placed in the worker root's frame (cradled wares, soft loads, fish, the water
 * bucket): it does not follow a moving hand, so a far update may hold its previous placement even
 * while the actor walks. Hand tools and weapons are not root-framed and place every pose.
 */
const isRootFramedWare = (id: string) =>
  isCradledWare(id) || isSoftHandLoad(id) || id === "fish" || id === "water";

/** Compact loads sit closer to the chest, keeping both palm contacts within the arm reach. */
const placeCompactCradledWare = (prop: Object3D, id: string) => {
  if (COIN_CARGO_VISUALS.some(visual => visual === id)) return placeCarriedCoinCargo(prop);
  prop.position.set(0, .84, .23);
  prop.quaternion.identity();
};

/** Haft radius of the pack hammer, in its own model units. */
const HAMMER_HAFT_RADIUS = .013;

type LoadedWorker = Awaited<ReturnType<ThreeWorkerPack["load"]>>;

/**
 * C06b: how one prop update runs. `bakedPose` marks a GPU crowd member, whose bone world matrices
 * this frame already come from the baked texture: the hand IK contacts only shape the skinned
 * body (which is not drawn) and the forced world updates are redundant, so the far path skips
 * both and still places every prop at the same spot as the skinned path.
 */
export interface WorkerPropUpdateOptions {
  bakedPose?: boolean;
  /** Far cadence: keep the last placement (the prop still follows the actor root and keeps its fold/scale). */
  hold?: boolean;
}

/** Carriers use the same upright handled bucket, fitted to the existing stock dimensions. */
const fitWaterCarrierFrame = (inputFrame: WorkerFrame): WorkerFrame => {
  const waterCarrier = inputFrame.workerJob !== "Well worker" &&
    (inputFrame.carryingWare === "water" || inputFrame.wareTransfer?.ware === "water");
  if (!waterCarrier) return inputFrame;
  const sourceScale = inputFrame.carriedWareScale ?? WATER_WARE_SCALE;
  const frame = { ...inputFrame, carriedWareScale: handledWaterBucketScale(sourceScale) };
  const transfer = inputFrame.wareTransfer;
  if (transfer) {
    const originalScale = transfer.scale3 ?? sourceScale;
    const scale3 = handledWaterBucketScale(originalScale);
    frame.wareTransfer = { ...transfer, scale3, target: { ...transfer.target,
      y: transfer.target.y + WATER_STOCK_CENTER_Y * originalScale.y - .041 * scale3.y } };
  }
  return frame;
};

/** The well bucket stays at the stock height until the hand has travelled most of the way up to it. */
const holdWellBucketAtPickup = (
  prop: Object3D, root: Object3D, transfer: NonNullable<WorkerFrame["wareTransfer"]>, scratch: Vector3
) => {
  const progress = Math.max(0, Math.min(1, (transfer.progress - .4) / .55));
  const travel = progress * progress * (3 - 2 * progress);
  const release = Math.max(0, Math.min(1, (travel - .8) / .2));
  const hold = 1 - release * release * (3 - 2 * release);
  const position = prop.getWorldPosition(scratch);
  position.y += Math.max(0, transfer.target.y - position.y) * hold;
  prop.position.copy(root.worldToLocal(position));
};

const listJoints = (root: Object3D) => {
  const joints = new Map<string, Object3D>();
  root.traverse((object) => joints.set(object.name, object));
  return joints;
};
/** Frees what a prop owns: geometries, unshared materials, owned materials and pack assets. */
const disposePropResources = (prop: Object3D) => {
  for (const texture of prop.userData.localTextures ?? []) texture.dispose();
  prop.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    if (prop.userData.sharedWareMaterials) return;
    meshMaterials(mesh).forEach((material) =>
      material.dispose()
    );
  });
  prop.userData.disposeOwnedMaterials?.();
  prop.userData.releasePackAssets?.();
  prop.removeFromParent();
};
const disposeProp = (prop: Object3D) => {
  if (prop.userData.sharedEquipment) return releaseEquipmentProp(prop);
  if (!prop.userData.releaseHeldWare) return disposePropResources(prop);
  prop.userData.releaseHeldWare();
  prop.removeFromParent();
};

const createHeldWare = (held: WorkerHeldProp, detailed: boolean,
  materials: Parameters<typeof createWareModel>[2], wellBucket: boolean, frame?: WorkerFrame) => {
  if (held.id === "fisher_basket") return createFisherBasket();
  if (held.id === "boat") {
    const geometry = buildNationalShuttleHull(frame?.propNation ?? frame?.nation ?? "roman", detailed);
    geometry.scale(FISHING_SKIFF_BEAM / LIGHTER_BEAM / WORKER_SCALE, .78 / WORKER_SCALE,
      FISHING_SKIFF_LENGTH / LIGHTER_LENGTH / WORKER_SCALE);
    // Place the rim at the prop origin: after turning the hull over, the rim rests on the hands.
    geometry.translate(0, -.3 * .78 / WORKER_SCALE, 0);
    const root = new Group(); root.name = "fisher_carried_boat";
    root.userData.fisherRailTop = detailed ? .02 * .78 / WORKER_SCALE : 0;
    const surface = createFishingSkiffSurface();
    root.userData.localTextures = [surface.texture];
    root.add(new Mesh(geometry, surface.material));
    return root;
  }
  if (held.id === "hides") return createWorkerHide(materials.hide, detailed);
  if (wellBucket) return createWorkerWellBucket(materials, detailed, false, frame?.propNation ?? frame?.nation ?? "roman");
  return createWareModel(held.id, detailed, materials, held.source === "tool" ? "tool" : "carry").root;
};

const placeCarriedSkin = (prop: Object3D, frame: WorkerFrame,
  contacts: ReturnType<typeof createSoftLoadHandContacts>, bakedPose: boolean) => {
  const ware = frame.carryingWare;
  if (!isSoftHandLoad(ware)) return false;
  placeSoftHandLoad(prop, ware!);
  if (!bakedPose) contacts(prop, { direction: "pickup", ware: ware!, progress: 1, target: frame }, true);
  return true;
};

/** Cache each original held prop; a woodcutter can switch between axe and carried timber. */
// eslint-disable-next-line max-lines-per-function -- one cache owns prop loading, placement and disposal
export const createWorkerProp = (
  pack: ThreeWorkerPack,
  worker: LoadedWorker,
  detailed = true,
  handBlend?: HandBlendTracker,
  shared?: WorkerPackAssets
) => {
  const props = new Map<string, Object3D>();
  const loading = new Set<string>();
  /** Props that have been placed at least once (a far hold must never leave a new prop unplaced). */
  const placed = new Set<string>();
  const joints = listJoints(worker.root);
  const transferContacts = createTransferHandContacts(worker.root, joints);
  const boatContacts = createBoatHandContacts(worker.root);
  const softContacts = createSoftLoadHandContacts(worker.root);
  const stoneContacts = createCradledWareHandContacts(worker.root);
  const fishContacts = createFishHandContacts(worker.root);
  const wellBucketContacts = createWellBucketHandContacts(worker.root);
  const walkingHammerGrip = createWalkingHammerGrip();
  const walkingScytheGrip = createWalkingScytheGrip();
  const walkingRodGrip = createTravelRodPlacement();
  const foresterHand = createForesterHandContact(worker.root);
  const handPosition = new Vector3(),
    handRotation = new Quaternion(),
    rootRotation = new Quaternion();
  const bucketScale = new Vector3(), bucketCarry = new Vector3(), bucketTarget = new Vector3(),
    upAxis = new Vector3(0, 1, 0);
  let materials: ReturnType<typeof acquireWareMaterials> | undefined;
  let equipment: MilitaryEquipmentKit | undefined;
  let disposed = false;
  let foresterSeedling: Object3D | undefined;
  const load = async (held: WorkerHeldProp, name: string, wellBucket = false, militaryFrame?: WorkerFrame) => {
    loading.add(name);
    try {
      if (disposed) return;
      let prop: Object3D;
      if (militaryFrame?.catapultStoneDiameter && held.id === "stone") {
        if (militaryFrame.catapultStoneKind === "granite") {
          const bundle = createCatapultGraniteBundle(detailed,
            bundleLocalDiameter(militaryFrame.catapultStoneDiameter, WORKER_SCALE));
          prop = new Group(); prop.add(bundle); prop.userData.sharedWareMaterials = true;
          prop.userData.disposeOwnedMaterials = bundle.userData.disposeOwnedMaterials;
        } else if (militaryFrame.catapultStoneKind === "marble") {
          const kit = createMarbleShotKit(detailed);
          const shape = new Group(); shape.name = "ware_geometry";
          shape.add(kit.create(militaryFrame.catapultStoneDiameter / WORKER_SCALE));
          prop = new Group(); prop.add(shape); prop.userData.sharedWareMaterials = true;
          prop.userData.disposeOwnedMaterials = kit.dispose;
        } else {
          const geometry = createCatapultRockGeometry(detailed), material = createCatapultRockMaterial(detailed);
          const size = militaryFrame.catapultStoneDiameter / WORKER_SCALE;
          geometry.scale(size, size, size);
          const shape = new Group(); shape.name = "ware_geometry"; shape.add(new Mesh(geometry, material));
          prop = new Group(); prop.add(shape); prop.userData.sharedWareMaterials = true;
          prop.userData.disposeOwnedMaterials = () => disposeCatapultRockMaterial(material);
        }
      }
      else if (militaryFrame?.combat && isMilitaryEquipment(held.id)) {
        equipment ??= acquireMilitaryEquipment(detailed);
        prop = equipment.create(held.id, militaryFrame.nation, militaryFrame.combat.type,
          rangedWeaponStyle(militaryFrame.nation, militaryFrame.combat.bandit));
      }
      else if (held.source === "pack") {
        const done = shared?.beginLoad();
        try {
          prop = (await pack.loadProp(held.id)).scene;
          // The prop's textures stay cached while it can still be drawn; disposal releases them.
          const release = shared?.retainProp(prop);
          if (release) prop.userData.releasePackAssets = release;
        } finally {
          done?.();
        }
      }
      else {
        const wares = materials ??= acquireWareMaterials(detailed);
        const create = () => createHeldWare(held, detailed, wares.materials, wellBucket, militaryFrame);
        // A carried hide deforms its own geometry while folding; every other held ware is static.
        const nation = wellBucket || held.id === "boat" ? militaryFrame?.propNation ?? militaryFrame?.nation ?? "roman" : "";
        prop = held.id === "hides" ? create()
          : acquireHeldWareClone(`${detailed}:${held.source}:${held.id}:${nation}`, create, disposePropResources);
      }
      if (disposed) return disposeProp(prop);
      tintCarriedStone(prop, held.id, militaryFrame);
      if (held.id === "fishing_rod") {
        thickenFishingPole(prop);
        addFishingBobber(prop, detailed);
      }
      if (held.id === "meat") {
        const support = new Object3D();
        support.name = "meat_shoulder_support";
        support.position.set(0, .095, .04);
        prop.getObjectByName("ware_geometry")!.add(support);
      }
      prop.visible = false;
      prop.userData.workerHeldId = held.id;
      props.set(name, prop);
      worker.root.add(prop);
    } finally {
      loading.delete(name);
    }
  };
  const attachToHand = (prop: Object3D, side: "R" | "L", worldCurrent = false) => {
    const hand = joints.get(`socket_hand_${side}`) ?? joints.get(`hand_${side}`);
    if (!hand) {
      prop.visible = false;
      return;
    }
    if (!worldCurrent) worker.root.updateMatrixWorld(true);
    prop.position.copy(worker.root.worldToLocal(hand.getWorldPosition(handPosition)));
    prop.quaternion.copy(
      worker.root
        .getWorldQuaternion(rootRotation)
        .invert()
        .multiply(hand.getWorldQuaternion(handRotation))
    );
  };
  const placeMilitaryProp = createWorkerMilitaryPlacement(worker.root, joints, attachToHand);
  const wellCarryContact = { direction: "pickup", ware: "water", progress: .8,
    target: { x: 0, y: 0, z: 0 } } as const;
  const attachWellBucket = (prop: Object3D, frame: WorkerFrame, worldCurrent = false) => {
    if (!worldCurrent) worker.root.updateMatrixWorld(true);
    worker.root.getWorldQuaternion(rootRotation);
    handPosition.set(.23, .40, .05).applyQuaternion(rootRotation)
      .add(worker.root.getWorldPosition(bucketScale));
    prop.position.copy(worker.root.worldToLocal(handPosition));
    prop.quaternion.copy(rootRotation.invert()
      .multiply(handRotation.setFromAxisAngle(upAxis, frame.heading)));
  };
  return {
    update: (inputFrame: WorkerFrame, options: WorkerPropUpdateOptions = {}) => {
      const bakedPose = options.bakedPose === true;
      const hold = options.hold === true;
      if (inputFrame.combat?.type === "archer" && inputFrame.combat.faction > 0 && inputFrame.combat.bandit?.rangedWeapon === "javelin") {
        for (const prop of props.values()) prop.visible = false;
        return;
      }
      // A soldier leaning out of a window shows head and shoulders only, no gear over the facade.
      if (inputFrame.lean) { for (const prop of props.values()) prop.visible = false; return; }
      const frame = fitWaterCarrierFrame(inputFrame);
      if (frame.foresterSeedling) {
        materials ??= acquireWareMaterials(detailed);
        foresterSeedling ??= createForesterSeedling(materials.materials, detailed);
        if (!foresterSeedling.parent) worker.root.add(foresterSeedling);
        const hand = joints.get("socket_hand_L") ?? joints.get("hand_L");
        if (hand) {
          placeForesterSeedling(foresterSeedling, worker.root, hand, frame);
          foresterHand(foresterSeedling);
        }
      } else if (foresterSeedling) foresterSeedling.visible = false;
      const held = getWorkerHeldProp(frame);
      const wellBucket = held?.id === "water" && frame.workerJob === "Well worker";
      const waterBucket = held?.id === "water";
      let equipmentKey = "";
      if (frame.combat) equipmentKey = `military:${frame.nation}:${frame.combat.type}:`;
      // The carried shape depends on the kind (granite bundle, marble sphere, rock), so the kind keys it.
      if (frame.catapultStoneDiameter)
        equipmentKey = `catapult:${frame.catapultStoneDiameter}:${frame.catapultStoneKind ?? "stone"}:`;
      const name = held ? `${equipmentKey}${held.source}:${held.id}${waterBucket ? `:well:${frame.propNation ?? frame.nation}` : ""}` : null;
      const dual = !!frame.combat && hasDualTomahawks(frame.nation, frame.combat.type);
      const secondary = dual ? { id: "axe", source: "tool" as const } : getWorkerSecondaryProp(frame);
      const secondaryName = secondary ? `${equipmentKey}${secondary.source}:${secondary.id}:offhand` : null;
      for (const [key, prop] of props) prop.visible = key === name || key === secondaryName;
      if (secondary && secondaryName) {
        const shield = props.get(secondaryName);
        if (shield) {
          if (frame.combat) setEquipmentFaction(shield, frame.combat.faction);
          // Hold the offhand only on a holdable pose; a shield on a swinging arm places every pose.
          if (!hold || !farPropHoldable(frame) || !placed.has(secondaryName)) {
            attachToHand(shield, "L", bakedPose);
            placed.add(secondaryName);
            const pose = dual ? meleePose(frame) : null;
            if (pose) orientMeleeWeapon(shield, worker.root, { ...pose,
              pitch: pose.leftPitch ?? pose.pitch, yaw: pose.leftYaw ?? pose.yaw }, false, bakedPose);
            else if (!dual && frame.combat) orientShield(shield, worker.root, Boolean(frame.combat.defending),
              frame.combat.threatYaw, bakedPose);
          }
        }
        else if (!loading.has(secondaryName))
          void load(secondary, secondaryName, false, frame).catch((error) =>
            console.error("Worker shield", error)
          );
      }
      if (!name || !held) return;
      let prop = props.get(name);
      if (!prop) {
        if (!loading.has(name))
          void load(held, name, waterBucket, frame).catch((error) => console.error("Worker prop", error));
        prop = props.get(name);
        if (!prop) return;
        prop.visible = true;
      }
      prop.visible = !(wellBucket && frame.wareTransfer?.direction === "pickup" &&
        frame.wareTransfer.progress < WELL_BUCKET_HANDOFF);
      updateWorkerHideFold(prop, frame.wareTransfer);
      applyCarriedWareScale(prop, worker.root, frame.carriedWareScale, frame.catapultStoneDiameter !== undefined);
      // Far cadence: this due frame keeps the last placement; the prop still follows the actor root.
      // Root-framed wares may hold on any action, hand tools only on the holdable poses, and a prop
      // that has never been placed always falls through (a load completing mid-pose is not stuck).
      const holdSafe = farPropHoldable(frame) || (!frame.wareTransfer && isRootFramedWare(held.id));
      if (hold && holdSafe && placed.has(name)) return;
      placed.add(name);
      if (frame.combat && isMilitaryEquipment(held.id)) {
        placeMilitaryProp(prop, frame, held.id, bakedPose);
        return;
      }
      if (held.id === "fisher_basket") {
        placeCarriedStone(prop);
        prop.position.y = .60;
        if (frame.action === "fish_basket_pickup") {
          const left = joints.get("socket_hand_L"), right = joints.get("socket_hand_R");
          if (left && right) {
            worker.root.updateMatrixWorld(true);
            left.getWorldPosition(handPosition); right.getWorldPosition(bucketTarget);
            prop.position.copy(worker.root.worldToLocal(handPosition.add(bucketTarget).multiplyScalar(.5)));
            prop.position.y += .03;
          }
        }
        if (frame.wareTransfer) placeTransferredWare(prop, worker.root, frame.wareTransfer);
        if (!bakedPose && frame.action !== "fish_basket_pickup")
          stoneContacts(prop, { direction: "pickup", ware: "stone", progress: 1, target: frame }, true);
        return;
      }
      if (held.id === "boat") {
        // Inventory icon scale must not shrink the physical skiff carried to the shore.
        prop.scale.setScalar(1);
        worker.root.updateMatrixWorld(true);
        const chest = joints.get("Spine2") ?? joints.get("chest");
        if (!chest) { prop.visible = false; return; }
        const left = joints.get("socket_hand_L"), right = joints.get("socket_hand_R");
        const carry = left && right
          ? worker.root.worldToLocal(left.getWorldPosition(handPosition)
            .add(right.getWorldPosition(bucketTarget)).multiplyScalar(.5))
          : worker.root.worldToLocal(chest.localToWorld(handPosition.set(0, .44, 0)));
        prop.position.copy(carry);
        const transfer = frame.wareTransfer;
        const lift = transfer ? (transfer.direction === "pickup" ? transfer.progress : 1 - transfer.progress) :
          frame.action === "boat_lift" ? frame.animationTime / 1.2 : 1;
        const transform = boatTransferTransform(lift);
        prop.quaternion.copy(transform.rotation);
        if (lift < 1) {
          prop.position.copy(transform.center);
          const head = joints.get("Head") ?? joints.get("head");
          if (head) {
            const headY = worker.root.worldToLocal(head.getWorldPosition(bucketTarget)).y;
            const phase = Math.max(0, Math.min(1, lift / .35));
            prop.position.y += (headY - boatLiftReferenceHeadY(lift)) * phase * phase * (3 - 2 * phase);
            const finish = Math.max(0, Math.min(1, (lift - .65) / .3));
            prop.position.y += (boatLiftReferenceHeadY(1) + .12 - 1.16) * finish * finish * (3 - 2 * finish);
          }
          prop.position.z -= transform.workerForward;
          if (frame.fisherBoatTransferBaseY !== undefined)
            prop.position.y += (frame.fisherBoatTransferBaseY - frame.y) / WORKER_SCALE;
        }
        else {
          prop.position.z = BOAT_CARRY_FORWARD;
          const head = joints.get("Head") ?? joints.get("head");
          if (head) {
            const headLocal = worker.root.worldToLocal(head.getWorldPosition(bucketTarget));
            prop.position.y = headLocal.y + .12;
          }
        }
        if (transfer) {
          const contact = worker.root.worldToLocal(bucketTarget.set(transfer.target.x, transfer.target.y, transfer.target.z));
          const start = boatTransferTransform(0).center;
          start.z -= transform.workerForward;
          if (frame.fisherBoatTransferBaseY !== undefined)
            start.y += (frame.fisherBoatTransferBaseY - frame.y) / WORKER_SCALE;
          prop.position.add(contact.sub(start).multiplyScalar(boatTransferStockOffsetWeight(lift)));
        }
        if (frame.fisherBoatYard) {
          const start = yardBoatWorldPose(frame.fisherBoatYard);
          worker.root.worldToLocal(start.center);
          start.rotation.premultiply(worker.root.getWorldQuaternion(new Quaternion()).invert());
          const head = joints.get("Head") ?? joints.get("head");
          const headY = head ? worker.root.worldToLocal(head.getWorldPosition(new Vector3())).y : 1;
          const finish = carry.clone(); finish.z = BOAT_CARRY_FORWARD;
          finish.y = headY + .12;
          const inverseWorker = worker.root.getWorldQuaternion(new Quaternion()).invert();
          const finalHeading = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), frame.fisherBoatYard.yaw + Math.PI / 2);
          const turnToFinish = inverseWorker.clone().multiply(finalHeading);
          const forward = new Vector3(0, 0, BOAT_CARRY_FORWARD).applyQuaternion(turnToFinish);
          finish.x = forward.x; finish.z = forward.z;
          const finishRotation = turnToFinish.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI));
          const pose = yardBoatLiftTransform(lift, start, finish, finishRotation);
          const ease = (n: number) => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };
          const liftClearance = .07 * ease((lift - .55) / .1) * (1 - ease((lift - .8) / .15));
          pose.center.y += liftClearance / WORKER_SCALE;
          const reaches = ["Left", "Right"].flatMap(side => {
            const upper = joints.get(`${side}Arm`), lower = joints.get(`${side}ForeArm`), hand = joints.get(`${side}Hand`);
            if (!upper || !lower || !hand) return [];
            const elbow = lower.getWorldPosition(new Vector3());
            return [upper.getWorldPosition(new Vector3()).distanceTo(elbow) + hand.getWorldPosition(new Vector3()).distanceTo(elbow)];
          });
          const reach = reaches.length ? reaches.reduce((sum, value) => sum + value, 0) / reaches.length : .32;
          const wallClearance = .025 + .055 * Math.max(0, Math.min(1, (reach - .28) / .04));
          const away = wallClearance * ease((lift - .3) / .3) * (1 - ease((lift - .65) / .3));
          pose.center.add(new Vector3(-Math.sin(frame.fisherBoatYard.yaw), 0, -Math.cos(frame.fisherBoatYard.yaw))
            .applyQuaternion(inverseWorker).multiplyScalar(away / WORKER_SCALE));
          prop.position.copy(pose.center); prop.quaternion.copy(pose.rotation);
        }
        if (!bakedPose) {
          if (frame.fisherBoatYard) boatContacts.yard(prop, lift, frame.fisherBoatYard);
          else if (lift < 1) boatContacts.ground(prop, lift);
          else boatContacts.boat(prop, transform.gripAlong, transform.gripDepth);
        }
        return;
      }
      if (frame.wareTransfer) {
        const carryAction = transferCarryAction(frame);
        const carryClip = worker.clips.find((candidate) => candidate.name === carryAction);
        if (!carryClip) return;
        if (isSoftHandLoad(held.id)) placeSoftHandLoad(prop, held.id);
        else if (isCompactCradledWare(held.id)) placeCompactCradledWare(prop, held.id);
        else if (isCradledWare(held.id)) {
          placeCarriedStone(prop, frame.catapultTuckedCarry);
          if (frame.catapultCarryPoint) prop.position.copy(worker.root.worldToLocal(handPosition.set(
            frame.catapultCarryPoint.x, frame.catapultCarryPoint.y, frame.catapultCarryPoint.z)));
        }
        else if (held.id === "fish") placeCarriedFish(prop);
        else if (waterBucket) attachWellBucket(prop, frame, bakedPose);
        else placement.placeWorkerProp(prop, worker.root, joints, {
          duration: carryClip.duration, loop: true, name: carryAction, prop: held.id
        }, 0);
        placeTransferredWare(prop, worker.root, frame.wareTransfer);
        if (wellBucket && frame.wareTransfer.direction === "pickup")
          holdWellBucketAtPickup(prop, worker.root, frame.wareTransfer, handPosition);
        if (waterBucket && frame.wareTransfer.direction === "putdown") {
          const transfer = frame.wareTransfer;
          const progress = transfer.progress;
          const position = prop.getWorldPosition(handPosition);
          const carry = bucketCarry.set(.23, .40, .05).applyQuaternion(worker.root.getWorldQuaternion(rootRotation))
            .add(worker.root.getWorldPosition(bucketScale));
          const move = Math.max(0, Math.min(1, progress / .5));
          const across = move * move * (3 - 2 * move);
          const raised = carry.y + .115;
          position.copy(carry).lerp(bucketTarget.set(transfer.target.x, raised, transfer.target.z), across);
          // Pass in front of the wheel rather than cutting diagonally through a spoke.
          if (wellBucket && progress < .5) {
            const forward = bucketTarget.set(0, 0, .15 * Math.sin(Math.PI * across))
              .applyQuaternion(rootRotation.setFromAxisAngle(upAxis, transfer.yaw ?? 0));
            position.add(forward);
          }
          if (progress > .5) {
            const lower = Math.max(0, Math.min(1, (progress - .5) / .3));
            const amount = lower * lower * (3 - 2 * lower);
            position.y = raised + (transfer.target.y - raised) * amount;
          }
          prop.position.copy(worker.root.worldToLocal(position));
        }
        if (waterBucket) {
          // Water stays level throughout the handoff, independently of torso and wrist motion.
          if(!frame.wareTransfer.pour) prop.quaternion.copy(worker.root.getWorldQuaternion(rootRotation).invert()
            .multiply(handRotation.setFromAxisAngle(upAxis, frame.wareTransfer.yaw ?? frame.heading)));
          if (!bakedPose) wellBucketContacts(prop, frame.wareTransfer);
        }
        else if (isCradledWare(held.id)) {
          prop.userData.catapultTucked = false;
          if (!bakedPose) stoneContacts(prop, frame.wareTransfer);
        }
        else if (held.id === "fish") { if (!bakedPose) fishContacts(prop, frame.wareTransfer); }
        else if (isSoftHandLoad(held.id)) { if (!bakedPose) softContacts(prop, frame.wareTransfer); }
        else if (!bakedPose) transferContacts(prop, frame.wareTransfer);
        return;
      }
      if (placeCarriedSkin(prop, frame, softContacts, bakedPose)) return;
      if (isCradledWare(held.id)) {
        prop.userData.catapultTucked = frame.catapultTuckedCarry === true;
        if (isCompactCradledWare(held.id)) placeCompactCradledWare(prop, held.id);
        else {
          placeCarriedStone(prop, frame.catapultTuckedCarry);
          if (frame.catapultCarryPoint) prop.position.copy(worker.root.worldToLocal(handPosition.set(
            frame.catapultCarryPoint.x, frame.catapultCarryPoint.y, frame.catapultCarryPoint.z)));
        }
        if (!bakedPose) stoneContacts(prop, { direction: "pickup", ware: held.id, progress: 1, target: frame }, true);
        return;
      }
      if (held.id === "fish") {
        placeCarriedFish(prop);
        if (!bakedPose) fishContacts(prop, { direction: "pickup", ware: "fish", progress: 1, target: frame }, true);
        return;
      }
      if (waterBucket) {
        attachWellBucket(prop, frame, bakedPose);
        if (!bakedPose) wellBucketContacts(prop, wellCarryContact, true);
        return;
      }
      const clip = worker.clips.find((candidate) => candidate.name === frame.action);
      if (!clip) return;
      if (held.id === "fishing_rod")
        setTravelRodLine(prop, ["walk", "run", "idle_breathe"].includes(frame.action));
      if (!bakedPose) worker.root.updateMatrixWorld(true);
      if (["walk", "run", "idle_breathe"].includes(frame.action) ||
        frame.workerJob === "Forester" && frame.action === "plant_seedling") {
        attachToHand(prop, "R", bakedPose);
        // Kneeling lowers the hand: grip farther down the shaft so its blade stays at soil level.
        if (frame.workerJob === "Forester" && frame.action === "plant_seedling") prop.position.y += .3;
        if (CARRIED_UPRIGHT_TOOLS.includes(held.id) && frame.action !== "plant_seedling") {
          const hand = joints.get("socket_hand_R") ?? joints.get("hand_R");
          if (hand) walkingHammerGrip(prop, worker.root, hand, held.id, joints.get("hand_R"), bakedPose);
          orientCarriedPickaxe(prop, worker.root, bakedPose);
        }
        if (held.id === "scythe") {
          const hand = joints.get("socket_hand_R") ?? joints.get("hand_R");
          if (hand) walkingScytheGrip(prop, worker.root, hand, bakedPose);
        }
        if (held.id === "fishing_rod") {
          const hand = joints.get("socket_hand_R") ?? joints.get("hand_R");
          if (hand) walkingRodGrip(prop, worker.root, hand, bakedPose);
        }
        return;
      }
      placement.placeWorkerProp(
        prop,
        worker.root,
        joints,
        {
          duration: clip.duration,
          loop: !["plant_seedling", "fish_cast", "fish_reel", "spyglass_scan"].includes(frame.action),
          name: frame.action,
          prop: held.id
        },
        frame.animationTime
      );
      if (!bakedPose) handBlend?.follow(prop, frame.action);
      if (held.id === "meat") foresterHand(prop.getObjectByName("meat_shoulder_support")!);
      if (held.id === "fishing_rod") placeFishingLine(prop, worker.root, frame);
      if (held.id === "hammer" && frame.action === "build_hammer") {
        orientWorkingHammer(prop);
        if (frame.workerJob === "Shipwright") {
          if (frame.shipHullWork) prop.position.y -= .44 / worker.root.scale.y;
          gripToolShaftInFist(prop, worker.root, HAMMER_HAFT_RADIUS * prop.scale.x);
        }
      }
      if (held.id === "pickaxe" && frame.action === "build_hammer") orientWorkingPickaxe(prop);
    },
    visibleProps: () => [...props.values()].filter(prop => prop.visible),
    dispose: () => {
      disposed = true;
      for (const prop of props.values()) disposeProp(prop);
      if (foresterSeedling) disposeProp(foresterSeedling);
      props.clear();
      materials?.release();
      equipment?.release();
    }
  };
};
