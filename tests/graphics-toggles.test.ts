import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readGraphicsOptions,
  reloadWithDetail,
  settingsStorage
} from "../src/app/settings/graphics-settings";
import { GraphicsSection } from "../src/app/settings/sections/graphics-section";
import {
  applyPendingCharacterDetail,
  canApplyCharacterDetail,
  createPendingCharacterDetail,
  getAmbientOcclusionOptions,
  getBloomOptions,
  getColourPrecisionOptions,
  getLawnDepthOptions,
  getQualityToggleRows,
  getWaterReflectionOptions,
  resetCharacterDetail,
  selectCharacterDetail
} from "../src/app/settings/sections/helpers";
import {
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  type QualityLevel,
  type SceneTarget
} from "../src/render-common/quality";
import {
  areQualityOverridesEqual,
  getAmbientOcclusionChoice,
  getBloomChoice,
  getLawnDepthChoice,
  getQualityToggleStates,
  getSceneTargetChoice,
  getWaterReflectionsChoice,
  normalizeQualityOverrides,
  parseQualityOverrides,
  QUALITY_TOGGLES,
  resolveQualityPreset,
  setAmbientOcclusionChoice,
  setBloomChoice,
  setLawnDepthChoice,
  setQualityToggle,
  setWaterReflectionsChoice
} from "../src/render-common/quality-overrides";
import { renderWithI18n } from "./helpers/render-with-i18n";

const stubStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("location", { pathname: "/", search: "" });
  return values;
};

afterEach(() => vi.unstubAllGlobals());

describe("pending character detail", () => {
  it("keeps the applied choice while the slider marks a pending one", () => {
    const initial = createPendingCharacterDetail("auto");
    expect(initial).toEqual({ applied: "auto", pending: "auto" });
    expect(canApplyCharacterDetail(initial)).toBe(false);
    const moved = selectCharacterDetail(initial, "low");
    expect(moved).toEqual({ applied: "auto", pending: "low" });
    expect(canApplyCharacterDetail(moved)).toBe(true);
  });

  it("disables the ✓ once the pending choice matches the applied one again", () => {
    const moved = selectCharacterDetail(createPendingCharacterDetail("low"), "low");
    expect(canApplyCharacterDetail(moved)).toBe(false);
  });

  it("applies the pending choice once and leaves the ✓ disabled", () => {
    const setCharacterDetail = vi.fn();
    const applied = applyPendingCharacterDetail(
      selectCharacterDetail(createPendingCharacterDetail("auto"), "minimal"),
      setCharacterDetail
    );
    expect(setCharacterDetail).toHaveBeenCalledTimes(1);
    expect(setCharacterDetail).toHaveBeenCalledWith("minimal");
    expect(applied).toEqual({ applied: "minimal", pending: "minimal" });
    expect(canApplyCharacterDetail(applied)).toBe(false);
  });

  it("discards the pending choice when the Detail slider moves", () => {
    const moved = selectCharacterDetail(createPendingCharacterDetail("auto"), "minimal");
    expect(resetCharacterDetail(moved)).toEqual({ applied: "auto", pending: "auto" });
  });
});

describe("ice floes toggle", () => {
  it("is offered and on by default on Medium and High only", () => {
    expect(QUALITY_PRESETS.high.iceFloes).toBe(true);
    expect(QUALITY_PRESETS.medium.iceFloes).toBe(true);
    for (const level of ["minimal", "low"] as const) {
      expect(normalizeQualityOverrides(level, { iceFloes: true })).toEqual({});
      expect(resolveQualityPreset(level, { iceFloes: true }).iceFloes).toBe(false);
    }
    expect(resolveQualityPreset("high", { iceFloes: false }).iceFloes).toBe(false);
  });

  it("shows a disabled checkbox with its reason below Medium", () => {
    const rowFor = (level: QualityLevel) => getQualityToggleRows(level, getQualityToggleStates(level, {}))
      .find(row => row.toggle === "iceFloes")!;
    expect(rowFor("high")).toMatchObject({ checked: true, disabled: false, label: "Ice floes" });
    expect(rowFor("low")).toMatchObject({ checked: false, disabled: true });
    expect(rowFor("low").title).toContain("Medium and High");
  });
});

describe("quality overrides", () => {
  it("every toggle is a boolean flag of every preset", () => {
    for (const level of QUALITY_LEVELS)
      for (const toggle of QUALITY_TOGGLES)
        expect(typeof QUALITY_PRESETS[level][toggle]).toBe("boolean");
  });

  it("returns the shared preset when nothing differs from its defaults", () => {
    expect(resolveQualityPreset("medium")).toBe(QUALITY_PRESETS.medium);
    expect(resolveQualityPreset("medium", { grass: true })).toBe(QUALITY_PRESETS.medium);
  });

  it("merges the overrides over the level defaults and keeps the rest", () => {
    const preset = resolveQualityPreset("minimal", { grass: true, trafficWear: false });
    expect(preset).toMatchObject({ grass: true, liteGround: true, sunShadows: false, trafficWear: false });
    expect(QUALITY_PRESETS.minimal.grass).toBe(true);
  });

  it("shows the level defaults plus the overrides as checkbox states", () => {
    const states = getQualityToggleStates("high", { sunShadows: false });
    expect(states.sunShadows).toBe(false);
    expect(states.refraction).toBe(true);
  });

  it("records only differences from the level's defaults", () => {
    const changed = setQualityToggle("high", {}, "grass", false);
    expect(changed).toEqual({ grass: false });
    expect(setQualityToggle("high", changed, "grass", true)).toEqual({});
    expect(normalizeQualityOverrides("minimal", { grass: false, refraction: true }))
      .toEqual({ grass: false, refraction: true });
  });

  it("compares override sets", () => {
    expect(areQualityOverridesEqual({}, {})).toBe(true);
    expect(areQualityOverridesEqual({ grass: false }, {})).toBe(false);
  });

  it("parses stored overrides tolerantly", () => {
    expect(parseQualityOverrides(null)).toEqual({});
    expect(parseQualityOverrides("nope")).toEqual({});
    expect(parseQualityOverrides('{"grass":false,"liteGround":true,"sunShadows":"x"}'))
      .toEqual({ grass: false });
  });
});

describe("stored overrides", () => {
  it("reach the renderer's quality preset", () => {
    stubStorage();
    settingsStorage.writeQualityOverrides({ trafficWear: false });
    const { quality } = readGraphicsOptions("high", "auto");
    expect(quality.trafficWear).toBe(false);
    expect(quality.sunShadows).toBe(true);
  });

  it("are cleared when the Detail level changes", () => {
    const values = stubStorage();
    settingsStorage.writeQualityOverrides({ trafficWear: false });
    vi.stubGlobal("window", { location: { pathname: "/", search: "" } });
    try {
      reloadWithDetail("low");
    } catch {
      // The reload itself is not available in the test environment.
    }
    expect(settingsStorage.readDetail()).toBe("low");
    expect(settingsStorage.readQualityOverrides()).toEqual({});
    expect(values.get("island-of-settlers.graphics.overrides")).toBe("{}");
  });
});

describe("graphics section markup", () => {
  const renderSection = () => renderWithI18n(createElement(GraphicsSection, {
    applyResolution: vi.fn(),
    characterDetail: "auto",
    detail: "high",
    highlights: 1,
    recommended: null,
    resolution: "auto",
    setHighlights: vi.fn(),
    setTone: vi.fn(),
    tone: "auto"
  }));

  it("lists every visual feature as a checkbox with a cost tooltip", () => {
    stubStorage();
    const markup = renderSection();
    expect(markup.match(/type="checkbox"/g)).toHaveLength(QUALITY_TOGGLES.length);
    expect(markup).toContain("Sun shadows");
    expect(markup).toContain("Worn paths");
    expect(markup).toContain("High GPU cost.");
    expect(markup).not.toMatch(/type="checkbox"[^>]*disabled/);
  });

  it("shows the stored override as an unticked box", () => {
    stubStorage({ "island-of-settlers.graphics.overrides": '{"trafficWear":false}' });
    const markup = renderSection();
    expect(markup).toMatch(/<input[^>]*type="checkbox"[^>]*\/><span class="settings-panel__check-text">Sun shadows/);
    expect(markup).not.toMatch(/<input[^>]*checked=""[^>]*\/><span class="settings-panel__check-text">Worn paths/);
    expect(markup).toMatch(/<input[^>]*checked=""[^>]*\/><span class="settings-panel__check-text">Sun shadows/);
  });

  it("puts the visual features behind a collapsed header with their summary", () => {
    stubStorage();
    const markup = renderSection();
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Visual features");
    expect(markup).toContain("11 of 11 on");
    expect(markup).toContain('id="graphics.visualFeatures-content"');
  });

  it("counts the enabled features in the collapsed summary", () => {
    stubStorage({ "island-of-settlers.graphics.overrides": '{"trafficWear":false,"grass":false}' });
    const markup = renderSection();
    expect(markup).toContain("9 of 11 on");
  });

  it("shows the Hungarian summary", () => {
    stubStorage();
    const markup = renderWithI18n(createElement(GraphicsSection, {
      applyResolution: vi.fn(), characterDetail: "auto", detail: "high", recommended: null,
      highlights: 1, resolution: "auto", setHighlights: vi.fn(), setTone: vi.fn(), tone: "auto"
    }), "hu");
    expect(markup).toContain("11 / 11 bekapcsolva");
  });

  it("shows the stored Character detail choice in Hungarian", () => {
    stubStorage();
    const markup = renderWithI18n(createElement(GraphicsSection, {
      applyResolution: vi.fn(), characterDetail: "low", detail: "high", recommended: null,
      highlights: 1, resolution: "auto", setHighlights: vi.fn(), setTone: vi.fn(), tone: "auto"
    }), "hu");
    expect(markup).toContain("<span>Karakterek részletessége: Alacsony</span>");
    expect(markup).toContain("A ✓ azonnal, újratöltés nélkül alkalmazza");
    expect(markup).toContain(
      'aria-label="Karakterek részletességének alkalmazása" class="settings-panel__apply" disabled=""'
    );
  });

  it("waits for the Character detail ✓ tick before applying the moved slider", () => {
    stubStorage();
    const markup = renderSection();
    expect(markup).toContain(
      'aria-label="Apply character detail" class="settings-panel__apply" disabled=""'
    );
  });
});

describe("bloom override", () => {
  it("defaults to the preset and offers Off, Soft and Full", () => {
    for (const level of QUALITY_LEVELS)
      expect(getBloomChoice(level, {})).toBe(QUALITY_PRESETS[level].bloom);
    expect(getBloomOptions().map(option => option.label)).toEqual(["Off", "Soft", "Full"]);
    expect(getBloomOptions().map(option => option.value)).toEqual(["off", "low", "on"]);
  });

  it("stores only a difference and reaches the resolved preset", () => {
    const changed = setBloomChoice("high", {}, "off");
    expect(changed).toEqual({ bloom: "off" });
    expect(resolveQualityPreset("high", changed).bloom).toBe("off");
    expect(setBloomChoice("high", changed, "on")).toEqual({});
    expect(areQualityOverridesEqual(changed, {})).toBe(false);
  });

  it("shows the select in the Graphics tab with the stored choice", () => {
    stubStorage({ "island-of-settlers.graphics.overrides": '{"bloom":"low"}' });
    const markup = renderWithI18n(createElement(GraphicsSection, {
      applyResolution: vi.fn(), characterDetail: "auto", detail: "high", recommended: null,
      highlights: 1, resolution: "auto", setHighlights: vi.fn(), setTone: vi.fn(), tone: "auto"
    }));
    expect(markup).toContain("Bloom");
    expect(markup).toContain("Soft");
  });
});

describe("ambient occlusion override (R12b)", () => {
  it("is Soft for High, Off for Medium and never offered on Low or Minimal", () => {
    expect(QUALITY_LEVELS.map(level => getAmbientOcclusionChoice(level, {})))
      .toEqual(["off", "off", "off", "soft"]);
    expect(getAmbientOcclusionOptions("high").map(option => option.label))
      .toEqual(["Off", "Soft", "Strong", "Dramatic"]);
    expect(getAmbientOcclusionOptions("medium").map(option => option.value))
      .toEqual(["off", "soft", "strong", "dramatic"]);
    expect(getAmbientOcclusionOptions("low")).toEqual([]);
    expect(getAmbientOcclusionOptions("minimal")).toEqual([]);
  });

  it("stores only a difference and reaches the resolved preset on Medium and High", () => {
    const medium = setAmbientOcclusionChoice("medium", {}, "strong");
    expect(medium).toEqual({ ambientOcclusion: "strong" });
    expect(resolveQualityPreset("medium", medium).ambientOcclusion).toBe("strong");
    expect(setAmbientOcclusionChoice("high", {}, "off")).toEqual({ ambientOcclusion: "off" });
    expect(setAmbientOcclusionChoice("high", {}, "strong")).toEqual({ ambientOcclusion: "strong" });
    expect(setAmbientOcclusionChoice("high", {}, "dramatic")).toEqual({ ambientOcclusion: "dramatic" });
    expect(resolveQualityPreset("high", { ambientOcclusion: "dramatic" }).ambientOcclusion).toBe("dramatic");
    expect(setAmbientOcclusionChoice("high", {}, "soft")).toEqual({});
    expect(areQualityOverridesEqual(medium, {})).toBe(false);
  });

  it("migrates a stored On (the former single strength) to Soft", () => {
    const stored = parseQualityOverrides('{"ambientOcclusion":"on"}');
    expect(stored).toEqual({ ambientOcclusion: "soft" });
    expect(resolveQualityPreset("medium", stored).ambientOcclusion).toBe("soft");
    expect(getAmbientOcclusionChoice("high", stored)).toBe("soft");
    expect(parseQualityOverrides('{"ambientOcclusion":"strong"}')).toEqual({ ambientOcclusion: "strong" });
    expect(parseQualityOverrides('{"ambientOcclusion":"dramatic"}')).toEqual({ ambientOcclusion: "dramatic" });
    expect(parseQualityOverrides('{"ambientOcclusion":"full"}')).toEqual({});
  });

  it("drops a stored choice on Low and Minimal, so they never create the pass", () => {
    for (const choice of ["strong", "dramatic"]) {
      const stored = parseQualityOverrides(`{"ambientOcclusion":"${choice}"}`);
      for (const level of ["low", "minimal"] as const) {
        expect(resolveQualityPreset(level, stored).ambientOcclusion).toBe("off");
        expect(getAmbientOcclusionChoice(level, stored)).toBe("off");
      }
    }
  });

  it("shows the select on High and hides it on Low", () => {
    stubStorage();
    const render = (detail: QualityLevel) => renderWithI18n(createElement(GraphicsSection, {
      applyResolution: vi.fn(), characterDetail: "auto", detail, recommended: null,
      highlights: 1, resolution: "auto", setHighlights: vi.fn(), setTone: vi.fn(), tone: "auto"
    }));
    expect(render("high")).toContain("Ambient occlusion");
    expect(render("low")).not.toContain("Ambient occlusion");
  });
});

describe("water reflections override (R18b)", () => {
  it("is On for High, Off for Medium and never offered on Low or Minimal", () => {
    expect(QUALITY_LEVELS.map(level => getWaterReflectionsChoice(level, {})))
      .toEqual(["off", "off", "off", "on"]);
    expect(getWaterReflectionOptions("high").map(option => option.label)).toEqual(["Off", "On"]);
    expect(getWaterReflectionOptions("medium").map(option => option.value)).toEqual(["off", "on"]);
    expect(getWaterReflectionOptions("low")).toEqual([]);
    expect(getWaterReflectionOptions("minimal")).toEqual([]);
  });

  it("stores only a difference, parses back and never reaches Low or Minimal", () => {
    const medium = setWaterReflectionsChoice("medium", {}, "on");
    expect(medium).toEqual({ waterReflections: "on" });
    expect(resolveQualityPreset("medium", medium).waterReflections).toBe("on");
    expect(setWaterReflectionsChoice("high", {}, "on")).toEqual({});
    expect(areQualityOverridesEqual(medium, {})).toBe(false);
    const stored = parseQualityOverrides('{"waterReflections":"on"}');
    expect(stored).toEqual({ waterReflections: "on" });
    expect(parseQualityOverrides('{"waterReflections":"full"}')).toEqual({});
    for (const level of ["low", "minimal"] as const) {
      expect(resolveQualityPreset(level, stored).waterReflections).toBe("off");
    }
  });

  it("shows the select on High and hides it on Minimal", () => {
    stubStorage();
    const render = (detail: QualityLevel) => renderWithI18n(createElement(GraphicsSection, {
      applyResolution: vi.fn(), characterDetail: "auto", detail, recommended: null,
      highlights: 1, resolution: "auto", setHighlights: vi.fn(), setTone: vi.fn(), tone: "auto"
    }));
    expect(render("high")).toContain("Water reflections");
    expect(render("minimal")).not.toContain("Water reflections");
  });
});

describe("lawn depth override", () => {
  it("defaults to the preset and offers Off, Normal and Strong on every level", () => {
    for (const level of QUALITY_LEVELS) expect(getLawnDepthChoice(level, {})).toBe("strong");
    expect(getLawnDepthOptions().map(option => option.label)).toEqual(["Off", "Normal", "Strong"]);
    expect(getLawnDepthOptions().map(option => option.value)).toEqual(["off", "normal", "strong"]);
  });

  it("stores only a difference and reaches the resolved preset", () => {
    const changed = setLawnDepthChoice("high", {}, "normal");
    expect(changed).toEqual({ lawnDepth: "normal" });
    expect(resolveQualityPreset("high", changed).lawnDepth).toBe("normal");
    expect(setLawnDepthChoice("high", changed, "strong")).toEqual({});
    expect(areQualityOverridesEqual(changed, {})).toBe(false);
  });

  it("parses the stored value tolerantly", () => {
    expect(parseQualityOverrides('{"lawnDepth":"off"}')).toEqual({ lawnDepth: "off" });
    expect(parseQualityOverrides('{"lawnDepth":"bogus"}')).toEqual({});
  });

  it("shows the select in the Graphics tab with the stored choice", () => {
    stubStorage({ "island-of-settlers.graphics.overrides": '{"lawnDepth":"normal"}' });
    const markup = renderWithI18n(createElement(GraphicsSection, {
      applyResolution: vi.fn(), characterDetail: "auto", detail: "high", recommended: null,
      highlights: 1, resolution: "auto", setHighlights: vi.fn(), setTone: vi.fn(), tone: "auto"
    }));
    expect(markup).toContain("Lawn depth");
    expect(markup).toContain("Strong");
  });
});

describe("colour precision override", () => {
  it("defaults to the preset and offers Off only where the preset has no scene target", async () => {
    const overrides = await import("../src/render-common/quality-overrides");
    expect(overrides.getSceneTargetChoice("high", {})).toBe("rgba8");
    expect(overrides.getSceneTargetChoices("high")).toEqual(["rgba8", "rgba16f"]);
    expect(overrides.getSceneTargetChoices("minimal")).toEqual(["off", "rgba8", "rgba16f"]);
  });

  it("stores only a difference and reaches the resolved preset", async () => {
    const overrides = await import("../src/render-common/quality-overrides");
    const changed = overrides.setSceneTargetChoice("high", {}, "rgba16f");
    expect(changed).toEqual({ sceneTarget: "rgba16f" });
    expect(overrides.resolveQualityPreset("high", changed).sceneTarget).toBe("rgba16f");
    expect(overrides.setSceneTargetChoice("high", changed, "rgba8")).toEqual({});
    expect(overrides.areQualityOverridesEqual(changed, {})).toBe(false);
  });

  it("parses the stored value tolerantly", async () => {
    const { parseQualityOverrides } = await import("../src/render-common/quality-overrides");
    expect(parseQualityOverrides('{"sceneTarget":"rgba16f"}')).toEqual({ sceneTarget: "rgba16f" });
    expect(parseQualityOverrides('{"sceneTarget":"x"}')).toEqual({});
  });

  it("shows the select in the Graphics tab and resets on the slider path", () => {
    stubStorage({ "island-of-settlers.graphics.overrides": '{"sceneTarget":"rgba16f"}' });
    const markup = renderWithI18n(createElement(GraphicsSection, {
      applyResolution: vi.fn(), characterDetail: "auto", detail: "high", recommended: null,
      highlights: 1, resolution: "auto", setHighlights: vi.fn(), setTone: vi.fn(), tone: "auto"
    }));
    expect(markup).toContain("Colour precision");
    expect(markup).toContain("High 16-bit");
  });

  it("shows a valid selected label on every Detail preset", () => {
    const expected: Record<QualityLevel, { label: string; value: SceneTarget }> = {
      high: { label: "Standard 8-bit", value: "rgba8" },
      low: { label: "Off (direct)", value: "off" },
      medium: { label: "Standard 8-bit", value: "rgba8" },
      minimal: { label: "Off (direct)", value: "off" }
    };
    for (const level of QUALITY_LEVELS) {
      const choice = getSceneTargetChoice(level, {});
      const options = getColourPrecisionOptions(level);
      expect(choice).toBe(expected[level].value);
      expect(options.some(option => option.label === expected[level].label && option.value === choice))
        .toBe(true);
      stubStorage();
      const markup = renderWithI18n(createElement(GraphicsSection, {
        applyResolution: vi.fn(), characterDetail: "auto", detail: level, recommended: null,
        highlights: 1, resolution: "auto", setHighlights: vi.fn(), setTone: vi.fn(), tone: "auto"
      }));
      const start = markup.indexOf('aria-label="Colour precision"');
      const selectMarkup = markup.slice(start, markup.indexOf("</select>", start));
      expect(selectMarkup).toContain(`selected="">${expected[level].label}</option>`);
    }
  });
});
