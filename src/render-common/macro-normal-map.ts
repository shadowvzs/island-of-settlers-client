import { getVertexIndex, type GridSize } from "../shared/world/grid-geometry";
import { toByte } from "./color";

/** Half width (vertices) of the height difference: the landform's slope over about 4 cells. */
const MACRO_REACH = 2;
const MACRO_SPAN = MACRO_REACH * 2;

/** -1..1 (a normal component) to a 0..255 byte. */
const toUnitByte = (value: number) => toByte(value * 0.5 + 0.5);

const clampIndex = (index: number, count: number) => Math.min(count - 1, Math.max(0, index));

interface HeightGrid extends GridSize {
  heights: Float32Array;
}

/**
 * The landform's normal per vertex (RGB, 0.5 + 0.5 * n; A 255), from the heights over about four
 * cells: the large formations of the mountains without the rock's relief. The rock material
 * pulls its broad planes toward it (rock-form-glsl.ts), so a mountain face reads as one plane.
 */
export const createMacroNormalPixels = (grid: HeightGrid) => {
  const width = grid.cellsX + 1;
  const height = grid.cellsZ + 1;
  const pixels = new Uint8Array(width * height * 4);
  const heightAt = (x: number, z: number) =>
    grid.heights[getVertexIndex(grid, clampIndex(x, width), clampIndex(z, height))]!;
  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const slopeX = (heightAt(x + MACRO_REACH, z) - heightAt(x - MACRO_REACH, z)) / MACRO_SPAN;
      const slopeZ = (heightAt(x, z + MACRO_REACH) - heightAt(x, z - MACRO_REACH)) / MACRO_SPAN;
      const length = Math.hypot(slopeX, 1, slopeZ);
      const offset = (z * width + x) * 4;
      pixels[offset] = toUnitByte(-slopeX / length);
      pixels[offset + 1] = toUnitByte(1 / length);
      pixels[offset + 2] = toUnitByte(-slopeZ / length);
      pixels[offset + 3] = 255;
    }
  }
  return { height, pixels, width };
};

/** Scenes without a world (icons, lab-cliff tests): alpha 0, the rock keeps its own normals. */
export const NO_MACRO_NORMAL_PIXELS = new Uint8Array([128, 255, 128, 0]);

/**
 * GLSL: the landform normal at a world position (xyz) and its weight (w: 0 without a world).
 * Texel centres sit on the vertices.
 */
export const MACRO_NORMAL_GLSL = `
uniform sampler2D uMacroNormals;

vec4 getMacroNormal(vec2 xz) {
  vec2 texels = vec2(textureSize(uMacroNormals, 0));
  vec4 texel = texture(uMacroNormals, (xz + 0.5) / texels);
  return vec4(normalize(texel.xyz * 2.0 - 1.0), texel.a);
}
`;
