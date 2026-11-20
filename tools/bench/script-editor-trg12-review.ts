import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Captures the Script workspace's Quests, Variables and Multiboards tabs (lane TRG12) through the real UI after
 * inserting the "plant N with a board" and "collect N" templates: the quest form (top and schedule/rewards), the
 * claim-date preview, the variables list, the board editor with its live preview, at desktop and phone width.
 * Run: npx tsx --env-file=<file with OUT=<folder> [PORT=<port>] [SCRIPT_LANG=hu]> tools/bench/script-editor-trg12-review.ts
 */
const DESKTOP = { height: 860, width: 1366 };
const PHONE = { height: 844, width: 390 };
const SETTLE_MS = 400;
const TABS = { boards: 4, quests: 1, variables: 2 } as const;
const PLANT_BOARD_TEMPLATE = 2;
const COLLECT_TEMPLATE = 1;
const out = process.env.OUT ?? "/tmp/script-editor-trg12-review";
const LANGUAGES = new Set(["de", "hu"]);
const language = LANGUAGES.has(process.env.SCRIPT_LANG ?? "") ? process.env.SCRIPT_LANG! : "en";
mkdirSync(out, { recursive: true });

const workspaceWindow = (page: Page) => page.locator(".script-workspace-window");
const dialog = (page: Page) => page.locator(".script-dialog");
const body = (page: Page) => page.locator(".script-workspace-window__body");

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

const tab = (page: Page, index: number) => workspaceWindow(page).locator(".script-workspace__tabs [role=tab]")
  .nth(index).click();

const scrollTo = (page: Page, selector: string) => page.locator(selector).first().evaluate(element =>
  element.scrollIntoView({ block: "start" }));

const shootDesktop = async (page: Page) => {
  await openWorkspace(page);
  await insertTemplate(page, PLANT_BOARD_TEMPLATE);
  await insertTemplate(page, COLLECT_TEMPLATE);
  await tab(page, TABS.quests);
  await shoot(page, "quest-form-desktop");
  const repeat = workspaceWindow(page).locator(".script-quest:not([hidden]) .script-quest__schedule select").first();
  await repeat.selectOption("calendar");
  await workspaceWindow(page).locator(".script-quest__schedule select").nth(3).selectOption("1");
  await scrollTo(page, ".script-quest__schedule");
  await shoot(page, "quest-schedule-desktop");
  await scrollTo(page, ".script-quest__reward");
  await shoot(page, "quest-rewards-desktop");
  await workspaceWindow(page).locator(".script-quest__reward button").nth(2).click();
  await shoot(page, "quest-home-reward-picker-desktop");
  await dialog(page).locator(".script-dialog__close").click();
  await body(page).evaluate(element => element.scrollTo(0, 0));
  await workspaceWindow(page).locator(".script-quest__declared > summary").click();
  await workspaceWindow(page).locator(".script-quest__declared > button").click();
  await shoot(page, "quest-declared-rewards-desktop");
  await tab(page, TABS.variables);
  await shoot(page, "variables-desktop");
  await tab(page, TABS.boards);
  await shoot(page, "boards-desktop");
  await scrollTo(page, ".script-board__preview");
  await shoot(page, "boards-preview-desktop");
  await workspaceWindow(page).locator(".script-board__cell .script-slot").first().click();
  await dialog(page).locator(".script-picker__tabs [role=tab]").last().click();
  await shoot(page, "boards-cell-picker-desktop");
  await dialog(page).locator(".script-dialog__close").click();
};

const shootPhone = async (page: Page) => {
  await page.setViewportSize(PHONE);
  await body(page).evaluate(element => element.scrollTo(0, 0));
  await tab(page, TABS.quests);
  await shoot(page, "quest-form-phone");
  await scrollTo(page, ".script-quest__schedule");
  await shoot(page, "quest-schedule-phone");
  await tab(page, TABS.variables);
  await body(page).evaluate(element => element.scrollTo(0, 0));
  await shoot(page, "variables-phone");
  await tab(page, TABS.boards);
  await scrollTo(page, ".script-board__columns");
  await shoot(page, "boards-phone");
  await scrollTo(page, ".script-board__preview");
  await shoot(page, "boards-preview-phone");
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
