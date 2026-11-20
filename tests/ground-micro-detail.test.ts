import { describe, expect, it } from "vitest";

import { FULL_GROUND_NEEDS } from "../src/render-common/ground-shader-variant";
import {
  getMicroDetailCell,
  MICRO_CLASS_OF_MATERIAL
} from "../src/render-common/materials/micro-detail";
import { GROUND_VARIANT_GLSL } from "../src/render-common/shaders/ground-variants-glsl";
import { MATERIAL } from "../src/shared/world/world-data";

const WEIGHT_CHANNELS = ["weightsA.x", "weightsA.y", "weightsA.z", "weightsA.w", "weightsB.x",
  "weightsB.y", "weightsB.z", "weightsB.w", "weightsC.x"];

const functionBody = (source: string, name: string) =>
  source.match(new RegExp(`vec2 ${name}\\([^]*?\\n\\}`))?.[0];

describe("micro-detail ground wiring", () => {
  it("samples and applies the shared atlas in both variants", () => {
    for (const source of [GROUND_VARIANT_GLSL.full, GROUND_VARIANT_GLSL.lite]) {
      expect(source).toContain("uniform sampler2D uMicroAtlas");
      expect(source).toContain("sampleMicroDetail(");
      expect(source).toContain("applyMicroDetail(");
    }
    expect(GROUND_VARIANT_GLSL.full).not.toContain("sampleDetailNormal");
    expect(GROUND_VARIANT_GLSL.full).not.toContain("DETAIL_SCALE");
  });

  it("maps every material to its micro class cell", () => {
    const source = GROUND_VARIANT_GLSL.full;
    for (const material of Object.values(MATERIAL)) {
      const cell = getMicroDetailCell(MICRO_CLASS_OF_MATERIAL[material]!);
      expect(source).toContain(
        `if (layer == ${material}) return vec2(${cell.column.toFixed(1)}, ${cell.row.toFixed(1)});`
      );
    }
  });

  it("sums every lite weight lane exactly once in its class", () => {
    const body = functionBody(GROUND_VARIANT_GLSL.lite, "getLiteMicroCell");
    expect(body).toBeDefined();
    for (const channel of WEIGHT_CHANNELS) {
      expect(body!.split(channel)).toHaveLength(2);
    }
  });

  it("reserves one more sampler for the micro atlas", () => {
    expect(FULL_GROUND_NEEDS.fragmentSamplers).toBe(11);
  });
});
