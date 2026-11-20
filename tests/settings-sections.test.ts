import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { audioLevels, setMasterVolume } from "../src/app/audio/audio-levels";
import { createSoundControls } from "../src/app/audio/sound-controls";
import { createEnvironmentController } from "../src/app/environment-controller";
import {
  formatHour,
  getDetailLevels,
  getSoundLayerRows,
  readWeatherState
} from "../src/app/settings/sections/helpers";
import { createSettingsSectionRequest } from "../src/app/settings/sections/section-request";
import { SettingsSections, type SettingsSectionsProps } from "../src/app/settings/sections/settings-sections";
import type { SoundLayer } from "../src/app/settings/sound-settings";
import { createWeatherControls } from "../src/app/weather-controls";
import { renderWithI18n } from "./helpers/render-with-i18n";

const SUN = { azimuth: 0.8, elevation: 0.9 } as never;

const createProps = (overrides: Partial<SettingsSectionsProps> = {}): SettingsSectionsProps => ({
  applyCharacterDetail: vi.fn(),
  applyResolution: vi.fn(),
  characterDetail: "auto",
  critters: true,
  detail: "high",
  sectionRequest: createSettingsSectionRequest().store,
  fog: false,
  highlights: 1,
  recommended: "medium",
  resolution: "fast",
  sound: createSoundControls({
    enabled: true, environmentVolume: 0.4, layersOff: new Set<SoundLayer>(["rain"]),
    setEnabled: vi.fn(), setEnvironmentVolume: vi.fn(), setLayer: vi.fn()
  }),
  tone: "auto",
  weather: createWeatherControls(createEnvironmentController(
    SUN, { hour: 6.5, mode: "nature", rain: true, snow: false }
  )),
  setCritters: vi.fn(),
  setFog: vi.fn(),
  setHighlights: vi.fn(),
  setTone: vi.fn(),
  ...overrides
});

describe("settings section helpers", () => {
  it("marks the recommended detail level", () => {
    expect(getDetailLevels("low")).toEqual(["Minimal", "Low (recommended)", "Medium", "High"]);
    expect(getDetailLevels(null)).toEqual(["Minimal", "Low", "Medium", "High"]);
  });

  it("formats the clock and compares weather snapshots", () => {
    expect(formatHour(6.5)).toBe("06:30");
    expect(formatHour(23.99)).toBe("23:59");
    const state = readWeatherState({ cycleSpeed: 1, cycling: false, day: 0, hour: 13.25, mode: "sun", raining: true, snowing: false });
    expect(state).toEqual({ clock: "13:15", cycleSpeed: 1, cycling: false, locked: false, mode: "sun", raining: true,
      snowing: false });
  });

  it("lists the sound layer toggles in their fixed order", () => {
    expect(getSoundLayerRows(new Set<SoundLayer>(["trees"])).map(row => [row.layer, row.checked]))
      .toEqual([["water", true], ["trees", false], ["rain", true], ["wildlife", true]]);
  });
});

describe("weather and sound adapters", () => {
  it("publishes a new weather snapshot only when the clock or a toggle changes", () => {
    const controller = createEnvironmentController(SUN, { hour: 6.5, rain: false, snow: false });
    const weather = createWeatherControls(controller);
    const listener = vi.fn();
    weather.store.subscribe(listener);
    weather.refresh();
    expect(listener).not.toHaveBeenCalled();
    controller.toggleRain();
    expect(weather.store.getSnapshot().raining).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unchecks all zero-volume layers, keeps them off when volume returns, and persists each change", () => {
    const setLayer = vi.fn();
    const sound = createSoundControls({
      enabled: true, environmentVolume: .4, layersOff: new Set<SoundLayer>(),
      setEnabled: vi.fn(), setEnvironmentVolume: vi.fn(), setLayer
    });
    sound.setEnvironmentVolume(0);
    expect([...sound.getState().layersOff].sort()).toEqual(["rain", "trees", "water", "wildlife"]);
    expect(setLayer.mock.calls).toEqual([["water", false], ["trees", false], ["rain", false], ["wildlife", false]]);
    sound.setLayer("rain", true);
    expect(sound.getState().layersOff.has("rain")).toBe(true);
    sound.setEnvironmentVolume(.6);
    expect(sound.getState().layersOff.size).toBe(4);
    sound.setLayer("rain", true);
    expect(sound.getState().layersOff.has("rain")).toBe(false);
  });

  it("normalizes initially silent layers and links the Sound toggle to master 0/100", () => {
    const sound = createSoundControls({
      enabled: true, environmentVolume: 0, layersOff: new Set<SoundLayer>(),
      setEnabled: vi.fn(), setEnvironmentVolume: vi.fn(), setLayer: vi.fn()
    });
    expect(sound.getState().layersOff.size).toBe(4);
    setMasterVolume(.35);
    sound.setEnabled(false);
    expect(audioLevels.getSnapshot().master).toBe(0);
    sound.setEnabled(true);
    expect(audioLevels.getSnapshot().master).toBe(1);
  });

  it("keeps the current sound values for the lazily mounted section", () => {
    const setEnabled = vi.fn();
    const sound = createSoundControls({
      enabled: true, environmentVolume: 0.4, layersOff: new Set<SoundLayer>(),
      setEnabled, setEnvironmentVolume: vi.fn(), setLayer: vi.fn()
    });
    sound.setEnabled(false);
    sound.setEnvironmentVolume(0.7);
    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(sound.getState()).toMatchObject({ enabled: false, environmentVolume: 0.7 });
  });
});

describe("settings sections markup", () => {
  const markup = renderWithI18n(createElement(SettingsSections, createProps()));

  it("renders the Graphics, Appearance, Sounds and Misc tabs with their sections", () => {
    expect(markup).toContain('<div aria-label="Settings categories" class="settings-panel__tabs" role="tablist">');
    expect(markup).toContain('aria-controls="settings-panel-graphics" aria-selected="true"');
    expect(markup).toContain('aria-controls="settings-panel-sounds" aria-selected="false"');
    expect(markup).toContain('aria-controls="settings-panel-appearance" aria-selected="false"');
    expect(markup).toContain('aria-controls="settings-panel-misc" aria-selected="false"');
    expect(markup).toContain('aria-controls="settings-panel-hotkeys" aria-selected="false"');
    const headings = [...markup.matchAll(/<h2>.*?<\/svg>(.*?)<\/h2>/g)]
      .map(match => match[1]!.replace(/<.*/, ""));
    expect(headings).toEqual([
      "Graphics", "Appearance", "Sounds", "Camera rotation", "Hotkeys", "Notifications", "Story dialogue", "Daylight", "World"
    ]);
    expect(markup).not.toContain("Time &amp; weather");
    expect(markup).not.toContain("Autosave");
  });

  it("renders the live Tone select from the stored choice", () => {
    expect(markup).toContain('aria-label="Tone"');
    expect(markup).toContain('<option value="0" selected="">Auto (vivid by day, filmic at night)</option>');
  });

  it("renders the detail slider and resolution select with disabled apply ticks", () => {
    expect(markup).toContain("<span>Detail: High</span>");
    expect(markup).toContain('aria-label="Apply detail (rebuilds the island in place)" class="settings-panel__apply" disabled=""');
    expect(markup).toContain('<option value="3" selected="">Fast</option>');
    expect(markup).toContain('aria-label="Apply resolution" class="settings-panel__apply" disabled=""');
    expect(markup).toContain(
      "Resolution changes that keep antialiasing apply immediately; antialiasing changes reload the game."
    );
  });

  it("renders the pending Character detail sub-slider under Detail with its ✓ tick", () => {
    expect(markup).toContain("<span>Character detail: Auto (follows Detail)</span>");
    expect(markup).toMatch(
      /<span>Character detail: Auto \(follows Detail\)<\/span><input max="4" min="0" step="1" type="range" value="0"/
    );
    expect(markup).toContain(
      'aria-label="Apply character detail" class="settings-panel__apply" disabled=""'
    );
    expect(markup).toContain("How detailed settler models are and how often they are posed.");
  });

  it("renders the world and sound settings from their current values", () => {
    expect(markup).toContain('<input type="checkbox" checked=""/>'
      + '<span class="settings-panel__check-text">Critters</span></label>');
    expect(markup).toContain('title="Show or hide fog without changing exploration or saved island progress.">'
      + '<input type="checkbox"/><span class="settings-panel__check-text">Fog of war</span></label>');
    expect(markup).toContain("<span>Master volume: 100 %</span>");
    expect(markup).toContain("<span>Music volume: 35 %</span>");
    expect(markup).toContain("<span>Environment volume: 40 %</span>");
    expect(markup).toContain('<input type="checkbox"/>'
      + '<span class="settings-panel__check-text">Rain / snow</span></label>');
  });

  it("renders disabled unchecked environment layers at zero and separates master from music", () => {
    const sound = createSoundControls({
      enabled: true, environmentVolume: 0, layersOff: new Set<SoundLayer>(),
      setEnabled: vi.fn(), setEnvironmentVolume: vi.fn(), setLayer: vi.fn()
    });
    const silent = renderWithI18n(createElement(SettingsSections, createProps({ sound })));
    for (const label of ["Sea &amp; rivers", "Leaves &amp; wind", "Rain / snow", "Wildlife"])
      expect(silent).toContain(`<input disabled="" type="checkbox"/>`
        + `<span class="settings-panel__check-text">${label}</span></label>`);
    expect(silent).toMatch(/Master volume:.*?<hr class="sound-controls__divider"\/>.*?Music volume:/);
    expect(silent).toContain('aria-label="Toggle building names"');
    expect(silent).toContain('aria-label="Move forward"');
  });

  it("adds the Account section when given and keeps the Daylight radio choice", () => {
    const full = renderWithI18n(createElement(SettingsSections, createProps({
      account: { displayName: "Ragnar", logOut: vi.fn() }
    })));
    expect(full).toContain('<div aria-label="Day and weather" class="settings-panel__day-mode" role="radiogroup">');
    expect(full).toContain('<input type="radio" name="day-mode" checked="" value="nature"/>');
    expect(full).toMatch(
      /<\/svg>Account<\/h2><div class="account-settings"><p class="settings-panel__hint">Signed in as Ragnar/
    );
  });

  it("disables the Daylight choice with a translated reason where the map script controls the environment", () => {
    const controller = createEnvironmentController(SUN, { hour: 6.5, mode: "nature", rain: false, snow: false });
    const weather = createWeatherControls(controller, () => true);
    const reasons = { de: "Diese Karte steuert Zeit und Wetter.", en: "This map controls time and weather.",
      hu: "Az időt és az időjárást ez a térkép irányítja." };
    for (const locale of ["en", "hu", "de"] as const) {
      const markup = renderWithI18n(createElement(SettingsSections, createProps({ weather })), locale);
      expect(markup).toContain('<input disabled="" type="radio" name="day-mode" checked="" value="nature"/>');
      expect(markup).toContain(`<p class="settings-panel__hint">${reasons[locale]}</p>`);
    }
    const free = renderWithI18n(createElement(SettingsSections, createProps()));
    expect(free).not.toContain(reasons.en);
  });
});

describe("weather controls lock (ENV0)", () => {
  it("ignores every viewer change while locked and publishes the lock in the snapshot", () => {
    let locked = true;
    const controller = createEnvironmentController(SUN, { hour: 9, mode: "nature", rain: false, snow: false });
    const weather = createWeatherControls(controller, () => locked);
    expect(weather.store.getSnapshot().locked).toBe(true);
    weather.actions.toggleRain();
    weather.actions.toggleSnow();
    weather.actions.toggleCycle();
    weather.actions.setTime("night");
    weather.setMode("sun");
    expect(controller.getControls()).toMatchObject({ cycling: false, mode: "nature", raining: false, snowing: false });
    controller.update(5);
    expect(controller.getControls().hour).toBe(9);
    locked = false;
    weather.refresh();
    expect(weather.store.getSnapshot().locked).toBe(false);
    weather.actions.toggleRain();
    expect(controller.getControls().raining).toBe(true);
  });
});
