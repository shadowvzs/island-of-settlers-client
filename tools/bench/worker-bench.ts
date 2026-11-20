import { mkdir, writeFile } from "node:fs/promises";
import type { Browser, Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/** Results of the worker gameplay checks (game behaviour, so they live in this repository). */
export const WORKER_BENCH_OUTPUT = "../docs/terrain-benchmarks/worker-gameplay";

/** One run: the page with the map open, the game URL and the collected errors. */
export interface WorkerBenchRun {
  errors: string[];
  page: Page;
  url: string;
}

/** Vite's hot updates would reload the page mid check while other files change: drop them. */
const ignoreHotReloads = (page: Page) =>
  page.routeWebSocket("**", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      if (typeof message === "string") {
        try {
          if (["update", "full-reload"].includes(JSON.parse(message).type)) return;
        } catch {
          // Not a JSON message: pass it on.
        }
      }
      socket.send(message);
    });
  });

/** A page that records page errors and console errors (the favicon 404 aside). */
const createWorkerPage = async (browser: Browser) => {
  const page = await browser.newPage({ viewport: { height: 1000, width: 1400 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    const isFavicon = message.location().url.endsWith("/favicon.ico");
    if (message.type() === "error" && !isFavicon) errors.push(message.text());
  });
  await ignoreHotReloads(page);
  return { errors, page };
};

/** Opens the island map with the query and waits for the island and the worker. */
export const openWorkerMap = async (page: Page, url: string, query: string) => {
  await page.goto(`${url}?${query}`);
  await page.waitForFunction(() => window.__islandReady && window.__worker, undefined, {
    timeout: 120000
  });
  await page.evaluate(() => {
    const overlay = document.querySelector<HTMLElement>(".stats-overlay");
    if (overlay) overlay.hidden = true;
  });
};

/** Clicks the worker and waits until it is selected. */
export const selectWorker = async (page: Page) => {
  const viewport = (await page.locator("#viewport").boundingBox())!;
  const point = await page.evaluate(() => window.__worker!.project());
  await page.mouse.click(point.x + viewport.x, point.y + viewport.y);
  await page.waitForFunction(() => window.__worker!.getState().selected);
};

/**
 * Runs a worker gameplay check on the game's own dev server, writes the result as
 * `<name>-validation.json` into WORKER_BENCH_OUTPUT and returns it.
 */
export const runWorkerBench = async <T>(
  name: string,
  check: (run: WorkerBenchRun) => Promise<T>
) => {
  await mkdir(WORKER_BENCH_OUTPUT, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  try {
    const { errors, page } = await createWorkerPage(browser);
    const result = await check({ errors, page, url });
    const file = `${WORKER_BENCH_OUTPUT}/${name}-validation.json`;
    await writeFile(file, JSON.stringify(result, null, 2));
    return result;
  } finally {
    await browser.close();
    await server.close();
  }
};
