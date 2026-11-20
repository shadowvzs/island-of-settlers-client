import { type BridgePlanningWorld,riverWaterEligibility } from "../../src/shared/settlement/bridge-planning";
import type { RoadPoint } from "../../src/shared/settlement/road-types";
import { sampleBilinear } from "../../src/shared/world/grid-geometry";
import { BLOCKING } from "../../src/shared/world/world-data";

export interface BridgeTestWorld extends BridgePlanningWorld {
  blocking: Uint8Array;
  heights: Float32Array;
  riverDistance: Float32Array;
}

interface BridgeTestWorldOptions {
  sea?: boolean;
  size?: number;
  /** Inclusive vertex band that holds water; all rows are filled. */
  waterFrom?: number;
  waterTo?: number;
}

/** A flat test island with a straight north-south river at `waterFrom..waterTo` vertices. */
export const bridgeTestWorld = (options: BridgeTestWorldOptions = {}): BridgeTestWorld => {
  const { sea = false, size = 24, waterFrom = 8, waterTo = 10 } = options;
  const stride = size + 1;
  const world: BridgeTestWorld = {
    blocking: new Uint8Array(size * size),
    cellsX: size,
    cellsZ: size,
    heights: new Float32Array(stride * stride),
    riverDistance: new Float32Array(stride * stride).fill(100),
    waterDepth: new Float32Array(stride * stride)
  };
  for (let z = 0; z <= size; z += 1) for (let x = 0; x <= size; x += 1) {
    const vertex = z * stride + x;
    const distance = x < waterFrom ? waterFrom - x : Math.max(0, x - waterTo);
    world.riverDistance[vertex] = sea ? 10 : distance;
    if (x >= waterFrom && x <= waterTo) world.waterDepth[vertex] = 1;
  }
  for (let z = 0; z < size; z += 1)
    for (let x = waterFrom; x <= Math.min(waterTo, size - 1); x += 1)
      world.blocking[z * size + x] = BLOCKING.water;
  return world;
};

/** A straight river through `centre` running at `angleDegrees` from the +x axis. */
export interface AngledRiver {
  angleDegrees: number;
  centre: RoadPoint;
  halfWidth: number;
}

export interface AngledRiverLayers {
  blocking: Uint8Array;
  cellsX: number;
  cellsZ: number;
  riverDistance: Float32Array;
  walkCost?: Uint8Array;
  waterDepth: Float32Array;
}

/** Unit vector along the river's flow line. */
export const riverDirection = (river: AngledRiver): RoadPoint => {
  const angle = river.angleDegrees * Math.PI / 180;
  return { x: Math.cos(angle), z: Math.sin(angle) };
};

/** Distance from the river's centreline. */
export const riverCentreDistance = (river: AngledRiver, point: RoadPoint) => {
  const direction = riverDirection(river);
  return Math.abs((point.x - river.centre.x) * -direction.z + (point.z - river.centre.z) * direction.x);
};

/**
 * Paints the river into existing layers: water depth falls linearly to the waterline at
 * `halfWidth`, cells whose centre is wet become water (and unwalkable when a walk cost exists).
 */
export const paintAngledRiver = (layers: AngledRiverLayers, river: AngledRiver, sea = false) => {
  const stride = layers.cellsX + 1;
  for (let z = 0; z <= layers.cellsZ; z += 1) for (let x = 0; x <= layers.cellsX; x += 1) {
    const distance = riverCentreDistance(river, { x, z });
    layers.waterDepth[z * stride + x] = Math.max(-1, Math.min(1, river.halfWidth - distance));
    layers.riverDistance[z * stride + x] = sea ? 10 : Math.max(0, distance - river.halfWidth);
  }
  for (let z = 0; z < layers.cellsZ; z += 1) for (let x = 0; x < layers.cellsX; x += 1) {
    if (riverCentreDistance(river, { x: x + 0.5, z: z + 0.5 }) >= river.halfWidth) continue;
    layers.blocking[z * layers.cellsX + x] = BLOCKING.water;
    if (layers.walkCost) layers.walkCost[z * layers.cellsX + x] = 0;
  }
};

/** A flat test island crossed by one straight river at any angle. */
export const angledBridgeTestWorld = (river: AngledRiver, options: { sea?: boolean; size?: number } = {}) => {
  const size = options.size ?? 32, stride = size + 1;
  const world: BridgeTestWorld = {
    blocking: new Uint8Array(size * size),
    cellsX: size,
    cellsZ: size,
    heights: new Float32Array(stride * stride),
    riverDistance: new Float32Array(stride * stride),
    waterDepth: new Float32Array(stride * stride)
  };
  paintAngledRiver(world, river, options.sea);
  return world;
};

export const waterDepthAt = (world: BridgeTestWorld, point: RoadPoint) =>
  sampleBilinear(world, world.waterDepth, point.x, point.z);

/** Dry, clear shore ground for the synthetic river; gameplay predicates stay injected. */
export const dryShore = (world: BridgeTestWorld) => (point: RoadPoint) =>
  point.x >= 0 && point.z >= 0 && point.x <= world.cellsX && point.z <= world.cellsZ &&
  waterDepthAt(world, point) <= 0;

export const bridgeRules = (world: BridgeTestWorld) => ({
  isEligibleWater: riverWaterEligibility(world),
  isSafeShore: dryShore(world)
});
