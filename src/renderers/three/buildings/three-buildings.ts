import {
  Box3, type Camera, type IUniform, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Object3D, OrthographicCamera,
  type Raycaster, Scene, type Texture, type WebGLRenderer
} from "three";

import { type BanditSiteRef, sameBanditSite } from "../../../render-common/buildings/bandit-camp-plan";
import {
  type BuildingFrame,
  getBuildingDefinition} from "../../../render-common/buildings/building-catalog";
import {
  type BuildingDetailEye, isBuildingDetailedInView
} from "../../../render-common/buildings/building-detail";
import { fortCollapseScale, isFortStanding } from "../../../render-common/buildings/fort-siege-visual";
import type { BuildingLevel } from "../../../render-common/buildings/levels/building-level";
import { MONUMENT_TYPE_ID } from "../../../render-common/buildings/monument-definition";
import { hasNeutralBuildingStyle } from "../../../render-common/buildings/neutral-building-recipe";
import { type EnemyBuildingStyle,enemyBuildingStyleKey } from "../../../render-common/buildings/themed-neutral-building-style";
import type { EnvironmentState } from "../../../render-common/environment";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { createExplorationCeilingQuery } from "../exploration/exploration-ceiling";
import { createSceneMatrixGate } from "../scene-matrix-gate";
import { createBuildingUpgradeStock } from "../settlement/building-upgrade-stock";
import type { ConstructionGround } from "../settlement/construction-site-ground";
import { meshMaterials } from "../three-mesh-resources";
import { createCrowdLights } from "../three-worker";
import { createBuildingBurnEffects, createBurnResources } from "./building-burn-effects";
import {
  attachVariant, type BuildingModel, type BuildingVariant, createParkedVariants, disposeVariant, placeVariant
} from "./building-detail-variants";
import { buildingCollapseScale } from "./building-fire-anchors";
import { type BuildingHealthMarker,createBuildingHealthBars } from "./building-health-bars";
import { createBuildingHover } from "./building-hover";
import { createBuildingLevelBadges, hoveredBuildingLevel } from "./building-level-badges";
import { type BuildingPauseMarker,createBuildingPauseBadges } from "./building-pause-badges";
import { createBuildingRecipeJobs, recipeJobsOf } from "./building-recipe-jobs";
import { createBuildingRoadMarkers } from "./building-road-marker";
import { createFortSiegeFires } from "./building-siege-fire";
import { BUILDING_BATCH_SOURCE_LAYER, createBuildingStaticBatches } from "./building-static-batches";
import { type PaintedSurfaces,restoreSurfacePixels } from "./building-surface-textures";
import { type BuildingUpgradeMarker, createBuildingUpgradeBars } from "./building-upgrade-bars";
import { createBuildingVariantBuilder, type VariantRequest } from "./building-variant-builder";
import { buildingAssetReady } from "./monument-building";
import { updateNightLampGlow } from "./night-lamp-glow";
import {
  createRomanBuildingWindState,
  romanBuildingFlagPhase,
  updateRomanBuildingWindState
} from "./roman-building-wind";
import { isWindowGlowMesh } from "./window-glow";

type Model = BuildingModel;
type BuildingEntry = {
  type: number;
  frame: BuildingFrame;
  level: BuildingLevel;
  nation: WorkerNation;
  neutral: boolean;
  bandit?: BanditSiteRef;
  enemyStyleKey?: string;
  enemyCatapultVariant?: BuildingFrame["enemyCatapultVariant"];
  enemyCampEnclosure?: "building";
  breachedWalls?: string;
  /** The drawn detail recipe; `parked` holds the other one (R16a), so a zoom switch only swaps. */
  active: BuildingVariant;
  parked?: BuildingVariant;
  request: VariantRequest;
  windState: BuildingFrame;
  flagPhase: number;
  roadMarker: ReturnType<ReturnType<typeof createBuildingRoadMarkers>["create"]>;
  demolition: boolean;
  owner: number;
};
type MaterialGroup = Readonly<Record<string, MeshStandardMaterial>> | undefined;
type UpgradeEntry = Pick<BuildingVariant, "pauseHeight" | "upgradeStock">;
const watchCeilingAsset = (ceilings: ReturnType<typeof createExplorationCeilingQuery>, id: string, root: Model["root"]) => {
  void buildingAssetReady(root).then(() => ceilings.invalidate(id, root));
};
const watchSurfaceRestore = (renderer: WebGLRenderer | undefined, painted?: PaintedSurfaces) => {
  const restore = () => { if (painted) restoreSurfacePixels(painted); };
  renderer?.domElement.addEventListener("webglcontextrestored", restore);
  return restore;
};

const windowMeshesOf = (root: Model["root"]) => {
  const meshes: Mesh[] = [];
  root.traverse(object => {
    if (object instanceof Mesh && isWindowGlowMesh(object)) meshes.push(object);
  });
  return meshes;
};

/** The glow is a cheap emissive halo; the WebGPU presenter draws it as a lit stand-in too. */
const createWindowGlowMaterial = (base: MeshStandardMaterial) => {
  // R11b: the glow reads as a warm halo through the bloom; it stays a cheap emissive, not a light.
  const glow = new MeshStandardMaterial({ color: 0x3a2410, emissive: 0xffb45e, emissiveIntensity: 2,
    opacity: .72, side: base.side, transparent: true, depthWrite: false });
  glow.forceSinglePass = true;
  glow.name = "building-window-warm-glow";
  return glow;
};

const updateWindowGlow = (root: Model["root"], glowing: boolean) => {
  const meshes = (root.userData.windowMeshes ??= windowMeshesOf(root)) as Mesh[];
  for (const mesh of meshes) {
    if (mesh.userData.windowLit === glowing) continue;
    const base = mesh.userData.windowBaseMaterial as MeshStandardMaterial | undefined;
    // A node-renderer stand-in is kept as the base too: the next frame swaps back to it.
    if (!base) mesh.userData.windowBaseMaterial = mesh.material as MeshStandardMaterial;
    else mesh.material = base;
    mesh.userData.windowLit = glowing;
    if (!glowing) continue;
    let glow = mesh.userData.windowGlowMaterial as MeshStandardMaterial | undefined;
    if (!glow) {
      glow = createWindowGlowMaterial(mesh.userData.windowBaseMaterial as MeshStandardMaterial);
      mesh.userData.windowGlowMaterial = glow;
    }
    mesh.material = glow;
  }
};

const updateCeiling = (ceilings: ReturnType<typeof createExplorationCeilingQuery>, id: string, entry: BuildingEntry) => {
  if (entry.demolition) ceilings.remove(id);
  else ceilings.sync(id, entry.active.model.root);
};

/** Delivered upgrade materials stay on the ground until the builder starts; the simulation owns them. */
const updateUpgradeStock = (scene: Scene, entry: UpgradeEntry, frame: BuildingFrame, level: number,
  detailed: boolean, materials: MaterialGroup) => {
  if (!frame.upgradeStock) {
    if (entry.upgradeStock) entry.upgradeStock.root.visible = false;
    return;
  }
  if (!entry.upgradeStock) {
    entry.upgradeStock = createBuildingUpgradeStock(getBuildingDefinition(frame.type), level, detailed, materials);
    scene.add(entry.upgradeStock.root);
  }
  entry.upgradeStock.root.position.set(frame.x, frame.y, frame.z);
  entry.upgradeStock.root.rotation.y = frame.rotation;
  entry.upgradeStock.update(frame.upgradeStock, (frame.upgradeProgress ?? 0) <= 0);
};

const addUpgradeMarker = (markers: BuildingUpgradeMarker[], frame: BuildingFrame, entry: UpgradeEntry) => {
  if (frame.construction === 1 && (frame.owner ?? 0) === 0 && frame.upgradeProgress !== undefined)
    markers.push({ progress: frame.upgradeProgress, x: frame.x,
      y: frame.y + entry.pauseHeight + .45, z: frame.z });
};

type FortSiegeEntry = Pick<BuildingVariant, "model" | "originalScaleY" | "pauseHeight" | "siegeFire">;
/** A colony fort under assault: milestone fires, the collapse after its fall and its hit point bar. */
const updateFortSiege = (scene: Scene, siegeFires: ReturnType<typeof createFortSiegeFires>, entry: FortSiegeEntry,
  frame: BuildingFrame, time: number, markers: BuildingHealthMarker[]) => {
  const siege = frame.fortSiege;
  let wallHealth = 1;
  for (const hp of frame.eventCourtyardWalls ?? []) if (hp > 0 && hp < wallHealth) wallHealth = hp;
  if (wallHealth < 1) markers.push({ health: wallHealth,
    x: frame.x, y: frame.y + entry.pauseHeight + .35, z: frame.z });
  if (!siege) return;
  if (!entry.siegeFire && (siege.flames > 0 || siege.fallenAge !== undefined)) {
    entry.model.root.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(entry.model.root);
    bounds.min.y = frame.y;
    entry.siegeFire = siegeFires.create(bounds, frame.id, entry.model.root);
    entry.originalScaleY ??= entry.model.root.scale.y;
    scene.add(entry.siegeFire.root);
  }
  entry.siegeFire?.update(siege, time);
  if (siege.fallenAge !== undefined)
    entry.model.root.scale.y = (entry.originalScaleY ?? 1) * fortCollapseScale(siege.fallenAge);
  if (siege.health < 1 && siege.fallenAge === undefined)
    markers.push({ health: siege.health, x: frame.x, y: frame.y + entry.pauseHeight + .35, z: frame.z });
};

/** Every surface texture held by the shared material packs. */
const collectPackTextures = (groups: readonly MaterialGroup[]) =>
  new Set(groups.flatMap(group => Object.values(group ?? {}).flatMap(material =>
    [material.map, material.normalMap, material.roughnessMap, material.bumpMap].filter(texture => texture !== null))));

/** Textures the current building scene actually draws, uploaded before the first frame. */
const collectVisibleTextures = (scene: Scene) => {
  const visible = new Set<Texture>();
  scene.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const materials = meshMaterials(object);
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial)) continue;
      for (const texture of [material.map, material.normalMap, material.roughnessMap])
        if (texture) visible.add(texture);
    }
  });
  return visible;
};

/** One texture per animation frame, so the remaining pack uploads never stall a frame. */
const uploadTexturesOverFrames = (renderer: WebGLRenderer, pending: Texture[], isDisposed: () => boolean) => {
  const uploadNext = () => {
    if (isDisposed()) return;
    const texture = pending.shift();
    if (!texture) return;
    renderer.initTexture(texture);
    requestAnimationFrame(uploadNext);
  };
  requestAnimationFrame(uploadNext);
};

/** Hover brightens the model's own meshes, so the hovered model leaves its static batch meanwhile. */
const createModelHover = (hover: ReturnType<typeof createBuildingHover>,
  batches: ReturnType<typeof createBuildingStaticBatches>) => {
  let hoveredRoot: Object3D | undefined;
  return (entry?: BuildingEntry) => {
    const root = entry?.active.model.root;
    if (root !== hoveredRoot) {
      batches.setSuspended(hoveredRoot, false);
      batches.setSuspended(root, true);
      hoveredRoot = root;
    }
    hover.set(entry ? hoverRootOf(entry) : undefined);
  };
};

/** The models no longer show what the frame asks for (type, level, nation or camp layout); detail only swaps. */
const isStale = (entry: BuildingEntry, frame: BuildingFrame, wanted: { breachedKey?: string;
  level: BuildingLevel; nation: WorkerNation; neutral: boolean }) =>
  entry.type !== frame.type || entry.level !== wanted.level ||
  entry.nation !== wanted.nation || entry.neutral !== wanted.neutral || !sameBanditSite(entry.bandit, frame.bandit) ||
  entry.enemyCampEnclosure !== frame.enemyCampEnclosure ||
  entry.enemyStyleKey !== (frame.enemyStyle ? enemyBuildingStyleKey(frame.enemyStyle) : undefined) ||
  entry.enemyCatapultVariant !== frame.enemyCatapultVariant || entry.breachedWalls !== wanted.breachedKey;

/** Hover outlines the standing model, or the construction plan while the model is hidden. */
const hoverRootOf = ({ active }: BuildingEntry) => active.model.root.visible ? active.model.root : active.plan.root;

/** Optional island layer. Materials and meshes are allocated only once buildings exist. */
const updateHoveredLevelBadge = (
  badges: ReturnType<typeof createBuildingLevelBadges>, entry: BuildingEntry | undefined,
  hoveredId: string | null, time: number
) => {
  const level = entry && hoveredBuildingLevel(entry.frame, hoveredId, entry.demolition);
  if (!entry || !level) { badges.update([], time); return; }
  const frame = entry.frame;
  badges.update([{ level, x: frame.x + (frame.productionPaused ? .65 : 0),
    y: frame.y + entry.active.pauseHeight, z: frame.z, phase: entry.flagPhase }], time);
};

/** A standing, finished model: its static parts may draw from the cross-building batches. */
const isModelBatchable = (entry: BuildingEntry) => entry.frame.construction === 1 && !entry.demolition &&
  entry.active.model.root.visible && entry.frame.fortSiege?.fallenAge === undefined && entry.type !== MONUMENT_TYPE_ID;

/**
 * Runs after the scene-wide matrix update: batches compare the current world matrices. A parked
 * variant stays batched with hidden instances while the drawn one would be batchable. A frame that
 * built a model adds no units to the batches (the next frame does), so the two costs never add up.
 */
const syncStaticBatches = (batches: ReturnType<typeof createBuildingStaticBatches>,
  models: ReadonlyMap<string, BuildingEntry>, builtModel = false) => {
  batches.begin();
  for (const entry of models.values()) {
    const batchable = isModelBatchable(entry);
    batches.visit(entry.active.model.root, batchable);
    if (entry.parked) batches.visit(entry.parked.model.root, batchable && entry.parked.finishedPose === true, false);
    batches.visit(entry.roadMarker, entry.roadMarker.visible && !entry.demolition);
  }
  batches.end(builtModel ? 0 : undefined);
};

/** Batched source meshes sit on their own layer; the pick ray still has to hit them. */
const intersectBuildingRoots = (raycaster: Raycaster, roots: Object3D[]) => {
  const mask = raycaster.layers.mask;
  raycaster.layers.enable(BUILDING_BATCH_SOURCE_LAYER);
  try { return raycaster.intersectObjects(roots, true); }
  finally { raycaster.layers.mask = mask; }
};

/** The nearest visible building (model or construction plan) under the ray, demolitions excluded. */
const pickBuildingHit = (models: ReadonlyMap<string, BuildingEntry>, raycaster: Raycaster) => {
  const roots = [...models.values()].filter(entry => !entry.demolition).flatMap(({ active }) =>
    [active.model.root, active.plan.root].filter(root => root.visible));
  const hit = intersectBuildingRoots(raycaster, roots).find(hit => {
    for (let object = hit.object; object; object = object.parent!)
      if (!object.visible) return false;
    return true;
  });
  if (!hit) return null;
  for (const [id, entry] of models)
    for (let object = hit.object; object; object = object.parent!)
      if (object === entry.active.model.root || object === entry.active.plan.root)
        return { id, distance: hit.distance };
  return null;
};


type PresentContext = {
  burnEffects: ReturnType<typeof createBuildingBurnEffects>;
  ceilings: ReturnType<typeof createExplorationCeilingQuery>;
  constructionGround?: ConstructionGround;
  environment: EnvironmentState;
  healthMarkers: BuildingHealthMarker[];
  materialsFor: (nation: WorkerNation) => MaterialGroup;
  pauseMarkers: BuildingPauseMarker[];
  playerColor?: [number, number, number];
  roadMarkers: ReturnType<typeof createBuildingRoadMarkers>;
  scene: Scene;
  siegeFires: ReturnType<typeof createFortSiegeFires>;
  time: number;
  updateShadows: boolean;
  upgradeMarkers: BuildingUpgradeMarker[];
};

/** Demolition fire and collapse of the drawn model. */
const updateDemolition = (context: PresentContext, active: BuildingVariant, frame: BuildingFrame) => {
  if (frame.demolitionAge !== undefined && !active.burn) {
    active.model.root.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(active.model.root);
    bounds.min.y = frame.y;
    active.burn = context.burnEffects.create(bounds, frame.id, active.model.root);
    active.originalScaleY = active.model.root.scale.y;
    context.scene.add(active.burn.root);
  }
  if (!active.burn) return;
  const age = frame.demolitionAge!;
  active.burn.update(age);
  active.model.root.scale.y = active.originalScaleY! * buildingCollapseScale(age);
};

/** Places and animates the drawn variant of one building for this frame and collects its markers. */
const presentBuilding = (context: PresentContext, entry: BuildingEntry, frame: BuildingFrame) => {
  const { active } = entry;
  const { environment, scene, time } = context;
  active.model.root.position.set(frame.x, frame.y, frame.z);
  active.model.root.rotation.y = frame.rotation;
  updateDemolition(context, active, frame);
  updateFortSiege(scene, context.siegeFires, active, frame, time, context.healthMarkers);
  updateRomanBuildingWindState(entry.windState, frame, environment);
  if ((frame.owner ?? 0) === 0 && context.playerColor) entry.windState.playerColor = context.playerColor;
  active.model.update(time, entry.windState, entry.flagPhase);
  active.finishedPose = frame.construction === 1;
  const night = environment.daylight < .25 && frame.construction === 1;
  updateWindowGlow(active.model.root, night && frame.windowLit === true);
  updateNightLampGlow(active.model.root, night);
  active.plan.root.position.set(frame.x, frame.y, frame.z);
  active.plan.root.rotation.y = frame.rotation;
  active.plan.update(frame);
  updateUpgradeStock(scene, active, frame, entry.request.level, active.detailed,
    context.materialsFor(entry.request.nation));
  context.roadMarkers.update(entry.roadMarker, frame, context.constructionGround);
  if (entry.demolition) { active.plan.root.visible = false; entry.roadMarker.visible = false; }
  active.model.root.visible = frame.construction !== 0 && (frame.demolitionAge ?? 0) < 10 &&
    isFortStanding(frame.fortSiege?.fallenAge);
  updateCeiling(context.ceilings, frame.id, entry);
  active.caster.root.visible = active.model.root.visible;
  if (context.updateShadows && active.model.root.visible) active.caster.update();
  // One scene-wide matrix update below covers the model; frustum culling stays on the meshes.
  if (frame.productionPaused && frame.construction === 1 && !entry.demolition)
    context.pauseMarkers.push({ x: frame.x, y: frame.y + active.pauseHeight, z: frame.z, phase: entry.flagPhase });
  addUpgradeMarker(context.upgradeMarkers, frame, active);
};

/** The frame's nation, owner style, camp breaches and level, apart from the detail recipe. */
const variantRequestOf = (frame: BuildingFrame): VariantRequest => {
  const neutral = !!frame.enemyCatapultVariant || (frame.owner ?? 0) !== 0 && hasNeutralBuildingStyle(frame.type);
  return { breached: frame.eventCourtyardWalls?.flatMap((hp, side) => hp <= 0 ? [side] : []),
    level: neutral ? 1 : frame.level ?? 1, nation: frame.nation ?? "roman", neutral };
};

export const createThreeBuildings = (
  high: boolean,
  shadowScene: Scene,
  shadowUniforms: Record<string, IUniform>,
  renderer?: WebGLRenderer,
  constructionGround?: ConstructionGround,
  /** Surface maps the loader painted ahead (world workers); the rest is painted on first use. */
  painted?: PaintedSurfaces,
  afterFirstFrame?: Promise<void>,
  enemyStyle: EnemyBuildingStyle = { theme: "forest" },
  /** Skip the per-building shadow-copy pass when the quality preset has no sun-shadow scene. */
  updateShadows = true,
  atmosphereUniforms: Record<string, IUniform> = {}
) => {
  let disposed = false;
  const restorePixels = watchSurfaceRestore(renderer, painted);
  const scene = new Scene();
  const hover = createBuildingHover(scene, { colorUniforms: atmosphereUniforms });
  const staticBatches = createBuildingStaticBatches(scene, renderer);
  const hoverEntry = createModelHover(hover, staticBatches);
  let hoveredId: string | null = null;
  /** The hover outline also shows on a hostile building (the soldiers' siege target, military controls P3). */
  let hoverAnyOwner = false;
  const hoverModel = (id: string | null, entry?: BuildingEntry) => { hoveredId = id; hoverEntry(entry); };
  const updateLights = createCrowdLights(scene);
  const casterMaterial = new MeshBasicMaterial();
  const variants = createBuildingVariantBuilder({ casterMaterial, constructionGround, enemyStyle, high, painted,
    shadowUniforms, updateShadows });
  const { materialsFor, monuments } = variants;
  const parking = createParkedVariants(scene, shadowScene);
  /** Recipes and geometry come from background workers; in play a building waits for them. */
  const recipeJobs = createBuildingRecipeJobs();
  /** Behind the loading screen models are built at once from the prefetched recipes. */
  let loading = false;
  const canBuild = (type: number, request: VariantRequest, detailed: boolean, parksOther: boolean) =>
    loading || recipeJobs.ready(type, request, detailed, parksOther);
  /** High only: entries whose other detail recipe is still to be built in the background. */
  const prebuildQueue = new Set<BuildingEntry>();
  const compileCamera = new OrthographicCamera();
  const roadMarkers = createBuildingRoadMarkers();
  const burnEffects = createBuildingBurnEffects(high, createBurnResources(high, atmosphereUniforms));
  const siegeFires = createFortSiegeFires(high, burnEffects.resources);
  const healthBars = createBuildingHealthBars(atmosphereUniforms);
  const upgradeBars = createBuildingUpgradeBars(atmosphereUniforms);
  const pauseBadges = createBuildingPauseBadges(high);
  scene.add(healthBars.root, upgradeBars.root, pauseBadges.root);
  const upgradeBadges = createBuildingLevelBadges(high);
  let badgeTime = 0;
  const refreshLevelBadge = () => updateHoveredLevelBadge(upgradeBadges,
    hoveredId ? models.get(hoveredId) : undefined, hoveredId, badgeTime);
  scene.add(upgradeBadges.root);
  const models = new Map<string, BuildingEntry>();
  const matrices = createSceneMatrixGate(scene);
  const ceilings = createExplorationCeilingQuery();
  const buildVariant = (frame: BuildingFrame, request: VariantRequest, detailed: boolean) => {
    const variant = variants.create(frame, request, detailed, recipeJobs.take(frame.type, request, detailed));
    watchCeilingAsset(ceilings, frame.id, variant.model.root);
    return variant;
  };
  const removeEntry = (id: string, entry: BuildingEntry) => {
    ceilings.remove(id);
    if (id === hoveredId) hoverModel(null);
    disposeVariant(scene, shadowScene, entry.active);
    parking.release(entry);
    prebuildQueue.delete(entry);
    scene.remove(entry.roadMarker);
    models.delete(id);
  };
  const createEntry = (frame: BuildingFrame, request: VariantRequest, detailed: boolean) => {
    const entry: BuildingEntry = {
      type: frame.type, enemyStyleKey: frame.enemyStyle ? enemyBuildingStyleKey(frame.enemyStyle) : undefined,
      frame, level: request.level, nation: request.nation, neutral: request.neutral,
      bandit: frame.bandit, enemyCatapultVariant: frame.enemyCatapultVariant,
      enemyCampEnclosure: frame.enemyCampEnclosure, breachedWalls: request.breached?.join(","),
      active: buildVariant(frame, request, detailed), request, demolition: false, owner: frame.owner ?? 0,
      windState: createRomanBuildingWindState(), flagPhase: romanBuildingFlagPhase(frame),
      roadMarker: roadMarkers.create()
    };
    models.set(frame.id, entry);
    attachVariant(scene, shadowScene, entry.active);
    scene.add(entry.roadMarker);
    if (high) prebuildQueue.add(entry);
    return entry;
  };
  /** One model build per frame in play: a zoom switch swaps parked variants for free. */
  const budget = { builds: 1 };
  /** The zoom crossed the detail threshold: draw the parked variant, or build it while the budget lasts. */
  const swapDetail = (entry: BuildingEntry, frame: BuildingFrame, detailed: boolean) => {
    let next = entry.parked;
    if (!next) {
      if (budget.builds <= 0) return;
      budget.builds--;
      next = buildVariant(frame, entry.request, detailed);
    }
    if (frame.id === hoveredId) hoverModel(null);
    ceilings.remove(frame.id);
    parking.activate(entry, next);
  };
  /** Poses an off-scene variant like the drawn one, so its static-batch copy shows the same parts. */
  const poseParked = (entry: BuildingEntry, variant: BuildingVariant) => {
    variant.model.update(badgeTime, entry.windState, entry.flagPhase);
    variant.finishedPose = entry.frame.construction === 1;
    placeVariant(variant, entry.frame);
  };
  const compileVariant = (variant: BuildingVariant) => {
    void renderer?.compileAsync(variant.model.root, compileCamera, scene).catch(() => undefined);
  };
  /** Builds the other detail recipe of one entry in a frame without any other model build. */
  const prebuildOne = () => {
    if (budget.builds <= 0 || !parking.hasRoom()) return;
    for (const entry of prebuildQueue) {
      if (entry.parked || models.get(entry.frame.id) !== entry) { prebuildQueue.delete(entry); continue; }
      if (!canBuild(entry.type, entry.request, !entry.active.detailed, false)) continue;
      prebuildQueue.delete(entry);
      const variant = buildVariant(entry.frame, entry.request, !entry.active.detailed);
      poseParked(entry, variant);
      if (parking.park(entry, variant)) compileVariant(variant);
      budget.builds--;
      return;
    }
  };
  /** R16b: the zoom rule in the strategic view; the eye radius (with hysteresis) when possessed. */
  const wantsDetail = (frame: BuildingFrame, entry: BuildingEntry | undefined, zoom: number,
    eye: BuildingDetailEye | undefined) =>
    isBuildingDetailedInView(high, zoom, eye, frame, entry?.active.detailed ?? false);
  /**
   * The entry drawing the frame. A new type, level, nation or camp layout is built once the workers
   * prepared its recipes and geometry, in a frame without another model build; until then the
   * previous model stays (a new building appears a few frames later).
   */
  const entryFor = (frame: BuildingFrame, zoom: number, eye: BuildingDetailEye | undefined) => {
    const request = variantRequestOf(frame);
    const entry = models.get(frame.id);
    const wanted = { breachedKey: request.breached?.join(","), level: request.level, nation: request.nation,
      neutral: request.neutral };
    const current = entry && !isStale(entry, frame, wanted) ? entry : undefined;
    const detailed = wantsDetail(frame, current, zoom, eye);
    if (current) {
      current.request = request;
      if (current.active.detailed !== detailed) swapDetail(current, frame, detailed);
      return current;
    }
    // In play one model build per frame: further new or changed buildings follow in the next frames.
    if ((!loading && budget.builds <= 0) || !canBuild(frame.type, request, detailed, high)) return entry;
    if (entry) removeEntry(frame.id, entry);
    budget.builds--;
    return createEntry(frame, request, detailed);
  };
  const clearMarkers = (time: number) => {
    upgradeBadges.update([], time); pauseBadges.update([], time); healthBars.update([]); upgradeBars.update([]);
  };
  const update = (
    frames: readonly BuildingFrame[],
    time: number,
    environment: EnvironmentState,
    zoom: number,
    playerColor?: [number, number, number],
    /** R16b: the possessed eye; absent in the strategic view (the zoom rule applies). */
    eye?: BuildingDetailEye
  ) => {
    badgeTime = time;
    budget.builds = 1;
    const present = new Set(frames.map((frame) => frame.id));
    for (const [id, entry] of models) {
      if (present.has(id)) continue;
      removeEntry(id, entry);
    }
    if (!frames.length) { clearMarkers(time); syncStaticBatches(staticBatches, models); return; }
    const context: PresentContext = { burnEffects, ceilings, constructionGround, environment, healthMarkers: [],
      materialsFor, pauseMarkers: [], playerColor, roadMarkers, scene, siegeFires, time, updateShadows,
      upgradeMarkers: [] };
    updateLights(environment);
    for (const frame of frames) {
      const entry = entryFor(frame, zoom, eye);
      if (!entry) continue;
      entry.frame = frame;
      entry.demolition = frame.demolitionAge !== undefined;
      entry.owner = frame.owner ?? 0;
      if (hoveredId === frame.id && ((entry.owner !== 0 && !hoverAnyOwner) || entry.demolition)) hoverModel(null);
      presentBuilding(context, entry, frame);
      if (entry.parked && !entry.parked.finishedPose && frame.construction === 1) poseParked(entry, entry.parked);
    }
    if (high) prebuildOne();
    pauseBadges.update(context.pauseMarkers, time);
    refreshLevelBadge();
    healthBars.update(context.healthMarkers);
    upgradeBars.update(context.upgradeMarkers);
    scene.updateMatrixWorld();
    syncStaticBatches(staticBatches, models, budget.builds < 1);
    matrices.markCurrent();
  };
  /** Startup (behind the loading screen): every parked variant is built, batched and compiled. */
  const prebuildAll = async () => {
    while (prebuildQueue.size && parking.hasRoom()) { budget.builds = 1; prebuildOne(); }
    syncStaticBatches(staticBatches, models);
    const parked = [...models.values()].flatMap(entry => entry.parked ? [entry.parked.model.root] : []);
    await Promise.all(parked.map(root => buildingAssetReady(root)));
    await Promise.all(parked.map(root => renderer?.compileAsync(root, compileCamera, scene)));
  };
  const pickHit = (raycaster: Raycaster) => pickBuildingHit(models, raycaster);
  return {
    prepare: async (frames: readonly BuildingFrame[], environment: EnvironmentState, zoom: number) => {
      if (!renderer) return;
      await recipeJobs.prefetch(frames.flatMap(frame => recipeJobsOf(frame.type, variantRequestOf(frame))));
      loading = true;
      try {
        update(frames, 0, environment, zoom);
        await Promise.all([...models.values()].map(entry => buildingAssetReady(entry.active.model.root)));
        await prebuildAll();
      } finally { loading = false; }
      await staticBatches.ready();
      const compiled = renderer.compileAsync(scene, new OrthographicCamera());
      // Upload once here; placement ghosts and subsequent buildings reuse these texture objects.
      const textures = collectPackTextures(variants.packMaterials());
      const visible = collectVisibleTextures(scene);
      for (const texture of visible) renderer.initTexture(texture);
      await compiled;
      if (afterFirstFrame) void afterFirstFrame.then(() =>
        uploadTexturesOverFrames(renderer, [...textures].filter(texture => !visible.has(texture)), () => disposed));
    },
    assetStats: () => ({ ...staticBatches.stats(), ...parking.stats(),
      ...monuments.stats([...models.values()].filter(entry => entry.type === 7)
        .map(entry => entry.active.model.root)) }),
    materialsFor,
    update,
    hoverStats: hover.getStats,
    pickHit,
    ceilingHeight: ceilings.sample,
    pick: (raycaster: Raycaster) => pickHit(raycaster)?.id ?? null,
    /** The recipe a building draws now (garrison window slots follow it); undefined when not drawn. */
    isDetailed: (id: string) => models.get(id)?.active.detailed,
    /** Outlines a building of the player; `anyOwner` also allows a hostile one (an army target). */
    setHover: (id: string | null, anyOwner = false) => {
      const entry = id ? models.get(id) : undefined;
      hoverAnyOwner = anyOwner;
      const allowed = Boolean(entry && (anyOwner || entry.owner === 0) && !entry.demolition);
      if (allowed) hoverModel(id, entry);
      else hoverModel(null);
      refreshLevelBadge();
      return allowed;
    },
    render: (renderer: WebGLRenderer, camera: Camera) => {
      staticBatches.beforeRender(camera);
      pauseBadges.faceCamera(camera);
      upgradeBadges.faceCamera(camera);
      // `update` ran this frame's scene-wide matrix update; only the badges turned since.
      if (models.size) matrices.render(renderer, camera, [pauseBadges.root, upgradeBadges.root]);
      else matrices.invalidate();
    },
    dispose: () => {
      disposed = true;
      renderer?.domElement.removeEventListener("webglcontextrestored", restorePixels);
      hover.dispose();
      staticBatches.dispose();
      for (const entry of models.values()) {
        disposeVariant(scene, shadowScene, entry.active);
        parking.release(entry);
      }
      prebuildQueue.clear();
      recipeJobs.dispose();
      casterMaterial.dispose();
      burnEffects.dispose();
      siegeFires.dispose();
      healthBars.dispose();
      pauseBadges.dispose();
      upgradeBars.dispose();
      upgradeBadges.dispose();
      roadMarkers.dispose();
      models.clear();
      ceilings.clear();
      variants.dispose();
      scene.clear();
    }
  };
};
