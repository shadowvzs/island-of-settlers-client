import { boatTransferBodyPhase } from "./worker-boat-transfer";
import { createNativeHandContacts } from "./worker-native-hand-contacts";
import { setArmourLod, ThreeArmourPack } from "@workers/game-three-armour";
import { ThreeWorkerPack } from "@workers/game-three-worker";
import {
  type Camera,
  Color,
  DirectionalLight,
  Group,
  InstancedMesh,
  LightProbe,
  LoopOnce,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  RingGeometry,
  Scene,
  Skeleton,
  SkinnedMesh,
  type WebGLRenderer,
  WebGLRenderTarget
} from "three";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

import { type EnvironmentState,getSunLightOffset } from "../../render-common/environment";
import { QUALITY_PRESETS } from "../../render-common/quality";
import { COIN_CARGO_VISUALS, HAND_CARRIED_INGREDIENTS } from "../../render-common/wares/ware-catalog";
import { isDrinkWorkAction } from "../../render-common/workers/drink-work-actions";
import { WORKER_ASSET_BASE } from "../../render-common/workers/worker-assets";
import { DEFAULT_WORKER_COLOR, getWorkerColorHex } from "../../render-common/workers/worker-colors";
import { WORKER_SCALE } from "../../render-common/workers/worker-dimensions";
import { createWorkerDisplay } from "../../render-common/workers/worker-display";
import type {
  ExplorationHeroBody, WorkerAppearance, WorkerFrame
} from "../../render-common/workers/worker-unit";
import { createVisibleWorkerPool } from "../../render-common/workers/worker-visible-pool";
import { createBuildingHover } from "./buildings/building-hover";
import { addCharacterStage, characterClock, characterProfileEnabled } from "./character-profile";
import {
  characterShadowScore,
  createShadowCasterSelection,
  type ShadowCaster,
  type ShadowCasterSelection
} from "./character-shadow-casters";
import { setSkeletonsGated } from "./character-skeleton-gate";
import {
  CHARACTER_CROWD_PIXELS, characterCastsShadow, characterShadowWidening, type CharacterTierPolicy
} from "./character-tier-policy";
import { createDelayedRelease } from "./delayed-release";
import { createSharedExplorationBodyLoader } from "./exploration/exploration-appearance";
import { ENEMY_LIVERY, setMilitaryLiveryColor } from "./military-equipment";
import { applySkyEnvironment } from "./sky-environment";
import { createSkyLightProbe } from "./sky-light-probe";
import { meshMaterials } from "./three-mesh-resources";
import { type CastSunShadows, createCasterRootScene } from "./three-shadows";
import { createWorkerProp } from "./three-worker-prop";
import { createUnitEyeOffset } from "./unit-eye-offset";
import {
  createWorkerAnimationBudget,
  updateWorkerAnimation,
  type WorkerAnimationBudget,
  type WorkerCadenceBias,
  workerScreenFraction
} from "./worker-animation-budget";
import { createWorkerBanditAccessories } from "./worker-bandit-accessories";
import { createWorkerBodyPool, type PooledWorker } from "./worker-body-pool";
import { createWorkerCatapultHands } from "./worker-catapult-hands";
import { createWorkerCatapultStairTuck } from "./worker-catapult-stair-tuck";
import { createWorkerCatapultSupport } from "./worker-catapult-support";
import { createWorkerCombatPose } from "./worker-combat-pose";
import { createWorkerDetail } from "./worker-detail";
import { createWorkerDrinkWork } from "./worker-drink-work";
import { createWorkerFade } from "./worker-fade";
import { createWorkerFallPose } from "./worker-fall-pose";
import { farPropPlacementDue, farPropsEnabled } from "./worker-far-props-mode";
import { createFarmerSowing } from "./worker-farmer-sow";
import { resetFishHandContacts } from "./worker-fish-carry";
import { resetForesterHand } from "./worker-forester-seedling";
import { createCrowdInstances, type CrowdInstances } from "./worker-gpu-instances";
import { createGpuCrowdMember } from "./worker-gpu-member";
import { crowdGpuEnabled } from "./worker-gpu-mode";
import { crowdNeedsSkinned, crowdSkinnedReason } from "./worker-gpu-pose";
import { createHandBlendTracker, type HandBlendTracker } from "./worker-hand-blend";
import { createWorkerHandcartPull } from "./worker-handcart-grip";
import { createWorkerHorseLead } from "./worker-horse-lead";
import { createLoadedLocomotion } from "./worker-loaded-locomotion";
import { createBoatHandContacts } from "./worker-boat-hand-contacts";
import { createFisherBoarding } from "./worker-fisher-boarding";
import { explorationPrewarmLevels } from "./worker-lod-sources";
import { createWorkerNationalHeadwear } from "./worker-national-headwear";
import { createTravelRodHand } from "./worker-natural-rod";
import { createWorkerPackAssets, type WorkerPackAssets } from "./worker-pack-assets";
import { createCarriedPickaxeHand } from "./worker-pickaxe-hand";
import { recordPlantationHands } from "./worker-plantation-contact";
import { createWorkerPoseTransition } from "./worker-pose-transition";
import { individualWorkerRings } from "./worker-ring-mode";
import { isSoftHandLoad, SOFT_HAND_LOADS } from "./worker-soft-carry";
import { resetSoftLoadHandContacts } from "./worker-soft-load-contacts";
import { createWorkerStance } from "./worker-stance";
import { resetStoneHandContacts } from "./worker-stone-carry";
import { createStonePickupLean } from "./worker-stone-lean";
import { createWorkerStrikeBody } from "./worker-strike-body";
import { createTabletopTransferReach } from "./worker-tabletop-reach";
import { createWorkerTerrainFeet, type WorkerGroundHeight } from "./worker-terrain-feet";
import { workerTransferMaterialAction } from "./worker-transfer-pose";
import { createWorkerViewCull } from "./worker-view-cull";
import { transferCarryAction, transferCarryWeight } from "./worker-ware-transfer";
import { createWellBucketPickupLean, resetWellBucketHandContacts } from "./worker-well-bucket-contact";
import { createWorkerWellCrank } from "./worker-well-crank";
import { createWorkerWindowPose } from "./worker-window-pose";

type LoadedWorker = Awaited<ReturnType<ThreeWorkerPack["load"]>>;

/**
 * This frame's view, shared by every member of one crowd and refilled in `update` (no per-actor
 * allocation): the camera, the drawing buffer height for projected sizes, the presentation clock
 * the per-level member counts and the sun shadow caster candidates of the frame.
 */
interface CrowdView {
  camera?: Camera;
  casters: ShadowCasterSelection;
  /** Groups of this frame's chosen casters: the only subtrees the sun pass traverses (reused list). */
  castingGroups: Object3D[];
  /** Chosen casters drawn wider into the shadow map this frame (reused list). */
  widened: WidenedCaster[];
  /** Members posed by the GPU crowd this frame (C06). */
  gpuCount: number;
  /** Profiling only: LOD3 members kept skinned this frame, by reason (receipt counter). */
  gpuSkipped: Map<string, number>;
  /** The hovered actor keeps its skinned body: the hover outline traverses its meshes. */
  hoveredId: number | null;
  lodCounts: [number, number, number, number];
  policy: CharacterTierPolicy;
  /** C02 (f): skinned members whose bone-matrix update is gated this frame (receipt counter). */
  skeletonsGated: number;
  time: number;
  viewportHeight: number;
}

/** CPU time per frame the chunked bone-matrix bake of a newly seen body type may take (C06). */
const CROWD_BAKE_BUDGET_MS = 1.5;

/** A casting member's root and its shadow-pass horizontal scale (characterShadowWidening). */
interface WidenedCaster {
  root: Object3D;
  width: number;
}

export interface WorkerCrowdOptions {
  /** C13 live pose-cadence lever of the budget controller, shared across crowd replacements. */
  cadenceBias?: WorkerCadenceBias;
  /** C03/C05 character policy of the active preset (LOD floor and shadow budgets). */
  characters?: CharacterTierPolicy;
}

/**
 * Ground rings shared by every worker: the selection ring and the soft contact shadow. C02 draws
 * each of them as one `InstancedMesh` for the whole crowd, so a worker costs no ring draw at all.
 */
const createGroundRings = () => {
  const selectionGeometry = new RingGeometry(0.22, 0.27, 48);
  const selectionMaterial = new MeshBasicMaterial({
    color: 0xffd15c,
    depthWrite: false,
    opacity: 0.95,
    transparent: true
  });
  const targetGeometry = new RingGeometry(0.27, 0.34, 48);
  const targetMaterial = new MeshBasicMaterial({
    color: 0xe0281c,
    depthWrite: false,
    opacity: 0.95,
    transparent: true
  });
  const shadowGeometry = new RingGeometry(0, 0.21, 32);
  const shadowMaterial = new MeshBasicMaterial({
    color: 0x252017,
    depthWrite: false,
    opacity: 0.18,
    transparent: true
  });
  const createRingInstances = (
    geometry: RingGeometry, material: MeshBasicMaterial, capacity: number, name: string
  ) => {
    const rings = new InstancedMesh(geometry, material, capacity);
    rings.count = 0;
    rings.name = name;
    return rings;
  };
  const createRing = (geometry: RingGeometry, material: MeshBasicMaterial, height: number, name: string) => {
    const ring = new Mesh(geometry, material);
    ring.name = name;
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = height;
    return ring;
  };
  return {
    /** C02 rollback (`?rings=individual`): one selection ring mesh per worker. */
    createSelection: () => createRing(selectionGeometry, selectionMaterial, 0.018, "worker_selection_ring"),
    /** C02 rollback (`?rings=individual`): one contact-shadow mesh per worker. */
    createShadow: () => createRing(shadowGeometry, shadowMaterial, 0.006, "worker_contact_shadow"),
    /** C02: every contact shadow (skinned and GPU crowd members) in one draw. */
    createShadowInstances: (capacity: number) =>
      createRingInstances(shadowGeometry, shadowMaterial, capacity, "worker_contact_shadow_instances"),
    /** C02: every selection ring in one draw (none visible: the batch draws nothing). */
    createSelectionInstances: (capacity: number) =>
      createRingInstances(selectionGeometry, selectionMaterial, capacity, "worker_selection_ring_instances"),
    /** targetMilitary: every chased enemy's red ring in one draw (none chased: the batch draws nothing). */
    createTargetInstances: (capacity: number) =>
      createRingInstances(targetGeometry, targetMaterial, capacity, "worker_target_ring_instances"),
    dispose: () => {
      targetGeometry.dispose();
      targetMaterial.dispose();
      selectionGeometry.dispose();
      selectionMaterial.dispose();
      shadowGeometry.dispose();
      shadowMaterial.dispose();
    },
    setShadowStrength: (strength: number) => {
      shadowMaterial.opacity = 0.18 * strength;
    }
  };
};

const POSE_BLEND_SECONDS = .2;
const CARRIED_IN_HANDS = [...SOFT_HAND_LOADS, ...COIN_CARGO_VISUALS, "water", "fish", "stone", "marble", "bread", "iron", ...HAND_CARRIED_INGREDIENTS];
/** Pose families: switching between them blends; within one (e.g. a walk/run mix) it is continuous. */
const workerPoseKey = (frame: WorkerFrame) => {
  if (frame.wareTransfer) return "transfer";
  if (frame.action === "walk" || frame.action === "run" || CARRIED_IN_HANDS.includes(frame.carryingWare ?? ""))
    return `locomotion:${frame.combat ? "combat" : "civil"}`;
  return frame.action;
};

/** Poses one skinned worker from its frame: idle clip or the shared walk / run crossfade. */
export const createWorkerPoser = (worker: LoadedWorker, handBlend?: HandBlendTracker) => {
  const loaded = createLoadedLocomotion(worker);
  const boatHands = createBoatHandContacts(worker.root);
  const combat = createWorkerCombatPose(worker.root, worker.clips);
  const windowPose = createWorkerWindowPose(worker.root);
  const stance = createWorkerStance(worker.root);
  const transition = createWorkerPoseTransition(worker.root);
  const horseLead = createWorkerHorseLead(worker.root);
  const handcartPull = createWorkerHandcartPull(worker.root);
  const catapultHands = createWorkerCatapultHands(worker.root);
  const stairTuck = createWorkerCatapultStairTuck(worker.root);
  const wellCrank = createWorkerWellCrank(worker.root);
  const tabletopReach = createTabletopTransferReach(worker.root);
  const wellPickupLean = createWellBucketPickupLean(worker.root);
  const strikeBody = createWorkerStrikeBody(worker.root);
  const farmerSowing = createFarmerSowing(worker.root);
  const drinkWork = createWorkerDrinkWork(worker.root);
  const pickaxeHand = createCarriedPickaxeHand(worker.root, worker.clips);
  const rodHand = createTravelRodHand(worker.root, worker.clips);
  const stonePickupLean = createStonePickupLean(worker.root);
  const fallPose = createWorkerFallPose(worker.root);
  const clipAction = (name: string) =>
    worker.mixer.clipAction(worker.clips.find((clip) => clip.name === name)!);
  const walk = clipAction("walk"),
    run = clipAction("run");
  let playing = "";
  const play = (name: string) => {
    if (name === playing) return;
    worker.mixer.stopAllAction();
    if (name === "locomotion") {
      walk.play();
      run.play();
    } else if (name.startsWith("transfer:")) {
      const [, material, carry] = name.split(":");
      clipAction(material!).reset().play();
      clipAction(carry!).reset().play();
    } else {
      const action = clipAction(name).reset();
      if (["spyglass_scan", "boat_lift", "boat_putdown", "boat_launch", "boat_beach", "fish_basket_pickup"].includes(name)) {
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      action.play();
    }
    playing = name;
  };
  /** Walk and run share one phase (left touchdown at 0), so the crossfade keeps the step. */
  const poseLocomotion = (frame: WorkerFrame) => {
    play("locomotion");
    walk.setEffectiveWeight(1 - frame.runBlend);
    run.setEffectiveWeight(frame.runBlend);
    walk.time = (frame.catapultReverseWalk ? 1 - frame.gaitPhase : frame.gaitPhase) * walk.getClip().duration;
    run.time = frame.gaitPhase * run.getClip().duration;
    worker.mixer.update(0);
    sampledPose.capture();
    stance.update(frame.runBlend);
    pickaxeHand.apply(frame);
    rodHand.apply(frame);
    horseLead.apply(frame);
    handcartPull.apply(frame);
    combat.apply(frame);
  };
  const stateBlend = createWorkerPoseTransition(worker.root);
  /**
   * The clip pose before any procedural layer (stance, IK, blends). Three's mixer only writes a
   * bone whose sampled value changed, so a layer's edit of a bone the next clip holds still (an
   * idle's legs) would stay for good: every frame starts again from the last sampled pose.
   */
  const sampledPose = createWorkerPoseTransition(worker.root);
  let blendKey = "", blendStart = -Infinity;
  /** Any change of pose state (walk to chop, work to idle, ...) blends instead of snapping. */
  const blendIntoPose = (frame: WorkerFrame) => {
    stairTuck.reset();
    const key = workerPoseKey(frame), now = performance.now() / 1000;
    if (key !== blendKey) {
      // Transfers ease in on their own; the first pose of a worker has nothing to blend from.
      if (blendKey && key !== "transfer") { stateBlend.capture(); blendStart = now; }
      blendKey = key;
    }
    poseFrame(frame);
    windowPose(frame);
    const fraction = (now - blendStart) / POSE_BLEND_SECONDS;
    const blending = key !== "transfer" && fraction < 1;
    if (blending) handBlend?.before();
    if (key !== "transfer") stateBlend.blend(fraction);
    handBlend?.after(blending);
    stairTuck.apply(frame);
    if (frame.fisherBoatHands) boatHands.world(frame.fisherBoatHands);
    // The final palms stay on the physical handle even while the preceding clip crossfades.
    catapultHands.apply(frame);
  };
  const poseFrame = (frame: WorkerFrame) => {
    stairTuck.reset();
    sampledPose.restore();
    combat.reset();
    horseLead.reset();
    handcartPull.reset();
    catapultHands.reset();
    resetStoneHandContacts(worker.root);
    resetSoftLoadHandContacts(worker.root);
    resetFishHandContacts(worker.root);
    resetForesterHand(worker.root);
    resetWellBucketHandContacts(worker.root);
    wellPickupLean.reset(frame);
    tabletopReach.reset();
    wellCrank.reset();
    strikeBody.reset();
    farmerSowing.reset(frame);
    pickaxeHand.reset();
    rodHand.reset();
    stonePickupLean.reset();
    if (frame.wareTransfer?.ware === "boat" && frame.fisherBoatYard) {
      const lift = frame.wareTransfer.direction === "pickup" ? frame.wareTransfer.progress : 1 - frame.wareTransfer.progress;
      play("boat_lift");
      worker.mixer.setTime(.216 + Math.max(0, Math.min(1, lift)) * 1.2 * .82);
      sampledPose.capture();
      return;
    }
    if (frame.wareTransfer) {
      const carry = [...SOFT_HAND_LOADS, "water", "fish", "stone", "marble", "bread", ...HAND_CARRIED_INGREDIENTS].includes(frame.wareTransfer.ware)
        ? "idle_breathe" : transferCarryAction(frame);
      const material = workerTransferMaterialAction(frame);
      const state = `transfer:${material}:${carry}`;
      if (playing !== state) transition.capture();
      play(state);
      const weight = transferCarryWeight(frame.wareTransfer);
      const materialAction = clipAction(material), carryAction = clipAction(carry);
      if (material === carry) {
        materialAction.setEffectiveWeight(1); materialAction.time = 0;
      } else {
        materialAction.setEffectiveWeight(1 - weight);
        const inputProgress = Math.min(.999, frame.wareTransfer.progress);
        const materialProgress = frame.wareTransfer.ware === "boat"
          ? frame.wareTransfer.direction === "pickup" ? boatTransferBodyPhase(inputProgress)
            : 1 - boatTransferBodyPhase(1 - inputProgress) : inputProgress;
        materialAction.time = materialProgress * materialAction.getClip().duration;
        carryAction.setEffectiveWeight(weight); carryAction.time = 0;
      }
      worker.mixer.update(0);
      sampledPose.capture();
      transition.ease(frame.wareTransfer.progress);
      wellPickupLean.apply(frame);
      tabletopReach.apply(frame);
      stonePickupLean.apply(frame);
      return;
    }
    if (CARRIED_IN_HANDS.includes(frame.carryingWare ?? "") && frame.action !== "fish_basket_pickup") {
      if (frame.catapultTuckedCarry || isSoftHandLoad(frame.carryingWare) && frame.standingCarry) {
        play("idle_breathe"); worker.mixer.setTime(frame.animationTime); sampledPose.capture(); stance.update(0); return;
      }
      poseLocomotion(frame);
      return;
    }
    if (frame.action === "carry_overhead_boat") {
      play(frame.action);
      worker.mixer.setTime(frame.standingCarry ? 0 : frame.gaitPhase * 1.4);
      sampledPose.capture();
      stance.update(0);
      return;
    }
    if (frame.action === "carry_shoulder" || frame.action === "carry_back") {
      const state = `loaded:${frame.action}`;
      if (playing !== state) worker.mixer.stopAllAction();
      playing = state;
      loaded.update(frame);
      sampledPose.capture();
      stance.update(frame.runBlend);
      return;
    }
    if (frame.action === "walk" || frame.action === "run") return poseLocomotion(frame);
    play(isDrinkWorkAction(frame.action) || frame.wellWork?.style === "hand-rope" ? "idle_breathe" : frame.action);
    // The wall-stowed gunwale is waist-high; avoid the ground-lift crouch
    // that would put the fisher's head through the waiting hull.
    const actionTime = frame.fisherBoatYard ? .216 + Math.max(0, Math.min(1.2, frame.animationTime)) * .82
      : frame.action === "boat_lift" ? 1.2 * boatTransferBodyPhase(frame.animationTime / 1.2)
        : frame.action === "boat_putdown" ? 1.2 * (1 - boatTransferBodyPhase(1 - frame.animationTime / 1.2))
          : frame.animationTime;
    worker.mixer.setTime(actionTime);
    sampledPose.capture();
    fallPose(frame);
    strikeBody.apply(frame);
    farmerSowing.apply(frame);
    drinkWork(frame);
    pickaxeHand.apply(frame);
    rodHand.apply(frame);
    wellCrank(frame.wellWork);
    horseLead.apply(frame);
    handcartPull.apply(frame);
    combat.apply(frame);
  };
  return blendIntoPose;
};

/** One worker in the crowd scene: its model, held prop, instanced rings and skeletal work. */
const createCrowdMember = (
  worker: PooledWorker,
  pack: ThreeWorkerPack,
  shared: WorkerPackAssets,
  rings: ReturnType<typeof createGroundRings>,
  detailed: boolean,
  budget: WorkerAnimationBudget,
  view: CrowdView,
  instances: CrowdInstances,
  groundHeight?: WorkerGroundHeight,
  bridgeHeight?: (x: number, z: number) => number | undefined
) => {
  const group = new Group();
  // Before any prop, headwear or accessory joins the root: the swap hides only the body meshes.
  const detail = createWorkerDetail(worker, view.policy);
  if (!detailed) worker.root.traverse(object => {
    if (!(object instanceof Mesh) || !object.name.startsWith("armour_")) return;
    for (const material of meshMaterials(object)) {
      if (!(material instanceof MeshStandardMaterial)) continue;
      material.normalMap = null; material.roughnessMap = null; material.metalnessMap = null;
      material.aoMap = null; material.roughness = .72; material.metalness = .15;
    }
  });
  const handBlend = createHandBlendTracker(worker.root);
  const prop = createWorkerProp(pack, worker, detailed, handBlend, shared);
  const nativeContacts = createNativeHandContacts(worker.root, worker.clips);
  const bandit = createWorkerBanditAccessories(worker.root, detailed);
  const headwear = createWorkerNationalHeadwear(worker.root, detailed);
  /** The current tunic colour (livery or player colour): the GPU instance's tint. */
  const tint = new Color();
  const applyTeamColor = (color: string | number) => {
    tint.set(color);
    worker.setTeamColor(color);
  };
  applyTeamColor(getWorkerColorHex(DEFAULT_WORKER_COLOR));
  worker.root.scale.setScalar(WORKER_SCALE);
  // C02 rollback (`?rings=individual`): one selection/contact ring mesh per worker, as before.
  const individualRings = individualWorkerRings();
  const selection = individualRings ? rings.createSelection() : undefined;
  const shadowRing = individualRings ? rings.createShadow() : undefined;
  group.add(worker.root);
  if (selection) group.add(selection, shadowRing!);
  const eyeOffset = createUnitEyeOffset(worker.root, group);
  const pose = createWorkerPoser(worker, handBlend);
  const boarding = createFisherBoarding(worker);
  const gpu = createGpuCrowdMember(worker, detail, instances);
  const catapultSupport = createWorkerCatapultSupport(worker.root);
  const terrainFeet = groundHeight ? createWorkerTerrainFeet(worker.root, groundHeight) : undefined;
  const animation = budget.newState();
  const fade = createWorkerFade(group);
  // C02 (f): the actor's bone matrices are gated on frames without a pose while it stands still.
  const skeletons = new Set<Skeleton>();
  worker.root.traverse(object => { if (object instanceof SkinnedMesh) skeletons.add(object.skeleton); });
  let skeletonGated = false;
  let rootMoved = true;
  let lastX = NaN, lastY = NaN, lastZ = NaN, lastRootY = NaN, lastLean = NaN, lastHeading = NaN;
  /** C02 (f): gates the bone-texture update on a frame without a pose while the actor stands still. */
  const gateSkeletons = (gate: boolean) => {
    if (gate === skeletonGated) return;
    skeletonGated = gate;
    setSkeletonsGated(skeletons, gate);
  };
  let lastColor: number | undefined;
  const widened: WidenedCaster = { root: worker.root, width: 1 };
  /** Chosen by the crowd's budget; a small figure is widened in the shadow pass (castShadows). */
  const caster: ShadowCaster = {
    setCaster: casting => {
      detail.setCaster(casting);
      if (!casting) return;
      view.castingGroups.push(group);
      if (widened.width > 1) view.widened.push(widened);
    }
  };
  /** Motion, selection, ground rings and cached livery stay per-frame; they are cheap and visible. */
  const present = (frame: WorkerFrame) => {
    const startedAt = characterClock();
    boarding.reset();
    const deck = bridgeHeight?.(frame.x, frame.z);
    group.position.set(frame.x, (deck ?? frame.y) + 0.005, frame.z);
    catapultSupport.present(frame);
    worker.root.rotation.set(frame.lean ?? 0, frame.heading, 0, "YXZ");
    fade.set(frame.fade ?? 1);
    // C02 (f): a frame without a pose may still move the actor; only a still root keeps its bones.
    rootMoved = group.position.x !== lastX || group.position.y !== lastY || group.position.z !== lastZ ||
      worker.root.position.y !== lastRootY || worker.root.rotation.x !== lastLean ||
      worker.root.rotation.y !== lastHeading;
    lastX = group.position.x; lastY = group.position.y; lastZ = group.position.z;
    lastRootY = worker.root.position.y; lastLean = worker.root.rotation.x; lastHeading = worker.root.rotation.y;
    group.updateWorldMatrix(true, false);
    if (selection) selection.visible = frame.selected === true;
    else if ((frame.fade ?? 1) >= 1) {
      // C02: both rings join the crowd's instanced batches; a fading carrier is left out so no
      // ghost ring stays behind (an individual ring mesh would fade with the body).
      const place = group.matrixWorld.elements;
      instances.pushRing(place[12]!, place[13]!, place[14]!);
      if (frame.selected) instances.pushSelectionRing(place[12]!, place[13]!, place[14]!);
      if (frame.targeted) instances.pushTargetRing(place[12]!, place[13]!, place[14]!);
    }
    let color: number | undefined;
    if (frame.combat?.faction) color = frame.combat.bandit?.cloth ?? ENEMY_LIVERY;
    else if (frame.fallenBandit) color = frame.fallenBandit.cloth;
    if (color !== undefined && color !== lastColor) applyTeamColor(color);
    lastColor = color;
    addCharacterStage("present", startedAt);
  };
  /**
   * World-space hand, prop, accessory and contact work; shared by both pose paths. `bakedPose`
   * marks the GPU crowd path: the baked bones are current, so the far props skip the hand IK
   * contacts (they only shape the undrawn skinned body) and the forced world updates (C06b).
   * `hold` keeps the previous far placement on an off-cadence pose (see `farPropHoldable`).
   */
  const attachments = (frame: WorkerFrame, startedAt: number, bakedPose = false, hold = false) => {
    prop.update(frame, { bakedPose, hold });
    if (nativeContacts.enabled) nativeContacts.finish(frame, prop.visibleProps(), bakedPose);
    bandit.update(frame, bakedPose);
    headwear.update(frame);
    recordPlantationHands(worker.root, frame);
    addCharacterStage("props", startedAt);
  };
  const work = {
    present,
    /** Skeletal pose and all world-space hand/prop work: the part the screen budget gates. */
    animate: (frame: WorkerFrame) => {
      let startedAt = characterClock();
      pose(frame);
      boarding.apply(frame);
      startedAt = addCharacterStage("pose", startedAt);
      catapultSupport.capture(frame);
      terrainFeet?.(frame);
      attachments(frame, addCharacterStage("ik", startedAt));
    }
  };
  // C06b far-prop cadence: the first GPU frame after a hand-over places; holdable poses then place
  // on every second due pose and hold the placement in between.
  let farPropTick = 0;
  let forceFarPlacement = false;
  let lastFarPoseKey = "";
  /** C06: the GPU draws the body; the CPU only places the instance and, on cadence, the sockets. */
  const gpuWork = {
    present: (frame: WorkerFrame) => {
      present(frame);
      gpu!.push(tint);
    },
    animate: (frame: WorkerFrame) => {
      const startedAt = characterClock();
      gpu!.poseSockets();
      const far = farPropsEnabled();
      const poseKey = workerPoseKey(frame);
      const poseChanged = poseKey !== lastFarPoseKey;
      lastFarPoseKey = poseKey;
      // The cadence only says which frames are off; the prop decides whether its pose can hold.
      const hold = far && !forceFarPlacement && !poseChanged && !farPropPlacementDue(farPropTick);
      farPropTick++;
      attachments(frame, addCharacterStage("pose", startedAt), far, hold);
    }
  };
  /** Far, small, not casting, not selected or hovered, steady and in a baked pose state (D-C4). */
  const gpuEligible = (frame: WorkerFrame, pixels: number) =>
    gpu !== undefined && crowdGpuEnabled() && detail.level() === 3 && pixels < CHARACTER_CROWD_PIXELS &&
    !characterCastsShadow(pixels, view.policy) && (frame.fade ?? 1) >= 1 && frame.actorId !== undefined &&
    frame.actorId !== view.hoveredId && !crowdNeedsSkinned(frame);
  /** Profiling receipt: why a LOD3 member stayed skinned this frame. */
  const countSkipped = (frame: WorkerFrame, pixels: number) => {
    let reason = crowdSkinnedReason(frame) ?? `bake:${frame.action}`;
    if (!crowdGpuEnabled()) reason = "off";
    else if (pixels >= CHARACTER_CROWD_PIXELS || characterCastsShadow(pixels, view.policy)) reason = "size";
    else if (frame.actorId === view.hoveredId || (frame.fade ?? 1) < 1) reason = "hover/fade";
    view.gpuSkipped.set(reason, (view.gpuSkipped.get(reason) ?? 0) + 1);
  };
  return {
    group,
    eyeOffset,
    setColor: (color: string) => {
      // The player colour replaces livery; let the next combat frame reapply the bandit colour.
      lastColor = undefined;
      applyTeamColor(color);
    },
    update: (frame: WorkerFrame | undefined) => {
      group.visible = !!frame && frame.visible !== false;
      if (!frame || frame.visible === false) { budget.offscreen(animation, frame ?? undefined); return; }
      const wasOnGpu = gpu?.isActive() ?? false;
      let onGpu = false;
      if (view.camera) {
        const pixels = workerScreenFraction(view.camera, frame.x, frame.y, frame.z) * view.viewportHeight;
        detail.update(pixels, view.time);
        widened.width = characterShadowWidening(pixels);
        if (!characterCastsShadow(pixels, view.policy)) detail.setCaster(false);
        else view.casters.offer(caster, characterShadowScore(view.camera, frame.x, frame.y, frame.z, pixels));
        onGpu = gpuEligible(frame, pixels) && gpu!.resolve(frame, view.time);
        if (!onGpu && gpu && detail.level() === 3 && characterProfileEnabled()) countSkipped(frame, pixels);
      }
      if (!onGpu) gpu?.leave();
      else view.gpuCount++;
      view.lodCounts[detail.level()]++;
      const active = onGpu ? gpuWork : work;
      // The first GPU frame after a hand-over always places the far props, whatever its cadence phase.
      if (onGpu && !wasOnGpu) forceFarPlacement = true;
      const posed = updateWorkerAnimation(budget, animation, frame, active);
      // A hand-over between the paths poses at once: no stale skeleton or lagging prop for a cadence gap.
      const handedOver = !posed && wasOnGpu !== onGpu;
      if (handedOver) active.animate(frame);
      forceFarPlacement = false;
      gateSkeletons(!onGpu && !posed && !handedOver && !rootMoved);
      if (skeletonGated) view.skeletonsGated++;
    },
    /** Leaves the frustum: its next entry refreshes promptly on the stable cadence phase. */
    offscreen: () => budget.offscreen(animation),
    /** C02 (c): reset the presentation while the pool keeps this body for a later re-entry. */
    park: () => {
      fade.set(1);
      budget.offscreen(animation);
    },
    /** C11: a camera jump applies the newly projected LOD at once instead of after the hold. */
    refreshDetail: () => detail.refresh(),
    dispose: () => {
      gateSkeletons(false);
      fade.dispose();
      nativeContacts.dispose();
      prop.dispose();
      bandit.dispose();
      headwear.dispose();
      worker.root.userData.disposeHorseLead?.();
      gpu?.dispose();
      detail.dispose();
      worker.dispose();
    }
  };
};

/** Swap equipment only when a job/tier changes; preserve a visible body during asynchronous loads. */
const createEquippedMember = (
  worker: PooledWorker,
  appearance: WorkerAppearance,
  pack: ThreeWorkerPack,
  shared: WorkerPackAssets,
  bodies: ReturnType<typeof createWorkerBodyPool>,
  rings: ReturnType<typeof createGroundRings>,
  detailed: boolean,
  budget: WorkerAnimationBudget,
  crowdView: CrowdView,
  instances: CrowdInstances,
  initialRank?: WorkerFrame["armourRank"],
  groundHeight?: WorkerGroundHeight,
  bridgeHeight?: (x: number, z: number) => number | undefined,
  view?: { contains(x: number, y: number, z: number): boolean; scene: Scene },
) => {
  const group = new Group();
  const display = createWorkerDisplay(
    createCrowdMember(worker, pack, shared, rings, detailed, budget, crowdView, instances, groundHeight,
      bridgeHeight),
    async (rank: WorkerFrame["armourRank"]) => {
      const loaded = await bodies.load(appearance, rank);
      setArmourLod(loaded.root, detailed ? 0 : 1);
      return createCrowdMember(loaded, pack, shared, rings, detailed, budget, crowdView, instances, groundHeight,
        bridgeHeight);
    },
    member => { group.clear(); group.add(member.group); },
  );
  let requested = initialRank;
  return {
    group,
    root: group,
    eyeOffset: () => display.current?.eyeOffset(),
    refreshDetail: () => display.current?.refreshDetail(),
    setColor: display.setColor,
    update: (frame: WorkerFrame | undefined) => {
      if (frame && requested !== frame.armourRank) {
        requested = frame.armourRank;
        void display.replace(requested).catch(error => {
          console.warn(`Soldier equipment could not load for ${appearance.variant}`, error);
        });
      }
      // Off-screen: out of the scene graph too, so its bones skip the matrix update.
      const viewY = frame ? bridgeHeight?.(frame.x, frame.z) ?? frame.y : 0;
      const offScreen = view && frame && frame.visible !== false && !view.contains(frame.x, viewY, frame.z);
      if (offScreen) { display.current?.offscreen(); group.removeFromParent(); return; }
      if (view && !group.parent) view.scene.add(group);
      display.current?.update(frame);
    },
    /** C02 (c): the pool keeps this body for a later re-entry instead of disposing it. */
    park: () => { display.current?.park(); group.removeFromParent(); },
    dispose: () => { display.dispose(); group.removeFromParent(); },
  };
};

/**
 * The workers' own light: the shared SH9 sky, the sun colour and the sun direction, plus the sky
 * environment reflection on Medium+.
 */
export const createCrowdLights = (scene: Scene) => {
  const sky = createSkyLightProbe(),
    sun = new DirectionalLight(0xfff1dd, 2.3);
  scene.add(sky.probe, sun, sun.target);
  return (environment: EnvironmentState) => {
    sky.update(environment);
    applySkyEnvironment(scene);
    sun.color.fromArray(environment.sunColor);
    const [x, y, z] = getSunLightOffset(environment.sun, 10);
    sun.position.set(sun.target.position.x + x, sun.target.position.y + y, sun.target.position.z + z);
  };
};

/**
 * The KTX2 (Basis) texture loader of the workers' pack: one per renderer, its transcoder served
 * under `workers/basis/` (tools/worker-assets-plugin.ts).
 */
export const createWorkerTextureLoader = (renderer: WebGLRenderer) =>
  new KTX2Loader().setTranscoderPath(`${WORKER_ASSET_BASE}basis/`).detectSupport(renderer);

/** Side of the off-screen target that warms the possession entry's hero bodies (C11). */
const HERO_PREWARM_TARGET_SIZE = 16;
/** Hero resources leave after the return transition, never in its first frame (C11). */
const HERO_RELEASE_DELAY_MS = 2500;

/** Resolves after the next painted frame (or a hidden tab's timeout). */
const afterPaint = () => new Promise<void>(resolve => {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    resolve();
  };
  requestAnimationFrame(() => requestAnimationFrame(finish));
  setTimeout(finish, 150);
});

/**
 * Draws the preloaded hero bodies once into a tiny off-screen target. The first draw is where the
 * driver compiles their skinned, shadow-receiving and crowd program variants and uploads geometry,
 * textures and skeletons; `compileAsync` alone does neither the uploads nor guarantee the crowd's
 * light variant (program keys follow the last rendered scene's light counts). Drawing the probe
 * scene updates that light state itself, so the first possessed frame finds every resource
 * resident. The probe repeats the crowd's light rig for exactly that reason.
 */
const warmExplorationHeroes = async (
  renderer: WebGLRenderer,
  camera: Camera,
  scene: Scene,
  probes: readonly Object3D[]
) => {
  const probeScene = new Scene();
  probeScene.environment = scene.environment;
  probeScene.environmentIntensity = scene.environmentIntensity;
  probeScene.add(new LightProbe(undefined, 1), new DirectionalLight());
  const group = new Group();
  group.name = "exploration_hero_prewarm";
  group.add(...probes);
  probeScene.add(group);
  // The bodies sit in their bind pose off the current iso view: draw them regardless, then
  // restore the culling flag the actor instances copy from their template.
  const culling: { frustumCulled: boolean; object: Object3D }[] = [];
  for (const probe of probes) probe.traverse(object => {
    culling.push({ frustumCulled: object.frustumCulled, object });
    object.frustumCulled = false;
  });
  const target = new WebGLRenderTarget(HERO_PREWARM_TARGET_SIZE, HERO_PREWARM_TARGET_SIZE);
  const previousTarget = renderer.getRenderTarget();
  try {
    await afterPaint();
    renderer.setRenderTarget(target);
    renderer.render(probeScene, camera);
  } finally {
    renderer.setRenderTarget(previousTarget);
    target.dispose();
    for (const entry of culling) entry.object.frustumCulled = entry.frustumCulled;
    for (const probe of probes) probe.removeFromParent();
  }
};

/**
 * The player's workers in one scene drawn in one pass: the Tripo3D bodies of the pack
 * (`workers/tripo/`, Basis textures), each worker with its own skinned model and clips.
 */
export const createThreeWorkerCrowd = async (
  textures: KTX2Loader,
  appearances: readonly WorkerAppearance[],
  detailed = true,
  groundHeight?: WorkerGroundHeight,
  bridgeHeight?: (x: number, z: number) => number | undefined,
  options: WorkerCrowdOptions = {}
) => {
  const policy = options.characters ?? QUALITY_PRESETS.high.characters;
  const pack = new ThreeWorkerPack(`${WORKER_ASSET_BASE}tripo/`, textures, !detailed);
  const armour = new ThreeArmourPack(`${WORKER_ASSET_BASE}armour/`, pack, !detailed);
  const shared = createWorkerPackAssets(pack);
  const bodies = createWorkerBodyPool(pack, armour, shared,
    { armourBase: `${WORKER_ASSET_BASE}armour/`, detailed, lodMax: policy.lodMax, soldierLodMax: policy.soldierLodMax });
  const crowdView: CrowdView = {
    casters: createShadowCasterSelection(), castingGroups: [], gpuCount: 0, gpuSkipped: new Map(), hoveredId: null,
    lodCounts: [0, 0, 0, 0], policy, skeletonsGated: 0, time: 0, viewportHeight: 1, widened: []
  };
  const drawn = { calls: 0, triangles: 0 };

  // Stable identity: the exploration live loader can tell whether its pool was replaced.
  const explorationBodyLoader = createSharedExplorationBodyLoader(bodies);
  const rings = createGroundRings();
  const scene = new Scene();
  const instances = createCrowdInstances(scene, rings);
  const castRoots = createCasterRootScene();
  const hover = createBuildingHover(scene, {
    local: true,
    name: "worker_hover_outline",
    // Caster-only LOD2 proxies (sun shadow layer alone) are not part of the drawn body.
    exclude: mesh => mesh.name === "worker_selection_ring" || mesh.name === "worker_contact_shadow" ||
      !mesh.layers.isEnabled(0)
  });
  const cull = createWorkerViewCull();
  const budget = createWorkerAnimationBudget(options.cadenceBias);
  const heroReleases = createDelayedRelease(HERO_RELEASE_DELAY_MS);
  /** C11: the next update is the first possessed frame of this visit. */
  let refreshExploration = false;
  /** C11 receipt: wall time of the last possession entry's hero prewarm (dev counters only). */
  let heroPrewarmMs = 0;
  const view = { contains: cull.contains, scene };
  const members = createVisibleWorkerPool<ReturnType<typeof createEquippedMember>>({
    attach: member => scene.add(member.group),
    load: async frame => {
      const worker = await bodies.load(frame, frame.armourRank);
      setArmourLod(worker.root, detailed ? 0 : 1);
      return createEquippedMember(worker, frame, pack, shared, bodies, rings, detailed, budget, crowdView,
        instances, frame.armourRank, groundHeight, bridgeHeight, view);
    },
    onError: error => console.warn("Visible worker could not load", error),
    // C02 (c): a body that leaves the visible set is reused on re-entry instead of cloned again.
    retain: member => member.park()
  });
  const updateLights = createCrowdLights(scene);
  const beginView = (camera: Camera | undefined, time: number, viewportHeight: number) => {
    crowdView.camera = camera;
    crowdView.time = time;
    crowdView.viewportHeight = viewportHeight;
    crowdView.lodCounts[0] = 0; crowdView.lodCounts[1] = 0; crowdView.lodCounts[2] = 0; crowdView.lodCounts[3] = 0;
    crowdView.gpuCount = 0;
    crowdView.skeletonsGated = 0;
    crowdView.gpuSkipped.clear();
    crowdView.casters.begin();
    crowdView.castingGroups.length = 0;
    crowdView.widened.length = 0;
    instances.begin();
  };
  return {
    /** C11: the next frame starts the possessed view; it reclassifies tiers and drops the LOD hold. */
    beginExplorationView: () => { refreshExploration = true; },
    /**
     * C11: loads the hero bodies the possessed view will show up close, warms their authored
     * coarser levels (approach LOD and sun shadow proxy) and draws them once off-screen so the
     * first possessed frame finds their programs, textures and buffers resident. Best effort: a
     * failed body or level only means that resource loads lazily, as before.
     */
    prepareExplorationHeroes: async (
      heroes: readonly ExplorationHeroBody[],
      renderer: WebGLRenderer,
      camera: Camera
    ) => {
      if (!heroes.length) return () => undefined;
      const releases: (() => void)[] = [];
      const probes: Object3D[] = [];
      const startedAt = performance.now();
      try {
        for (const hero of heroes) {
          const body = await bodies.prewarm(hero, hero.armourRank);
          releases.push(body.release);
          probes.push(body.root);
          for (const level of explorationPrewarmLevels(body.lods)) {
            const lease = body.lods!.acquire(level);
            try {
              const template = await lease.promise;
              releases.push(() => lease.release());
              probes.push(...template.meshes);
            } catch { lease.release(); }
          }
        }
        if (probes.length) await warmExplorationHeroes(renderer, camera, scene, probes);
        heroPrewarmMs = Math.round(performance.now() - startedAt);
      } catch (error) {
        for (const release of releases) release();
        console.warn("Exploration hero bodies could not be prewarmed", error);
        return () => undefined;
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        for (const release of releases) heroReleases.defer(release);
      };
    },
    /**
     * `camera`: this frame's view; workers outside it are neither posed nor drawn.
     * `time`: presentation clock (FrameState.time) for animation-budget and LOD hysteresis.
     * `viewportHeight`: drawing buffer height (device px), the scale of projected worker sizes.
     */
    update: (frames: readonly WorkerFrame[] | undefined, environment: EnvironmentState, camera?: Camera,
      time = performance.now() / 1000, viewportHeight = 1) => {
      cull.setCamera(camera);
      // C11: the first possessed frame reclassifies and reposes every visible actor at once.
      if (refreshExploration) {
        refreshExploration = false;
        budget.resetTiers();
        members.refreshDetail();
      }
      budget.beginFrame(camera, time);
      beginView(camera, time, viewportHeight);
      members.update(frames);
      instances.flush();
      instances.step(CROWD_BAKE_BUDGET_MS);
      crowdView.casters.select(policy.shadowCasters);
      hover.set(members.hovered()?.root);
      updateLights(environment);
      rings.setShadowStrength(environment.shadowStrength);
    },
    render: (renderer: WebGLRenderer, camera: Camera) => {
      renderer.render(scene, camera);
      // info resets at the start of every render call: these are this scene's draws alone.
      drawn.calls = renderer.info.render.calls;
      drawn.triangles = renderer.info.render.triangles;
    },
    /**
     * R02/C07: the chosen casters' bodies (LOD2 proxies) into the sun shadow map. Only the casting
     * members' groups are updated and traversed (R08: a crowd-wide traversal per pass cost ~0.5 ms);
     * the main draw still updates the whole crowd, at normal width, as before.
     */
    castShadows: (cast: CastSunShadows) => {
      if (crowdView.casters.casting() === 0) return;
      const { castingGroups, widened } = crowdView;
      for (let index = 0; index < widened.length; index++) {
        const { root, width } = widened[index]!;
        root.scale.set(WORKER_SCALE * width, WORKER_SCALE, WORKER_SCALE * width);
      }
      for (let index = 0; index < castingGroups.length; index++) castingGroups[index]!.updateMatrixWorld(true);
      try { castRoots(cast, castingGroups); }
      finally {
        for (let index = 0; index < widened.length; index++) widened[index]!.root.scale.setScalar(WORKER_SCALE);
      }
    },
    prepare: async (frames: readonly WorkerFrame[], environment: EnvironmentState) => {
      cull.setCamera(undefined);
      budget.beginFrame(undefined, performance.now() / 1000);
      beginView(undefined, performance.now() / 1000, 1);
      members.update(frames);
      instances.flush();
      crowdView.casters.select(policy.shadowCasters);
      hover.set(members.hovered()?.root);
      updateLights(environment);
      rings.setShadowStrength(environment.shadowStrength);
      await members.whenReady();
      // Behind the loading screen: the body types seen so far bake at once, so the first frame
      // already poses its far crowd on the GPU.
      await instances.prepare();
    },
    poolStats: bodies.stats,
    /** C02 (c): active/pending members and the parked bodies of the bounded free list. */
    visiblePoolStats: () => members.stats(),
    eyeOffset: (actor: number) => members.get(actor)?.eyeOffset(),
    /** Pose-budget receipt: current-frame poses and tier distribution (visual-only). */
    animationStats: () => budget.stats(),
    /** C05 receipt: members per drawn level and the crowd scene's draws and triangles this frame. */
    detailStats: () => ({ casters: crowdView.casters.casting(), drawCalls: drawn.calls, gpu: crowdView.gpuCount,
      gpuBakeMs: Math.round(instances.stats().bakeMs),
      gpuSkipped: [...crowdView.gpuSkipped].map(([reason, count]) => `${reason} ${count}`).join(", ") || "0",
      heroPrewarmMs, lods: crowdView.lodCounts.join("/"), skeletonsGated: crowdView.skeletonsGated,
      triangles: drawn.triangles }),
    createExplorationBodyLoader: () => explorationBodyLoader,
    textureStats: () => pack.textureCount,
    /** Tunic colour (hex) of every worker. */
    setColor: (color: string) => {
      members.setColor(color);
      setMilitaryLiveryColor(color);
    },
    /** Hover one worker by simulation id; the caller only passes selectable soldiers. */
    setHover: (id: number | null) => {
      crowdView.hoveredId = id;
      members.setHover(id);
    },
    dispose: () => {
      // Teardown owns every lease: a deferred hero release must not outlive its body pool.
      heroReleases.flush();
      hover.dispose();
      members.dispose();
      instances.dispose();
      bodies.dispose();
      shared.dispose();
      pack.dispose();
      rings.dispose();
    }
  };
};
