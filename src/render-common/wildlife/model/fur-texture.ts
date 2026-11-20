import { createRandom } from "../../../shared/world/rng";

/** Tileable fur detail: R stroke height (bump), G albedo modulation (128 = neutral). */
export const FUR_TEXTURE_SIZE = 128;
const STROKES = 2600;
/** Strokes follow the body flow (texture u = model x, head to tail) with a little spread. */
const STROKE_SPREAD = 0.28;

const wrap = (value: number) =>
  ((Math.round(value) % FUR_TEXTURE_SIZE) + FUR_TEXTURE_SIZE) % FUR_TEXTURE_SIZE;

/** One hair stroke: rises from root to tip (a soft ridge), its own shade along the way. */
const drawStroke = (height: Float32Array, shade: Float32Array, random: () => number) => {
  const length = 5 + random() * 9;
  const angle = Math.PI + (random() - 0.5) * 2 * STROKE_SPREAD;
  const x = random() * FUR_TEXTURE_SIZE;
  const y = random() * FUR_TEXTURE_SIZE;
  const tone = (random() - 0.5) * 0.5;
  for (let step = 0; step <= length; step += 0.5) {
    const along = step / length;
    const pixel =
      wrap(y + Math.sin(angle) * step) * FUR_TEXTURE_SIZE + wrap(x + Math.cos(angle) * step);
    const ridge = Math.sin(Math.PI * along) * (0.6 + along * 0.4);
    if (ridge <= height[pixel]!) continue;
    height[pixel] = ridge;
    shade[pixel] = tone + along * 0.25;
  }
};

/**
 * Procedural fur (no photo): thousands of short overlapping hair strokes along the body flow,
 * written as a height for the detail normals (derivative bump in Three.js) and a subtle albedo
 * modulation. Deterministic per seed, wraps seamlessly.
 */
export const createFurTexture = (seed: number) => {
  const random = createRandom(seed);
  const pixels = FUR_TEXTURE_SIZE * FUR_TEXTURE_SIZE;
  const height = new Float32Array(pixels);
  const shade = new Float32Array(pixels);
  for (let stroke = 0; stroke < STROKES; stroke += 1) drawStroke(height, shade, random);
  const data = new Uint8Array(pixels * 4);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    data[pixel * 4] = Math.round(Math.min(1, height[pixel]!) * 255);
    data[pixel * 4 + 1] = Math.round(Math.min(1, Math.max(0, 0.5 + shade[pixel]! * 0.5)) * 255);
    data[pixel * 4 + 2] = 128;
    data[pixel * 4 + 3] = 255;
  }
  return data;
};
