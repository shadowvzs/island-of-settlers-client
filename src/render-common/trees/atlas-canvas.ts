import type { AtlasMip } from "../baker/atlas-mips";
import { toByte } from "../color";

/** Float RGBA canvas for procedural texture painting (linear colour, straight alpha). */
export interface AtlasCanvas {
  alpha: Float32Array;
  /** Linear RGB, 3 floats per pixel. */
  color: Float32Array;
  height: number;
  /** Bump height for the normal map (leaf domes, ribs, veins). */
  relief: Float32Array;
  /** Separate surfaces get no normal slope across their borders. */
  surface: Int32Array;
  width: number;
}

export const createAtlasCanvas = (width: number, height: number): AtlasCanvas => ({
  alpha: new Float32Array(width * height),
  color: new Float32Array(width * height * 3),
  height,
  relief: new Float32Array(width * height),
  surface: new Int32Array(width * height).fill(-1),
  width
});

export interface PixelWrite {
  color: readonly [number, number, number];
  coverage: number;
  relief: number;
  surface: number;
}

/** Paints over what is there (later strokes lie on top); anti-aliased edge via coverage. */
export const writePixel = (canvas: AtlasCanvas, x: number, y: number, pixel: PixelWrite) => {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height || pixel.coverage <= 0) return;
  const index = y * canvas.width + x;
  const existing = canvas.alpha[index]!;
  const mix = existing > 0 ? Math.min(1, pixel.coverage) : 1;
  for (let channel = 0; channel < 3; channel += 1) {
    const offset = index * 3 + channel;
    canvas.color[offset] = canvas.color[offset]! * (1 - mix) + pixel.color[channel]! * mix;
  }
  canvas.alpha[index] = Math.max(existing, Math.min(1, pixel.coverage));
  if (pixel.coverage < 0.5) return;
  canvas.relief[index] = pixel.relief;
  canvas.surface[index] = pixel.surface;
};

/** Multiplies the colour of a painted pixel (shadows); empty pixels stay empty. */
export const darkenPixel = (canvas: AtlasCanvas, x: number, y: number, factor: number) => {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const index = y * canvas.width + x;
  if (canvas.alpha[index]! <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) canvas.color[index * 3 + channel]! *= factor;
};

const encodeSrgb = (value: number) =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;

/** Pixel index offsets of the left, right, upper and lower neighbour. */
const getNeighbourOffsets = (width: number) => [-1, 1, -width, width];

/** Unfilled pixels next to the given ones (each once): the next pass's candidates. */
const collectUnfilledNeighbours = (
  pixels: Iterable<number>,
  filled: Uint8Array,
  offsets: number[],
  seen: Uint8Array
) => {
  const result: number[] = [];
  for (const index of pixels) {
    for (const offset of offsets) {
      const neighbour = index + offset;
      if (neighbour < 0 || neighbour >= filled.length || filled[neighbour] || seen[neighbour]) {
        continue;
      }
      seen[neighbour] = 1;
      result.push(neighbour);
    }
  }
  return result;
};

/** Takes the colour of the first filled neighbour (left, right, up, down); false if none. */
const fillFromNeighbour = (
  canvas: AtlasCanvas,
  filled: Uint8Array,
  offsets: number[],
  index: number
) => {
  const x = index % canvas.width;
  for (const offset of offsets) {
    const neighbour = index + offset;
    if (neighbour < 0 || neighbour >= filled.length || !filled[neighbour]) continue;
    if (Math.abs((neighbour % canvas.width) - x) > 1) continue;
    canvas.color.copyWithin(index * 3, neighbour * 3, neighbour * 3 + 3);
    return true;
  }
  return false;
};

/** Unfilled pixels with a filled neighbour: the first pass's candidates (one scan). */
const listBorderPixels = (filled: Uint8Array, offsets: number[]) => {
  const result: number[] = [];
  for (let index = 0; index < filled.length; index += 1) {
    if (filled[index]) continue;
    for (const offset of offsets) {
      if (!filled[index + offset]) continue;
      result.push(index);
      break;
    }
  }
  return result;
};

/**
 * Empty pixels take the colour of their nearest painted neighbour (a few passes), so mipmaps
 * and filtering never pull dark or white fringes into alpha-tested edges. Each pass only visits
 * the empty pixels next to the last filled ones (a pass reads the fill state before it).
 */
export const dilateAtlasCanvas = (canvas: AtlasCanvas, passes: number) => {
  const filled = new Uint8Array(canvas.alpha.length);
  for (let index = 0; index < filled.length; index += 1) {
    filled[index] = canvas.alpha[index]! > 0 ? 1 : 0;
  }
  const offsets = getNeighbourOffsets(canvas.width);
  let candidates = listBorderPixels(filled, offsets);
  for (let pass = 0; pass < passes && candidates.length > 0; pass += 1) {
    const grown = candidates.filter((index) => fillFromNeighbour(canvas, filled, offsets, index));
    for (const index of grown) filled[index] = 1;
    candidates = collectUnfilledNeighbours(grown, filled, offsets, new Uint8Array(filled.length));
  }
};

/** Relief of a neighbour on the same surface, else the centre's (no cliffs between leaves). */
const sameSurfaceRelief = (canvas: AtlasCanvas, centre: number, neighbour: number) =>
  neighbour >= 0 &&
  neighbour < canvas.relief.length &&
  canvas.surface[neighbour] === canvas.surface[centre]
    ? canvas.relief[neighbour]!
    : canvas.relief[centre]!;

/** Tangent space normal map (OpenGL, green = +v; row 0 = v 0) from the relief channel. */
const createNormalMap = (canvas: AtlasCanvas, strength: number) => {
  const normals = new Uint8Array(canvas.width * canvas.height * 4);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const centre = y * canvas.width + x;
      const dx =
        sameSurfaceRelief(canvas, centre, centre + 1) -
        sameSurfaceRelief(canvas, centre, centre - 1);
      const dy =
        sameSurfaceRelief(canvas, centre, centre + canvas.width) -
        sameSurfaceRelief(canvas, centre, centre - canvas.width);
      const length = Math.sqrt((dx * strength) ** 2 + (dy * strength) ** 2 + 1);
      normals[centre * 4] = toByte(0.5 - (dx * strength) / length / 2);
      normals[centre * 4 + 1] = toByte(0.5 - (dy * strength) / length / 2);
      normals[centre * 4 + 2] = toByte(0.5 + 0.5 / length);
      normals[centre * 4 + 3] = 255;
    }
  }
  return normals;
};

export interface PaintedTexture {
  /** sRGB colour, alpha = coverage. */
  color: Uint8Array;
  /** Coverage-preserving colour mip chain, level 0 included. */
  colorMips?: AtlasMip[];
  height: number;
  normal: Uint8Array;
  /** Normalized normal-map mip chain, level 0 included. */
  normalMips?: AtlasMip[];
  width: number;
}

/** Final GPU ready maps (colour with dilated edges, normal from relief). */
export const finishCanvas = (canvas: AtlasCanvas, normalStrength: number): PaintedTexture => {
  dilateAtlasCanvas(canvas, 8);
  const color = new Uint8Array(canvas.width * canvas.height * 4);
  for (let index = 0; index < canvas.alpha.length; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      color[index * 4 + channel] = toByte(encodeSrgb(canvas.color[index * 3 + channel]!));
    }
    color[index * 4 + 3] = toByte(canvas.alpha[index]!);
  }
  return {
    color,
    height: canvas.height,
    normal: createNormalMap(canvas, normalStrength),
    width: canvas.width
  };
};
