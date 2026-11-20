import { GROUND_VARIANT_TUNING } from "./shaders/ground-variant-layers-glsl";
import { wheatPatchRadius, wheatRandom } from "./wheat-field";

/**
 * Field rows (ground-palette-4): every plot's furrows run along the world z axis at the ground's tilled-soil spacing
 * (the crop plots' furrows of the ground shader), so a plot reads as tidy rows and lines up with the soil around it.
 */
export const FIELD_ROW_SPACING = GROUND_VARIANT_TUNING.tilledSpacing;

/** Local x of the first ridge crest at or right of the patch centre (`originX`: the patch's world x). */
export const fieldRowOffset = (originX: number) => {
  const crest = (Math.floor(originX / FIELD_ROW_SPACING - .25) + 1.25) * FIELD_ROW_SPACING;
  return crest - originX;
};

/** Small cultivated ridges along the field rows taper into the unchanged terrain at the patch boundary. */
export const wheatSoilRelief = (seed: number, x: number, z: number, originX = 0) => {
  const radius = Math.hypot(x, z) / wheatPatchRadius(Math.atan2(z, x), seed);
  const edge = Math.max(0, Math.min(1, (1 - radius) * 7));
  const ridge = Math.pow((Math.sin((x + originX) / FIELD_ROW_SPACING * Math.PI * 2) + 1) / 2, 2);
  const clods = Math.sin(x * 83 + seed) * Math.sin(z * 71 - seed) * .004;
  return edge * (.005 + ridge * .022 + clods);
};

export const createWheatSoilData = (seed: number, detailed: boolean,
  groundHeight: (x: number, z: number) => number, originX = 0) => {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [], edges: number[] = [];
  const rings = detailed ? 9 : 4, segments = detailed ? 64 : 24;
  positions.push(0, groundHeight(0, 0) + wheatSoilRelief(seed, 0, 0, originX), 0);
  uvs.push(.5, .5); edges.push(1);
  for (let ring = 1; ring <= rings; ring++) for (let segment = 0; segment < segments; segment++) {
    const angle = segment / segments * Math.PI * 2;
    const radius = ring / rings * wheatPatchRadius(angle, seed);
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    positions.push(x, groundHeight(x, z) + wheatSoilRelief(seed, x, z, originX), z);
    uvs.push(x / 1.6 + .5, z / 1.6 + .5);
    edges.push(ring === rings ? 0 : Math.min(1, (1 - ring / rings) * 7));
    const current = 1 + (ring - 1) * segments + segment;
    const next = 1 + (ring - 1) * segments + (segment + 1) % segments;
    if (ring === 1) indices.push(0, next, current);
    else {
      const previous = current - segments, previousNext = next - segments;
      indices.push(previous, next, current, previous, previousNext, next);
    }
  }
  return { positions, uvs, indices, edges };
};

/** Repeatable original soil palette: coarse aggregates, fine grit and shallow crevices. */
export const wheatSoilPixel = (x: number, y: number) => {
  const fine = wheatRandom(x + y * 512);
  const aggregate = wheatRandom(Math.floor(x / 7) + Math.floor(y / 7) * 97);
  const vein = Math.sin(x * .071 + Math.sin(y * .067) * 2) * .07;
  const value = .53 + (fine - .5) * .27 + (aggregate - .5) * .26 + vein;
  return [Math.round(value * 151), Math.round(value * 119), Math.round(value * 83)];
};
