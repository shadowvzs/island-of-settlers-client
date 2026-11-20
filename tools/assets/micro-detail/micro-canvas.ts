import { createPeriodicNoise } from "../../../src/render-common/materials/periodic-noise";
import type { RecipeContext } from "../../../src/render-common/materials/recipe-helpers";
import { createPaint, createTileCanvas, type Paint, type Rgb, stampDisc, type Stroke,
  type TileCanvas } from "../../../src/render-common/materials/tile-canvas";
import { createRandom } from "../../../src/shared/world/rng";

/**
 * Micro tiles reuse the ground tile canvas, but paint a grey tone instead of a colour: the tone
 * becomes the albedo multiplier (B) and the height becomes the normal (RG) and cavity (A).
 */
export const createMicroContext = (size: number, seed: number): RecipeContext => ({
  canvas: createTileCanvas(size),
  noise: createPeriodicNoise(seed),
  paint: createPaint(),
  random: createRandom(seed)
});

export const setTone = (paint: Paint, tone: number) => {
  paint.r = tone;
  paint.g = tone;
  paint.b = tone;
};

/** A grey palette for the shared scatter helpers (stones, debris), which pick RGB from a ramp. */
export const toneRamp = (...tones: number[]): Rgb[] => tones.map(tone => [tone, tone, tone]);

/** The painted tone (multiplier before normalisation) of a texel. */
export const toneAt = (canvas: TileCanvas, index: number) => canvas.color[index * 3]!;

/**
 * A tapering blade or twig with a ridge along its centre line (mid-rib / keel): overlapping
 * discs whose dome is `rib` high, so the normal flips across the blade.
 */
export const stampRibbedStroke = (
  canvas: TileCanvas,
  stroke: Stroke,
  paint: Paint,
  rib: number,
  shadeAt: (t: number) => number
) => {
  const steps = Math.max(3, Math.ceil(stroke.length * 2));
  const stepLength = stroke.length / steps;
  const base = paint.r;
  let x = stroke.x;
  let y = stroke.y;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const angle = stroke.angle + stroke.bend * t * t +
      stroke.wiggle * Math.sin(t * stroke.wiggleFrequency * Math.PI * 2 + stroke.x);
    const radius = Math.max(0.45, (stroke.width * (1 - stroke.taper * t)) / 2);
    setTone(paint, base * shadeAt(t));
    const height = stroke.baseHeight + (stroke.tipHeight - stroke.baseHeight) * t;
    stampDisc(canvas, x, y, radius, height, rib * Math.min(1, radius), paint);
    x += Math.cos(angle) * stepLength;
    y += Math.sin(angle) * stepLength;
  }
  setTone(paint, base);
};
