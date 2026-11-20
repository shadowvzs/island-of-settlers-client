import {
  type CameraState,
  getViewHalfExtent,
  rotateAroundUp} from "../../render-common/camera-state";
import { ISO_PITCH } from "../../render-common/iso-projection";
import { getTreeSpecies } from "../../render-common/props/island-trees";
import type { TreeSpecies } from "../../render-common/trees/tree-model";
import { clamp } from "../../shared/world/noise";
import { MATERIAL, MATERIAL_COUNT, type WorldData } from "../../shared/world/world-data";
import { SOUND_FEATURES, type SoundFeature, type SoundSample } from "./soundscape-mix";

/** World cells per field block: rivers and groves are heard a few blocks away (blurred). */
const BLOCK = 4;
/** Sea vertices within this distance of land form the surf zone. */
const SURF_ZONE = 2.5;
/** Trees per cell of a dense forest (density 1). */
const DENSE_TREES_PER_CELL = 0.3;
/** River flow speed (world units per second) heard as fast water. */
const FAST_FLOW = 2;
/** Points per view axis sampled each update (odd: the centre is one of them). */
const SAMPLE_GRID = 9;
/** Share of the plain view average next to the near-target weighting. */
const VIEW_WEIGHT = 0.12;

type FieldChannel = SoundFeature | "riverSpeed";
type TreeChannel = "broadleaf" | "palm" | "pine";
const TREE_CHANNELS = ["broadleaf", "palm", "pine"] as const;

/**
 * Coarse, blurred feature maps of the island built once (block resolution); the leaf channels
 * follow felling (`removeSoundTree`).
 */
export interface SoundField {
  blocksX: number;
  blocksZ: number;
  channels: Record<FieldChannel, Float32Array>;
  /** Standing trees per block and leaf channel (before normalising and blurring). */
  trees: Record<TreeChannel, Float32Array>;
}

const TREE_CHANNEL: Partial<Record<TreeSpecies, TreeChannel>> = {
  oak: "broadleaf",
  palm: "palm",
  pine: "pine",
  birch: "broadleaf"
};

const isMeadowVertex = (world: WorldData, vertex: number) => {
  const base = vertex * MATERIAL_COUNT;
  const grass = world.splat[base + MATERIAL.grass]! + world.splat[base + MATERIAL.lushGrass]!;
  return grass > 140;
};

const accumulateVertices = (world: WorldData, field: SoundField, counts: Float32Array) => {
  const { channels } = field;
  const stride = world.cellsX + 1;
  for (let vertex = 0; vertex < world.heights.length; vertex += 1) {
    const block = toBlock(field, vertex % stride, Math.floor(vertex / stride));
    counts[block]! += 1;
    const depth = world.waterDepth[vertex]!;
    const speed = Math.hypot(world.flow[vertex * 2]!, world.flow[vertex * 2 + 1]!);
    if (depth > 0 && speed > 0) {
      channels.river[block]! += 1;
      channels.riverSpeed[block]! += clamp(speed / FAST_FLOW, 0, 1);
    } else if (depth > 0) {
      channels.sea[block]! += 1;
      if (world.coastDistance[vertex]! > -SURF_ZONE) channels.shore[block]! += 1;
    } else if (isMeadowVertex(world, vertex)) {
      channels.meadow[block]! += 1;
    }
  }
};

const getTreeChannel = (world: WorldData, tree: number) => {
  const species = getTreeSpecies(world.props.types[tree]!);
  return species ? TREE_CHANNEL[species] : undefined;
};

const getTreeBlock = (world: WorldData, field: SoundField, tree: number) =>
  toBlock(field, world.props.x[tree]!, world.props.z[tree]!);

const accumulateTrees = (world: WorldData, field: SoundField) => {
  for (let index = 0; index < world.props.count; index += 1) {
    const channel = getTreeChannel(world, index);
    if (channel) field.trees[channel][getTreeBlock(world, field, index)]! += 1;
  }
};

/** Trees per block -> leaf share (0..1, a dense forest is 1). */
const toTreeShare = (trees: number) => Math.min(1, trees / (BLOCK * BLOCK * DENSE_TREES_PER_CELL));

const toBlock = (field: SoundField, x: number, z: number) => {
  const blockX = clamp(Math.floor(x / BLOCK), 0, field.blocksX - 1);
  const blockZ = clamp(Math.floor(z / BLOCK), 0, field.blocksZ - 1);
  return blockZ * field.blocksX + blockX;
};

/**
 * Counts -> shares (0..1): water and meadow per vertex, trees per cell. `riverSpeed` holds the
 * speed weighted river share, so riverSpeed / river is the mean speed after any averaging.
 */
const normalizeChannels = (field: SoundField, counts: Float32Array) => {
  const { channels, trees } = field;
  const vertexChannels = ["meadow", "river", "riverSpeed", "sea", "shore"] as const;
  for (let block = 0; block < counts.length; block += 1) {
    const vertices = counts[block] || 1;
    for (const channel of vertexChannels) channels[channel][block]! /= vertices;
    for (const channel of TREE_CHANNELS) {
      channels[channel][block] = toTreeShare(trees[channel][block]!);
    }
  }
};

const isInside = (field: SoundField, x: number, z: number) =>
  x >= 0 && z >= 0 && x < field.blocksX && z < field.blocksZ;

/** One block of the 3x3 box blur (the centre counts twice) over `read` (block -> value). */
const blurBlock = (field: SoundField, read: (block: number) => number, x: number, z: number) => {
  let sum = 0;
  let weight = 0;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (!isInside(field, x + dx, z + dz)) continue;
      const w = dx === 0 && dz === 0 ? 2 : 1;
      sum += read((z + dz) * field.blocksX + x + dx) * w;
      weight += w;
    }
  }
  return sum / weight;
};

/** 3x3 box blur: a feature is heard a block or two around it. */
const blur = (field: SoundField, values: Float32Array) => {
  const source = values.slice();
  const read = (block: number) => source[block]!;
  for (let z = 0; z < field.blocksZ; z += 1) {
    for (let x = 0; x < field.blocksX; x += 1) {
      values[z * field.blocksX + x] = blurBlock(field, read, x, z);
    }
  }
};

/**
 * A tree was felled: its block counts one tree less and the blurred leaf share of the 3x3
 * blocks around it is recomputed (nine blocks, no rebuild), so the rustle follows felling.
 */
export const removeSoundTree = (field: SoundField, world: WorldData, tree: number) => {
  const channel = getTreeChannel(world, tree);
  if (!channel) return;
  const counts = field.trees[channel];
  const block = getTreeBlock(world, field, tree);
  if (counts[block]! <= 0) return;
  counts[block]! -= 1;
  const read = (index: number) => toTreeShare(counts[index]!);
  const blockX = block % field.blocksX;
  const blockZ = Math.floor(block / field.blocksX);
  for (let z = blockZ - 1; z <= blockZ + 1; z += 1) {
    for (let x = blockX - 1; x <= blockX + 1; x += 1) {
      if (!isInside(field, x, z)) continue;
      field.channels[channel][z * field.blocksX + x] = blurBlock(field, read, x, z);
    }
  }
};

/** Builds the feature maps of a world (a few ms, once per island). */
export const createSoundField = (world: WorldData): SoundField => {
  const blocksX = Math.ceil(world.cellsX / BLOCK) + 1;
  const blocksZ = Math.ceil(world.cellsZ / BLOCK) + 1;
  const size = blocksX * blocksZ;
  const channels = Object.fromEntries(
    [...SOUND_FEATURES, "riverSpeed"].map((channel) => [channel, new Float32Array(size)])
  ) as Record<FieldChannel, Float32Array>;
  const trees = Object.fromEntries(
    TREE_CHANNELS.map((channel) => [channel, new Float32Array(size)])
  ) as Record<TreeChannel, Float32Array>;
  const field: SoundField = { blocksX, blocksZ, channels, trees };
  const counts = new Float32Array(size);
  accumulateVertices(world, field, counts);
  accumulateTrees(world, field);
  normalizeChannels(field, counts);
  for (const channel of [...SOUND_FEATURES, "riverSpeed"] as const) blur(field, channels[channel]);
  return field;
};

/** Beyond the island border there is only open sea. */
const OUTSIDE: Record<FieldChannel, number> = {
  broadleaf: 0,
  meadow: 0,
  palm: 0,
  pine: 0,
  river: 0,
  riverSpeed: 0,
  sea: 1,
  shore: 0
};

/** Bilinear read of a channel at world (x, z). */
const readChannel = (field: SoundField, channel: FieldChannel, x: number, z: number) => {
  const bx = x / BLOCK - 0.5;
  const bz = z / BLOCK - 0.5;
  if (bx < -1 || bz < -1 || bx > field.blocksX || bz > field.blocksZ) return OUTSIDE[channel];
  const x0 = clamp(Math.floor(bx), 0, field.blocksX - 2);
  const z0 = clamp(Math.floor(bz), 0, field.blocksZ - 2);
  const fx = clamp(bx - x0, 0, 1);
  const fz = clamp(bz - z0, 0, 1);
  const values = field.channels[channel];
  const at = (dx: number, dz: number) => values[(z0 + dz) * field.blocksX + x0 + dx]!;
  const top = at(0, 0) * (1 - fx) + at(1, 0) * fx;
  const bottom = at(0, 1) * (1 - fx) + at(1, 1) * fx;
  return top * (1 - fz) + bottom * fz;
};

/** Ground footprint of the view: half extents along screen right (u) and down (v). */
export const getViewFootprint = (camera: CameraState) => {
  const { halfHeight, halfWidth } = getViewHalfExtent(camera);
  const pitch = clamp(ISO_PITCH + camera.tilt, 0.25, 1.4);
  return { halfU: Math.max(1, halfWidth), halfV: Math.max(1, halfHeight / Math.sin(pitch)) };
};

/** World point of the view axes (u right, v down the screen), turned by the camera yaw. */
export const viewToWorld = (camera: CameraState, u: number, v: number) => {
  const turned = rotateAroundUp((u + v) / Math.SQRT2, (v - u) / Math.SQRT2, camera.yaw);
  return { x: camera.centerX + turned.x, z: camera.centerZ + turned.z };
};

/** View axes of a world point: `u` is the stereo axis (screen right). */
export const worldToView = (camera: CameraState, x: number, z: number) => {
  const turned = rotateAroundUp(x - camera.centerX, z - camera.centerZ, -camera.yaw);
  return { u: (turned.x - turned.z) / Math.SQRT2, v: (turned.x + turned.z) / Math.SQRT2 };
};

/** How far the listener hears around the camera target (world units), from the view size. */
export const getHearingRadius = (halfU: number, halfV: number) =>
  clamp(Math.min(halfU, halfV) * 0.6, 5, 30);

const createAccumulator = () => ({
  pan: Object.fromEntries(SOUND_FEATURES.map((feature) => [feature, 0])) as Record<
    SoundFeature,
    number
  >,
  sum: Object.fromEntries([...SOUND_FEATURES, "riverSpeed"].map((key) => [key, 0])) as Record<
    FieldChannel,
    number
  >,
  weight: 0
});

/**
 * What is heard around the camera target: a grid over the view footprint, weighted towards
 * the target (near sources dominate) plus a little of the whole view; each feature's pan is
 * its weighted screen position. About 80 bilinear reads per channel: run it a few times a second.
 */
export const sampleSoundField = (field: SoundField, camera: CameraState): SoundSample => {
  const { halfU, halfV } = getViewFootprint(camera);
  const radius = getHearingRadius(halfU, halfV);
  const total = createAccumulator();
  const half = (SAMPLE_GRID - 1) / 2;
  for (let row = 0; row < SAMPLE_GRID; row += 1) {
    for (let column = 0; column < SAMPLE_GRID; column += 1) {
      const u = ((column - half) / half) * halfU;
      const v = ((row - half) / half) * halfV;
      const { x, z } = viewToWorld(camera, u, v);
      const weight = Math.exp(-((u * u + v * v) / (radius * radius))) + VIEW_WEIGHT;
      total.weight += weight;
      for (const channel of SOUND_FEATURES) {
        const value = readChannel(field, channel, x, z) * weight;
        total.sum[channel] += value;
        total.pan[channel] += value * (u / halfU);
      }
      total.sum.riverSpeed += readChannel(field, "riverSpeed", x, z) * weight;
    }
  }
  return toSample(total);
};

const toSample = (total: ReturnType<typeof createAccumulator>): SoundSample => {
  const share = (channel: FieldChannel) => total.sum[channel] / total.weight;
  const pan = Object.fromEntries(
    SOUND_FEATURES.map((feature) => {
      const amount = total.sum[feature];
      return [feature, amount > 1e-6 ? clamp(total.pan[feature] / amount, -1, 1) : 0];
    })
  ) as Record<SoundFeature, number>;
  const river = share("river");
  return {
    broadleaf: share("broadleaf"),
    meadow: share("meadow"),
    pan,
    palm: share("palm"),
    pine: share("pine"),
    river,
    riverSpeed: river > 1e-4 ? clamp(share("riverSpeed") / river, 0, 1) : 0,
    sea: share("sea"),
    shore: share("shore")
  };
};
