import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * TRG9 review: the map-script presentation on a fresh island through the dev hook `window.__scriptUi`: a waiting
 * highlight on the bottom-bar Build button, the quest window opened by a script on a chosen quest, the inbox with a
 * scripted mail, and the colony-lost notice; desktop and phone, English and Hungarian.
 *
 * Usage (browser via captures/browser-slot.sh, env file via `npx tsx --env-file=<file>`):
 *   OUTPUT_DIR=<dir> [LAYOUTS=desktop,phone] [LOCALES=en,hu] [QUALITY=high] npx tsx tools/bench/script-ui-review.ts
 */
const outputDir = process.env.OUTPUT_DIR;
assert(outputDir, "Set OUTPUT_DIR");
const layouts = (process.env.LAYOUTS ?? "desktop,phone").split(",");
const locales = (process.env.LOCALES ?? "en,hu").split(",");
const quality = process.env.QUALITY ?? "high";
const VIEWPORTS: Record<string, { height: number; width: number }> = {
  desktop: { height: 720, width: 1280 }, phone: { height: 844, width: 390 }
};
mkdirSync(outputDir, { recursive: true });

const MAIL = {
  attachments: { goods: [{ amount: 12, ware: "logs" }, { amount: 6, ware: "fish" }] },
  body: { en: "Captain, the harbour master of Seabright thanks you for the timber. He sends word that the "
    + "northern reefs are calm this season.", hu: "Kapitány, Seabright kikötőmestere köszöni a faanyagot. "
    + "Üzeni, hogy az északi zátonyok ebben az évszakban nyugodtak." },
  date: Date.UTC(2026, 10, 11, 9, 30), id: "mail:review:trigger-1:1.s2",
  title: { en: "A letter from the coast", hu: "Levél a partról" }
};
const HINT = { en: "Open the build menu", hu: "Nyisd meg az építés menüt" };

const hook = (page: Page, script: string) => page.evaluate(script);
const settle = (page: Page, ms = 700) => page.waitForTimeout(ms);
const shoot = (page: Page, name: string) => page.screenshot({ path: resolve(outputDir, `${name}.png`) });

const receive = (page: Page, effects: unknown[]) =>
  hook(page, `window.__scriptUi.presentation.receive(${JSON.stringify(effects)})`);

const closeAll = (page: Page) => hook(page, "window.__settlement?.closeWindows?.()");

const firstQuestId = (page: Page) => page.evaluate(() => {
  const player = (window as any).__settlement?.playerSession?.progress?.();
  return player?.quests?.[1]?.id ?? player?.quests?.[0]?.id ?? null;
});

const captureLayout = async (page: Page, label: string, locale: string) => {
  await receive(page, [{ highlight: { anchor: "bottomBar.build", effectId: "ui:1:s4:1", seconds: null,
    text: HINT, until: "clicked", waiting: false }, kind: "highlightUi" }]);
  await settle(page);
  await shoot(page, `${label}-highlight-build`);
  await receive(page, [{ kind: "clearHighlights" }, { highlight: { anchor: "build.tab.food",
    effectId: "ui:1:s6:2", seconds: 30, text: HINT, until: "seconds", waiting: false }, kind: "highlightUi" }]);
  await settle(page);
  await shoot(page, `${label}-highlight-fallback`);
  await receive(page, [{ kind: "clearHighlights" }]);
  const questId = await firstQuestId(page);
  await receive(page, [{ kind: "openUi", target: { kind: "quests", questId } }]);
  await settle(page, 1500);
  const selected = await page.evaluate(() =>
    document.querySelector(".quest-window [aria-selected='true']")?.getAttribute("data-quest-id") ?? null);
  await shoot(page, `${label}-quest-window`);
  await closeAll(page);
  await receive(page, [{ kind: "sendMail", mail: MAIL }]);
  await settle(page, 1200);
  await receive(page, [{ kind: "openUi", target: { kind: "messages", mailId: MAIL.id } }]);
  await settle(page, 1500);
  await shoot(page, `${label}-inbox-mail`);
  await closeAll(page);
  await hook(page, `window.__scriptUi.showColonyLost(${JSON.stringify([{ id: 4, name: "North Reach",
    ore: "iron" }])})`);
  await settle(page, 1200);
  await shoot(page, `${label}-colony-lost`);
  await hook(page, `window.__scriptUi.showColonyLost(${JSON.stringify([{ id: 4, name: "North Reach",
    ore: "iron" }, { id: 5, name: "Marble Cay", ore: "marble" }])})`);
  await settle(page, 1200);
  await shoot(page, `${label}-colony-lost-two`);
  return { locale, questId, selected };
};

const { server, url } = await startDevServer({ port: Number(process.env.PORT ?? 5231) });
const browser = launchBrowser();
const report: Record<string, unknown> = {};
try {
  for (const layout of layouts) for (const locale of locales) {
    const page = await (await browser).newPage({ locale, viewport: VIEWPORTS[layout] });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript(language => {
      (window as any).__name = (value: unknown) => value;
      try { localStorage.setItem("island-of-settlers.language", language); } catch { /* storage off */ }
    }, locale);
    await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1&reveal=1&size=128&seed=123&lang=${locale}`);
    await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    await page.waitForFunction(() => Boolean((window as any).__scriptUi), null, { timeout: 30000 });
    await settle(page, 6000);
    const label = `${layout}-${locale}`;
    report[label] = { ...(await captureLayout(page, label, locale)), errors };
    await page.close();
  }
} finally {
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));
  await (await browser).close();
  await server.close();
}
console.log(JSON.stringify(report, null, 2));
