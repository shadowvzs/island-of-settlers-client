import { DataTexture } from "three";
import { describe, expect, it } from "vitest";

import { createTerrainMaterial } from "../src/renderers/three/three-materials";

const texture = new DataTexture(new Uint8Array(4), 1, 1);
const fragmentOf = (variant: "full" | "lite") =>
  createTerrainMaterial({}, texture, texture, variant).fragmentShader;

describe("river bed by flow speed (RC-1)", () => {
  it("reshapes the render splat after the cliff and snow rules and before the ground is sampled", () => {
    for (const variant of ["full", "lite"] as const) {
      const main = fragmentOf(variant).slice(fragmentOf(variant).indexOf("void main()"));
      const call = main.indexOf("shapeRiverBed(mountainSplatA, mountainSplatB, vWater.zw, vWater.x, xz)");
      expect(call).toBeGreaterThan(main.indexOf("shedOntoCliffs("));
      expect(call).toBeGreaterThan(main.indexOf("shapeSummitSnow("));
      expect(call).toBeLessThan(main.indexOf("sampleGround("));
    }
  });

  it("moves sand and soil to the gravel and rock channels only", () => {
    const source = fragmentOf("full");
    const body = source.slice(source.indexOf("void shapeRiverBed("), source.indexOf("void main()"));
    expect(body).toContain("splatB.x *= 1.0 - coarse;");
    expect(body).toContain("splatA.w *= 1.0 - coarse;");
    expect(body).toContain("splatB.w += fines * (1.0 - boulder);");
    expect(body).toContain("splatB.y += fines * boulder;");
  });

  it("blends the borders by height on the full ground and switches whole layers on the lite ground", () => {
    expect(fragmentOf("full")).toContain("#define RIVER_BED_BLEND_BAND");
    expect(fragmentOf("lite")).not.toContain("#define RIVER_BED_BLEND_BAND");
  });
});
