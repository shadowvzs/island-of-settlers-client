import { afterEach, describe, expect, it, vi } from "vitest";

import { connectCritterSetting } from "../src/app/island-critters";
import { settingsStorage } from "../src/app/settings/graphics-settings";

const stubStorage = () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
  return values;
};

const createLayers = () => ({
  birds: { setEnabled: vi.fn() },
  butterflies: { setEnabled: vi.fn() },
  critters: { setDecorativeEnabled: vi.fn() },
  whales: { setEnabled: vi.fn() }
});

afterEach(() => vi.unstubAllGlobals());

describe("Critters setting", () => {
  it("is on by default and remembers the choice", () => {
    const values = stubStorage();
    expect(settingsStorage.readCritters()).toBe(true);
    settingsStorage.writeCritters(false);
    expect(values.get("island-of-settlers.critters")).toBe("0");
    expect(settingsStorage.readCritters()).toBe(false);
    settingsStorage.writeCritters(true);
    expect(settingsStorage.readCritters()).toBe(true);
  });

  it("switches birds, butterflies, decorative critters and whales together", () => {
    stubStorage();
    const layers = createLayers();
    const setting = connectCritterSetting(layers);
    expect(setting.enabled).toBe(true);
    expect(layers.birds.setEnabled).toHaveBeenLastCalledWith(true);
    setting.set(false);
    expect(layers.birds.setEnabled).toHaveBeenLastCalledWith(false);
    expect(layers.butterflies.setEnabled).toHaveBeenLastCalledWith(false);
    expect(layers.critters.setDecorativeEnabled).toHaveBeenLastCalledWith(false);
    expect(layers.whales.setEnabled).toHaveBeenLastCalledWith(false);
    expect(settingsStorage.readCritters()).toBe(false);
  });

  it("starts with the stored choice", () => {
    stubStorage().set("island-of-settlers.critters", "0");
    const layers = createLayers();
    expect(connectCritterSetting(layers).enabled).toBe(false);
    expect(layers.critters.setDecorativeEnabled).toHaveBeenLastCalledWith(false);
  });
});

describe("Critters setting under the budget controller", () => {
  it("hides the shown layers while suppressed without storing anything", () => {
    const values = stubStorage();
    const layers = createLayers();
    const setting = connectCritterSetting(layers);
    setting.setSuppressed(true);
    expect(layers.birds.setEnabled).toHaveBeenLastCalledWith(false);
    expect(values.has("island-of-settlers.critters")).toBe(false);
    setting.setSuppressed(false);
    expect(layers.critters.setDecorativeEnabled).toHaveBeenLastCalledWith(true);
  });

  it("never shows layers the player switched off", () => {
    stubStorage().set("island-of-settlers.critters", "0");
    const layers = createLayers();
    const setting = connectCritterSetting(layers);
    setting.setSuppressed(true);
    setting.setSuppressed(false);
    expect(layers.butterflies.setEnabled).toHaveBeenLastCalledWith(false);
    expect(setting.isEnabled()).toBe(false);
  });
});
