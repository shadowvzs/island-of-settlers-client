import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getGreeting, greeting } from "./fixtures/lingui/helpers";
import { MacroView } from "./fixtures/lingui/view";

describe("Lingui macros through the actual Vite/Vitest pipeline", () => {
  it("compiles t, lazy msg and Trans and resolves the current locale without stale module strings", () => {
    const i18n = setupI18n({ locale: "en", messages: {
      en: { "macro.greeting": "Welcome, {name}!", "macro.ready": "Ready to sail" },
      hu: { "macro.greeting": "Üdv, {name}!", "macro.ready": "Indulásra kész" }
    } });
    const render = () => renderToStaticMarkup(createElement(I18nProvider, { i18n }, createElement(MacroView)));
    expect(getGreeting(i18n, "Ada")).toBe("Welcome, Ada!");
    expect(i18n._({ ...greeting, values: { name: "Ada" } })).toBe("Welcome, Ada!");
    expect(render()).toBe("<p>Ready to sail</p>");
    i18n.activate("hu");
    expect(getGreeting(i18n, "Ada")).toBe("Üdv, Ada!");
    expect(i18n._({ ...greeting, values: { name: "Ada" } })).toBe("Üdv, Ada!");
    expect(render()).toBe("<p>Indulásra kész</p>");
  });
});
