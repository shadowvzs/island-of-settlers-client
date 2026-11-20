import { THEME_COUNT } from "../generation/island-themes";
import { GROUND_VARIANT_COUNT } from "../ground-variants";
import { MATERIAL_COUNT, type PropSet, type WorldData } from "../world-data";
import type { ChunkInfo, LayerType } from "./map-format";

export type LayerArray = Float32Array | Uint16Array | Uint8Array;

/** What one entry of a layer belongs to: a grid vertex, a cell or a prop. */
type LayerScope = "cell" | "prop" | "vertex";

/** A stored layer's name, scope, element type and entries per scope item (its size). */
export interface LayerShape {
  /** Alternative stored types (quantised prop layers may be u16 or f32). */
  acceptedTypes?: readonly LayerType[];
  name: string;
  scope: LayerScope;
  stride: number;
  type: LayerType;
}

/** A stored world layer: where it lives in the world and whether a file may lack it. */
export interface LayerSpec extends LayerShape {
  get: (world: WorldData) => LayerArray | undefined;
  /** May be missing (lakeWater: only after the editor dug a lake). */
  optional: boolean;
}

type WorldLayerKey = {
  [Key in keyof WorldData]-?: NonNullable<WorldData[Key]> extends LayerArray ? Key : never;
}[keyof WorldData];

type PropLayerKey = Exclude<keyof PropSet, "count">;

const worldLayer = (
  name: WorldLayerKey,
  scope: LayerScope,
  type: LayerType,
  stride = 1,
  optional = false
): LayerSpec => ({ get: (world) => world[name], name, optional, scope, stride, type });

/** Only the `count` used entries of a prop array (the arrays may be longer). */
const propLayer = (name: PropLayerKey, type: LayerType, acceptedTypes?: readonly LayerType[]): LayerSpec => ({
  get: ({ props }) => props[name].subarray(0, props.count),
  name: `props.${name}`,
  optional: false,
  scope: "prop",
  stride: 1,
  type,
  ...(acceptedTypes ? { acceptedTypes } : {})
});

/**
 * Every layer a saved map stores, in file order. Not stored: the normals (computeNormals of the
 * heights, as every edit does) and the fog (runtime state, made again from the sectors).
 */
export const MAP_LAYERS: readonly LayerSpec[] = [
  worldLayer("clearedStoneGround", "cell", "u8", 1, true),
  worldLayer("restoreBaselineHeights", "vertex", "f32", 1, true),
  worldLayer("restoreBaselineWater", "vertex", "f32", 1, true),
  worldLayer("restoreBaselineLake", "vertex", "u8", 1, true),
  worldLayer("heights", "vertex", "f32"),
  worldLayer("roadGradeBase", "vertex", "f32", 1, true),
  worldLayer("roadGradeApplied", "vertex", "f32", 1, true),
  worldLayer("waterSurface", "vertex", "f32"),
  worldLayer("waterDepth", "vertex", "f32"),
  worldLayer("flow", "vertex", "f32", 2),
  worldLayer("coastDistance", "vertex", "f32"),
  worldLayer("riverDistance", "vertex", "f32"),
  worldLayer("splat", "vertex", "u8", MATERIAL_COUNT),
  worldLayer("themeWeights", "vertex", "u8", THEME_COUNT),
  worldLayer("ambientOcclusion", "vertex", "u8"),
  worldLayer("sunShadow", "vertex", "u8"),
  worldLayer("heightLevels", "vertex", "u8"),
  worldLayer("moisture", "vertex", "u8"),
  worldLayer("wetRock", "vertex", "u8"),
  worldLayer("lakeWater", "vertex", "u8", 1, true),
  worldLayer("groundVariants", "vertex", "u8", GROUND_VARIANT_COUNT, true),
  worldLayer("coverPaint", "cell", "u8", 1, true),
  worldLayer("blocking", "cell", "u8"),
  worldLayer("buildCap", "cell", "u8"),
  worldLayer("buildClass", "cell", "u8"),
  worldLayer("slopeClass", "cell", "u8"),
  worldLayer("walkCost", "cell", "u8"),
  worldLayer("oreAmount", "cell", "u8"),
  worldLayer("mineZone", "cell", "u16"),
  worldLayer("sector", "cell", "u16"),
  propLayer("types", "u8"),
  propLayer("form", "u8"),
  propLayer("x", "f32", ["f32", "u16"]),
  propLayer("y", "f32"),
  propLayer("z", "f32", ["f32", "u16"]),
  propLayer("rotation", "f32", ["f32", "u16"]),
  propLayer("scale", "f32", ["f32", "u16"]),
  { ...propLayer("phase", "f32"), optional: true }
];

/** Entries a layer must have on a map of this size with this many props. */
export const getLayerLength = (
  spec: LayerShape,
  size: { cellsX: number; cellsZ: number; propCount: number }
) => {
  if (spec.scope === "prop") return size.propCount;
  if (spec.scope === "cell") return size.cellsX * size.cellsZ * spec.stride;
  return (size.cellsX + 1) * (size.cellsZ + 1) * spec.stride;
};

/** A layer to store and its chunk table entry. */
export interface StoredLayer {
  array: LayerArray;
  info: ChunkInfo;
}

export const toStoredLayer = (shape: LayerShape, array: LayerArray): StoredLayer => ({
  array,
  info: { length: array.length, name: shape.name, type: shape.type }
});

/** Bytes per element of a layer type. */
export const TYPE_BYTES: Record<LayerType, number> = { f32: 4, u16: 2, u8: 1 };

/** The layer array over the bytes' own buffer (the bytes must own a whole buffer). */
export const toLayerArray = (type: LayerType, owned: Uint8Array): LayerArray => {
  if (type === "f32") return new Float32Array(owned.buffer);
  if (type === "u16") return new Uint16Array(owned.buffer);
  return owned;
};
