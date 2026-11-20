/**
 * SETTINGS-COLLAPSE captures: the Graphics tab with the Visual features block collapsed and
 * expanded, on a desktop (1920x1080) and a phone (400x860) viewport. The same run logs the
 * panel's scroll layout, the fixed header/tab row and every select's chosen label, so a clipped
 * or empty value is visible in the report as well as in the images.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> npx tsx tools/bench/settings-collapse-captures.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { stageStartupSave } from "./frame-profile";

const save = JSON.parse(readFileSync(process.env.SAVE!, "utf8"));
const environment = save.runtime.environment;
// Freeze the sky so the collapsed and expanded images see the same light.
Object.assign(environment, { cycling: false, targetHour: environment.hour, weatherState: "clear" });
const saveText = JSON.stringify(save);
const output = resolve(process.env.OUTPUT_DIR!);
mkdirSync(output, { recursive: true });

const VIEWPORTS = [
  { height: 1080, name: "desktop-1920x1080", width: 1920 },
  { height: 860, name: "phone-400x860", width: 400 }
] as const;

const openIsland = async (url: string, viewport: { height: number; width: number }) => {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", error => console.log("pageerror", error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript(() => { (window as any).__name = (value: unknown) => value; });
  await stageStartupSave(page, url, saveText);
  await page.goto(`${url}?quality=high&cache=0&skipLogin=1`);
  await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: 240000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  await page.waitForTimeout(2000);
  return page;
};

const openGraphicsTab = async (page: Page) => {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".settings-panel:not([hidden])").getByRole("heading", { name: "Graphics" }).waitFor();
  await page.waitForTimeout(400);
};

/** The active tab's select values: a blank or clipped entry shows up here. */
const readSelects = (page: Page) => page.evaluate(() =>
  Array.from(document.querySelectorAll<HTMLSelectElement>(
    ".settings-panel:not([hidden]) .settings-panel__tab-content:not([hidden]) select"
  )).filter(select => select.getClientRects().length > 0).map(select => ({
    label: select.getAttribute("aria-label"),
    selectedText: select.selectedOptions[0]?.textContent ?? "",
    value: select.value,
    width: Math.round(select.getBoundingClientRect().width)
  })));

/** Panel and tab-row scroll metrics, with the fixed header/tab row positions before and after scrolling. */
const readLayout = async (page: Page) => {
  const content = page.locator(
    ".settings-panel:not([hidden]) .settings-panel__tab-content:not([hidden]):visible"
  ).first();
  const before = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".settings-panel:not([hidden])")!;
    const tabContent = panel.querySelector<HTMLElement>(".settings-panel__tab-content:not([hidden])")!;
    const header = panel.querySelector<HTMLElement>(".settings-panel__header")!;
    const tabs = panel.querySelector<HTMLElement>(".settings-panel__tabs")!;
    return {
      documentOverflowX: document.documentElement.scrollWidth > window.innerWidth,
      headerTop: Math.round(header.getBoundingClientRect().top),
      panelClientHeight: panel.clientHeight,
      panelScrollHeight: panel.scrollHeight,
      tabsTop: Math.round(tabs.getBoundingClientRect().top),
      tabClientHeight: tabContent.clientHeight,
      tabClientWidth: tabContent.clientWidth,
      tabScrollHeight: tabContent.scrollHeight,
      tabScrollWidth: tabContent.scrollWidth
    };
  });
  await content.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".settings-panel:not([hidden])")!;
    const header = panel.querySelector<HTMLElement>(".settings-panel__header")!;
    const tabs = panel.querySelector<HTMLElement>(".settings-panel__tabs")!;
    return {
      headerTop: Math.round(header.getBoundingClientRect().top),
      scrolled: Math.round(panel.querySelector<HTMLElement>(
        ".settings-panel__tab-content:not([hidden])")!.scrollTop),
      tabsTop: Math.round(tabs.getBoundingClientRect().top)
    };
  });
  return { afterScroll: after, beforeScroll: before };
};

const captureViewport = async (url: string, viewport: typeof VIEWPORTS[number]) => {
  const page = await openIsland(url, viewport);
  await openGraphicsTab(page);
  const headerButton = page.getByRole("button", { name: /Visual features/ });
  const content = page.locator(".settings-panel__collapsible-content");
  const headerStyles = await page.evaluate(() => {
    const read = (element: Element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundImage,
        border: style.border,
        boxShadow: style.boxShadow,
        outline: style.outline
      };
    };
    return {
      button: read(document.querySelector(".settings-panel__collapsible-toggle")!),
      heading: read(document.querySelector(".settings-panel__collapsible-heading")!)
    };
  });
  const collapsed = {
    ariaExpanded: await headerButton.getAttribute("aria-expanded"),
    contentVisible: await content.isVisible(),
    headerStyles,
    selects: await readSelects(page)
  };
  await page.screenshot({ path: resolve(output, `${viewport.name}-collapsed.png`) });
  await headerButton.click();
  await page.waitForTimeout(300);
  const expanded = {
    ariaExpanded: await headerButton.getAttribute("aria-expanded"),
    contentVisible: await content.isVisible(),
    selects: await readSelects(page)
  };
  await page.screenshot({ path: resolve(output, `${viewport.name}-expanded.png`) });
  const layout = await readLayout(page);
  await page.screenshot({ path: resolve(output, `${viewport.name}-expanded-scrolled.png`) });
  await page.close();
  return { collapsed, expanded, layout };
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const report: Record<string, unknown> = { save: process.env.SAVE };
try {
  for (const viewport of VIEWPORTS) {
    report[viewport.name] = await captureViewport(url, viewport);
    console.log(viewport.name, "captured");
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
