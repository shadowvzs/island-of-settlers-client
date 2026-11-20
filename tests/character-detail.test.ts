import { describe, expect, it } from "vitest";

import {
  applyCharacterDetail,
  CHARACTER_DETAIL_CHOICES,
  type CharacterLodCap,
  parseCharacterDetail,
  resolveCharacterDetail
} from "../src/render-common/character-detail";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import {
  effectiveCadenceBias,
  workerAnimationCadence
} from "../src/renderers/three/worker-animation-budget";

/** The mutable slice of a crowd's character policy the choice writes. */
interface CharacterLodCapHolder {
  lodMax: CharacterLodCap;
  soldierLodMax: CharacterLodCap;
}

describe("character detail mapping", () => {
  const high = QUALITY_PRESETS.high.characters;
  const minimal = QUALITY_PRESETS.minimal.characters;

  it("offers Auto first and every Detail-style choice", () => {
    expect(CHARACTER_DETAIL_CHOICES).toEqual(["auto", "high", "medium", "low", "minimal"]);
    expect(parseCharacterDetail(null)).toBe("auto");
    expect(parseCharacterDetail("bogus")).toBe("auto");
    expect(parseCharacterDetail("low")).toBe("low");
  });

  it("follows the Detail level on Auto", () => {
    expect(resolveCharacterDetail("auto", high)).toEqual({
      cadence: 0, lodMax: 0, soldierLodMax: 0
    });
    expect(resolveCharacterDetail("auto", minimal)).toEqual({
      cadence: 0, lodMax: 1, soldierLodMax: 2
    });
  });

  it("steps the LOD cap and the cadence floor down per choice", () => {
    expect(resolveCharacterDetail("high", high)).toMatchObject({ cadence: 0, lodMax: 0 });
    expect(resolveCharacterDetail("medium", high)).toMatchObject({ cadence: 0, lodMax: 1 });
    expect(resolveCharacterDetail("low", high)).toMatchObject({ cadence: 1, lodMax: 2 });
    expect(resolveCharacterDetail("minimal", high)).toMatchObject({ cadence: 2, lodMax: 3 });
  });

  it("never gets finer than the Detail level loads", () => {
    expect(resolveCharacterDetail("high", minimal)).toEqual({
      cadence: 0, lodMax: 1, soldierLodMax: 2
    });
    expect(resolveCharacterDetail("minimal", minimal)).toEqual({
      cadence: 2, lodMax: 3, soldierLodMax: 3
    });
  });

  it("applies to an existing crowd in place", () => {
    const policy: CharacterLodCapHolder = { lodMax: 0, soldierLodMax: 0 };
    const cadence = { floor: 0 };
    applyCharacterDetail("low", high, { cadence, policy });
    expect(policy).toEqual({ lodMax: 2, soldierLodMax: 2 });
    expect(cadence.floor).toBe(1);
    applyCharacterDetail("auto", high, { cadence, policy });
    expect(policy).toEqual({ lodMax: 0, soldierLodMax: 0 });
    expect(cadence.floor).toBe(0);
  });
});

describe("character detail versus the budget controller", () => {
  it("never lets the controller raise characters above the player's choice", () => {
    const policy: CharacterLodCapHolder = { lodMax: 0, soldierLodMax: 0 };
    const cadence = { floor: 0 };
    applyCharacterDetail("minimal", QUALITY_PRESETS.high.characters, { cadence, policy });
    expect(cadence.floor).toBe(2);
    // The controller's bias may be 0 (fully recovered), 1 or 2: the effective cadence never
    // becomes finer than the player's floor.
    for (const bias of [0, 1, 2]) {
      expect(effectiveCadenceBias({ bias, floor: cadence.floor })).toBe(2);
    }
    expect(workerAnimationCadence(3, effectiveCadenceBias({ bias: 0, floor: cadence.floor }))).toBe(8);
  });

  it("lets the controller go coarser than the player's choice", () => {
    const floor = 1;
    expect(effectiveCadenceBias({ bias: 0, floor })).toBe(1);
    expect(effectiveCadenceBias({ bias: 2, floor })).toBe(2);
    expect(workerAnimationCadence(3, effectiveCadenceBias({ bias: 0, floor }))).toBe(6);
    expect(workerAnimationCadence(3, effectiveCadenceBias({ bias: 2, floor }))).toBe(8);
  });
});
