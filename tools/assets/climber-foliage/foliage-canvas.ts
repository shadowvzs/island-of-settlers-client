import { toByte } from "../../../src/render-common/color";
import { type AtlasCanvas, createAtlasCanvas, darkenPixel, dilateAtlasCanvas, finishCanvas,
  writePixel } from "../../../src/render-common/trees/atlas-canvas";
import { clamp01 } from "./foliage-noise";

export type Rgb = readonly [number, number, number];

/**
 * What one element (blade, petal, stem...) contributes to a texel. Colour is linear and final
 * (base colour x luminance shading x baked occlusion). Relief is in element-length units.
 */
export interface FoliageSample {
  colour: Rgb;
  relief: number;
  roughness: number;
  /** 1 = multiplied by the card's vertex tint (palette), 0 = baked natural colour kept as is. */
  tint: number;
  /** 1 = thin tissue that transmits most back light, 0 = opaque (thick veins, wood). */
  translucency: number;
}

/** Element placement in tile UV: local +y runs from `origin` along `angle` (0 = +v, positive towards +u). */
export interface ElementFrame {
  angle: number;
  length: number;
  /** Mirrors local x (asymmetric shapes on the other side). */
  mirror?: boolean;
  origin: readonly [number, number];
}

export interface FoliageElement {
  /** Local-space [xMin, yMin, xMax, yMax] that contains the whole shape. */
  bounds: readonly [number, number, number, number];
  /** Signed distance-like field in local units, negative inside. */
  distance: (x: number, y: number) => number;
  frame: ElementFrame;
  /** `texel` = one level-0 texel in local units, so fine veins can keep a readable minimum width. */
  shade: (x: number, y: number, distance: number, texel: number) => FoliageSample;
  /** Darkening (0..1) this element casts onto the layers painted before it. */
  shadow?: number;
}

export interface FoliageCanvas {
  albedo: AtlasCanvas;
  /** colour channels = [translucency, roughness, tint]; alpha mirrors coverage. */
  material: AtlasCanvas;
  nextSurface: number;
  size: number;
  tilePixels: number;
}

/** Painter and attachment pivot (tile UV) of one atlas tile. */
export interface FoliageTileRecipe {
  paint: (painter: TilePainter) => void;
  pivot: readonly [number, number];
}

export interface TilePainter {
  canvas: FoliageCanvas;
  pixels: number;
  x0: number;
  y0: number;
}

/** Normal strength for relief stored in pixel heights (central difference spans two texels). */
const NORMAL_STRENGTH = 0.5;
/** Relief is authored as a fraction of the element length; this converts it to pixel heights. */
const RELIEF_SCALE = 1;
/** Shadow cast towards -u, -v (light from the upper right of the card), in tile units. */
const SHADOW_OFFSET = [-0.010, -0.014] as const;
const SHADOW_SOFTNESS_PX = 5;
const EDGE_BAND_PX = 6;

export const createFoliageCanvas = (size: number, grid: number): FoliageCanvas => ({
  albedo: createAtlasCanvas(size, size), material: createAtlasCanvas(size, size), nextSurface: 0,
  size, tilePixels: size / grid
});

export const tilePainter = (canvas: FoliageCanvas, index: number, grid: number): TilePainter => ({
  canvas, pixels: canvas.tilePixels,
  x0: (index % grid) * canvas.tilePixels, y0: Math.floor(index / grid) * canvas.tilePixels
});

const toLocal = (frame: ElementFrame, u: number, v: number): [number, number] => {
  const sin = Math.sin(frame.angle), cos = Math.cos(frame.angle);
  const du = u - frame.origin[0], dv = v - frame.origin[1];
  const y = (du * sin + dv * cos) / frame.length, x = (du * cos - dv * sin) / frame.length;
  return [frame.mirror ? -x : x, y];
};

const toTile = (frame: ElementFrame, x: number, y: number): [number, number] => {
  const sin = Math.sin(frame.angle), cos = Math.cos(frame.angle), lx = frame.mirror ? -x : x;
  return [frame.origin[0] + (lx * cos + y * sin) * frame.length, frame.origin[1] + (y * cos - lx * sin) * frame.length];
};

const pixelBounds = (painter: TilePainter, element: FoliageElement, pad: number) => {
  const [x0, y0, x1, y1] = element.bounds;
  const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => toTile(element.frame, x!, y!));
  const us = corners.map(corner => corner[0]), vs = corners.map(corner => corner[1]);
  const clampPixel = (value: number) => Math.min(painter.pixels - 1, Math.max(0, value));
  return {
    left: clampPixel(Math.floor((Math.min(...us) - pad) * painter.pixels)),
    right: clampPixel(Math.ceil((Math.max(...us) + pad) * painter.pixels)),
    bottom: clampPixel(Math.floor((Math.min(...vs) - pad) * painter.pixels)),
    top: clampPixel(Math.ceil((Math.max(...vs) + pad) * painter.pixels))
  };
};

/** Edge coverage from the field value and its numeric gradient (analytic anti-aliasing). */
const edgeCoverage = (element: FoliageElement, x: number, y: number, distance: number, pixelLocal: number) => {
  const distancePixels = distance / pixelLocal;
  if (distancePixels > EDGE_BAND_PX) return 0;
  if (distancePixels < -EDGE_BAND_PX) return 1;
  const h = pixelLocal * 0.5;
  const gx = (element.distance(x + h, y) - element.distance(x - h, y)) / (2 * h);
  const gy = (element.distance(x, y + h) - element.distance(x, y - h)) / (2 * h);
  return clamp01(0.5 - distancePixels / Math.max(0.2, Math.hypot(gx, gy)));
};

const castShadow = (painter: TilePainter, element: FoliageElement, pixelLocal: number) => {
  const strength = element.shadow ?? 0.32;
  if (strength <= 0) return;
  const box = pixelBounds(painter, element, 0.03);
  for (let py = box.bottom; py <= box.top; py += 1) for (let px = box.left; px <= box.right; px += 1) {
    const u = (px + 0.5) / painter.pixels, v = (py + 0.5) / painter.pixels;
    const [x, y] = toLocal(element.frame, u, v);
    if (element.distance(x, y) < 0) continue;
    const [sx, sy] = toLocal(element.frame, u - SHADOW_OFFSET[0], v - SHADOW_OFFSET[1]);
    const inside = clamp01(0.5 - element.distance(sx, sy) / pixelLocal / SHADOW_SOFTNESS_PX);
    if (inside > 0) darkenPixel(painter.canvas.albedo, painter.x0 + px, painter.y0 + py, 1 - strength * inside);
  }
};

/** Rasterizes one element over what the tile already holds (later elements lie on top). */
export const paintElement = (painter: TilePainter, element: FoliageElement) => {
  const pixelLocal = 1 / (element.frame.length * painter.pixels);
  const surface = painter.canvas.nextSurface++;
  const reliefPixels = element.frame.length * painter.pixels * RELIEF_SCALE;
  castShadow(painter, element, pixelLocal);
  const box = pixelBounds(painter, element, 0);
  for (let py = box.bottom; py <= box.top; py += 1) for (let px = box.left; px <= box.right; px += 1) {
    const [x, y] = toLocal(element.frame, (px + 0.5) / painter.pixels, (py + 0.5) / painter.pixels);
    const distance = element.distance(x, y);
    const coverage = edgeCoverage(element, x, y, distance, pixelLocal);
    if (coverage <= 0) continue;
    const sample = element.shade(x, y, distance, pixelLocal);
    const ax = painter.x0 + px, ay = painter.y0 + py;
    writePixel(painter.canvas.albedo, ax, ay, { color: sample.colour, coverage,
      relief: sample.relief * reliefPixels, surface });
    writePixel(painter.canvas.material, ax, ay, { color: [sample.translucency, sample.roughness, sample.tint],
      coverage, relief: 0, surface });
  }
};

/** Shade helper: base colour scaled by luminance and occlusion. */
export const shadedColour = (base: Rgb, luminance: number, occlusion = 1): Rgb =>
  [base[0] * luminance * occlusion, base[1] * luminance * occlusion, base[2] * luminance * occlusion];

export interface FinishedFoliageMaps {
  /** sRGB colour, straight alpha = coverage. */
  albedo: Uint8Array;
  /** Linear [translucency, roughness, tint, coverage]. */
  material: Uint8Array;
  /** Tangent-space normal (OpenGL, +v green), alpha = coverage. */
  normal: Uint8Array;
}

/** Dilated colour/material edges and relief normals for the whole atlas, level 0. */
export const finishFoliageCanvas = (canvas: FoliageCanvas): FinishedFoliageMaps => {
  const painted = finishCanvas(canvas.albedo, NORMAL_STRENGTH);
  dilateAtlasCanvas(canvas.material, 8);
  const material = new Uint8Array(canvas.size * canvas.size * 4);
  for (let index = 0; index < canvas.material.alpha.length; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      material[index * 4 + channel] = toByte(canvas.material.color[index * 3 + channel]!);
    }
    material[index * 4 + 3] = painted.color[index * 4 + 3]!;
    painted.normal[index * 4 + 3] = painted.color[index * 4 + 3]!;
  }
  return { albedo: painted.color, material, normal: painted.normal };
};

/** Places a design authored in tile UV (around `pivot`) at another position, angle and scale. */
export interface DesignPlacement {
  angle: number;
  origin: readonly [number, number];
  pivot: readonly [number, number];
  scale: number;
}

export const IDENTITY_PLACEMENT: DesignPlacement = { angle: 0, origin: [0.5, 0.5], pivot: [0.5, 0.5], scale: 1 };

export const placePoint = (placement: DesignPlacement, [u, v]: readonly [number, number]): [number, number] => {
  const du = (u - placement.pivot[0]) * placement.scale, dv = (v - placement.pivot[1]) * placement.scale;
  const sin = Math.sin(placement.angle), cos = Math.cos(placement.angle);
  return [placement.origin[0] + du * cos + dv * sin, placement.origin[1] - du * sin + dv * cos];
};

export const placeFrame = (placement: DesignPlacement, frame: ElementFrame): ElementFrame => ({
  angle: frame.angle + placement.angle, length: frame.length * placement.scale, mirror: frame.mirror,
  origin: placePoint(placement, frame.origin)
});
