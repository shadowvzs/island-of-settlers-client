import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { Browser, BrowserContext, Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Online accounts and cloud saves in the real game against the local stack (docs/server/local-dev.md). Start
 * the stack with this origin allowed, then run:
 *   DEV_CORS_ORIGINS=http://127.0.0.1:5288 npm run stack --prefix island-of-settlers-local-dev
 *   npx tsx tools/bench/online-account-review.ts
 * Desktop (1280): sign in page, Register, slot picker, game, Save (status line), reload continues the saved
 * game; a second tab takes the session over (question), the first is told and takes it back, its stale save
 * meets the conflict question and overwrites. Phone (420): sign in, take over, save, taken over, conflict.
 * Screenshots go to OUT (default ../resources/backend-2026-10-22).
 */
const OUT = process.env.OUT ?? "../resources/backend-2026-10-22";
const ORIGIN_PORT = 5288;
const READY_TIMEOUT = 240_000;
const DESKTOP = { height: 800, width: 1280 };
const PHONE = { height: 860, width: 420 };
const suffix = randomBytes(4).toString("hex");
const ACCOUNT = { displayName: `Review${suffix}`, email: `review-${suffix}@example.test`,
  password: `review-${randomBytes(6).toString("hex")}` };
/** A real player's browser: not automated, so the start scroll and saves behave as for players. */
const NOT_AUTOMATED = "Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });";

const check = (condition: boolean, message: string) => {
  if (!condition) throw new Error(`Check failed: ${message}`);
  console.log(`ok - ${message}`);
};

const newContext = async (browser: Browser, viewport: typeof DESKTOP) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport });
  await context.addInitScript({ content: NOT_AUTOMATED });
  return context;
};

const openPage = async (context: BrowserContext, url: string) => {
  const page = await context.newPage();
  page.on("pageerror", error => console.error("page error:", error.message));
  page.on("console", message => { if (message.type() !== "log") console.log(`[${message.type()}]`, message.text()); });
  await page.goto(`${url}?quality=minimal&size=64&cache=0`);
  return page;
};

const scroll = (page: Page) => page.getByRole("dialog", { exact: true, name: /./ }).first();
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` });

const waitForGame = async (page: Page) => {
  try {
    await page.waitForFunction(() => window.__islandReady === true, null, { timeout: READY_TIMEOUT });
    await page.locator("#loading-screen").waitFor({ state: "detached", timeout: READY_TIMEOUT });
  } catch (error) {
    await shot(page, "failure");
    throw error;
  }
};

const choose = (page: Page, name: RegExp) => page.getByRole("button", { name }).first().click();

const saveGame = async (page: Page) => {
  const saved = await page.evaluate(async () => {
    const settlement = (window as {
      __settlement?: { saving?: { flush: (reason: "manual") => Promise<boolean> } };
    }).__settlement;
    if (!settlement?.saving) throw new Error("The settlement save coordinator is not available");
    return settlement.saving.flush("manual");
  });
  if (!saved) throw new Error("The game did not save");
};

const statusText = (page: Page) => page.locator(".cloud-status").innerText({ timeout: 30_000 });

const waitForStatus = async (page: Page, text: RegExp) => {
  try {
    await page.locator(".cloud-status", { hasText: text }).waitFor({ timeout: 60_000 });
  } catch (error) {
    await shot(page, "failure");
    console.error("status:", await page.locator(".cloud-status").allInnerTexts(),
      "toast:", await page.locator(".settlement-toast, [role=status]").allInnerTexts());
    throw error;
  }
};

const popup = (page: Page, title: string) => page.getByRole("alertdialog", { name: title });

const setGold = (page: Page, gold: number) =>
  page.evaluate(value => { (window as any).__settlement.simulation.headquarters.inventory.gold = value; }, gold);
const readGold = (page: Page) =>
  page.evaluate(() => (window as any).__settlement.simulation.headquarters.inventory.gold as number);

const register = async (page: Page) => {
  await scroll(page).waitFor({ timeout: 60_000 });
  await shot(page, "1280-sign-in");
  await choose(page, /^Register$/);
  await page.getByRole("textbox", { name: /^Display name/ }).fill(ACCOUNT.displayName);
  await page.getByRole("textbox", { name: /^Email/ }).fill(ACCOUNT.email);
  await page.getByLabel(/^Password/).fill(ACCOUNT.password);
  await page.getByRole("radio", { name: "Viking" }).click();
  await shot(page, "1280-register");
  await page.getByRole("button", { exact: true, name: "Register" }).click();
};

const signIn = async (page: Page, prefix: string) => {
  await scroll(page).waitFor({ timeout: 60_000 });
  await page.getByRole("textbox", { name: /^Email/ }).fill(ACCOUNT.email);
  await page.getByLabel(/^Password/).fill(ACCOUNT.password);
  await shot(page, `${prefix}-sign-in`);
  await page.getByRole("button", { exact: true, name: "Sign in" }).click();
};

/** Tab A plays and saves; a reload continues the saved game without any question. */
const reviewDesktopFirstTab = async (context: BrowserContext, url: string) => {
  const page = await openPage(context, url);
  await register(page);
  await page.getByRole("heading", { name: "Choose a save slot" }).waitFor({ timeout: 60_000 });
  await shot(page, "1280-slots");
  await choose(page, /^Slot 1: empty/);
  await waitForGame(page);
  await setGold(page, 77);
  await saveGame(page);
  await waitForStatus(page, /^Saved online$/);
  await shot(page, "1280-saved");
  await page.reload();
  await waitForGame(page);
  check(await scroll(page).count() === 0, "a reload signs in silently and continues the tab's slot");
  check(await readGold(page) === 77, "the reload loads the saved game from the server");
  return page;
};

/** Tab B takes the session over; tab A is told, takes it back, and its stale save meets the conflict. */
const reviewTakeOverAndConflict = async (context: BrowserContext, url: string, tabA: Page, prefix: string) => {
  const tabB = await openPage(context, url);
  await tabB.getByRole("heading", { name: "Choose a save slot" }).waitFor({ timeout: 60_000 });
  await choose(tabB, /^Slot 1/);
  await tabB.getByRole("heading", { name: "Playing on another device" }).waitFor({ timeout: 60_000 });
  await shot(tabB, `${prefix}-take-over-question`);
  await choose(tabB, /^Take over here/);
  await waitForGame(tabB);
  await setGold(tabB, 88);
  await saveGame(tabB);
  await waitForStatus(tabB, /^Saved online$/);
  await tabA.bringToFront();
  await saveGame(tabA);
  await popup(tabA, "Playing on another device").waitFor({ timeout: 60_000 });
  await shot(tabA, `${prefix}-taken-over`);
  check(/playing elsewhere/.test(await statusText(tabA)), "the first tab shows it stopped saving online");
  await choose(tabA, /^Take the session back/);
  await popup(tabA, "This save changed on another device").waitFor({ timeout: 60_000 });
  await shot(tabA, `${prefix}-conflict`);
  await choose(tabA, /^Keep playing here and overwrite/);
  await waitForStatus(tabA, /^Saved online$/);
  await tabB.close();
};

const reviewPhone = async (browser: Browser, url: string, desktop: Page) => {
  const context = await newContext(browser, PHONE);
  const phone = await openPage(context, url);
  await signIn(phone, "420");
  await phone.getByRole("heading", { name: "Choose a save slot" }).waitFor({ timeout: 60_000 });
  await shot(phone, "420-slots");
  await choose(phone, /^Slot 1/);
  await phone.getByRole("heading", { name: "Playing on another device" }).waitFor({ timeout: 60_000 });
  await shot(phone, "420-take-over-question");
  await choose(phone, /^Take over here/);
  await waitForGame(phone);
  await saveGame(phone);
  await waitForStatus(phone, /^Saved online$/);
  await shot(phone, "420-saved");
  check(await readGold(phone) === 77, "another device loads the overwritten save");
  await reviewTakeOverAndConflict(context, url, phone, "420");
  await desktop.close();
  await context.close();
};

mkdirSync(OUT, { recursive: true });
const { server, url } = await startDevServer({ env: { VITE_API_URL: "http://127.0.0.1:3002",
  VITE_IDENTITY_URL: "http://127.0.0.1:3001" }, host: "127.0.0.1", port: ORIGIN_PORT });
const browser = await launchBrowser();
try {
  const desktop = await newContext(browser, DESKTOP);
  const tabA = await reviewDesktopFirstTab(desktop, url);
  await reviewTakeOverAndConflict(desktop, url, tabA, "1280");
  await reviewPhone(browser, url, tabA);
  console.log(`screenshots in ${OUT}`);
} finally {
  await browser.close();
  await server.close();
}
