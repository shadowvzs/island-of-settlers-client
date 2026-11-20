/**
 * EXPLORE-01C renderer-owned visual layer. Nothing in this directory is wired into the shared renderer
 * yet; 01G imports these adapters and keeps the normal isometric camera, scene and simulation intact.
 */
export {
  createExplorationAppearanceAdapter,
  createExplorationSpyglass,
  createLiveExplorationBodyLoader,
  createOwnedExplorationAppearanceAdapter,
  createOwnedExplorationBodyLoader,
  createSharedExplorationBodyLoader,
  EXPLORATION_APPEARANCE_ASSET_GAPS,
  EXPLORATION_NATIONS,
  EXPLORATION_PORTRAIT_BODIES,
  type ExplorationAppearanceAdapterHandle,
  type ExplorationAppearanceAdapterIntegration,
  type ExplorationAppearanceAdapterOptions,
  type ExplorationAppearanceGap,
  type ExplorationAppearanceGapField,
  type ExplorationAppearanceGapReason,
  type ExplorationAppearanceLeaseHandle,
  type ExplorationAppearanceResolution,
  type ExplorationBodyLoader,
  type ExplorationBodySource,
  type ExplorationBodyVisibility,
  explorationBodyVisibility,
  type ExplorationGender,
  type ExplorationLoadedBody,
  explorationNationBodies,
  type ExplorationPortraitSource,
  type ExplorationRigMetrics,
  type ExplorationSpyglassProp,
  isExplorationWorkerNation,
  measureExplorationRig,
  resolveExplorationAppearance
} from "./exploration-appearance";
export {
  createExplorationLodAdapter,
  EXPLORATION_LOD_DEFAULTS,
  EXPLORATION_LOD_LOAD_POLICY,
  type ExplorationLodAdapter,
  explorationLodAtDistance,
  type ExplorationLodFrame,
  type ExplorationLodOptions,
  type ExplorationLodQuality
} from "./exploration-lod";
export {
  createExplorationSmokeAdapter,
  createExplorationSmokeModel,
  EXPLORATION_SMOKE_COLORS,
  EXPLORATION_SMOKE_DURATION_MS,
  EXPLORATION_SMOKE_MAX_PARTICLES,
  type ExplorationSmokeAdapterHandle,
  type ExplorationSmokeAdapterOptions,
  type ExplorationSmokeModel,
  type ExplorationSmokeModelOptions,
  type ExplorationSmokeParticle,
  type ExplorationSmokeSample,
  PRESENTATION_SMOKE_SEED
} from "./exploration-smoke";
export {
  clampExplorationPose,
  createExplorationCameraRig,
  explorationBlendEase,
  type ExplorationCameraOptions,
  type ExplorationCameraPoint,
  type ExplorationCameraSample,
  type ExplorationCameraView,
  explorationLookDirection,
  explorationRtsCameraView,
  wrapExplorationYaw
} from "./three-camera";
