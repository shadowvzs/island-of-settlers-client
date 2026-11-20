import type { Browser, Page } from "playwright-core";

import { observeMain, observeSettlementBoot } from "./observation-hooks";
import type { FullReport } from "./report";

export { observationHookHash } from "./observation-hooks";

/** Observation exposes existing objects; it does not alter update timing or gameplay results. */
export const createSession = async (
  browser: Browser, report: FullReport
) => {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 960 } });
  await context.addInitScript("window.__name = value => value;");
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.routeWebSocket("**/*", () => {});
  await page.route(/\/src\/app\/(?:main|island-runtime|island-settlement-boot)\.ts(?:\?|$)/, async route => {
    const response = await route.fetch();
    const source = await response.text();
    let observed: string;
    try {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith("/island-runtime.ts")) observed = observeMain(source);
      else if (pathname.endsWith("/island-settlement-boot.ts")) observed = observeSettlementBoot(source);
      else observed = source;
    } catch (error) {
      await route.abort();
      throw error;
    }
    await route.fulfill({ response, body: observed });
  });
  const append = (row: unknown) => {
    if (report.logs.length < 5000) report.logs.push(row);
    else report.metadata.logsTruncated = true;
  };
  page.on("pageerror", error => append({ kind: "pageerror", message: error.message, at: new Date().toISOString() }));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) append({ kind: message.type(), text: message.text() });
  });
  page.on("requestfailed", request => append({ kind: "requestfailed", url: request.url(), error: request.failure() }));
  page.on("response", response => {
    if (response.status() >= 400) append({ kind: "http", status: response.status(), url: response.url() });
    const type = response.headers()["content-type"] ?? "";
    if (type.includes("html") && ["script", "fetch", "xhr"].includes(response.request().resourceType()))
      append({ kind: "html-for-module", url: response.url() });
  });
  return { context, page };
};

export const waitForGame = async (page: Page) => {
  await page.waitForFunction(() => Boolean((window as any).__islandReady &&
    (window as any).__fullE2E?.settlement && (window as any).__fullWorldRestoreBoundary),
    undefined, { timeout: 600_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 600_000 });
};
