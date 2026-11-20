/**
 * A shared numeric constant as the GLSL float literal it replaced: integers keep one decimal
 * (`36` -> `36.0`), fractions print their shortest form (`0.25`). Lets a GLSL template interpolate
 * a constant that TSL imports too without changing the generated shader source.
 */
export const glslLiteral = (value: number) =>
  Number.isInteger(value) ? value.toFixed(1) : String(value);
