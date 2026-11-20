import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Captures the map editor's Script workspace (lane TRG11) through the real UI: the trigger list, a template insert,
 * the sentence form, the slot pickers (catalog type, family tree, value), live validation errors, the actor panel
 * (with the display name of a pirate actor and the actor picker that lists it) and the template dialog, at desktop
 * and phone width; SCRIPT_LANG=hu shoots the Hungarian copy.
 * Run: npx tsx --env-file=<file with OUT=<folder> [PORT=<port>] [SCRIPT_LANG=hu]> tools/bench/script-editor-review.ts
 */
const DESKTOP = { height: 860, width: 1366 };
const PHONE = { height: 844, width: 390 };
const SETTLE_MS = 400;
/** Script workspace tabs: Triggers, Quests, Variables, Actors, Multiboards. */
const ACTORS_TAB = 3;
/** Template dialog order: kill counter, collect, deadline, build, plant with a board, reach, hold, escort, … */
const KILL_COUNTER_TEMPLATE = 0;
const ESCORT_TEMPLATE = 7;
/** The look select's value of the pirate look, and how the actor picker words a named actor. */
const PIRATE_LOOK = JSON.stringify({ kind: "pirates" });
const NAMED_ACTOR_CHOICE = /shown as|megjelenő név|angezeigt als/;
const APPEAR_ACTION = /make … appear|make .* appear|megjeleníti|erscheinen/;
const out = process.env.OUT ?? "/tmp/script-editor-review";
const LANGUAGES = new Set(["de", "hu"]);
const language = LANGUAGES.has(process.env.SCRIPT_LANG ?? "") ? process.env.SCRIPT_LANG! : "en";
mkdirSync(out, { recursive: true });

const workspaceWindow = (page: Page) => page.locator(".script-workspace-window");
const dialog = (page: Page) => page.locator(".script-dialog");

const shoot = async (page: Page, name: string) => {
  await page.waitForTimeout(SETTLE_MS);
  const overflow = await page.evaluate(() => [document.querySelector(".script-workspace-window"),
    document.querySelector(".script-dialog")].some(host => host && host.scrollWidth > host.clientWidth + 1));
  await page.screenshot({ path: join(out, `${name}-${language}.png`) });
  console.log(`${name}${overflow ? " (horizontal overflow!)" : ""}`);
};

const openWorkspace = async (page: Page) => {
  await page.locator(".map-editor__tabs [role=tab]").last().click();
  await page.locator(".map-editor__tab-panel:not([hidden]) button[aria-haspopup=dialog]").click();
  await workspaceWindow(page).locator(".script-workspace").waitFor();
};

const insertTemplate = async (page: Page, index: number) => {
  await workspaceWindow(page).locator(".script-list__toolbar button").nth(1).click();
  await dialog(page).locator(".script-templates button").nth(index).click();
  await dialog(page).locator(".script-dialog__primary").click();
};

/** The slot button whose text matches, inside the visible form. */
const slot = (page: Page, text: RegExp) => workspaceWindow(page).locator(".script-form .script-slot")
  .filter({ hasText: text })
  .first();

const pickerTab = (page: Page, index: number) => dialog(page).locator(".script-picker__tabs [role=tab]").nth(index)
  .click();

const closeDialog = (page: Page) => dialog(page).locator(".script-dialog__close").click();

/** The first actor card with a spawn look select (the actor added last has none of the template's names). */
const lastActorCard = (page: Page) => workspaceWindow(page).locator(".script-actor").last();

/**
 * Actor display names (owner 2026-11-13): the new actor takes the pirate look, its name field shows the look's
 * default, then the map maker's own name.
 */
const shootActorNames = async (page: Page) => {
  const card = lastActorCard(page);
  await card.locator("select").filter({ has: page.locator(`option[value='${PIRATE_LOOK}']`) })
    .selectOption(PIRATE_LOOK);
  await card.scrollIntoViewIfNeeded();
  await shoot(page, "actor-name-default-desktop");
  const english = card.locator(".script-text input").first();
  await english.fill("Redbeard the Elder");
  await english.blur();
  await lastActorCard(page).scrollIntoViewIfNeeded();
  await shoot(page, "actor-name-edited-desktop");
};

/** Adds a "make … appear" action to the open trigger and opens its actor slot: the picker lists the named actor. */
const shootNamedActorPicker = async (page: Page) => {
  const panel = workspaceWindow(page).locator(".script-workspace__panel:not([hidden])");
  await panel.locator(".script-row__add button").first().click();
  await dialog(page).locator(".script-add__option").filter({ hasText: APPEAR_ACTION }).first().click();
  await panel.locator(".script-slot[data-error=true]").last().click();
  await dialog(page).locator(".script-picker__choices button").filter({ hasText: NAMED_ACTOR_CHOICE }).waitFor();
  await shoot(page, "picker-actor-named-desktop");
  await closeDialog(page);
};

const shootDesktop = async (page: Page) => {
  await openWorkspace(page);
  await shoot(page, "list-empty-desktop");
  await workspaceWindow(page).locator(".script-list__toolbar button").nth(1).click();
  await shoot(page, "template-dialog-desktop");
  await closeDialog(page);
  await insertTemplate(page, KILL_COUNTER_TEMPLATE);
  await insertTemplate(page, ESCORT_TEMPLATE);
  await workspaceWindow(page).locator(".script-list__trigger-name").nth(1).click();
  await shoot(page, "form-kill-counter-desktop");
  await slot(page, /Hunter|Vadász|Jäger/).click();
  await pickerTab(page, 1);
  await shoot(page, "picker-type-desktop");
  await closeDialog(page);
  await workspaceWindow(page).locator(".script-form .script-slot").nth(2).click();
  await pickerTab(page, 2);
  await shoot(page, "picker-family-desktop");
  await closeDialog(page);
  await workspaceWindow(page).locator(".script-workspace__panel:not([hidden]) .script-form__add").last().click();
  await shoot(page, "add-condition-desktop");
  await dialog(page).locator(".script-add__option").first().click();
  await workspaceWindow(page).locator(".script-workspace__panel:not([hidden]) .script-row__add button").first()
    .click();
  await dialog(page).locator(".script-add__option").filter({ hasText: /increase|nőjön|erhöhe/ }).first().click();
  await shoot(page, "form-validation-errors-desktop");
  await workspaceWindow(page).locator(".script-list__trigger-name").filter({ hasText: /Escort|kíséret|Geleit/i })
    .first().click();
  await shoot(page, "form-escort-template-desktop");
  await workspaceWindow(page).locator(".script-workspace__tabs [role=tab]").nth(ACTORS_TAB).click();
  await workspaceWindow(page).locator(".script-actors .script-list__toolbar button").first().click();
  await shoot(page, "actor-panel-desktop");
  await workspaceWindow(page).locator(".script-actor .script-slot").first().click();
  await dialog(page).locator(".reward-picker__tabs [role=tab]").first().click();
  await shoot(page, "picker-actor-type-desktop");
  await closeDialog(page);
  await shootActorNames(page);
  await workspaceWindow(page).locator(".script-workspace__tabs [role=tab]").nth(0).click();
  await shootNamedActorPicker(page);
};

const shootPhone = async (page: Page) => {
  await page.setViewportSize(PHONE);
  await workspaceWindow(page).locator(".script-list__trigger-name")
    .filter({ hasText: /^(Kill counter|Zsákmányszámláló|Beutezähler)$/ })
    .first().click();
  await shoot(page, "list-phone");
  await workspaceWindow(page).locator(".script-form").first().scrollIntoViewIfNeeded();
  await shoot(page, "form-phone");
  await slot(page, /Hunter|Vadász|Jäger/).click().catch(() => undefined);
  await shoot(page, "picker-phone");
  await closeDialog(page).catch(() => undefined);
  await workspaceWindow(page).locator(".script-workspace__tabs [role=tab]").nth(ACTORS_TAB).click();
  await shoot(page, "actor-panel-phone");
};

const port = Number(process.env.PORT) || undefined;
const { server, url } = await startDevServer({ port });
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: DESKTOP });
  page.on("pageerror", error => console.error("[pageerror]", error.message));
  await page.addInitScript(locale => localStorage.setItem("island-of-settlers.language", locale), language);
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${url}editor.html?quality=minimal&size=64&seed=123&cache=0`);
  await page.waitForFunction(() => Boolean((window as Window & { __editorReady?: boolean }).__editorReady), null,
    { timeout: 180_000 });
  await shootDesktop(page);
  await shootPhone(page);
} finally {
  await browser.close();
  await server.close();
}
