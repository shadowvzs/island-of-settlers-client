import { describe, expect, it } from "vitest";

import { GROUND_VARIANT_GLSL } from "../src/render-common/shaders/ground-variants-glsl";

const WEIGHT_CHANNELS = ["weightA.x", "weightA.y", "weightA.z", "weightA.w", "weightB.x",
  "weightB.y", "weightB.z", "weightB.w", "weightC.x"];
const UNTURNED = new Set(["weightB.x", "weightB.z", "weightC.x"]);

const turnQuarter = (value: [number, number], turns: number): [number, number] => {
  if (turns < 0.5) return value;
  if (turns < 1.5) return [-value[1], value[0]];
  if (turns < 2.5) return [-value[0], -value[1]];
  return [value[1], -value[0]];
};

describe("two-offset ground anti-tiling", () => {
  it("samples through the untiled helpers in both variants", () => {
    for (const source of Object.values(GROUND_VARIANT_GLSL)) {
      expect(source).toContain("const float UNTILE_ENABLED = 1.0;");
      expect(source).toContain("getUntileFrame(macro.patches.w)");
      expect(source).toContain("sampleAlbedoUntiled(");
      expect(source).toContain("sampleNormalUntiled(");
    }
  });

  it("keeps the directional tiles unturned in the lite layer calls", () => {
    const calls = [...GROUND_VARIANT_GLSL.lite.matchAll(/addLite(?:Rock)?Layer\([^;]*\);/g)]
      .map((match) => match[0]);
    expect(calls).toHaveLength(9);
    for (const call of calls) {
      const channel = WEIGHT_CHANNELS.find((name) => call.includes(name));
      expect(channel).toBeDefined();
      const allowTurn = UNTURNED.has(channel!) ? "0.0" : "1.0";
      expect(call.trim().endsWith(`untile, ${allowTurn});`)).toBe(true);
    }
  });

  it("returns the original vector after a turn and its inverse", () => {
    const value: [number, number] = [2, 3];
    for (let turns = 0; turns < 4; turns += 1) {
      const turned = turnQuarter(value, turns);
      const restored = turnQuarter(turned, (4 - turns) % 4);
      expect(restored[0]).toBeCloseTo(value[0], 12);
      expect(restored[1]).toBeCloseTo(value[1], 12);
    }
  });
});
