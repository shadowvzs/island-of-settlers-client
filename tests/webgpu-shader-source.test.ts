import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { COLOR_TRANSFORM_GLSL } from "../src/render-common/shaders/color-output-glsl";
import { FOG_OF_WAR_GLSL, NOISE_GLSL } from "../src/render-common/shaders/common-glsl";
import { GROUND_CLIFF_GLSL } from "../src/render-common/shaders/ground-cliff-glsl";
import { GROUND_GLSL } from "../src/render-common/shaders/ground-glsl";
import { WATER_GLSL } from "../src/render-common/shaders/water-glsl";

/**
 * The generated GLSL is the WebGL contract; these hashes are the pre-WG-FIX-2 baseline. WATER_GLSL:
 * SURF_TIMING (own surf period, TOOL-8 reference tuner, 2026-11-17; seasons-6: winter palette on the season
 * ice ramp). GROUND_CLIFF_GLSL and GROUND_GLSL:
 * GROUND-PALETTE (island sand/soil palette, grey wall stone and apron, white-blue summit snow, 2026-11-17;
 * ground-palette-3: Minimal packed snow paths and later the rock palette; seasons-4: season meadow tint, season snow distribution share;
 * seasons-5: the snow keep returns season snow to the stone it covered).
 * The exploration hashes are the TSL-3 baseline (constants moved to render-common, bytes unchanged).
 */
const SHADER_HASHES = {
  COLOR_TRANSFORM_GLSL: "f12a1b05617a89bb38ec133ab10b91f8bfaab1267a3f4418494e66ed896da3f7",
  FOG_OF_WAR_GLSL: "04330ab521d799e21144d835fc39972b006d0667da1eb08a3f95b1b8e77551c0",
  GROUND_CLIFF_GLSL: "e620334231e74a7108fd78f55b5c074c385350bf293755ed5866e30917c0f92e",
  GROUND_GLSL: "35c70f7635b6ea938aec0b24b2a0df3716da40520dd8a9b0efeb9a3e8e583a52",
  NOISE_GLSL: "dc545f86792552352717ce822d49f24df48e2328d458c10056f365e06667f9d1",
  WATER_GLSL: "773310aae5af47a1a1fc293c331e3c494de1e8922cebd55fc2c3a901caf9f7ab"
} as const;

const hash = (source: string) => createHash("sha256").update(source).digest("hex");

describe("WG-FIX-2 shared shader source", () => {
  it("keeps the generated GLSL byte-identical", () => {
    const sources = {
      COLOR_TRANSFORM_GLSL,
      FOG_OF_WAR_GLSL,
      GROUND_CLIFF_GLSL,
      GROUND_GLSL,
      NOISE_GLSL,
      WATER_GLSL
    };
    for (const [name, source] of Object.entries(sources))
      expect(hash(source), name).toBe(SHADER_HASHES[name as keyof typeof SHADER_HASHES]);
  });
});
