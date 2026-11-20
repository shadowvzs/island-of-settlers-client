import type { ConsoleMessage, Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { findMapPoint, nextFrames } from "../../fixtures/ui";

/** Menu > Settings entry name per locale (also guards the translated entry itself). */
const SETTINGS_ENTRY = { de: "Einstellungen", en: "Settings", hu: "Beállítások" } as const;
type SmokeLocale = keyof typeof SETTINGS_ENTRY;

/** The live preference module the game uses (the dev server hands back the same instance). */
const setLanguage = (page: Page, locale: SmokeLocale) => page.evaluate(async (next) => {
  const module = await import(/* @vite-ignore */ String("/src/app/localization/language-store.ts"));
  module.languagePreference.setLanguage(next);
  await module.languagePreference.ready();
}, locale);

const settingsMenu = (page: Page) => page.locator(".settings-panel.settings-menu");

const openSettingsIn = async (page: Page, locale: SmokeLocale) => {
  await page.locator('[data-launcher-id="menu"]').click();
  await page.getByRole("button", { exact: true, name: SETTINGS_ENTRY[locale] }).click();
  await expect(settingsMenu(page)).toBeVisible();
  await nextFrames(page);
};

const CLOSERS = {
  button: (page: Page) => settingsMenu(page).locator(".settings-panel__close").click(),
  escape: (page: Page) => page.keyboard.press("Escape"),
  outside: async (page: Page) => {
    const point = await findMapPoint(page);
    await page.mouse.click(point.x, point.y);
  }
} as const;

/**
 * SETTINGS-CLOSE-BUG (2026-11-09): the lazily loaded settings sheet's `display: flex` outranked
 * `.settings-panel[hidden]`, so the closed panel stayed on screen. Every locale opens and closes it
 * by its button, Escape and an outside press without console errors (React DOM-nesting included).
 */
test.describe("settings panel in every language", () => {
  test("opens and closes in en, hu and de without console errors", async ({ game: { page } }) => {
    const consoleErrors: string[] = [];
    const onConsole = (message: ConsoleMessage) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    };
    page.on("console", onConsole);
    try {
      for (const locale of ["en", "hu", "de"] as const) {
        await setLanguage(page, locale);
        for (const [how, close] of Object.entries(CLOSERS)) {
          await openSettingsIn(page, locale);
          await close(page);
          await expect(settingsMenu(page), `${locale}: ${how} closes Settings`).toBeHidden();
        }
      }
    } finally {
      page.off("console", onConsole);
      await setLanguage(page, "en");
    }
    expect(consoleErrors, "console errors").toEqual([]);
  });
});
