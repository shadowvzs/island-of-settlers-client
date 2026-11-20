import { expect, it } from "vitest";

import { QUALITY_PRESETS } from "../src/render-common/quality";
import {
  CHARACTER_LOD_HYSTERESIS,
  CHARACTER_LOD_PIXELS,
  CHARACTER_LOD3_LATE_PIXELS,
  characterCastsShadow,
  characterLodForPixels,
  characterLodForTier,
  characterShadowWidening,
  characterTierPolicy,
  classifyCharacterTier,
  nextCharacterLod,
  SHADOW_WIDENING_FULL_PIXELS,
  SHADOW_WIDENING_MAX,
  SHADOW_WIDENING_NONE_PIXELS
} from "../src/renderers/three/character-tier-policy";

const high = characterTierPolicy(QUALITY_PRESETS.high), minimal = characterTierPolicy(QUALITY_PRESETS.minimal);

it("keeps one character flag table and classifies by projected size with hero overrides", () => {
  expect(QUALITY_PRESETS.high.characters).toEqual({
    lodMax: 0, soldierLodMax: 0, fpsCaps: [8, 40], isoCaps: [4, 40], shadowCasters: 64, shadowCastPixels: 30
  });
  expect(QUALITY_PRESETS.minimal.characters).toEqual({
    lodMax: 1, soldierLodMax: 2, fpsCaps: [1, 8], isoCaps: [0, 8], shadowCasters: 0, shadowCastPixels: null
  });
  expect(classifyCharacterTier({ contact: false, screenPixels: 80, selected: false, threat: false, view: "iso" }))
    .toBe("A");
  expect(classifyCharacterTier({ contact: false, screenPixels: 30, selected: false, threat: false, view: "iso" }))
    .toBe("B");
  expect(classifyCharacterTier({ contact: false, screenPixels: 10, selected: false, threat: false, view: "iso" }))
    .toBe("C");
  expect(classifyCharacterTier({ contact: false, screenPixels: 2, selected: false, threat: false, view: "iso" }))
    .toBe("D");
  expect(classifyCharacterTier({ contact: true, screenPixels: 2, selected: false, threat: false, view: "fps" }))
    .toBe("A");
});

it("never hands a tier a level finer than the preset's floor", () => {
  expect(characterLodForTier("A", minimal)).toBe(1);
  expect(characterLodForTier("A", high)).toBe(0);
  expect(characterLodForTier("C", minimal)).toBe(2);
  expect(characterLodForTier("D", high)).toBe(2);
});

it("picks the authored level from projected device pixels and the preset floor", () => {
  expect(characterLodForPixels(900, high)).toBe(0);
  expect(characterLodForPixels(400, high)).toBe(0);
  expect(characterLodForPixels(399, high)).toBe(1);
  expect(characterLodForPixels(120, high)).toBe(1);
  expect(characterLodForPixels(84, high)).toBe(2);
  expect(characterLodForPixels(29, high)).toBe(3);
  expect(characterLodForPixels(900, minimal)).toBe(1);
  expect(characterLodForPixels(50, minimal)).toBe(2);
});

it("changes level only past the hysteresis band and settles jumps in one step", () => {
  const [lod0, lod1, lod2] = CHARACTER_LOD_PIXELS;
  const up = 1 + CHARACTER_LOD_HYSTERESIS, down = 1 - CHARACTER_LOD_HYSTERESIS;
  // Sitting on the LOD1/LOD2 edge from either side keeps the current level.
  expect(nextCharacterLod(2, lod1 * 1.05, high)).toBe(2);
  expect(nextCharacterLod(1, lod1 * 0.95, high)).toBe(1);
  expect(nextCharacterLod(2, lod1 * up, high)).toBe(1);
  expect(nextCharacterLod(1, lod1 * down - 1, high)).toBe(2);
  // A spyglass zoom from far away jumps straight to the hero level.
  expect(nextCharacterLod(3, lod0 * up, high)).toBe(0);
  expect(nextCharacterLod(0, lod2 * down - 1, high)).toBe(3);
  // The floor applies to the current level and to promotions.
  expect(nextCharacterLod(0, 9999, minimal)).toBe(1);
  expect(nextCharacterLod(2, 9999, minimal)).toBe(1);
});

it("keeps the coarse-LOD3 bodies on LOD2 until the late switch edge", () => {
  expect(CHARACTER_LOD3_LATE_PIXELS).toBeLessThan(CHARACTER_LOD_PIXELS[2]!);
  // At 25 px the default policy has already gone to LOD3; the late bodies stay on LOD2.
  expect(nextCharacterLod(2, 25, high)).toBe(3);
  expect(nextCharacterLod(2, 25, high, CHARACTER_LOD3_LATE_PIXELS)).toBe(2);
  expect(nextCharacterLod(3, 25, high, CHARACTER_LOD3_LATE_PIXELS)).toBe(2);
  // They still reach LOD3 once below the late edge and its hysteresis band.
  expect(nextCharacterLod(2, 14, high, CHARACTER_LOD3_LATE_PIXELS)).toBe(3);
});

it("casts character shadows only above the preset's projected size and with a budget", () => {
  expect(characterCastsShadow(30, high)).toBe(true);
  expect(characterCastsShadow(29, high)).toBe(false);
  expect(characterCastsShadow(500, minimal)).toBe(false);
  expect(characterCastsShadow(100, characterTierPolicy(QUALITY_PRESETS.low))).toBe(false);
  expect(characterCastsShadow(120, characterTierPolicy(QUALITY_PRESETS.low))).toBe(true);
});

it("widens small figures' shadow-map silhouette and keeps close ones true to size", () => {
  expect(characterShadowWidening(30)).toBe(SHADOW_WIDENING_MAX);
  expect(characterShadowWidening(SHADOW_WIDENING_FULL_PIXELS)).toBe(SHADOW_WIDENING_MAX);
  expect(characterShadowWidening(SHADOW_WIDENING_NONE_PIXELS)).toBe(1);
  expect(characterShadowWidening(400)).toBe(1);
  const middle = characterShadowWidening((SHADOW_WIDENING_FULL_PIXELS + SHADOW_WIDENING_NONE_PIXELS) / 2);
  expect(middle).toBeCloseTo((1 + SHADOW_WIDENING_MAX) / 2);
});
