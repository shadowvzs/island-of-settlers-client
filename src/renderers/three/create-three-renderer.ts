import {
  type Camera,
  type Object3D,
  OrthographicCamera,
  Scene,
  Vector3,
  type Vector4,
  WebGLRenderer
} from "three";

import { applyCharacterDetail } from "../../render-common/character-detail";
import { DEFAULT_COLOR_TONE, toneWeightFor } from "../../render-common/color-output";
import { type EnvironmentState, getSunShadowWeight } from "../../render-common/environment";
import { EXPLORATION_FIELD_OF_VIEW } from "../../render-common/exploration/exploration-frame";
import { createFirstFrameSignal } from "../../render-common/first-frame-signal";
import { markFrameStage, markRenderPass } from "../../render-common/frame-profiler";
import { describeGround } from "../../render-common/ground-shader-variant";
import { clampHighlights, NEUTRAL_HIGHLIGHTS } from "../../render-common/highlights";
import { profileAsync, profileStep } from "../../render-common/load-profile";
import { createPresentationScheduler } from "../../render-common/presentation-scheduler";
import {
  fieldCropCoverCells, getFieldSoilBounds, setFieldCropCoverCells
} from "../../render-common/props/field-cover-exclusions";
import type {
  CreateRenderer,
  FrameState,
  RendererInput,
  RendererModule,
  TerrainRenderer
} from "../../render-common/renderer-contract";
import { getPixelRatio } from "../../render-common/resolution";
import { showsSmallRocks } from "../../render-common/rocks/island-rocks";
import { getMonsoonRainScale } from "../../render-common/seasonal-appearance/monsoon-weather";
import { getSeasonLeafCapacity } from "../../render-common/seasonal-appearance/season-leaf-fall";
import { getSpringFlowerSamples } from "../../render-common/seasonal-appearance/spring-bloom";
import { getWinterFoliageAtlas } from "../../render-common/seasonal-appearance/winter-foliage";
import { getWinterGroundMaterials } from "../../render-common/seasonal-appearance/winter-shore";
import { DEFAULT_PLAYER_COLOR, playerColorFromHex } from "../../render-common/settlement/player-color";
import { SCALAR_UNIFORMS, updateSharedUniformValues } from "../../render-common/shader-uniforms";
import type { createSnowMap } from "../../render-common/snow-map";
import { startIslandBuilds } from "../../render-common/start-island-builds";
import { TRAFFIC_WEAR_TUNING } from "../../render-common/traffic-wear";
import { createWorkerDisplay } from "../../render-common/workers/worker-display";
import { WORKER_SCALE } from "../../render-common/workers/worker-dimensions";
import type { ExplorationHeroBody, WorkerAppearance } from "../../render-common/workers/worker-unit";
import { createBridgeSurfaceService } from "../../shared/settlement/bridge-surface";
import { sampleBilinear, sampleSmooth } from "../../shared/world/grid-geometry";
import {
  aoExcludedLastOpaqueSort,
  excludeFromAmbientOcclusion,
  renderAsAmbientOcclusionReceivers
} from "./ambient-occlusion-exclusion";
import { createAtmosphereState, withoutAtmosphere } from "./atmosphere/atmosphere-state";
import { createStandardAtmosphereBinding } from "./atmosphere/standard-atmosphere";
import { boatTransferTransform, yardBoatWorkerHeading } from "./worker-boat-transfer";
import { createBuildingPlacementGhost } from "./buildings/building-placement-ghost";
import { createBuildingPlacementPreviews } from "./buildings/building-placement-previews";
import { loadPaintedSurfaces, prefetchBuildingSurfaces } from "./buildings/building-surface-loading";
import { createThreeBuildings } from "./buildings/three-buildings";
import {
  beginCharacterProfileFrame,
  characterProfileDetails,
  characterProfileEnabled,
  rollCharacterWindow
} from "./character-profile";
import { createCinematicView } from "./cinematic/cinematic-view";
import {
  createColorOutputControl,
  exposeColorOutputDevHook,
  withLinearColorCapture
} from "./color/color-output-control";
import { createLiveExplorationBodyLoader } from "./exploration/exploration-appearance";
import { explorationBuildingEye, explorationLodDistances, explorationLodZoom } from "./exploration/exploration-lod";
import { createExplorationCameraRig } from "./exploration/three-camera";
import { explorationPrewarmEnabled } from "./exploration-prewarm-mode";
import { createExplorationWeatherAdapter } from "./exploration-weather";
import {
  createFrameCompositor,
  exposeAmbientOcclusionDevHook,
  exposeBloomDevHook,
  exposeFrameCompositorDevHook,
  exposeLinearOutputDevHook,
  exposeWaterReflectionDevHook
} from "./frame-compositor";
import { getGrassFade } from "./grass-fade";
import { createThreeGrassRing, type GrassRingFrame } from "./grass-ring/three-grass-ring";
import { createImpostorWarmup } from "./impostor-warmup";
import { getRendererContextOptions } from "./renderer-context-options";
import { trackRendererSharedListeners } from "./renderer-shared-listeners";
import { createSeasonUniformWriter } from "./season-uniforms";
import { waitForAdvancedMaterialTextures } from "./settlement/advanced-material-assets";
import { createThreeDepositSigns } from "./settlement/three-deposit-signs";
import { createThreeStoneDeposits } from "./settlement/three-stone-deposits";
import { acquireWareMaterials } from "./settlement/ware-material-cache";
import { describeShadowTiming } from "./shadow-light-cameras";
import { createSkyEnvironment } from "./sky-environment";
import { createGroundPaletteSync, createGroundPaletteUniforms } from "./three-ground-palette";
import { createRuinScorchSync } from "./three-ground-scorch";
import { createRendererIceFloes, hasIceFloeScene } from "./three-ice-floes";
import { createThreeLightning, GROUND_STRIKE_SECONDS } from "./three-lightning";
import {
  createAtlasTexture,
  createTerrainMaterial,
  createWaterMaterial,
  releaseFallbackFogGpu,
  setTerrainVariant} from "./three-materials";
import { createThreeMounts } from "./three-mounts";
import { createPropDepthMaterial, createPropMaterial } from "./three-prop-materials";
import { createRendererAmbient } from "./three-renderer-ambient";
import { createThreeMapEdit } from "./three-renderer-map-edit";
import { createRendererPicking } from "./three-renderer-picking";
import { createRefractionRenderer, sizeRefractionTarget } from "./three-renderer-refraction";
import { createRendererSettlement } from "./three-renderer-settlement";
import { createRendererShading } from "./three-renderer-shading";
import { createCavalryLayer, createWorkerCrowdLoader } from "./three-renderer-workers";
import { createThreeRocks } from "./three-rocks";
import { createSceneShadowCasters } from "./three-scene-shadow-casters";
import { createSeasonalContentBuilders, getSeasonalVegetationUniforms } from "./three-seasonal-content";
import { watchThreeShaderErrors } from "./three-shader-errors";
import { type DynamicSunCasters, getShadowFocus, isLegacyShadowFadeProbe, isSunCasterProbeOff } from "./three-shadows";
import { releaseSharedLightingGpu } from "./three-shared-lighting-lifecycle";
import { createThreeStress } from "./three-stress";
import { createThreeTerrain } from "./three-terrain";
import { createThreeVegetation, prefetchThreeVegetation, type VegetationFrame } from "./three-vegetation";
import { createWorkerTextureLoader } from "./three-worker";
import { waitForGpuFrame } from "./wait-for-gpu-frame";
import { createWebGpuSpikeWiring, type WebGpuSpikeRendererOptions } from "./webgpu/spike-wiring";

/** Snowfall over snow free ground, relative to a snowy area. */
const LIGHT_SNOWFALL = 0.55;
const BACKGROUND = 0x0b2238;
/** Presentation leftover per frame when no render loop scheduler is supplied (tools, replays). */
const OWN_PRESENTATION_MS = 2;
const EMPTY_ROAD_DECORATIONS: NonNullable<FrameState["roadDecorations"]> = [];
const EMPTY_SHIPS: NonNullable<FrameState["ships"]> = [];
const EMPTY_BOATS: NonNullable<FrameState["shuttleBoats"]> = [];
const EMPTY_FISHING_BOATS: NonNullable<FrameState["fishingBoats"]> = [];

/**
 * Starts compiling every program of the scenes (KHR_parallel_shader_compile through
 * compileAsync, not awaited): the driver compiles in the background while the app finishes its
 * setup (animal navigation, sound), so the first frame finds them ready. The camera only drives
 * the traversal (the programs do not depend on it).
 */
const compileShaders = (renderer: WebGLRenderer, scenes: Scene[], prepare: (scene: Scene) => void) => {
  const camera = new OrthographicCamera();
  return Promise.all(scenes.map(scene => {
    prepare(scene);
    return renderer.compileAsync(scene, camera);
  }));
};

/**
 * Rain, or snowfall: over snowy ground (the snow map at the view) it falls full, elsewhere as
 * a light snowfall (no snow cover appears there). Monsoon downpours fall heavier (M1). The global
 * season's snowfall and snow cover (T1) count as snowy ground.
 */
const getPrecipitation = (snowMap: ReturnType<typeof createSnowMap>, { camera, environment }: FrameState) => {
  const theme = snowMap.hasSnow ? snowMap.sample(camera.centerX, camera.centerZ) : 0;
  const season = environment.season;
  const winter = Math.max(theme, season?.snowfall ?? 0, season?.snowCover ?? 0);
  const snow = environment.snow * (LIGHT_SNOWFALL + (1 - LIGHT_SNOWFALL) * winter);
  const amount = environment.rain * getMonsoonRainScale(environment.season?.monsoon ?? 0) + snow;
  return { amount, snowShare: amount > 0 ? snow / amount : 0 };
};

const toCamera = new Vector3();
const viewDirection = new Vector3();

/**
 * World-space storm flashes: the rain scheduler triggers a 3D bolt and its thunder callback. A
 * cinematic `strikeAt` (CIN2/CIN6) reaches the ground at its point and also flashes in clear weather: its bolt
 * is not cleared by the dry sky. `setWarming` keeps the idle layer drawn (invisible) during the loading frames,
 * so the first strike compiles no shader.
 */
const createStormLightning = (world: Parameters<typeof createThreeLightning>[0],
  scene: Scene, onLightning?: () => void) => {
  const layer = createThreeLightning(world);
  scene.add(layer.root);
  let camera: Camera | undefined, time = 0, centre = { x: world.cellsX / 2, z: world.cellsZ / 2 };
  let forcedUntil = Number.NEGATIVE_INFINITY;
  let warming = false;
  return {
    setWarming: (on: boolean) => { warming = on; },
    trigger: () => {
      if (camera) layer.strike(camera, centre, time);
      onLightning?.();
    },
    /** One bolt exactly at x/z; returns false before the first frame (no camera to face yet). */
    strikeAt: (x: number, z: number) => {
      if (!camera) return false;
      layer.strikeGround(camera, { x, z }, time);
      forcedUntil = time + GROUND_STRIKE_SECONDS;
      onLightning?.();
      return true;
    },
    update: (nextCamera: Camera, frame: FrameState, enabled = true) => {
      camera = nextCamera; time = frame.time;
      centre = { x: frame.camera.centerX, z: frame.camera.centerZ };
      const forced = frame.time < forcedUntil;
      if (!forced && (!enabled || frame.environment.rain <= .01)) layer.clear();
      else layer.update(frame.time);
      if (warming) layer.warm();
    },
    dispose: () => layer.dispose()
  };
};

/** The stats overlay's view label. */
const describeView = (cinematic: boolean, exploring: boolean, mode: string) => {
  if (cinematic) return "campaign-cinematic";
  return exploring ? "exploration" : mode;
};

/** Glints follow the real camera (the cinematic view looks from a different angle). */
const setViewDirection = (
  target: Float32Array, camera: Camera, state: FrameState["camera"], targetHeight: number
) => {
  toCamera
    .set(camera.position.x - state.centerX, camera.position.y - targetHeight, camera.position.z - state.centerZ)
    .normalize();
  target[0] = toCamera.x;
  target[1] = toCamera.y;
  target[2] = toCamera.z;
};

/** FPS glints follow the eye's forward direction (the negative of the toward-camera vector). */
const setExplorationViewDirection = (target: Float32Array, camera: Camera) => {
  camera.getWorldDirection(toCamera).multiplyScalar(-1);
  target[0] = toCamera.x;
  target[1] = toCamera.y;
  target[2] = toCamera.z;
};

// eslint-disable-next-line max-lines-per-function -- one factory owns all renderer/GPU bindings
const createThreeRendererWithOptions = async (input: RendererInput,
  spikeOptions: WebGpuSpikeRendererOptions | null) => {
  const {
    ambientOcclusion: ambientOcclusionRequest,
  animals: animalModels,
  bloom: bloomRequest,
  builders: sourceBuilders,
  buildingNation,
  canvas,
  characterDetail = "auto",
  colorOutput: colorOutputRequest,
  colorTone: colorToneRequest = DEFAULT_COLOR_TONE,
  explorationAudio,
  explorationFog,
  flyerAtlas,
  foliageAtlas: sourceFoliageAtlas,
  groundShader: groundShaderRequest = "auto",
  highlights = NEUTRAL_HIGHLIGHTS,
  materials: sourceMaterials,
  microDetail,
  mounts: mountAppearances, onLightning,
  presentation: loopPresentation,
  quality,
  resolution,
  rockTexture,
  sceneDepth = false,
  sceneTarget: sceneTargetRequest,
  seasonSnow = false,
  spikeNoOffscreen = false,
  stress,
  visualWinter = false,
  waterReflections: waterReflectionsRequest,
    workers: workerAppearances,
    world
  } = input;
  // T1: with the GPU season snow armed the prepared (prepainted) winter assets are only the fallback; the snapping
  // winter extras (ice floes, frozen shore, no grass ring) still follow visualWinter; the water colour and the
  // critter hibernation follow the season's ice ramp (seasons-6).
  const preparedWinter = visualWinter && !seasonSnow;
  const builders = createSeasonalContentBuilders(sourceBuilders, preparedWinter);
  const foliageAtlas = preparedWinter ? getWinterFoliageAtlas(sourceFoliageAtlas) : sourceFoliageAtlas;
  const materials = preparedWinter ? getWinterGroundMaterials(sourceMaterials) : sourceMaterials;
  // R10: the scene target owns the frame's MSAA, so the canvas itself is not antialiased.
  const sceneTarget = sceneTargetRequest ?? quality.sceneTarget;
  const renderer = new WebGLRenderer(
    getRendererContextOptions(canvas, resolution.antialias, sceneTarget)
  );
  renderer.setOpaqueSort(aoExcludedLastOpaqueSort);
  const releaseSharedListeners = trackRendererSharedListeners(renderer);
  const workerTextures = createWorkerTextureLoader(renderer);
  let latestWorkerFrame: Pick<FrameState, "workers" | "environment" | "exploration"> | undefined;
  /** C11: whether the last frame used the exploration camera (the first possessed frame resets). */
  let exploringView = false;
  const terrainHeight = (x: number, z: number) => sampleSmooth(world, world.heights, x, z);
  const bridgeSurface = createBridgeSurfaceService(terrainHeight,
    (x, z) => sampleBilinear(world, world.waterSurface, x, z));
  const bridgeHeight = (x: number, z: number) => bridgeSurface.height(x, z);
  const groundHeight = (x: number, z: number) => bridgeHeight(x, z) ?? terrainHeight(x, z);
  const cameraGroundHeight = (x: number, z: number) => bridgeHeight(x, z) ?? Math.max(world.seaLevel, terrainHeight(x, z));
  /** Rain impacts: open water outside bridge decks; its splashes land on the water surface. */
  const rainOnWater = (x: number, z: number) =>
    bridgeHeight(x, z) === undefined && sampleBilinear(world, world.waterDepth, x, z) > 0.02;
  const rainSurfaceHeight = (x: number, z: number) => rainOnWater(x, z)
    ? sampleBilinear(world, world.waterSurface, x, z)
    : groundHeight(x, z);
  // Live copies: the player's Character detail choice changes the cap and the cadence floor
  // without a reload; the shared QUALITY_PRESETS object is never mutated.
  const characterPolicy = { ...quality.characters };
  const cadenceBias = { bias: 0, floor: 0 };
  applyCharacterDetail(characterDetail, quality.characters, { cadence: cadenceBias, policy: characterPolicy });
  const loadWorkers = createWorkerCrowdLoader(workerTextures, !quality.liteGround, world, () => latestWorkerFrame,
    bridgeHeight, { cadenceBias, characters: characterPolicy });
  const workerBuild = workerAppearances ? loadWorkers(workerAppearances) : Promise.resolve(null);
  const cavalry = createCavalryLayer(workerTextures, !quality.liteGround, characterPolicy);
  const mountBuild = mountAppearances?.length
    ? createThreeMounts(workerTextures, mountAppearances, !quality.liteGround, { characters: characterPolicy })
    : Promise.resolve(null);
  renderer.setPixelRatio(getPixelRatio(window.devicePixelRatio, resolution));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setClearColor(BACKGROUND);
  const spike = await createWebGpuSpikeWiring(spikeOptions, canvas);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  /** Worker builds start first: they run while the main thread creates the GPU objects. */
  const { coverFieldBuild, grassBuild, rocksBuild, terrainBuild, waterFieldBuild } = startIslandBuilds(builders, quality);
  const surfacesBuild = loadPaintedSurfaces(builders, buildingNation, !quality.liteGround);
  const {
    albedo, dispose: disposeShading, fog, fogTexture, grassFade, groundShader, normal, ownCoverField, ownTrafficWear,
    ownWaterField, refraction, shadows, snowMap, uniforms, uniformValues, updateSkyView, viewport
  } = createRendererShading({ explorationFog, flyerAtlas, foliageAtlas, gl, groundShaderRequest, materials, microDetail,
    quality, seasonSnow, visualWinter, world });
  const atmosphere = createAtmosphereState(world, quality, uniformValues);
  uniformValues.uColorVividBoost = quality.vividSaturationBoost;
  uniformValues.uHighlight = clampHighlights(highlights);
  uniformValues.uFogOfWarLit = quality.fogOfWarStyle === "lit" ? 1 : 0;
  const colorOutput = createColorOutputControl(renderer, uniformValues, colorOutputRequest);
  const bloom = bloomRequest ?? quality.bloom;
  const activeSceneTarget = spike.active || spikeNoOffscreen ? "off" : sceneTarget;
  const compositor = activeSceneTarget === "off"
    ? null
    : createFrameCompositor(renderer, uniforms, {
      ambientOcclusion: ambientOcclusionRequest ?? quality.ambientOcclusion,
      antialias: resolution.antialias,
      bloom,
      exposureMode: quality.exposureMode,
      exposureStrength: quality.exposureStrength,
      format: activeSceneTarget,
      iceFloes: hasIceFloeScene(quality, snowMap, visualWinter),
      volumetricLight: quality.volumetricLight,
      volumetricLightStrength: quality.volumetricLightStrength,
      waterReflections: waterReflectionsRequest ?? quality.waterReflections,
      winter: preparedWinter
    });
  if (activeSceneTarget !== "off" && !compositor) console.warn("Scene target unavailable: drawing to the canvas");
  // Development only (?depth=1): requests the resolved depth as the first R12 consumer would.
  if (sceneDepth) compositor?.useDepth();
  let activeCompositor = compositor;
  const removeCompositorHook = compositor ? exposeFrameCompositorDevHook(active => {
    if (active !== undefined) activeCompositor = active ? compositor : null;
    return activeCompositor !== null;
  }) : () => {};
  let linearOutput = false;
  const removeLinearOutputHook = compositor ? exposeLinearOutputDevHook(active => {
    if (active !== undefined) linearOutput = active;
    compositor.setLinearOutput(linearOutput);
    return linearOutput;
  }) : () => {};
  const removeBloomHook = compositor ? exposeBloomDevHook(active => {
    if (active !== undefined) compositor.setBloom?.(active);
    return (compositor.stats().bloom ?? 0) > 0;
  }) : () => {};
  const removeAmbientOcclusionHook = compositor ? exposeAmbientOcclusionDevHook(active => {
    if (active !== undefined) compositor.setAmbientOcclusion(active);
    return compositor.stats().ambientOcclusion > 0;
  }) : () => {};
  const removeWaterReflectionHook = compositor ? exposeWaterReflectionDevHook(active => {
    if (active !== undefined) compositor.setWaterReflections(active);
    return compositor.stats().waterReflections > 0;
  }) : () => {};
  const removeColorOutputHook = exposeColorOutputDevHook(colorOutput);
  let colorTone = colorToneRequest;
  const atmosphereMaterials = createStandardAtmosphereBinding(renderer, uniforms);
  const skyEnvironment = quality.skyEnvironment ? createSkyEnvironment(renderer) : null;
  const updateSkyEnvironment = (environment: EnvironmentState) =>
    skyEnvironment?.update(environment, performance.now() / 1000);
  const firstFrame = createFirstFrameSignal();
  const writeSeasonUniforms = createSeasonUniformWriter(uniforms);
  const vegetationUniforms = getSeasonalVegetationUniforms(uniforms, preparedWinter);
  const ownPresentation = loopPresentation ? null : createPresentationScheduler();
  const vegetationBuild = createThreeVegetation(world, vegetationUniforms, foliageAtlas, {
    builders,
    firstFrame: firstFrame.drawn,
    grass: grassBuild,
    impostorWarmup: createImpostorWarmup(renderer, loopPresentation ?? ownPresentation!),
    treeViewAtlasMiB: quality.treeViewAtlasMiB,
    treeViews: quality.treeViewImpostors,
    seasonalLeafCapacity: getSeasonLeafCapacity(quality.weatherParticles, quality.grassSamples),
    springFlowerSamples: getSpringFlowerSamples(quality.grassSamples),
    visualWinter: preparedWinter
  });
  const [[terrainChunks, waterChunks], rockData, vegetation] = await profileAsync(
    "wait for worker builds",
    () => Promise.all([terrainBuild, rocksBuild, vegetationBuild])
  );
  const [coverField, waterField] = await Promise.all([coverFieldBuild, waterFieldBuild]);
  ownCoverField(coverField);
  ownWaterField(createAtlasTexture(waterField.pixels, waterField.width, waterField.height));
  // GROUND-PALETTE: the island's sand/soil palette by theme and nation (or its editor choice).
  const groundPaletteContext = { expeditionTheme: world.expeditionTheme, nation: buildingNation };
  const groundPalette = createGroundPaletteUniforms(world, groundPaletteContext);
  Object.assign(uniforms, groundPalette);
  const syncGroundPalette = createGroundPaletteSync(groundPalette, world, groundPaletteContext);
  const syncRuinScorch = createRuinScorchSync(uniforms);
  const terrainMaterial = createTerrainMaterial(uniforms, albedo, normal, groundShader.variant,
    quality.groundParallax);
  watchThreeShaderErrors(renderer, groundShader, (variant) =>
    setTerrainVariant(terrainMaterial, variant)
  );
  const terrain = profileStep("three terrain meshes", () =>
    createThreeTerrain(
      world,
      { terrain: terrainChunks, water: waterChunks },
      terrainMaterial,
      // R12b: water never receives screen-space occlusion (its depth is the surface, not the seabed).
      excludeFromAmbientOcclusion(createWaterMaterial(uniforms, quality.refraction, preparedWinter, quality.waterFoam))
    )
  );
  // R18b: the reflection pass redraws exactly this water surface.
  compositor?.setReflectiveWater({ hasVisibleWater: terrain.hasVisibleWater, water: terrain.water });
  const painted = await profileAsync("wait for building surfaces", () => surfacesBuild);
  const buildings = createThreeBuildings(
    !quality.liteGround,
    shadows.scene,
    shadows.uniforms,
    renderer,
    { sample: (x, z) => sampleSmooth(world, world.heights, x, z), revision: () => world.buildRevision ?? 0 },
    painted,
    firstFrame.drawn,
    { theme: world.adventureTheme ?? "forest", variant: world.adventureTheme === "tropical" ? "pirate" : "bandit" },
    quality.sunShadows,
    uniforms
  );
  // Held for the renderer's life: carts, horse loads and carried goods share these worker maps.
  const wareSurfaces = acquireWareMaterials(!quality.liteGround, painted);
  const placementGhost = createBuildingPlacementGhost(!quality.liteGround, buildings.materialsFor,
    (x, z) => sampleSmooth(world, world.heights, x, z));
  const placementPreviews = createBuildingPlacementPreviews(buildings.materialsFor);
  const scene = new Scene(); const storm = createStormLightning(world, scene, onLightning);
  const {
    adventureCamps, adventureCampScene, boatPeople, bridges, civilianFields, combatEffects, fishingBoats, handcarts,
    rallyBanner, roadDecorations, roads, roadVerges, shipInteraction, ships, shuttles, smokeScene, syncRoads,
    territoryMarkers,
    transportHorses, updateCampLights, wakes
  } = createRendererSettlement({ bridgeHeight, bridgeSurface, groundHeight, quality, renderer, scene,
    shadowScene: shadows.scene, terrainHeight, uniforms, world, materialsFor: buildings.materialsFor });
  let playerFlagColor: [number, number, number] = [...DEFAULT_PLAYER_COLOR];
  // The player's settlers carry the chosen nation from the start; its ships are built in that style.
  let playerNation: WorkerAppearance["nation"] = workerAppearances?.[0]?.nation ?? "roman";
  const rocks = profileStep("three rock meshes", () =>
    createThreeRocks(rockData, uniforms, rockTexture, quality.rockDetail)
  );
  // Stone material deposits: quarry boulder clusters in the rock material, recoloured per stone.
  const marbleDeposits = createThreeStoneDeposits(world, quality.liteGround, rocks.createTintedMaterial);
  // T07: the possessed near grass ring (not with the prepared winter assets: the snow look keeps its tufts).
  const grassRing = visualWinter
    ? null
    : createThreeGrassRing(world, uniforms, quality.grassRing,
      { hole: vegetation.shortGrassHole, shape: vegetation.shortGrassHoleShape });
  scene.add(terrain.ground, terrain.water, rocks.group, marbleDeposits.root, ...vegetation.meshes);
  const iceFloes = createRendererIceFloes(world, snowMap, uniforms, quality, visualWinter);
  if (iceFloes) {
    scene.add(iceFloes.mesh);
    if (quality.sunShadows) shadows.scene.add(iceFloes.caster);
  }
  if (grassRing) scene.add(grassRing.root);
  shadows.scene.add(rocks.casters, ...vegetation.casters);
  const stressContent = stress
    ? createThreeStress(stress, world, uniforms, {
        depth: createPropDepthMaterial(uniforms),
        main: createPropMaterial(uniforms, false)
      })
    : null;
  if (stressContent) {
    scene.add(...stressContent.meshes);
    shadows.scene.add(...stressContent.casters);
  }
  const {
    animals, animalScene, birds, birdScene, butterflies, cameraRig, clouds, critters, fishSchools, rain, ripples,
    waterfallScene, weeds, weedScene, whales
  } = createRendererAmbient({
    animalDraw: { furDetail: !quality.liteGround, sunShadows: quality.sunShadows, visualWinter },
    animals: animalModels, background: BACKGROUND, fishSchools: quality.refraction ? quality.fishSchools : 0,
    groundHeight: cameraGroundHeight, ledgeMist: !quality.liteGround,
    onLightning: storm.trigger, presentation: loopPresentation ?? ownPresentation!, scene,
    shadowScene: shadows.scene, uniforms, viewport,
    whales: { level: quality.whales, sunShadows: quality.sunShadows }, world
  });
  if (import.meta.env.DEV) window.__whales = whales.debug;
  // Afloat fishing skiffs shade the seabed like the fish: soft, depth-spread, in the refraction capture.
  if (quality.refraction && fishingBoats.seabedShadows) weedScene.add(fishingBoats.seabedShadows);
  const explorationCamera = createExplorationCameraRig({ groundHeight,
    rtsTargetHeight: cameraRig.getTargetHeight });
  const cinematicView = createCinematicView({ cellsX: world.cellsX, cellsZ: world.cellsZ,
    groundHeight: cameraGroundHeight, limits: quality.cinematicView, rtsTargetHeight: cameraRig.getTargetHeight,
    scene });
  /** CIN2: whether the last frame drew the campaign cinematic camera (stats only). */
  let cinematicDrawn = false;
  let latestEnvironment: EnvironmentState | null = null;
  const explorationWeather = createExplorationWeatherAdapter({
    audio: explorationAudio,
    environment: () => latestEnvironment,
    groundHeight: rainSurfaceHeight,
    now: () => performance.now(),
    parent: scene,
    quality,
    render: { background: BACKGROUND, uniforms },
    waterAt: rainOnWater
  });
  const worker = createWorkerDisplay(await workerBuild, loadWorkers);
  /**
   * C11: the possession entry preloads the hero bodies and the sky before the camera moves, so
   * the first possessed frame does not pay their load/compile cost. Hero GPU resources leave on a
   * delay after the visit (crowd-owned), keeping the return transition free of disposal stalls.
   */
  const prepareExplorationView = async (heroes: readonly ExplorationHeroBody[] = []) => {
    const releases: (() => void)[] = [];
    // The hero warm-up and the sky compile are independent: one entry latency, not their sum.
    const results = await Promise.allSettled([
      explorationPrewarmEnabled() && heroes.length > 0
        ? worker.current?.prepareExplorationHeroes(heroes, renderer, explorationCamera.camera)
        : undefined,
      explorationWeather.prepare(renderer, explorationCamera.camera)
    ]);
    for (const result of results) if (result.status === "fulfilled" && result.value) releases.push(result.value);
    const failure = results.find(result => result.status === "rejected");
    if (failure) {
      for (const release of releases) release();
      throw failure.reason;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const release of releases) release();
    };
  };
  /**
   * The exploration body must follow the live crowd: a nation change swaps in a replacement crowd
   * and disposes the previous body pool. Resolve the current crowd at load time, and let the
   * appearance adapter rebuild its body after a successful swap instead of keeping a dead cache.
   */
  let workerSourceRevision = 0;
  const workerSourceListeners = new Set<() => void>();
  const explorationBodyLoader = createLiveExplorationBodyLoader({
    current: () => worker.current?.createExplorationBodyLoader(),
    nation: () => playerNation,
    revision: () => workerSourceRevision,
    subscribe: listener => {
      workerSourceListeners.add(listener);
      return () => { workerSourceListeners.delete(listener); };
    }
  });
  boatPeople.setSource(explorationBodyLoader, workerAppearances ?? []);
  const notifyWorkerSourceChanged = () => {
    workerSourceRevision++;
    for (const listener of workerSourceListeners) {
      try { listener(); }
      catch (error) { console.warn("Exploration appearance refresh could not start", error); }
    }
  };
  const mounts = await mountBuild;
  const vehicleCasters = createSceneShadowCasters(
    [ships.group, shuttles.group, fishingBoats.casters, handcarts.root, transportHorses.root]);
  /** R02/C07: people, mounts and vehicles cast into the sun map (not on Minimal: no sun pass). */
  const castDynamicShadows: DynamicSunCasters = cast => {
    worker.current?.castShadows(cast);
    mounts?.castShadows(cast);
    cavalry.castShadows(cast);
    vehicleCasters(cast);
  };
  const dynamicCasters = quality.characters.shadowCasters > 0 ? castDynamicShadows : undefined;
  /** Before the animals: their silhouettes where crowns or hills are in front of them. */
  const silhouetteScene = new Scene().add(...animals.silhouettes);
  shadows.scene.add(...animals.casters);
  renderer.autoClear = false;
  const shadersReady = spike.prepare({
    compile: scenes => compileShaders(renderer, scenes, atmosphereMaterials.bind),
    quality,
    renderer,
    sceneGraph: [terrain.ground, terrain.water, rocks.group, marbleDeposits.root, vegetation.meshes],
    scenes: [scene, waterfallScene, animalScene, birdScene, silhouetteScene, weedScene, shadows.scene],
    sunShadowUniforms: shadows.uniforms
  });

  const depositSigns = createThreeDepositSigns(world, buildings.materialsFor("roman"));
  const picking = createRendererPicking(canvas, world, buildings, shipInteraction, depositSigns, worker, roadDecorations,
    bridgeHeight, bridges, fishingBoats);
  // Refraction reads the surface layers without drawing them into the colour buffer.
  const renderRefraction = createRefractionRenderer({
    foreground: () => [
      terrain.water, rocks.group, territoryMarkers.root, roads.root, clouds.root,
      civilianFields.group, transportHorses.root, ships.group, shuttles.group, fishingBoats.group, combatEffects.root,
      ...(grassRing ? [grassRing.root] : []),
      ...(wakes ? [wakes.mesh] : []), ...(stressContent?.aboveWater ?? [])
    ],
    hasWater: terrain.hasVisibleWater,
    hideWaterlessGround: terrain.hideWaterlessGround,
    quality, refraction, renderer, scene, vegetation, viewport, weedScene,
    asSeabedCapture: render => withoutAtmosphere(uniforms, () => withLinearColorCapture(uniforms, render))
  });

  const mapEdit = createThreeMapEdit({ grassRing, quality, rocks, terrain, uniforms, vegetation,
    visualWinter: preparedWinter, weeds, world });
  /** Crops and the monument plinth own their tiles; grass must not pierce their ground surface. */
  let cropCells: Set<number> | null = null;
  const syncCropCover = (fields: FrameState["fields"], buildings: FrameState["buildings"]) => {
    if (!fields && !buildings) return;
    const soil = fieldCropCoverCells(fields ?? [], world.cellsX);
    const next = new Set(soil);
    for (const building of buildings ?? []) if (building.type === 7 && (building.demolitionAge ?? 0) < 10)
      for (let z = Math.floor(building.z - 4.5); z < building.z + 4.5; z++)
        for (let x = Math.floor(building.x - 4.5); x < building.x + 4.5; x++)
          if (x >= 0 && z >= 0 && x < world.cellsX && z < world.cellsZ) next.add(z * world.cellsX + x);
    if (cropCells && cropCells.size === next.size && [...next].every(cell => cropCells!.has(cell))) return;
    const changed = [...next].filter(cell => !cropCells?.has(cell));
    if (cropCells) for (const cell of cropCells) if (!next.has(cell)) changed.push(cell);
    cropCells = next;
    setFieldCropCoverCells(world, next, soil);
    (uniforms.uFieldSoilBox!.value as Vector4).set(...getFieldSoilBounds(soil, world.cellsX));
    if (!changed.length) return;
    const xs = changed.map(cell => cell % world.cellsX);
    const zs = changed.map(cell => Math.floor(cell / world.cellsX));
    mapEdit.refreshFieldCover({
      minX: Math.min(...xs) - 1, maxX: Math.max(...xs) + 1,
      minZ: Math.min(...zs) - 1, maxZ: Math.max(...zs) + 1
    });
  };
  /** Clears the frame (the scene target when active) and draws the possessed sky first. */
  const beginLayers = (camera: Camera, skyFrame: boolean) => {
    if (activeCompositor) activeCompositor.beginScene();
    else renderer.clear();
    if (skyFrame) {
      clouds.root.visible = false;
      explorationWeather.renderSky(renderer, camera);
    } else clouds.update(camera);
  };
  /** Per-frame option objects, refilled each frame (the callees do not keep them). */
  const vegetationView = {} as VegetationFrame;
  const leafFocus = { time: 0, x: 0, z: 0 };
  vegetationView.leafFocus = leafFocus;
  const buildingEye = { radius: 0, x: 0, y: 0, z: 0 };
  const grassRingView = {} as GrassRingFrame;
  const wind = { direction: 0, strength: 0 };
  let trafficWearRevision = -1, trafficWearUpload = -Infinity;
  /** At most one upload per source revision and per `uploadIntervalMs` (fast forward). */
  const syncTrafficWear = (field: FrameState["trafficWear"]) => {
    if (!field || field.revision === trafficWearRevision) return;
    const now = performance.now();
    if (now - trafficWearUpload < TRAFFIC_WEAR_TUNING.uploadIntervalMs) return;
    trafficWearRevision = field.revision;
    trafficWearUpload = now;
    ownTrafficWear(field);
  };
  const render = (input: FrameState) => {
    spike.beginFrame();
    markFrameStage("build.frame");
    beginCharacterProfileFrame();
    syncTrafficWear(input.trafficWear);
    syncGroundPalette();
    syncRuinScorch(input.ruinScorch);
    latestWorkerFrame = input;
    // The camera and picking run before the road meshes sync; rebuild the shared deck surface first.
    bridgeSurface.update(input.roads ?? []);
    if (fog.update()) fogTexture.needsUpdate = true;
    updateSharedUniformValues(uniformValues, input);
    shadows.setStrength(isLegacyShadowFadeProbe()
      ? input.environment.bakedShadowWeight : getSunShadowWeight(input.environment));
    updateSkyEnvironment(input.environment);
    updateSkyView(input.environment);
    const exploration = input.exploration;
    const explorationCameraSample = exploration?.camera
      ? explorationCamera.update(input.camera, exploration.camera) : null;
    if (explorationCameraSample && !exploringView && explorationPrewarmEnabled())
      worker.current?.beginExplorationView();
    exploringView = Boolean(explorationCameraSample);
    // CIN2: cinematic > exploration > RTS rig. The RTS rig still eases its target every frame.
    const underlyingCamera = explorationCameraSample ? explorationCamera.camera : cameraRig.update(input.camera);
    const view = cinematicView.resolve(input, underlyingCamera, Boolean(explorationCameraSample));
    const { camera, frame } = view;
    cinematicDrawn = view.overriding;
    /** A suspended possessed eye under a cinematic shot fades its near fog out with the shot's weight. */
    const explorationWeight = (explorationCameraSample?.blend ?? 0) * (1 - view.blend);
    grassFade.value = getGrassFade(quality.grass, frame.camera.zoom, explorationWeight);
    uniformValues.uExplorationFog = explorationWeight;
    compositor?.setEyeAdaptation(explorationWeight);
    spike.setEyeAdaptation(explorationWeight);
    atmosphere.update(camera, frame.environment, Boolean(explorationCameraSample),
      explorationCameraSample ? explorationWeight : undefined, frame.time);
    const environment = frame.environment;
    colorOutput.setWeight(
      toneWeightFor(colorTone, environment.daylight, environment.rain, environment.sun.elevation)
    );
    for (const name of SCALAR_UNIFORMS) uniforms[name]!.value = uniformValues[name];
    writeSeasonUniforms(environment.season);
    latestEnvironment = frame.environment;
    const weatherFrame = exploration?.weather ?? null;
    explorationWeather.setActive(weatherFrame !== null);
    if (weatherFrame) {
      camera.getWorldDirection(viewDirection);
      explorationWeather.setCameraView({ forwardX: viewDirection.x, forwardY: viewDirection.y,
        forwardZ: viewDirection.z, yaw: explorationCameraSample?.yaw ?? 0 });
      explorationWeather.setEnvironment(frame.environment);
      explorationWeather.update(weatherFrame);
    } else explorationWeather.update(null);
    storm.update(camera, frame, !weatherFrame);
    picking.setView(camera, frame.camera, frame.workers);
    stressContent?.update(frame.time);
    const viewMode = view.overriding ? "cinematic" : cameraRig.getMode();
    const isIso = !explorationCameraSample && viewMode === "iso";
    const lodZoom = explorationCameraSample && explorationCameraSample.blend >= 1
      ? explorationLodZoom(explorationCameraSample.fov, EXPLORATION_FIELD_OF_VIEW)
      : 1;
    const lodDistances = explorationLodDistances(lodZoom, quality.liteGround);
    const detailDistance = lodDistances.detail;
    const grassDetailDistance = lodDistances.grass;
    const shadowFocus = explorationCameraSample
      ? { radius: 35, x: camera.position.x, z: camera.position.z }
      : getShadowFocus(frame.camera, viewMode);
    // R08: the possessed eye centres the cascades (the 35-unit focus stays the 1-cascade rollback).
    const shadowEye = explorationCameraSample ? camera.position : null;
    const shadowFrustum = shadows.prepare(frame.environment.sun, shadowFocus, shadowEye);
    vegetationView.camera = camera;
    vegetationView.eyePosition = explorationCameraSample
      ? { x: camera.position.x, z: camera.position.z } : undefined;
    vegetationView.felling = frame.felling;
    vegetationView.grassDistance = explorationCameraSample ? grassDetailDistance : undefined;
    vegetationView.growth = frame.growth;
    vegetationView.grassVisible = grassFade.value > 0;
    vegetationView.flowerFade = getGrassFade(true, frame.camera.zoom, explorationWeight);
    leafFocus.time = frame.time;
    leafFocus.x = explorationCameraSample ? camera.position.x : frame.camera.centerX;
    leafFocus.z = explorationCameraSample ? camera.position.z : frame.camera.centerZ;
    // Minimal keeps its simplified plant/tree LOD in the possessed near ring too (liteGround).
    const strategicPlantDetail = !isIso || frame.camera.zoom >= quality.plantDetailZoom;
    vegetationView.plantDetail = explorationCameraSample ? !quality.liteGround : strategicPlantDetail;
    vegetationView.plantDistance = explorationCameraSample ? detailDistance : undefined;
    vegetationView.shadowFrustum = explorationCameraSample ? shadowFrustum : null;
    vegetationView.treeDistance = explorationCameraSample ? detailDistance : undefined;
    vegetationView.useImpostors = isIso
      ? frame.camera.zoom < quality.treeImpostorZoom
      : Boolean(explorationCameraSample);
    markFrameStage("build.vegetation");
    vegetation.update(vegetationView);
    if (explorationCameraSample) {
      grassRingView.blend = explorationCameraSample.blend;
      grassRingView.camera = explorationCamera.camera;
      grassRingView.eyeX = camera.position.x;
      grassRingView.eyeZ = camera.position.z;
      grassRingView.viewportHeight = viewport.y;
    }
    grassRing?.update(explorationCameraSample ? grassRingView : null);
    markFrameStage("build.terrainLod");
    const eye = explorationCameraSample ? { x: camera.position.x, z: camera.position.z } : undefined;
    terrain.updateLod(frame.camera.zoom, isIso, eye, detailDistance);
    rocks.updateLod(frame.camera.zoom, isIso, eye, detailDistance);
    rocks.setSmallRocksVisible(showsSmallRocks(frame.camera.zoom, isIso));
    rocks.updateGrowth(frame.time);
    wind.direction = Math.atan2(frame.environment.windZ, frame.environment.windX);
    wind.strength = Math.hypot(frame.environment.windX, frame.environment.windZ);
    if (explorationCameraSample) setExplorationViewDirection(uniformValues.uViewDirection, camera);
    else setViewDirection(uniformValues.uViewDirection, camera, frame.camera, cameraRig.getTargetHeight());
    markFrameStage("build.ambient");
    birds.update(frame.birds, camera, frame.camera);
    butterflies.update(frame.butterflies, camera, frame.camera);
    critters.update(frame.critters);
    ripples.update(frame.critters.ripples);
    fishSchools?.update(frame, explorationCameraSample ? camera.position : null);
    whales.update(frame.time, camera, Boolean(explorationCameraSample), frame.camera.viewportHeight,
      frame.environment.windX, frame.environment.windZ);
    animals.update(frame.animals, camera, frame.camera);
    markFrameStage("build.ships");
    ships.update(frame.ships ?? [], frame.shipSites ?? [], frame.time, {
      cameraX: camera.position.x, cameraY: camera.position.y, cameraZ: camera.position.z,
      windDirection: wind.direction,
      windStrength: wind.strength,
      playerColor: playerFlagColor, playerNation, zoom: frame.camera.zoom
    });
    shuttles.update(frame.shuttleBoats ?? [], frame.time);
    fishingBoats.update(frame.fishingBoats ?? EMPTY_FISHING_BOATS, frame.time, frame.environment.daylight < .25,
      frame.workers ?? []);
    wakes?.update(frame.ships ?? EMPTY_SHIPS, frame.shuttleBoats ?? EMPTY_BOATS, frame.time);
    iceFloes?.update(frame);
    marbleDeposits.update(frame.marbleDeposits ?? [], frame.time);
    adventureCamps.update(frame.adventureCamps ?? [], frame.camera.zoom, frame.time,
      frame.environment.windX, frame.environment.windZ);
    updateCampLights(frame.environment);
    markFrameStage("build.effects");
    combatEffects.update(frame.militaryArrows ?? [], frame.militaryDeaths ?? [], playerFlagColor);
    rallyBanner.update(frame.rallyBanner, frame.time, wind, playerFlagColor);
    transportHorses.update(frame.transportHorses ?? [], frame.time);
    handcarts.update(frame.handcarts ?? [], frame.camera.zoom, camera);
    territoryMarkers.update(frame.territoryBorders, frame.territoryRevision, frame.camera.zoom, playerFlagColor);
    markFrameStage("build.buildings");
    buildings.update(frame.buildings ?? [], frame.time, frame.environment, frame.camera.zoom, playerFlagColor,
      explorationCameraSample
        ? explorationBuildingEye(buildingEye, quality.buildingEyeDetailRadius, lodZoom, camera.position)
        : undefined);
    markFrameStage("build.overlaysRoads");
    placementGhost.update(frame.placementGhost, frame.camera.zoom, frame.environment);
    placementPreviews.update(frame.placementPreviews, frame.environment);
    depositSigns.update(frame);
    picking.updateHover();
    syncRoads(frame);
    roadDecorations.update(frame.roadDecorations ?? EMPTY_ROAD_DECORATIONS, camera, frame.camera.viewportHeight);
    roadVerges.update(frame, camera, frame.camera.viewportHeight);
    roadDecorations.updateGhost(frame.roadDecorationGhost);
    roadDecorations.updateEnvironment(frame.environment);
    roads.updatePreview(frame.roadPreview);
    roads.updateEnvironment(frame.environment);
    transportHorses.updateLeadTargets(frame.workers ?? []);
    markFrameStage("build.workers");
    const renderedWorkers = frame.shipPreviewWorkers?.length
      ? [...frame.workers ?? [], ...frame.shipPreviewWorkers] : frame.workers;
    const hasTransfer = renderedWorkers?.some(person => person.action === "boat_lift" || person.wareTransfer?.ware === "boat");
    const handlingWorkers = !hasTransfer && !frame.fishingBoats?.some(boat => boat.handling) ? renderedWorkers : renderedWorkers?.map(person => {
      const transfer = person.wareTransfer?.ware === "boat" ? person.wareTransfer : undefined;
      if (person.fisherBoatYard) return { ...person, heading: yardBoatWorkerHeading(person.fisherBoatYard.yaw, transfer ? (transfer.direction === "pickup" ? transfer.progress : 1 - transfer.progress) : person.animationTime / 1.2) };
      if (person.action === "boat_lift" || transfer) {
        const lift = transfer ? (transfer.direction === "pickup" ? transfer.progress : 1 - transfer.progress) :
          person.animationTime / 1.2;
        const distance = boatTransferTransform(lift).workerForward * WORKER_SCALE;
        const x = person.x + Math.sin(person.heading) * distance;
        const z = person.z + Math.cos(person.heading) * distance;
        return { ...person, x, z, y: groundHeight(x, z), fisherBoatTransferBaseY: person.y };
      }
      if (person.actorId === undefined || !["boat_launch", "boat_beach", "fish_basket_pickup"].includes(person.action)) return person;
      const pose = fishingBoats.handlingPose(person.actorId);
      return pose ? { ...person, x: pose.x, y: groundHeight(pose.x, pose.z), z: pose.z,
        heading: pose.yaw, fisherBoatHands: person.action === "fish_basket_pickup" ? undefined : pose.hands,
        fisherBoatBoarding: person.action === "fish_basket_pickup" ? undefined : pose.boarding } : person;
    });
    worker.current?.update(handlingWorkers, frame.environment, camera, frame.time, renderer.domElement.height);
    markFrameStage("build.fields");
    civilianFields.update(frame.fields ?? [], frame.time, frame.workers);
    syncCropCover(frame.fields, frame.buildings);
    markFrameStage("build.mounts");
    mounts?.update(frame.mounts, frame.environment, camera, frame.time);
    cavalry.update(frame, camera, frame.time);
    markRenderPass("shadows");
    if (!spikeNoOffscreen) withoutAtmosphere(uniforms,
      () => shadows.render(renderer, frame.environment.sun, shadowFocus,
        isSunCasterProbeOff() ? undefined : dynamicCasters, shadowEye));
    renderer.getDrawingBufferSize(viewport);
    markRenderPass("refraction");
    if (quality.refraction && !spikeNoOffscreen) renderRefraction(camera);
    markRenderPass("sky");
    beginLayers(camera, weatherFrame !== null);
    markRenderPass("world");
    renderer.render(scene, camera);
    markRenderPass("waterfalls");
    renderer.render(waterfallScene, camera);
    renderAsAmbientOcclusionReceivers(renderer, () => {
      markRenderPass("animals");
      // Owner 2026-11-13: the possessed eye sees no animals through hills, crowns or waterfalls.
      if (quality.animalSilhouettes && !exploringView) renderer.render(silhouetteScene, camera);
      renderer.render(animalScene, camera);
      if (frame.adventureCamps?.length) renderer.render(adventureCampScene, camera);
      markRenderPass("buildings");
      buildings.render(renderer, camera);
      depositSigns.render(renderer, camera);
      markRenderPass("workers");
      worker.current?.render(renderer, camera);
      markRenderPass("mounts");
      mounts?.render(renderer, camera);
      cavalry.render(renderer, camera);
    });
    markRenderPass("smokeBirds");
    renderer.render(smokeScene, camera);
    renderer.render(birdScene, camera);
    markRenderPass("overlays");
    // The hovered ghost and its road first: the faint previews' depth must not hide them.
    placementGhost.render(renderer, camera);
    placementPreviews.render(renderer, camera);
    markRenderPass("weather");
    if (weatherFrame) explorationWeather.renderEffects(renderer, camera);
    else if (quality.weatherParticles) rain.render(renderer, getPrecipitation(snowMap, frame));
    markRenderPass("output");
    activeCompositor?.finish(camera);
    spike.endFrame();
    firstFrame.markDrawn();
    ownPresentation?.runBudget(OWN_PRESENTATION_MS);
  };

  /** Effect layers drawn invisibly through the loading frames, so their first use compiles no shader (CIN6). */
  const setEffectWarmup = (on: boolean) => {
    storm.setWarming(on);
    cinematicView.setWarming(on);
  };

  const prepareFirstFrames = async (frame: FrameState) => {
    await Promise.all([shadersReady, critters.whenReady(),
      worker.current?.prepare(frame.workers ?? [], frame.environment)]);
    // Compile the home sky behind startup loading, not on the first possession click. This
    // retains one small cloud texture, makes no draw, and does not fetch the lunar image.
    if (!world.expeditionKind) await explorationWeather.prepare(renderer, explorationCamera.camera, false);
    if (frame.cavalryMounts?.length) await cavalry.prepare(frame.cavalryMounts, frame.environment);
    if (frame.mounts?.length) await mounts?.prepare(frame.mounts, frame.environment);
    render(frame);
    await boatPeople.whenReady();
    render(frame);
    await waitForAdvancedMaterialTextures();
    if (!world.expeditionKind && !frame.exploration?.camera) {
      const x = frame.camera.centerX, z = frame.camera.centerZ;
      render({ ...frame, exploration: { appearance: null, bubble: null, revision: 0,
        smoke: null, weather: null, camera: { blend: 1, pose: { x, z,
          y: sampleSmooth(world, world.heights, x, z) + 1.2, eyeHeight: 1.2,
          fov: Math.PI / 3, mode: "eye", pitch: 0, yaw: frame.camera.yaw } } } });
      explorationCamera.update(frame.camera, null);
      render(frame);
      await waitForGpuFrame(gl);
    }
    // The first hidden draw releases the worker bake of distant vegetation. Do not hold the first
    // visible frame for it: the deferred impostors keep the full meshes active until the bake lands,
    // so the island can show immediately and the far-zoom quads swap in on a later frame.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await spike.prewarmPresented();
    render(frame);
  };

  const result: TerrainRenderer = {
    prepareCritters: species => critters.prepare(species),
    prepareBuildings: (frames, environment, zoom) => {
      updateSkyEnvironment(environment);
      return buildings.prepare(frames, environment, zoom);
    },
    prepareFrame: async frame => {
      setEffectWarmup(true);
      try {
        await prepareFirstFrames(frame);
      } finally {
        setEffectWarmup(false);
      }
    },
    dispose: () => {
      if (import.meta.env.DEV) delete window.__whales;
      releaseSharedLightingGpu(renderer, scene);
      atmosphereMaterials.dispose();
      compositor?.dispose();
      removeCompositorHook();
      removeBloomHook();
      removeAmbientOcclusionHook();
      removeWaterReflectionHook();
      removeLinearOutputHook();
      skyEnvironment?.dispose();
      removeColorOutputHook();
      picking.dispose();
      depositSigns.dispose();
      vegetation.dispose();
      grassRing?.dispose();
      clouds.dispose(); explorationWeather.dispose(); storm.dispose(); cinematicView.dispose();
      buildings.dispose();
      placementGhost.dispose();
      placementPreviews.dispose();
      bridges.dispose();
      roads.dispose();
      roadDecorations.dispose();
      roadVerges.dispose();
      territoryMarkers.dispose();
      civilianFields.dispose();
      combatEffects.dispose();
      transportHorses.dispose();
      handcarts.dispose();
      wareSurfaces.release();
      shipInteraction.dispose();
      ships.dispose();
      shuttles.dispose();
      fishingBoats.dispose();
      wakes?.dispose();
      boatPeople.dispose();
      marbleDeposits.dispose();
      iceFloes?.dispose();
      adventureCamps.dispose();
      rallyBanner.dispose();
      workerSourceListeners.clear();
      worker.dispose();
      mounts?.dispose();
      cavalry.dispose();
      workerTextures.dispose();
      disposeShading();
      releaseFallbackFogGpu();
      releaseSharedListeners();
      spike.dispose();
      renderer.dispose();
      // Release the WebGL context deliberately when an in-page island replacement removes the canvas;
      // browser GC alone can keep contexts alive until the process limit is hit.
      renderer.forceContextLoss();
    },
    getResourceStats: () => ({ geometries: renderer.info.memory.geometries,
      programs: renderer.info.programs?.length ?? 0, textures: renderer.info.memory.textures }),
    getStats: () => {
      const skyStats = explorationWeather.skyStats();
      const workerAnimation = worker.current?.animationStats();
      const workerDetail = worker.current?.detailStats();
      return {
        details: {
          ...spike.statsDetails(),
          ...boatPeople.stats(),
          ...buildings.assetStats(),
          animalDrawCalls: animals.getDrawnLayers(),
          animalTriangles: animals.getTriangles(),
          ...clouds.getStats(),
          ...(skyStats ? {
            cloudDrawCalls: skyStats.drawCalls,
            cloudTriangles: skyStats.triangles,
            cloudExtraTextures: skyStats.extraTextures
          } : {}),
          ...territoryMarkers.getStats(),
          ...placementPreviews.getStats(),
          ...describeGround(groundShader),
          ...compositor?.stats(),
          grass: vegetation.grassCount,
          meshes: terrain.meshes + vegetation.meshes.length,
          propTriangles: vegetation.propTriangles,
          rockTriangles: rocks.triangles,
          rocks: rocks.count,
          terrainTriangles: terrain.triangles,
          cinematicGlintSprites: cinematicView.glintSprites(),
          view: describeView(cinematicDrawn, Boolean(latestWorkerFrame?.exploration?.camera), cameraRig.getMode()),
          waterWeedTriangles: weeds.triangles,
          ...(workerAnimation ? {
            workerPoseTiers: workerAnimation.tiers.join("/"),
            workerPoseUpdates: workerAnimation.poses
          } : {}),
          ...(quality.sunShadows ? {
            shadowCasterDrawCalls: shadows.stats().casterDrawCalls,
            shadowCasterMs: shadows.stats().casterMilliseconds.toFixed(2),
            shadowCasterTriangles: shadows.stats().casterTriangles,
            shadowCascades: shadows.stats().cascades,
            shadowDrawCalls: shadows.stats().drawCalls,
            shadowPassMs: describeShadowTiming(shadows.timing()),
            shadowTriangles: shadows.stats().triangles
          } : {}),
          ...(workerDetail ? {
            workerDrawCalls: workerDetail.drawCalls,
            workerGpuBakeMs: workerDetail.gpuBakeMs,
            workerGpuCrowd: workerDetail.gpu,
            workerGpuSkipped: workerDetail.gpuSkipped,
            workerLods: workerDetail.lods,
            workerShadowCasters: workerDetail.casters,
            workerSkeletonsGated: workerDetail.skeletonsGated,
            workerTriangles: workerDetail.triangles
          } : {}),
          ...(characterProfileEnabled() ? characterProfileDetails(rollCharacterWindow(), cavalry.stats()) : {})
        }
      };
    },
    bridgeHeight,
    gl,
    getViewMode: cameraRig.getMode,
    currentCameraPose: cinematicView.currentCameraPose,
    strikeLightning: (x, z) => {
      if (storm.strikeAt(x, z)) rain.flash();
    },
    projectToViewport: picking.projectToViewport,
    pickGround: picking.pickGround,
    pickWater: picking.pickWater,
    pickBridge: picking.pickBridge,
    pickBuilding: picking.pickBuilding,
    isBuildingDetailed: buildings.isDetailed,
    pickRoadDecoration: picking.pickRoadDecoration,
    pickShip: picking.pickShip,
    setArmyTargetHover: picking.setArmyTargetHover,
    drawsShoreShells: () => quality.grass,
    mapEdit,
    setWorkerAppearances: async (appearances) => {
      // The player's settlers carry the chosen nation; its ships take that nation's figurehead.
      const replaced = await worker.replace(appearances);
      if (replaced) { playerNation = appearances[0]?.nation ?? "roman"; notifyWorkerSourceChanged(); boatPeople.setSource(explorationBodyLoader, appearances); }
      return replaced;
    },
    prepareWorkerAppearances: async appearances => {
      const prepared = await worker.prepare(appearances);
      if (!prepared) return null;
      return {
        commit: () => {
          if (!prepared.commit()) return false;
          playerNation = appearances[0]?.nation ?? "roman";
          notifyWorkerSourceChanged();
          boatPeople.setSource(explorationBodyLoader, appearances);
          return true;
        },
        dispose: prepared.dispose
      };
    },
    setWorkerColor: (color) => {
      playerFlagColor = playerColorFromHex(color);
      worker.setColor(color);
      boatPeople.setColor(color);
      mounts?.setColor(color);
      cavalry.setColor(color);
    },
    setViewMode: cameraRig.setMode,
    setColorTone: tone => { colorTone = tone; },
    setHighlights: strength => { uniformValues.uHighlight = clampHighlights(strength); },
    setFishSchoolsEnabled: enabled => fishSchools?.setEnabled(enabled),
    setWhalesEnabled: whales.setEnabled,
    setAnimationCadenceBias: bias => { cadenceBias.bias = bias; },
    setCharacterDetail: choice => {
      applyCharacterDetail(choice, quality.characters, { cadence: cadenceBias, policy: characterPolicy });
    },
    addTransient: (object) => {
      const transient = object as unknown as Object3D;
      scene.add(transient);
      return () => { scene.remove(transient); };
    },
    createExplorationBodyLoader: () => (worker.current ? explorationBodyLoader : undefined),
    explorationCeilingHeight: buildings.ceilingHeight,
    prepareExplorationView,
    militaryEyeOffset: (actor, mounted, drawnMount) => mounted ? cavalry.eyeOffset(actor, drawnMount) : worker.current?.eyeOffset(actor),
    explorationWeather: () => explorationWeather,
    render,
    resize: (width, height, pixelRatio) => {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      spike.resize(width, height, pixelRatio);
      // Shaders sample the drawing buffer before the next render; refraction follows its size.
      renderer.getDrawingBufferSize(viewport);
      compositor?.resize(viewport.x, viewport.y);
      if (quality.refraction) sizeRefractionTarget(refraction, viewport, quality.refractionScale);
    }
  };
  return result;
};

export const createThreeRenderer: CreateRenderer = input => createThreeRendererWithOptions(input, null);

/** WG-0 spike entry point: the same scene with the node renderer drawing it (see webgpu/). */
export const createThreeRendererWithWebGpuSpike = (input: RendererInput,
  options: WebGpuSpikeRendererOptions) => createThreeRendererWithOptions(input, options);

export const rendererModule: RendererModule = {
  create: createThreeRenderer,
  prefetch: (input) => {
    prefetchThreeVegetation(input);
    prefetchBuildingSurfaces(input);
  }
};
