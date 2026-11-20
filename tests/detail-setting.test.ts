import { afterEach, describe, expect, it, vi } from "vitest";

import { readGraphicsOptions, settingsStorage } from "../src/app/settings/graphics-settings";
import { applyLiteGround } from "../src/render-common/ground-shader-variant";
import { QUALITY_LEVELS, QUALITY_PRESETS } from "../src/render-common/quality";

const stubStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
};

afterEach(() => vi.unstubAllGlobals());

describe("detail levels", () => {
  it("orders the slider from the cheapest to the full level", () => {
    expect(QUALITY_LEVELS).toEqual(["minimal", "low", "medium", "high"]);
  });

  it("minimal switches optional passes off except the min-LOD grass", () => {
    expect(QUALITY_PRESETS.minimal).toMatchObject({
      animalSilhouettes: false,
      atmosphere: false,
      atmosphereBanks: false,
      grass: true,
      grassSamples: 2,
      liteGround: true,
      plantDetailZoom: Infinity,
      refraction: false,
      skyEnvironment: false,
      sunShadows: false,
      treeImpostorZoom: Infinity,
      weatherParticles: false
    });
  });

  it("high keeps everything on", () => {
    expect(QUALITY_PRESETS.high).toMatchObject({
      animalSilhouettes: true,
      atmosphere: true,
      atmosphereBanks: true,
      grass: true,
      liteGround: false,
      refraction: true,
      skyEnvironment: true,
      sunShadows: true,
      weatherParticles: true
    });
    expect(QUALITY_PRESETS.medium.atmosphereBanks).toBe(false);
    expect(QUALITY_PRESETS.low.atmosphereBanks).toBe(false);
    expect(QUALITY_PRESETS.medium.skyEnvironment).toBe(true);
    expect(QUALITY_PRESETS.low.skyEnvironment).toBe(false);
    expect(QUALITY_PRESETS.medium.skyModel).toBe("lut");
    expect(QUALITY_PRESETS.low.skyModel).toBe("analytic");
    expect(QUALITY_PRESETS.minimal.skyModel).toBe("analytic");
  });
});

describe("detail setting", () => {
  it("is unset until chosen, then remembers the level", () => {
    stubStorage();
    expect(settingsStorage.readDetail()).toBeNull();
    settingsStorage.writeDetail("minimal");
    expect(settingsStorage.readDetail()).toBe("minimal");
  });

  it("ignores an invalid stored level", () => {
    stubStorage({ "island-of-settlers.graphics.detail": "ultra" });
    expect(settingsStorage.readDetail()).toBeNull();
  });

  it("gives the level's preset to the renderer", () => {
    stubStorage();
    expect(readGraphicsOptions("medium", "auto").quality).toBe(QUALITY_PRESETS.medium);
    expect(readGraphicsOptions("minimal", "auto").groundShader).toBe("lite");
  });

  it("minimal asks for the lite ground unless ?ground= forces a variant", () => {
    expect(applyLiteGround("auto", true)).toBe("lite");
    expect(applyLiteGround("auto", false)).toBe("auto");
    expect(applyLiteGround("full", true)).toBe("full");
  });
});
