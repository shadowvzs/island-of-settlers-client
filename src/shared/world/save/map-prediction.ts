import { xorBytes } from "./map-bytes";
import type { LayerArray } from "./map-layers";

/**
 * Layers a map file stores as exact XOR residuals against a prediction from other layers (map
 * format 3): `waterDepth` is `max(0, waterSurface - heights)` and the road grading layers and the
 * restore baseline are near copies of `heights`. Where they agree the residual is zero bytes, which
 * compress to nothing (gzip cannot see the duplicates: they are a megabyte apart, its window 32 KiB).
 * The decoded layers are bit identical to the live ones.
 */
export const RESIDUAL_SUFFIX = "~residual";

type Layers = ReadonlyMap<string, LayerArray>;

interface ResidualRule {
  name: string;
  predict: (layers: Layers) => Float32Array;
}

export const predictWaterDepth = (heights: Float32Array, waterSurface: Float32Array) =>
  Float32Array.from(heights, (height, index) => Math.max(0, waterSurface[index]! - height));

const predictHeights = (layers: Layers) => layers.get("heights") as Float32Array;

export const RESIDUAL_RULES: readonly ResidualRule[] = [
  { name: "restoreBaselineHeights", predict: predictHeights },
  { name: "roadGradeBase", predict: predictHeights },
  { name: "roadGradeApplied", predict: predictHeights },
  {
    name: "waterDepth",
    predict: (layers) => predictWaterDepth(predictHeights(layers), layers.get("waterSurface") as Float32Array)
  }
];

export const residualName = (name: string) => `${name}${RESIDUAL_SUFFIX}`;

/** The layer a chunk name stands for (a residual chunk stands for its original layer). */
export const baseLayerName = (chunkName: string) =>
  chunkName.endsWith(RESIDUAL_SUFFIX) ? chunkName.slice(0, -RESIDUAL_SUFFIX.length) : chunkName;

export const isResidualName = (chunkName: string) => chunkName.endsWith(RESIDUAL_SUFFIX);

export const hasResidualRule = (name: string) => RESIDUAL_RULES.some((rule) => rule.name === name);

const toFloats = (bytes: Uint8Array) => new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);

/** The residual of a layer against its prediction (a new array; the layer is untouched). */
export const toResidual = (rule: ResidualRule, layer: Float32Array, layers: Layers) =>
  toFloats(xorBytes(layer, rule.predict(layers)));

/** Rebuilds every residual layer in place: the residual is replaced by the original layer. */
export const applyResiduals = (layers: Map<string, LayerArray>) => {
  for (const rule of RESIDUAL_RULES) {
    const residual = layers.get(residualName(rule.name)) as Float32Array | undefined;
    if (!residual) continue;
    layers.delete(residualName(rule.name));
    layers.set(rule.name, toFloats(xorBytes(residual, rule.predict(layers))));
  }
};
