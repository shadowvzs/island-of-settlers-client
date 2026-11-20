import { describe, expect, it } from "vitest";

import { createLanguagePreference, LANGUAGE_PREFERENCE_KEY } from "../src/shared/i18n/language-preference";

const memory = () => {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); } };
};

describe("browser language preference and Lingui activation", () => {
  it("defaults to English and rejects unsupported locales without changing saved state", () => {
    const storage = memory(), preference = createLanguagePreference(storage);
    expect(preference.i18n.locale).toBe("en");
    expect(preference.setLanguage("unknown")).toBe(false);
    expect(storage.getItem(LANGUAGE_PREFERENCE_KEY)).toBeNull();
    expect(preference.getSnapshot().locale).toBe("en");
  });

  it("persists Hungarian, activates the real Lingui instance, and restores it", async () => {
    const storage = memory(), preference = createLanguagePreference(storage);
    preference.setLanguage("hu");
    await preference.ready();
    expect(preference.i18n.locale).toBe("hu");
    expect(storage.getItem(LANGUAGE_PREFERENCE_KEY)).toBe("hu");
    expect(createLanguagePreference(storage).getSnapshot()).toEqual({ locale: "hu", saved: true });
  });

  it("notifies once per change and releases subscriptions", () => {
    const preference = createLanguagePreference(memory());
    let changed = 0;
    const release = preference.subscribe(() => { changed++; });
    preference.setLanguage("hu"); preference.setLanguage("hu");
    expect(changed).toBe(1);
    release(); preference.setLanguage("en");
    expect(changed).toBe(1);
  });

  it("keeps a tab-local choice when persistence is unavailable", async () => {
    const preference = createLanguagePreference({ getItem: () => { throw new Error("Blocked"); },
      setItem: () => { throw new Error("Blocked"); } });
    expect(preference.setLanguage("hu")).toBe(true);
    await preference.ready();
    expect(preference.i18n.locale).toBe("hu");
    expect(preference.getSnapshot()).toEqual({ locale: "hu", saved: false });
  });

  it("reacts to external preference replacement or removal without changing catalogs", async () => {
    const storage = memory(), preference = createLanguagePreference(storage);
    storage.setItem(LANGUAGE_PREFERENCE_KEY, "hu"); preference.reload();
    await preference.ready();
    expect(preference.i18n.locale).toBe("hu");
    storage.setItem(LANGUAGE_PREFERENCE_KEY, "unsupported"); preference.reload();
    expect(preference.i18n.locale).toBe("en");
    expect(preference.i18n._("Current English text")).toBe("Current English text");
  });

  it("loads a translation on demand and lets the newest choice win a race", async () => {
    const storage = memory();
    storage.setItem(LANGUAGE_PREFERENCE_KEY, "de");
    const preference = createLanguagePreference(storage);
    expect(preference.getSnapshot().locale).toBe("de");
    preference.setLanguage("hu"); preference.setLanguage("en");
    await preference.ready();
    expect(preference.i18n.locale).toBe("en");
    preference.setLanguage("de");
    await preference.ready();
    expect(preference.i18n.locale).toBe("de");
  });
});
