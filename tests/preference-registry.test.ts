import { afterEach, describe, expect, it, vi } from "vitest";

import { choiceCodec, flagCodec, rawTextCodec } from "../src/app/preferences/codecs";
import { PREFERENCE_FAMILIES, PREFERENCE_KEY_LIST, PREFERENCES } from "../src/app/preferences/keys";
import { browserStorageArea, definePreference, definePreferenceFamily } from "../src/app/preferences/registry";

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
    values
  };
};

const throwingStorage = () => ({
  getItem: () => { throw new Error("blocked"); },
  removeItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); }
});

afterEach(() => vi.unstubAllGlobals());

describe("preference key registry", () => {
  it("lists every key once, with the stored strings players already have", () => {
    expect(new Set(PREFERENCE_KEY_LIST).size).toBe(PREFERENCE_KEY_LIST.length);
    expect(PREFERENCES.detail.key).toBe("island-of-settlers.graphics.detail");
    expect(PREFERENCES.cloudSlot).toEqual({ key: "island-settlers.cloud-slot", scope: "session" });
    expect(PREFERENCE_KEY_LIST).not.toContain("island-of-settlers.map-editor");
  });

  it("keeps family prefixes outside the fixed keys", () => {
    for (const { prefix } of Object.values(PREFERENCE_FAMILIES))
      expect(PREFERENCE_KEY_LIST.some(key => key.startsWith(prefix))).toBe(false);
  });
});

describe("typed preferences", () => {
  it("reads the historical flag encodings with their own defaults", () => {
    const offByDefault = definePreference(PREFERENCES.minimap, flagCodec(false));
    const onByDefault = definePreference(PREFERENCES.critters, flagCodec(true));
    const storage = memoryStorage({ [PREFERENCES.critters.key]: "yes" });
    expect(offByDefault.read(storage)).toBe(false);
    expect(onByDefault.read(storage)).toBe(true);
    offByDefault.write(true, storage);
    expect(storage.values.get(PREFERENCES.minimap.key)).toBe("1");
  });

  it("falls back for unknown choices and clears to the default", () => {
    const isVivid = (value: string | null): value is "vivid" => value === "vivid";
    const tone = definePreference(PREFERENCES.tone, choiceCodec(isVivid, "auto"));
    const storage = memoryStorage({ [PREFERENCES.tone.key]: "sepia" });
    expect(tone.read(storage)).toBe("auto");
    tone.write("vivid", storage);
    expect(tone.read(storage)).toBe("vivid");
    tone.clear(storage);
    expect(tone.read(storage)).toBe("auto");
  });

  it("never throws when the storage refuses every call (private windows)", () => {
    const hotkeys = definePreference(PREFERENCES.hotkeys, rawTextCodec);
    const blocked = throwingStorage();
    expect(hotkeys.read(blocked)).toBeNull();
    expect(hotkeys.write("x", blocked)).toBe(false);
    expect(() => hotkeys.clear(blocked)).not.toThrow();
  });

  it("guards the browser storage itself, even when accessing it throws", () => {
    vi.stubGlobal("sessionStorage", undefined);
    const denied = () => { throw new Error("denied"); };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: denied });
    const sound = definePreference(PREFERENCES.sound, flagCodec(false));
    expect(sound.read()).toBe(false);
    expect(sound.write(true)).toBe(false);
    const tab = browserStorageArea("session");
    expect(tab.getItem("anything")).toBeNull();
    expect(() => tab.setItem("anything", "1")).not.toThrow();
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("stores family members at prefix + id", () => {
    const section = definePreferenceFamily(PREFERENCE_FAMILIES.settingsSection, flagCodec(false));
    const storage = memoryStorage();
    section("graphics").write(true, storage);
    expect(storage.values.get("island-of-settlers.settings.section.graphics")).toBe("1");
  });
});
