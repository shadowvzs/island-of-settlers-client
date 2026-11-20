import { shareWorkerSkeletons } from "@workers/game-three-skeletons";
import { MOUNT_CLIPS } from "@workers/mount-clips";
import { createCoatMaterial } from "@workers/mount-coat-material";
import { findHorseCoat } from "@workers/mount-coats";
import { applyBodyGirth, bodyGirthProfile } from "@workers/worker-body-girth";
import {
  type AnimationClip,
  AnimationMixer,
  Box3,
  type Camera,
  type ColorRepresentation,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  RingGeometry,
  Scene,
  type Skeleton,
  SkinnedMesh,
  Texture,
  TextureLoader,
  Vector3,
  type WebGLRenderer
} from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { type GLTF,GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

import type { EnvironmentState } from "../../render-common/environment";
import { commanderAppearance, riderArmourRank } from "../../render-common/mounts/commander-appearance";
import {
  hasCommanderRiderSurface,
  MINIMAL_HORSE_PATH,
  minimalRiderPath,
  type MountManifest,
  riderModelPath
} from "../../render-common/mounts/mount-assets";
import {
  MOUNT_ASSET_BASE,
  type MountAppearance,
  type MountFrame
} from "../../render-common/mounts/mount-frame";
import { DEFAULT_WORKER_COLOR, getWorkerColorHex } from "../../render-common/workers/worker-colors";
import { WORKER_HEIGHT, WORKER_SCALE } from "../../render-common/workers/worker-dimensions";
import type { WorkerFrame, WorkerNation } from "../../render-common/workers/worker-unit";
import { setSkeletonsGated } from "./character-skeleton-gate";
import type { CharacterTierPolicy } from "./character-tier-policy";
import { createCommanderAura, createCommanderInsignia } from "./commander-mount-visuals";
import { createLazyRenderLayer } from "./lazy-render-layer";
import { loadOwnedAssetPair } from "./load-owned-asset-pair";
import {
  acquireMilitaryEquipment,
  ENEMY_LIVERY,
  type MilitaryEquipmentKit,
  setMilitaryLiveryColor
} from "./military-equipment";
import {
  createMountAnimationBudget, type MountAnimationBudget, type MountAnimationState
} from "./mount-animation-budget";
import { createMountDetail, listBodyMeshes, pairFarGeometry, pixelsPerUnit } from "./mount-detail";
import { createHorseTemplateOwner } from "./mount-horse-template";
import { createMountRetirementGrace } from "./mount-retirement";
import { dressRider, loadRiderArmour, type RiderArmour } from "./mount-rider-armour";
import { createRiderBodyOwner } from "./mount-rider-body-owner";
import { createOwnedAssetCache, type OwnedAssetLease } from "./owned-asset-cache";
import { meshMaterials } from "./three-mesh-resources";
import { type CastSunShadows, SHADOW_CASTER_LAYER } from "./three-shadows";
import { createCrowdLights } from "./three-worker";
import { createUnitEyeOffset } from "./unit-eye-offset";
import { createWorkerCombatPose } from "./worker-combat-pose";
import { MOUNTED_ENGAGE } from "./worker-mounted-cut";
import { createMountedEquipment, mountedWeaponPose, mountedWeaponType } from "./worker-mounted-equipment";
import { createWorkerPoseTransition } from "./worker-pose-transition";


/**
 * Horses with riders (`?horse=1` trial): skinned meshes from game_ready/mounts.
 * Each horse clones the shared horse (own skeleton, own coat material), the rider sits under
 * its `Saddle` node and plays the riding clip of the horse's clip at the same time. Turning
 * bends the neck in and leans the body.
 */

const TEAM_MATERIAL = "tunic_team_linen";
/** Ground ring colours of a mount: selected (own) and chased by the player's soldiers (enemy). */
const SELECTION_RING_COLOR = 0xeacb72;
const TARGET_RING_COLOR = 0xe0281c;

/** Each loaded template owns its textures; cloned instances only own materials and skeletons. */
const createTemplateDisposer = () => {
  const released = new Set<{ dispose: () => void }>();
  const release = (asset: { dispose: () => void }) => {
    if (released.has(asset)) return;
    released.add(asset); asset.dispose();
  };
  return (model: GLTF) => model.scene.traverse(object => {
    if (!(object instanceof Mesh)) return;
    release(object.geometry);
    for (const material of meshMaterials(object)) {
      for (const value of Object.values(material)) if (value instanceof Texture) release(value);
      release(material);
    }
    if (object instanceof SkinnedMesh) release(object.skeleton);
  });
};

const forEachMaterial = (root: Object3D, visit: (material: MeshStandardMaterial) => void) =>
  root.traverse((object) => {
    if (!(object instanceof SkinnedMesh)) return;
    const materials = meshMaterials(object);
    materials.forEach((material) => visit(material as MeshStandardMaterial));
  });

/** The horse body's own material (the textured one), cloned for this horse's coat. */
const giveOwnCoat = (root: Object3D, mask: Texture, manifest: MountManifest, coat: string) => {
  root.traverse((object) => {
    if (!(object instanceof SkinnedMesh) || !(object.material as MeshStandardMaterial).map) return;
    const material = object.material as MeshStandardMaterial;
    createCoatMaterial(material, mask, manifest.horse.coat).setCoat(findHorseCoat(coat));
  });
};

const createPlayer = (root: Object3D, clips: AnimationClip[]) => {
  const mixer = new AnimationMixer(root);
  let playing = "";
  return (clip: string, time: number) => {
    if (clip !== playing) {
      mixer.stopAllAction();
      mixer.clipAction(clips.find((candidate) => candidate.name === clip)!).play();
      playing = clip;
    }
    mixer.setTime(time);
  };
};

/** Neck bend per neck joint and body lean per unit of turn rate (radians per rad/s). */
const TURN = { lean: 0.07, maxLean: 0.12, maxNeck: 0.12, neck: 0.06 };
const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);

/**
 * Bends the posed horse into its turn: the neck towards the inside (skeletal, animate frames) and
 * the body leaning in (root transform, every frame, so a cadenced mount does not rock).
 */
const createTurnBend = (root: Object3D) => {
  const neck = ["Neck1", "Neck2", "Neck3"].map((name) => root.getObjectByName(name)!);
  const bend = new Quaternion();
  const turnNeck = (turnRate: number) => {
    const neckYaw = Math.max(-TURN.maxNeck, Math.min(TURN.maxNeck, turnRate * TURN.neck));
    bend.setFromAxisAngle(UP, neckYaw);
    for (const joint of neck) joint.quaternion.premultiply(bend);
  };
  const leanBody = (turnRate: number, speed: number) => {
    const lean = Math.max(-TURN.maxLean, Math.min(TURN.maxLean, turnRate * speed * TURN.lean));
    root.quaternion.multiply(bend.setFromAxisAngle(FORWARD, -lean));
  };
  return { leanBody, turnNeck };
};

/** A slain rider goes down with his horse: it rolls over its hooves onto its right side. */
const MOUNT_FALL_ROLL = Math.PI / 2 - .08;
const fallRoll = new Quaternion();
/** `fall` 0..1: the roll accelerates like a toppling body; the flank ends resting on the ground. */
const fallOntoSide = (root: Object3D, fall: number, halfWidth: number) => {
  const roll = MOUNT_FALL_ROLL * fall * fall;
  root.quaternion.multiply(fallRoll.setFromAxisAngle(FORWARD, -roll));
  root.position.y += halfWidth * Math.sin(roll);
};

/** A loaded body and, on High, its simplified Minimal model for the far detail (mount-detail.ts). */
interface DetailedModel { far?: GLTF; model: GLTF; release?: () => void }
interface DressedRider extends DetailedModel {
  clips: AnimationClip[];
  release: () => void;
}

/** A dressed template is a clone: its skeletons are private, its meshes stay owned by the templates. */
const disposeClonedSkeletons = (root: Object3D) => root.traverse(object => {
  if (object instanceof SkinnedMesh) object.skeleton.dispose();
});

const disposeDressedRider = (rider: DressedRider) => {
  disposeClonedSkeletons(rider.model.scene);
  rider.model.scene.removeFromParent();
  rider.release();
};

const createMount = (
  horse: DetailedModel,
  rider: DetailedModel & { clips: AnimationClip[] },
  appearance: MountAppearance & { commander?: boolean; nation?: WorkerNation },
  shared: { equipment: MilitaryEquipmentKit; manifest: MountManifest; mask: Texture },
  detailed: boolean,
  budget: MountAnimationBudget
) => {
  const root = cloneSkinned(horse.model.scene);
  // C02 (d): the horse's skinned parts share one skeleton (one bone upload) after cloning.
  shareWorkerSkeletons(root);
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(material => material.clone()) : object.material.clone();
  });
  const horseBox = new Box3().setFromObject(root);
  const horseBounds = horseBox.getSize(new Vector3()).multiplyScalar(WORKER_SCALE);
  const horseCenter = horseBox.getCenter(new Vector3()).multiplyScalar(WORKER_SCALE);
  giveOwnCoat(root, shared.mask, shared.manifest, appearance.coat);
  const ownedMaterials = new Set<MeshStandardMaterial>();
  // The horse clone owns its materials; the rider's body and armour keep the templates' materials.
  forEachMaterial(root, material => ownedMaterials.add(material));
  const detail = createMountDetail(root, [
    ...(horse.far ? pairFarGeometry(root, horse.far.scene) : []),
    ...(rider.far ? pairFarGeometry(rider.model.scene, rider.far.scene) : [])
  ]);
  root.getObjectByName("Saddle")!.add(rider.model.scene);
  // Horse and rider bodies cast the sun shadow (armour, gear and rings do not); see `setCaster`.
  const casterMeshes = listBodyMeshes(root);
  let casting = false;
  /** Screen pixels per map cell at the last drawn frame (the shadow pass runs before the draw). */
  let pixels = 0;
  root.scale.setScalar(WORKER_SCALE);
  const renderOrigin = new Vector3();
  const eyeOffset = createUnitEyeOffset(rider.model.scene, root, () => renderOrigin);
  const poseHorse = createPlayer(root, horse.model.animations);
  const hips = rider.model.scene.getObjectByName("Hips");
  const standingHipY = hips?.position.y ?? 0;
  const poseRider = createPlayer(rider.model.scene, rider.clips);
  const bendIntoTurn = createTurnBend(root);
  // The mixer skips unchanged bones: undo last frame's neck bend and cut before sampling again.
  const sampledPose = createWorkerPoseTransition(root);
  const combatPose = createWorkerCombatPose(rider.model.scene, rider.clips,
    appearance.commander === true && appearance.nation === "viking");
  const reinArm: { bone: Object3D; pose: Quaternion }[] = [];
  rider.model.scene.traverse(bone => {
    if (bone.name.startsWith("Left") && /Arm|Hand/.test(bone.name))
      reinArm.push({ bone, pose: new Quaternion() });
  });
  const selection = new Mesh(new RingGeometry(.42, .48, 32),
    new MeshBasicMaterial({ color: SELECTION_RING_COLOR, transparent: true, opacity: .8, depthWrite: false }));
  let shownTargeted: boolean | undefined;
  selection.rotation.x = -Math.PI / 2;
  selection.position.y = .018 / WORKER_SCALE;
  selection.visible = false;
  root.add(selection);
  const commanderLook = commanderAppearance(appearance.nation ?? "roman");
  const commanderInsignia = appearance.commander ? createCommanderInsignia(commanderLook, detailed) : undefined;
  if (commanderInsignia) rider.model.scene.add(commanderInsignia.group);
  const commanderAura = appearance.commander ? createCommanderAura(commanderLook, detailed) : undefined;
  if (commanderAura) root.add(commanderAura.group);
  const equipment = createMountedEquipment(rider.model.scene, shared.equipment);
  // Only the team colour is the rider's own material; armour and body surfaces stay shared.
  forEachMaterial(rider.model.scene, material => {
    if (material.name === TEAM_MATERIAL) ownedMaterials.add(material);
  });
  // C02 (e/f): the mount's cadence state and the skeletons a still mount keeps out of the update.
  const animation: MountAnimationState = budget.newState();
  const skeletons = new Set<Skeleton>();
  root.traverse(object => { if (object instanceof SkinnedMesh) skeletons.add(object.skeleton); });
  let skeletonGated = false;
  let rootMoved = true;
  let lastX = NaN, lastY = NaN, lastZ = NaN, lastHeading = NaN, lastEngage = NaN, lastFall = NaN, lastTurn = NaN;
  const gateSkeletons = (gated: boolean) => {
    if (gated === skeletonGated) return;
    skeletonGated = gated;
    setSkeletonsGated(skeletons, gated);
  };
  /** Root transform, fall roll, selection and aura: cheap and visible every frame. */
  const present = (frame: MountFrame | undefined) => {
    root.visible = !!frame;
    if (!frame) { budget.offscreen(animation); return; }
    // Engaged, the horse steps up and turns so the target stands by its right shoulder.
    const engage = frame.engage ?? 0;
    const advance = MOUNTED_ENGAGE.advance * engage;
    const fall = frame.fall ?? 0;
    // The turn rate changes the every-frame body lean too, so it moves the bones as well.
    rootMoved = frame.x !== lastX || frame.y !== lastY || frame.z !== lastZ ||
      frame.heading !== lastHeading || engage !== lastEngage || fall !== lastFall ||
      frame.turnRate !== lastTurn;
    lastX = frame.x; lastY = frame.y; lastZ = frame.z;
    lastHeading = frame.heading; lastEngage = engage; lastFall = fall; lastTurn = frame.turnRate;
    renderOrigin.set(frame.x, frame.y + .005, frame.z);
    root.position.set(frame.x + Math.sin(frame.heading) * advance, frame.y + 0.005,
      frame.z + Math.cos(frame.heading) * advance);
    // A full reset: the turn lean of the last frame must not stay in the Euler angles.
    root.rotation.set(0, frame.heading + MOUNTED_ENGAGE.turn * engage, 0);
    if (frame.fall !== undefined) fallOntoSide(root, frame.fall, horseBounds.x / 2);
    // The lean is a root transform, so it follows every frame even on a cadenced pose frame.
    bendIntoTurn.leanBody(frame.turnRate, MOUNT_CLIPS[frame.clip].speed);
    selection.visible = frame.selected === true || frame.targeted === true;
    // A chased enemy rider shows the same ring in red (targetMilitary; never selected itself).
    if (frame.targeted !== shownTargeted) {
      shownTargeted = frame.targeted;
      (selection.material as MeshBasicMaterial).color.setHex(frame.targeted ? TARGET_RING_COLOR : SELECTION_RING_COLOR);
    }
    if (commanderInsignia) commanderInsignia.group.visible = frame.commander === true;
    if (commanderAura) {
      commanderAura.group.visible = frame.commander === true && frame.auraActive !== false &&
        frame.fall === undefined;
      commanderAura.group.scale.setScalar(1 + Math.sin(frame.clipTime * Math.PI * 2) * .012);
    }
  };
  /** Skeletal clips, combat stance, turn bend and the rider's weapon: the budget-gated part. */
  const animate = (frame: MountFrame) => {
    combatPose.reset();
    sampledPose.restore();
    poseHorse(frame.clip, frame.clipTime);
    poseRider(frame.clip, frame.clipTime);
    sampledPose.capture();
    const progress = frame.attackProgress ?? null;
    const sword = mountedWeaponPose(frame, standingHipY - (hips?.position.y ?? standingHipY));
    if (frame.actorId !== undefined) {
      for (const joint of reinArm) joint.pose.copy(joint.bone.quaternion);
      combatPose.apply({ nation: frame.nation, combat: { attackProgress: progress,
        manualBowPitch: frame.manualBowPitch,
        faction: frame.faction ?? 0, type: mountedWeaponType(frame) } } as WorkerFrame, sword);
      // Sword parries retain the rein hand; actual bows and axes use both hands.
      if (!frame.commanderLoadout || frame.commanderLoadout === "sword")
        for (const joint of reinArm) joint.bone.quaternion.copy(joint.pose);
    }
    bendIntoTurn.turnNeck(frame.turnRate);
    // The blade follows the cut rather than the rein hand's wrist (it would sink into the neck).
    equipment.update(frame, sword);
  };
  return {
    root,
    eyeOffset,
    horseBounds,
    horseCenter,
    setColor: (color: ColorRepresentation) =>
      forEachMaterial(rider.model.scene, (material) => {
        if (material.name === TEAM_MATERIAL) material.color.set(color);
      }),
    /** Unconditional pose (previews and the possessed eye): visible on the very next frame. */
    update: (frame: MountFrame | undefined) => {
      present(frame);
      if (!frame) return;
      animate(frame);
      gateSkeletons(false);
    },
    /** Production frame: root/selection every frame, pose when the shared cadence is due (C02 e). */
    updateBudgeted: (frame: MountFrame) => {
      present(frame);
      const animated = budget.due(animation, frame);
      if (animated) animate(frame);
      // A still mount on a skipped frame keeps its bone matrices (C02 f).
      gateSkeletons(!animated && !rootMoved);
      return animated;
    },
    /** Picks near or far detail from the mount's size on screen (drawing buffer pixels). */
    updateDetail: (camera: Camera, viewportWidth: number) => {
      if (!root.visible) return;
      pixels = pixelsPerUnit(camera, root.position, viewportWidth);
      detail.update(pixels);
    },
    /** Projected height of a standing character at the mount, for the caster gate. */
    characterPixels: () => (root.visible ? pixels * WORKER_HEIGHT : 0),
    setCaster: (on: boolean) => {
      if (on === casting) return;
      casting = on;
      for (const mesh of casterMeshes) {
        if (on) mesh.layers.enable(SHADOW_CASTER_LAYER);
        else mesh.layers.disable(SHADOW_CASTER_LAYER);
      }
    },
    useCasterGeometry: detail.useCasterGeometry,
    /** C01 counters: drawn this frame, and at near (full) detail. */
    isVisible: () => root.visible,
    isNear: detail.isNear,
    dispose: () => {
      selection.geometry.dispose(); (selection.material as MeshBasicMaterial).dispose();
      equipment.dispose();
      commanderInsignia?.dispose();
      commanderAura?.dispose();
      for (const material of ownedMaterials) material.dispose();
      root.traverse(object => { if (object instanceof SkinnedMesh) object.skeleton.dispose(); });
      root.removeFromParent();
    }
  };
};

export interface MountLayerOptions {
  /** C03/C07 character policy: mounts above its `shadowCastPixels` cast the sun shadow. */
  characters?: CharacterTierPolicy;
}

export const createThreeMounts = async (
  textures: KTX2Loader,
  appearances: readonly MountAppearance[], detailed = true,
  options: MountLayerOptions = {}
) => {
  const castPixels = options.characters?.shadowCasters ? options.characters.shadowCastPixels : null;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(textures);
  const disposeTemplate = createTemplateDisposer();
  const manifest: MountManifest = await (await fetch(`${MOUNT_ASSET_BASE}manifest.json`)).json();
  /** Manifest paths are relative to the mounts folder; bundled Minimal meshes are full URLs already. */
  const assetUrl = (path: string) => new URL(path, MOUNT_ASSET_BASE).href;
  /** High loads the full model plus the Minimal one (far detail); Minimal only the latter. */
  const loadDetailed = async (url: string, minimalUrl: string): Promise<DetailedModel> => {
    if (!detailed) return { model: await loader.loadAsync(minimalUrl) };
    const [model, far] = await loadOwnedAssetPair(loader.loadAsync(url), loader.loadAsync(minimalUrl),
      disposeTemplate, disposeTemplate);
    return { far, model };
  };
  const disposeDetailed = (template: DetailedModel) => {
    if (template.release) { template.release(); return; }
    disposeTemplate(template.model);
    if (template.far) disposeTemplate(template.far);
  };
  /** Loaded on the first mount that needs it; the last active/static mount releases it again. */
  const horseTemplates = createHorseTemplateOwner(
    async () => {
      const [horse, mask] = await loadOwnedAssetPair(
        loadDetailed(assetUrl(manifest.horse.model), assetUrl(MINIMAL_HORSE_PATH)),
        new TextureLoader().loadAsync(`${MOUNT_ASSET_BASE}${manifest.horse.coat.mask}`),
        disposeDetailed, mask => mask.dispose()
      );
      mask.flipY = false;
      return { horse, mask };
    },
    ({ horse, mask }) => { disposeDetailed(horse); mask.dispose(); }
  );
  const riderBodies = createRiderBodyOwner(url => loader.loadAsync(url), disposeTemplate, detailed);
  const loadRider = async (key: string) => {
    const [variant, kind] = key.split("|");
    const entry = manifest.riders.find((rider) => rider.variant === variant) ?? manifest.riders[0]!;
    const [body, actions] = await loadOwnedAssetPair(
      riderBodies.load(assetUrl(riderModelPath(entry, kind === "commander")), assetUrl(minimalRiderPath(entry, kind === "commander"))),
      loader.loadAsync(`${MOUNT_ASSET_BASE}${entry.animations}`),
      disposeDetailed, disposeTemplate
    );
    disposeTemplate(actions);
    // The same girth fit as the variant's foot body; the shared geometry is fitted once.
    const girth = bodyGirthProfile(entry.variant);
    applyBodyGirth(body.model.scene, girth);
    if (body.far) applyBodyGirth(body.far.scene, girth);
    return { ...body, clips: actions.animations };
  };
  let disposed = false;
  const riderTemplates = createOwnedAssetCache(loadRider, disposeDetailed);
  const disposeRiderArmour = (armour: RiderArmour) => {
    disposeTemplate(armour.body);
    armour.rigid.forEach(({ gltf }) => disposeTemplate(gltf));
  };
  const riderArmour = createOwnedAssetCache(
    (key: string) => {
      const [nation, rank] = key.split("|") as [WorkerNation, "centurion" | "soldier"];
      return loadRiderArmour(loader, nation, rank);
    },
    disposeRiderArmour
  );
  /** Riders wear their rank armour; the `?horse=1` preview rides unarmoured. */
  const loadDressedRider = async (key: string): Promise<DressedRider> => {
    const [variant, nation, rank] = key.split("|") as [string, WorkerNation | "", "centurion" | "soldier" | ""];
    const bodyKey = rank === "centurion" && hasCommanderRiderSurface(variant) ? `${variant}|commander` : variant;
    const riderLease = riderTemplates.acquire(bodyKey);
    let armourLease: OwnedAssetLease<RiderArmour> | undefined;
    let scene: Group | undefined;
    try {
      const template = await riderLease.promise;
      if (disposed) throw new Error("Mounted rider cache disposed");
      let armour: RiderArmour | undefined;
      if (nation) {
        armourLease = riderArmour.acquire(`${nation}|${rank || "soldier"}`);
        armour = await armourLease.promise;
        if (disposed) throw new Error("Mounted rider cache disposed");
      }
      scene = cloneSkinned(template.model.scene) as Group;
      if (armour) dressRider(scene, armour, detailed ? [0, 1] : [1]);
      return {
        clips: template.clips,
        far: template.far,
        model: { ...template.model, scene },
        release: () => { riderLease.release(); armourLease?.release(); }
      };
    } catch (error) {
      if (scene) { disposeClonedSkeletons(scene); scene.removeFromParent(); }
      riderLease.release();
      armourLease?.release();
      throw error;
    }
  };
  const dressedRiders = createOwnedAssetCache(loadDressedRider, disposeDressedRider);
  const equipment = acquireMilitaryEquipment(detailed);
  const budget = createMountAnimationBudget();
  const instantiate = async (appearance: MountAppearance & { commander?: boolean; nation?: WorkerNation }) => {
    const rank = riderArmourRank(appearance.commander === true);
    const templateLease = dressedRiders.acquire(
      `${appearance.rider}|${appearance.nation ?? ""}|${appearance.commander ? rank : ""}`);
    const horseLease = horseTemplates.acquire();
    try {
      const [template, horse] = await Promise.all([templateLease.promise, horseLease.promise]);
      const model: GLTF = { ...template.model, scene: cloneSkinned(template.model.scene) as Group };
      // C02 (d): body and worn armour share one skeleton per skin after the clone.
      shareWorkerSkeletons(model.scene);
      forEachMaterial(model.scene, material => {
        if (material.name !== TEAM_MATERIAL) return;
        // Every rider has its own team colour; geometry, textures and armour remain shared.
        model.scene.traverse(object => {
          if (!(object instanceof SkinnedMesh)) return;
          if (Array.isArray(object.material)) object.material = object.material.map(value => value === material ? value.clone() : value);
          else if (object.material === material) object.material = material.clone();
        });
      });
      const mount = createMount(horse.horse, { ...template, model }, appearance,
        { equipment, manifest, mask: horse.mask }, detailed, budget);
      let released = false;
      return {
        ...mount,
        dispose: () => {
          if (released) return;
          released = true;
          mount.dispose();
          // The last mount of this rider/nation lets the rider templates go; shared ones stay.
          templateLease.release();
          // Static and active/pending mounts all hold the horse; the last one lets it go.
          horseLease.release();
        }
      };
    } catch (error) {
      templateLease.release();
      horseLease.release();
      throw error;
    }
  };
  const mounts = await Promise.all(appearances.map(instantiate));
  type MountInstance = Awaited<ReturnType<typeof instantiate>>;
  const dynamic = new Map<number, MountInstance>();
  const posedForEye = new WeakSet<MountFrame>();
  const retirement = createMountRetirementGrace();
  const pending = new Map<number, ReturnType<typeof createLazyRenderLayer<MountInstance>>>();
  const reportedRiders = new Set<string>();
  const scene = new Scene();
  let playerColor: string = getWorkerColorHex(DEFAULT_WORKER_COLOR);
  for (const mount of mounts) { mount.setColor(playerColor); scene.add(mount.root); }
  const updateLights = createCrowdLights(scene);
  /** Mounts are few: every visible one above the caster size casts, no per-frame budget. */
  const chooseCaster = (mount: MountInstance) => {
    const on = castPixels !== null && mount.characterPixels() >= castPixels;
    mount.setCaster(on);
    return on;
  };
  const setCasterGeometry = (on: boolean) => {
    for (const mount of mounts) mount.useCasterGeometry(on);
    for (const mount of dynamic.values()) mount.useCasterGeometry(on);
  };
  const layer = {
    /** Mount scene, exposed to the isolated portrait/review scenes (the live renderer uses render()). */
    scene,
    prepare: async (frames: readonly MountFrame[], environment: EnvironmentState) => {
      layer.update(frames, environment);
      await Promise.all([...pending.values()].map(request => request.whenReady()));
      layer.update(frames, environment);
    },
    render: (renderer: WebGLRenderer, camera: Camera) => {
      const width = renderer.domElement.width;
      for (const mount of mounts) mount.updateDetail(camera, width);
      for (const mount of dynamic.values()) mount.updateDetail(camera, width);
      renderer.render(scene, camera);
    },
    /** R02/C07: horse and rider bodies (far geometry) into the sun shadow map. */
    castShadows: (cast: CastSunShadows) => {
      if (castPixels === null) return;
      let casting = false;
      for (const mount of mounts) casting = chooseCaster(mount) || casting;
      for (const mount of dynamic.values()) casting = chooseCaster(mount) || casting;
      if (!casting) return;
      setCasterGeometry(true);
      try { cast(scene); }
      finally { setCasterGeometry(false); }
    },
    /** C01 counters: drawn mounts at near and far detail. */
    stats: () => {
      let near = 0, far = 0;
      for (const mount of [...mounts, ...dynamic.values()]) {
        if (!mount.isVisible()) continue;
        if (mount.isNear()) near++;
        else far++;
      }
      return { far, near };
    },
    horseBounds: () => [...dynamic.values()].map(mount => mount.horseBounds.toArray()),
    eyeOffset: (actor: number, frame?: MountFrame) => {
      const mount = dynamic.get(actor);
      if (mount && frame?.actorId === actor && !posedForEye.has(frame)) { mount.update(frame); posedForEye.add(frame); }
      return mount?.eyeOffset();
    },
    horseCenter: () => [...dynamic.values()].map(mount => mount.horseCenter.toArray()),
    setColor: (color: string) => {
      playerColor = color;
      setMilitaryLiveryColor(color);
      mounts.forEach(mount => mount.setColor(color));
    },
    update: (frames: readonly MountFrame[] | undefined, environment: EnvironmentState,
      camera?: Camera, time = performance.now() / 1000) => {
      if (disposed) return;
      // C02 (e): one budget frame, shared by every mount of this layer.
      budget.beginFrame(camera, time);
      mounts.forEach((mount, index) => mount.update(frames?.[index]));
      const active = new Set<number>();
      if (!appearances.length) for (const frame of frames ?? []) {
        if (frame.actorId === undefined) continue;
        const id = frame.actorId;
        active.add(id);
        retirement.seen(id);
        const mount = dynamic.get(id);
        if (!mount) {
          let request = pending.get(id);
          if (!request) {
            request = createLazyRenderLayer(() => instantiate(frame), created => {
              dynamic.set(id, created); scene.add(created.root); created.root.visible = false;
            }, error => {
              if (reportedRiders.has(frame.rider)) return;
              reportedRiders.add(frame.rider);
              console.error("Mounted soldier asset; retrying loading", error);
            });
            pending.set(id, request);
          }
          request.request();
        }
        if (!mount) continue;
        mount.setColor((frame.faction ?? 0) === 0 ? playerColor : ENEMY_LIVERY);
        if (posedForEye.has(frame)) posedForEye.delete(frame);
        else mount.updateBudgeted(frame);
      }
      for (const [id, mount] of dynamic) if (!active.has(id)) {
        mount.update(undefined);
        if (!retirement.missing(id)) continue;
        dynamic.delete(id);
        // The lazy layer owns the instance that is now being retired.
        const request = pending.get(id);
        if (request) { request.dispose(); pending.delete(id); }
        else mount.dispose();
      }
      for (const [id, request] of pending) if (!active.has(id) && !dynamic.has(id)) {
        request.dispose(); pending.delete(id);
      }
      updateLights(environment);
    },
    dispose: () => {
      disposed = true;
      mounts.forEach(mount => mount.dispose());
      pending.forEach(request => request.dispose()); pending.clear();
      for (const mount of dynamic.values()) mount.dispose();
      dynamic.clear();
      retirement.clear();
      dressedRiders.dispose();
      riderTemplates.dispose();
      riderBodies.dispose();
      riderArmour.dispose();
      horseTemplates.dispose();
      equipment.release();
    }
  };
  return layer;
};
