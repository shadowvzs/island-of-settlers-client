/** 0..1 RGB colour of a 0xRRGGBB hex value. */
export const rgb = (hex: number): readonly [number, number, number] => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255
];

/** 0..1 to a clamped, rounded 0..255 byte. */
export const toByte = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);

/** Linear colour of sRGB components (gamma 2.2 approximation, not the piecewise curve). */
export const srgbToLinear = (red: number, green: number, blue: number): [number, number, number] =>
  [red ** 2.2, green ** 2.2, blue ** 2.2];
