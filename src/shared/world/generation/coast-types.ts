import type { GridSize } from "../grid-geometry";
import { smoothstep } from "../noise";
import { boxBlurVertices } from "./box-blur";
import { computeDistanceField } from "./distance-field";

/** Land vertices this far (cells) from the sea sample the coast behind the shore. */
const SAMPLE_BAND = { max: 6, min: 1.5 } as const;
/** Spread of the samples along the coast and out over the sea (three passes: sigma ~ radius). */
const SPREAD = { passes: 3, radius: 8 } as const;
/** Rise per cell behind the shore: up to `beach` a gentle shore, from `cliff` a cliff coast. */
const RISE = { beach: 0.25, cliff: 0.7 } as const;
/** Ground from this height up is high (a massif or a tall hill). */
const HIGH_GROUND = 4.5;
/** Cells from the shore band to high ground: a massif this close makes a mountain coast. */
const MASSIF_REACH = { full: 10, none: 22 } as const;
/** Coast type where no coast sample reaches (far out at sea), and its weight. */
const PRIOR = { type: 0.15, weight: 1e-4 } as const;
/**
 * Mean sample type of a pure beach and of a full cliff coast: the spread dilutes short steep
 * stretches, and a massif a few cells behind the shore already counts as a cliff coast.
 */
const TYPE_RANGE = { beach: 0.05, cliff: 0.6 } as const;

interface CoastSampleInputs {
  heights: Float32Array;
  highDistance: Float32Array;
  seaDistance: Float32Array;
  seaLevel: number;
}

/** Coast type of one land vertex of the shore band: the steeper of its rise and its massif. */
const getSampleType = (inputs: CoastSampleInputs, index: number) => {
  const distance = inputs.seaDistance[index]!;
  const rise = Math.max(0, inputs.heights[index]! - inputs.seaLevel) / distance;
  const steep = smoothstep(RISE.beach, RISE.cliff, rise);
  const massif = 1 - smoothstep(MASSIF_REACH.full, MASSIF_REACH.none, inputs.highDistance[index]!);
  return Math.max(steep, massif);
};

/** Coast type samples on the land band behind the shore (weight 1 there, 0 elsewhere). */
const sampleCoastTypes = (inputs: CoastSampleInputs) => {
  const types = new Float32Array(inputs.heights.length);
  const weights = new Float32Array(inputs.heights.length);
  for (let index = 0; index < types.length; index += 1) {
    const distance = inputs.seaDistance[index]!;
    if (distance < SAMPLE_BAND.min || distance > SAMPLE_BAND.max) continue;
    types[index] = getSampleType(inputs, index);
    weights[index] = 1;
  }
  return { types, weights };
};

/**
 * Coast type per vertex, 0 = beach (sand coast, gentle shore, river mouth) .. 1 = cliff (steep
 * land at the water, rocky or mountain coast): how fast the land rises behind the nearest shore
 * and how close a massif stands to it. The samples are spread along the coast and out over the
 * sea, so the type changes smoothly along the coast and is known offshore.
 */
export const computeCoastTypes = (grid: GridSize, heights: Float32Array, seaLevel: number) => {
  const inputs: CoastSampleInputs = {
    heights,
    highDistance: computeDistanceField(grid, (index) => heights[index]! >= HIGH_GROUND),
    seaDistance: computeDistanceField(grid, (index) => heights[index]! < seaLevel),
    seaLevel
  };
  const { types, weights } = sampleCoastTypes(inputs);
  boxBlurVertices(grid, types, SPREAD);
  boxBlurVertices(grid, weights, SPREAD);
  return types.map((sum, index) => {
    const meanType = (sum + PRIOR.type * PRIOR.weight) / (weights[index]! + PRIOR.weight);
    return smoothstep(TYPE_RANGE.beach, TYPE_RANGE.cliff, meanType);
  });
};
