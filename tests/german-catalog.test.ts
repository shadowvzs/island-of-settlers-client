import { describe, expect, it } from "vitest";

import { messages as german } from "../src/locales/de/messages";
import { messages as english } from "../src/locales/en/messages";
import { createLanguagePreference, LANGUAGE_PREFERENCE_KEY } from "../src/shared/i18n/language-preference";
import { LANGUAGE_OPTIONS } from "../src/shared/i18n/locales";
import { createTestI18n } from "./helpers/render-with-i18n";

const memory = () => {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); } };
};

type CompiledToken = string | [string, string?, Record<string, unknown>?];

const isTokenList = (value: unknown): value is CompiledToken[] => Array.isArray(value);

/** Every ICU argument of a compiled message as "name:type:branches", nested plural/select branches included. */
const collectArguments = (tokens: CompiledToken[]): string[] => tokens.flatMap(token => {
  if (typeof token === "string") return [];
  const [name, type = "", options = {}] = token;
  const branches = Object.keys(options).filter(key => isTokenList(options[key])).sort();
  const nested = branches.flatMap(key => collectArguments(options[key] as CompiledToken[]));
  return [`${name}:${type}:${branches.join("|")}`, ...nested];
});

const argumentSignature = (message: unknown) =>
  [...new Set(isTokenList(message) ? collectArguments(message) : [])].sort().join(", ");

const edgeSpaces = (message: unknown) => {
  if (!isTokenList(message)) return "";
  const first = message[0], last = message[message.length - 1];
  const leading = typeof first === "string" && first.startsWith(" ");
  const trailing = typeof last === "string" && last.endsWith(" ");
  return `${leading}/${trailing}`;
};

describe("German language option", () => {
  it("is listed with a German flag and persists as the active locale", async () => {
    expect(LANGUAGE_OPTIONS).toContainEqual({ flag: "de", label: "Deutsch", locale: "de" });
    const storage = memory(), preference = createLanguagePreference(storage);
    expect(preference.setLanguage("de")).toBe(true);
    await preference.ready();
    expect(preference.i18n.locale).toBe("de");
    expect(storage.getItem(LANGUAGE_PREFERENCE_KEY)).toBe("de");
    expect(createLanguagePreference(storage).getSnapshot()).toEqual({ locale: "de", saved: true });
  });

  it("has a non-empty German translation for every English source message", () => {
    for (const key of Object.keys(english)) {
      expect(german[key], key).toBeTruthy();
    }
  });

  it("keeps the placeholders, plural branches and edge spaces of every English source message", () => {
    for (const key of Object.keys(english)) {
      expect(argumentSignature(german[key]), key).toBe(argumentSignature(english[key]));
      expect(edgeSpaces(german[key]), key).toBe(edgeSpaces(english[key]));
    }
  });

  it("uses the reviewed game terms instead of context-free homonyms", () => {
    const i18n = createTestI18n("de");
    const translate = (id: string) => i18n._({ id, message: "any" });
    expect(translate("domain.ware.hides")).toBe("Häute");
    expect(translate("domain.ware.sake")).toBe("Sake");
    expect(translate("domain.ware.saw")).toBe("Säge");
    expect(translate("domain.building.mint")).toBe("Münzprägerei");
    expect(translate("domain.job.berryInfuser")).toBe("Beerenaufgießer");
  });

  it("renders representative interface copy in German", () => {
    const i18n = createTestI18n("de");
    expect(i18n._({ id: "settings.window.language", message: "Language" })).toBe("Sprache");
    expect(i18n._({ id: "settings.graphics.detailHelp", message: "any" })).toContain("Hoch: alles an.");
    expect(i18n._({ id: "domain.ship.term.passengers", message: "any", values: { count: 2 } }))
      .toBe("2 Passagiere");
    expect(i18n._({ id: "mapEditor.common.howItWorks", message: "any" })).toBe("So funktioniert es");
  });

});
