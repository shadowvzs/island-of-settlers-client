import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Captures the campaign editor's Check panel and translation table (lane CUX-CHECK). It authors a campaign through
 * the real UI (two maps, a story intro, a speaker), saves one map file with two script templates from the map
 * editor, then shoots the translation table (all rows, only missing, after a Check jump) and the Check panel at
 * desktop width in English and Hungarian, plus a phone overflow check.
 * Run: npx tsx --env-file=<file with OUT=<folder>> tools/bench/campaign-check-review.ts
 */
const DESKTOP = { height: 860, width: 1366 };
const PHONE = { height: 844, width: 390 };
const SETTLE_MS = 350;
const PORTRAIT = resolve(import.meta.dirname, "../../assets/commander-portraits/roman.png");
const out = process.env.OUT ?? "/tmp/campaign-check-review";
mkdirSync(out, { recursive: true });

const answers: string[] = [];
const tab = (page: Page, id: string) => page.locator(`#campaign-editor-tab-${id}`).click();
const button = (page: Page, name: string) => page.getByRole("button", { exact: true, name }).first().click();
const waitForEditor = (page: Page) => page.waitForFunction(
  () => Boolean((window as Window & { __editorReady?: boolean }).__editorReady), null, { timeout: 180_000 });

const shoot = async (page: Page, name: string) => {
  await page.waitForTimeout(SETTLE_MS);
  const overflow = await page.evaluate(() => {
    const host = document.getElementById("campaign-editor");
    return Boolean(host && host.scrollWidth > host.clientWidth + 1);
  });
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`${name}${overflow ? " (horizontal overflow!)" : ""}`);
};

const authorCampaign = async (page: Page) => {
  answers.push("The Northern Isles");
  await button(page, "New campaign");
  await page.getByText("Uploads are our own or licence-clean artwork").click();
  await page.getByLabel("Description").first().fill("Three landings on the cold northern coast.");
  await tab(page, "maps");
  await button(page, "Add map");
  await button(page, "Add map");
  await button(page, "Map 1");
  await page.getByLabel("Name", { exact: true }).last().fill("Landfall at Grey Cove");
  await tab(page, "story");
  const intro = page.getByRole("region", { name: "Intro (map start)" });
  await intro.getByLabel("Title", { exact: true }).fill("Grey Cove");
  await intro.getByLabel("Text", { exact: true }).fill(
    "The fog lifts over Grey Cove. Our ships ride at anchor while the scouts row ashore.");
  await tab(page, "speakers");
  await page.getByLabel("Upload image: Add speaker (choose its portrait)").setInputFiles(PORTRAIT);
  await page.locator(".campaign-editor__speaker").first().getByLabel("Name", { exact: true }).fill("Advisor Livia");
  await button(page, "Save");
};

/**
 * Saves the first map's file from the 3D map editor with two script templates and an unfinished
 * condition and step (script Ready-check errors), then returns. */
const saveMapFileWithScript = async (page: Page) => {
  await tab(page, "maps");
  await button(page, "Landfall at Grey Cove");
  await button(page, "Open map");
  await page.waitForURL(/campaignSlot=/);
  await waitForEditor(page);
  await page.locator(".map-editor__tabs [role=tab]").last().click();
  await page.locator(".map-editor__tab-panel:not([hidden]) button[aria-haspopup=dialog]").click();
  const workspace = page.locator(".script-workspace-window");
  await workspace.locator(".script-workspace").waitFor();
  for (const index of [0, 3]) {
    await workspace.locator(".script-list__toolbar button").nth(1).click();
    await page.locator(".script-dialog .script-templates button").nth(index).click();
    await page.locator(".script-dialog .script-dialog__primary").click();
  }
  await workspace.locator(".script-list__trigger-name").nth(1).click();
  await workspace.getByRole("button", { exact: true, name: "+ condition" }).first().click();
  await page.locator(".script-dialog .script-add__option").first().click();
  await workspace.getByText(/^2 errors/).first().waitFor();
  await workspace.getByRole("button", { name: /^Close/ }).first().click();
  await page.getByRole("tab", { name: "Map, headquarters and scenario" }).click();
  await button(page, "Save campaign map");
  await page.getByText(/^Campaign map ".*" saved/).first().waitFor();
  await button(page, "Back to the campaign editor");
  await page.waitForURL(/mode=campaign/);
  await waitForEditor(page);
};

const cell = (page: Page, field: string, language: string) =>
  page.getByRole("textbox", { exact: true, name: `${field} (${language})` });

const shootTextTable = async (page: Page, suffix: string) => {
  await tab(page, "translations");
  await shoot(page, `text-table-${suffix}`);
  await page.getByLabel("Only missing").check();
  await shoot(page, `text-table-only-missing-${suffix}`);
  await page.getByLabel("Only missing").uncheck();
};

const shootCheck = async (page: Page, suffix: string) => {
  await tab(page, "validation");
  await page.locator(".campaign-check__run").click();
  await page.locator(".campaign-check__section").first().waitFor();
  await shoot(page, `check-${suffix}`);
  await page.locator(".campaign-check__section").last().scrollIntoViewIfNeeded();
  await shoot(page, `check-last-section-${suffix}`);
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: DESKTOP });
  page.on("pageerror", error => console.error("[pageerror]", error.message));
  page.on("dialog", dialog => void dialog.accept(dialog.type() === "prompt" ? answers.shift() ?? "" : undefined));
  await page.goto(`${url}editor.html?mode=campaign`);
  await waitForEditor(page);
  await authorCampaign(page);
  await saveMapFileWithScript(page);
  await tab(page, "translations");
  await cell(page, "Name", "Magyar").first().fill("Az északi szigetek");
  await cell(page, "Name", "Deutsch").first().fill("Die Nordinseln");
  await cell(page, "Quest story-intro: title", "Magyar").fill("Szürke-öböl");
  await shootTextTable(page, "desktop-en");
  await shootCheck(page, "desktop-en");
  await page.locator(".campaign-check__entry").filter({ hasText: /Deutsch|de translation/ }).first().click();
  await shoot(page, "check-jump-to-cell-desktop-en");
  await button(page, "Save");
  await page.setViewportSize(PHONE);
  await shootTextTable(page, "phone-en");
  await shootCheck(page, "phone-en");
  await page.setViewportSize(DESKTOP);
  await page.evaluate(() => localStorage.setItem("island-of-settlers.language", "hu"));
  await page.reload();
  await waitForEditor(page);
  await page.getByRole("button", { name: /The Northern Isles|Az északi szigetek/ }).first().click();
  await shootTextTable(page, "desktop-hu");
  await shootCheck(page, "desktop-hu");
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ fullPage: true, path: join(out, "failure.png") });
  throw error;
} finally {
  await browser.close();
  await server.close();
}
