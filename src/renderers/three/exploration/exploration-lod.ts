import type { BuildingDetailEye } from "../../../render-common/buildings/building-detail";
import type { QualityPreset } from "../../../render-common/quality";

/**
 * FPS-specific detail budget. It deliberately does not reuse the perspective path's policy that forces
 * detailed plants and full terrain/rock LOD: near detail is distance-limited, far props use impostors,
 * and all draw distances are bounded to the current island. It never requests a second scene, a world,
 * a whole nation catalog or another island's assets.
 */
export type ExplorationLodQuality = Pick<
  QualityPreset,
  "animalSilhouettes" | "grass" | "liteGround" | "rockDetail" | "sunShadows"
>;

export interface ExplorationLodOptions {
  /** Beyond this eye distance, vegetation switches to its simplified plant LOD. */
  nearDetailDistance?: number;
  /** Beyond this distance the whole prop/terrain layer is coarse. */
  farDetailDistance?: number;
  /** Trees switch to baked impostors at and beyond this distance. */
  impostorDistance?: number;
  /** Grass remains only near the eye. */
  grassDistance?: number;
  /** Hard draw/detail budget; the current island remains visible to it and no farther. */
  maxViewDistance?: number;
  /** Local fog range, clamped by `maxViewDistance`. */
  fogNear?: number;
  fogFar?: number;
  /** Prevents threshold flicker while walking. */
  hysteresis?: number;
}

export interface ExplorationLodFrame {
  animalDetail: "coarse" | "near";
  distance: number;
  fogFar: number;
  fogNear: number;
  grassVisible: boolean;
  maxAnimalDistance: number;
  maxPropDistance: number;
  plantDetail: boolean;
  rockDetail: "coarse" | "near";
  shadowRadius: number;
  terrainDetail: "coarse" | "near";
  useImpostors: boolean;
}

export const EXPLORATION_LOD_DEFAULTS = {
  farDetailDistance: 55,
  fogFar: 170,
  fogNear: 35,
  grassDistance: 38,
  hysteresis: 5,
  impostorDistance: 48,
  maxViewDistance: 185,
  nearDetailDistance: 24
} as const;

/**
 * Possessed sun shadows (R08): the detailed cascades reach this eye distance, and moving casters
 * (people, mounts, vehicles) are drawn only into them; the last cascade reaches the fog
 * (`maxViewDistance`).
 */
export const EXPLORATION_SHADOW_RADIUS = 60;

/** The only allowed load scope: one resident island, on demand, with no catalog prefetch. */
export const EXPLORATION_LOD_LOAD_POLICY = {
  assetScopes: "current-island" as const,
  catalogPrefetch: false,
  otherIslands: false,
  scenes: 1 as const
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** OD-T2 caps: detail 160 units (Minimal 120), grass 90, regardless of spyglass zoom. */
export const EXPLORATION_SPYGLASS_LOD_CAPS = {
  detail: 160,
  detailMinimal: 120,
  grass: 90
} as const;

const validFieldOfView = (value: number) =>
  Number.isFinite(value) && value > 0 && value < Math.PI;

/** Magnification relative to the base eye field of view; 1 for the normal possessed view or bad input. */
export const explorationLodZoom = (fov: number, referenceFov: number) => {
  if (!validFieldOfView(fov) || !validFieldOfView(referenceFov)) return 1;
  return Math.max(1, Math.tan(referenceFov / 2) / Math.tan(fov / 2));
};

/** Detail and grass visibility distances for a possessed magnification, clamped to the OD-T2 caps. */
export const explorationLodDistances = (zoom: number, liteGround: boolean) => {
  const safeZoom = Math.max(1, Number.isFinite(zoom) ? zoom : 1);
  const detailCap = liteGround
    ? EXPLORATION_SPYGLASS_LOD_CAPS.detailMinimal
    : EXPLORATION_SPYGLASS_LOD_CAPS.detail;
  return {
    detail: clamp(EXPLORATION_LOD_DEFAULTS.farDetailDistance * safeZoom,
      EXPLORATION_LOD_DEFAULTS.farDetailDistance, detailCap),
    grass: clamp(EXPLORATION_LOD_DEFAULTS.grassDistance * safeZoom,
      EXPLORATION_LOD_DEFAULTS.grassDistance, EXPLORATION_SPYGLASS_LOD_CAPS.grass)
  };
};

/**
 * R16b: fills `target` with the possessed eye and the preset's building Detailed radius; the spyglass
 * widens the radius like the other detail distances, up to the OD-T2 detail cap. Undefined with no
 * radius (the strategic zoom rule stays).
 */
export const explorationBuildingEye = (
  target: BuildingDetailEye, radius: number, zoom: number, eye: { x: number; y: number; z: number }
) => {
  if (radius <= 0) return undefined;
  const safeZoom = Math.max(1, Number.isFinite(zoom) ? zoom : 1);
  target.radius = clamp(radius * safeZoom, radius, Math.max(radius, EXPLORATION_SPYGLASS_LOD_CAPS.detail));
  target.x = eye.x; target.y = eye.y; target.z = eye.z;
  return target;
};

const optionsWithDefaults = (options: ExplorationLodOptions = {}) => ({
  farDetailDistance: Math.max(1, options.farDetailDistance ?? EXPLORATION_LOD_DEFAULTS.farDetailDistance),
  fogFar: Math.max(1, options.fogFar ?? EXPLORATION_LOD_DEFAULTS.fogFar),
  fogNear: Math.max(0, options.fogNear ?? EXPLORATION_LOD_DEFAULTS.fogNear),
  grassDistance: Math.max(1, options.grassDistance ?? EXPLORATION_LOD_DEFAULTS.grassDistance),
  hysteresis: Math.max(0, options.hysteresis ?? EXPLORATION_LOD_DEFAULTS.hysteresis),
  impostorDistance: Math.max(1, options.impostorDistance ?? EXPLORATION_LOD_DEFAULTS.impostorDistance),
  maxViewDistance: Math.max(10, options.maxViewDistance ?? EXPLORATION_LOD_DEFAULTS.maxViewDistance),
  nearDetailDistance: Math.max(1, options.nearDetailDistance ?? EXPLORATION_LOD_DEFAULTS.nearDetailDistance)
});

/** One pure distance descriptor; the adapter below adds hysteresis for a walking camera. */
export const explorationLodAtDistance = (
  distance: number,
  quality: ExplorationLodQuality,
  options: ExplorationLodOptions = {},
  zoom = 1
): ExplorationLodFrame => {
  const tuning = optionsWithDefaults(options);
  const effective = (Number.isFinite(distance) ? distance : tuning.maxViewDistance) /
    Math.max(1, Number.isFinite(zoom) ? zoom : 1);
  const bounded = clamp(effective, 0, tuning.maxViewDistance);
  const near = bounded < tuning.farDetailDistance;
  return {
    animalDetail: bounded < tuning.maxViewDistance * 0.7 ? "near" : "coarse",
    distance: bounded,
    fogFar: Math.min(tuning.fogFar, tuning.maxViewDistance),
    fogNear: Math.min(tuning.fogNear, Math.max(0, Math.min(tuning.fogFar, tuning.maxViewDistance) - 1)),
    grassVisible: quality.grass && bounded < tuning.grassDistance,
    maxAnimalDistance: tuning.maxViewDistance * 0.8,
    maxPropDistance: tuning.maxViewDistance,
    plantDetail: !quality.liteGround && bounded <= tuning.nearDetailDistance,
    rockDetail: quality.rockDetail && near ? "near" : "coarse",
    shadowRadius: quality.sunShadows ? Math.min(EXPLORATION_SHADOW_RADIUS, tuning.maxViewDistance) : 0,
    terrainDetail: near ? "near" : "coarse",
    useImpostors: bounded >= tuning.impostorDistance
  };
};

export interface ExplorationLodAdapter {
  descriptor: () => ExplorationLodFrame | null;
  dispose: () => void;
  update: (distance: number, zoom?: number) => ExplorationLodFrame;
}

/**
 * Stateful adapter for the coordinator's FPS camera. The distance is eye-to-focus; the renderer can map
 * `plantDetail`/`useImpostors` to the existing vegetation view, and `terrainDetail`/`rockDetail` to the
 * existing LOD switches without changing the shared renderer contract.
 */
export const createExplorationLodAdapter = (
  quality: ExplorationLodQuality,
  options: ExplorationLodOptions = {}
): ExplorationLodAdapter => {
  const tuning = optionsWithDefaults(options);
  let plantDetail = true;
  let impostors = false;
  let coarseTerrain = false;
  let coarseRocks = false;
  let grass = true;
  let current: ExplorationLodFrame | null = null;
  let disposed = false;

  const within = (previous: boolean, distance: number, threshold: number) =>
    previous ? distance <= threshold + tuning.hysteresis : distance <= threshold - tuning.hysteresis;
  const beyond = (previous: boolean, distance: number, threshold: number) =>
    previous ? distance >= threshold - tuning.hysteresis : distance >= threshold + tuning.hysteresis;

  const compute = (distance: number, zoom: number): ExplorationLodFrame => {
    const effective = (Number.isFinite(distance) ? distance : tuning.maxViewDistance) /
      Math.max(1, Number.isFinite(zoom) ? zoom : 1);
    const bounded = clamp(effective, 0, tuning.maxViewDistance);
    plantDetail = !quality.liteGround && within(plantDetail, bounded, tuning.nearDetailDistance);
    impostors = beyond(impostors, bounded, tuning.impostorDistance);
    coarseTerrain = beyond(coarseTerrain, bounded, tuning.farDetailDistance);
    coarseRocks = !quality.rockDetail || beyond(coarseRocks, bounded, tuning.farDetailDistance);
    grass = quality.grass && within(grass, bounded, tuning.grassDistance);
    current = {
      animalDetail: bounded < tuning.maxViewDistance * 0.7 ? "near" : "coarse",
      distance: bounded,
      fogFar: Math.min(tuning.fogFar, tuning.maxViewDistance),
      fogNear: Math.min(tuning.fogNear, Math.max(0, Math.min(tuning.fogFar, tuning.maxViewDistance) - 1)),
      grassVisible: grass,
      maxAnimalDistance: tuning.maxViewDistance * 0.8,
      maxPropDistance: tuning.maxViewDistance,
      plantDetail,
      rockDetail: coarseRocks ? "coarse" : "near",
      shadowRadius: quality.sunShadows ? Math.min(EXPLORATION_SHADOW_RADIUS, tuning.maxViewDistance) : 0,
      terrainDetail: coarseTerrain ? "coarse" : "near",
      useImpostors: impostors
    };
    return current;
  };

  return {
    descriptor: () => current,
    dispose: () => {
      disposed = true;
      current = null;
    },
    update: (distance, zoom = 1) => disposed
      ? explorationLodAtDistance(tuning.maxViewDistance, quality, options, zoom)
      : compute(distance, zoom)
  };
};
