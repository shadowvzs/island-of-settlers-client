import { describe, expect, it } from "vitest";

import { GROUND_CLIFF_GLSL } from "../src/render-common/shaders/ground-cliff-glsl";
import { GROUND_VARIANT_GLSL } from "../src/render-common/shaders/ground-variants-glsl";

// Evaluate the actual scalar line and coverage expressions from the shader with controlled inputs.
const constant = (name: string) => {
  const match = GROUND_CLIFF_GLSL.match(new RegExp(`const float ${name} = ([\\d.]+);`));
  if (!match) throw new Error(`Missing shader constant ${name}`);
  return Number(match[1]);
};
const expressions = GROUND_CLIFF_GLSL.match(
  /float line = (SUMMIT_SNOW_LINE[\s\S]*?);\s*return (smoothstep\(line, line \+ SUMMIT_SNOW_FADE, world\.y\));/
);
if (!expressions) throw new Error("Missing summit snow line and coverage expressions");
const smoothstep = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const evaluate = new Function(
  "broad", "hollow", "lee", "hold", "breakup", "world", "smoothstep",
  "SUMMIT_SNOW_LINE", "SUMMIT_SNOW_WANDER", "SUMMIT_SNOW_HOLLOW_RUN", "SUMMIT_SNOW_LEE", "SUMMIT_SNOW_FADE",
  `const line = ${expressions[1]}; return ${expressions[2]};`
) as (broad: number, hollow: number, lee: number, hold: number, breakup: number, world: { y: number },
  smoothstep: (a: number, b: number, value: number) => number, ...constants: number[]) => number;
const coverage = (y: number, broad: number, hollow: number, lee: number, hold: number, breakup: number) =>
  evaluate(broad, hollow, lee, hold, breakup, { y }, smoothstep, ...[
    "SUMMIT_SNOW_LINE", "SUMMIT_SNOW_WANDER", "SUMMIT_SNOW_HOLLOW_RUN", "SUMMIT_SNOW_LEE", "SUMMIT_SNOW_FADE"
  ].map(constant));

describe("summit snow cap", () => {
  it("is fully opaque above the highest possible edge for every slope and noise extreme", () => {
    for (const broad of [0, 1]) for (const hollow of [0, 1]) for (const lee of [-1, 1])
      for (const hold of [0, 1]) for (const breakup of [0, 1]) {
        expect(coverage(15.1, broad, hollow, lee, hold, breakup)).toBe(1);
        expect(coverage(12.7, broad, hollow, lee, hold, breakup)).toBe(0);
      }
  });

  it("lets slope, hollows and noise move the edge without thinning the core", () => {
    expect(coverage(13.9, 0.5, 0, 0, 1, 0.5)).toBeGreaterThan(coverage(13.9, 0.5, 0, 0, 0, 0.5));
    expect(coverage(13.9, 0.5, 1, 0, 0, 0.5)).toBeGreaterThan(coverage(13.9, 0.5, 0, 0, 0, 0.5));
    expect(coverage(13.9, 0, 0, 0, 1, 0)).toBeGreaterThan(coverage(13.9, 1, 0, 0, 1, 1));
  });

  it("shares the same cap and lowland guard between both ground variants", () => {
    for (const source of Object.values(GROUND_VARIANT_GLSL)) {
      expect(source).toContain(GROUND_CLIFF_GLSL);
      expect(source).toContain("if (world.y < SUMMIT_SNOW_FLOOR) return;");
    }
  });
});
