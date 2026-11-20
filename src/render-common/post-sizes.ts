/**
 * Target sizes of the frame post chain (R11b bloom, R12b ambient occlusion). Pure, renderer
 * agnostic: the WebGL compositor and the WebGPU/TSL chain must ask for the same sizes.
 */

/** Target size of a bloom mip level: the drawing buffer halved once per level, at least one texel. */
export const bloomMipSize = (
  width: number,
  height: number,
  level: number
): readonly [number, number] => [
  Math.max(1, Math.floor(width / 2 ** (level + 1))),
  Math.max(1, Math.floor(height / 2 ** (level + 1)))
];

/** Half of the drawing buffer, rounded up: texel i reads the full-resolution pixel 2i. */
export const ambientOcclusionSize = (width: number, height: number): readonly [number, number] =>
  [Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2))];
