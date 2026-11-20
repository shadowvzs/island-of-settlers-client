/**
 * A mixed crowd of the Tripo3D workers of all four nations (debug bodies per worker): two
 * walk, three chop (debug standing action). One screenshot plus the
 * download size of each worker's files, into docs/terrain-benchmarks/tripo-workers-2026-10-07/
 * (OUT_DIR to change it). WORKER_COLOR=<palette id> (red, yellow, ...) sets the team colour.
 *   npx tsx tools/bench/worker-crowd-nations.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { openWorkerMap } from "./worker-bench";

const OUTPUT = process.env.OUT_DIR ?? "../docs/terrain-benchmarks/tripo-workers-2026-10-07";
const MAP = "size=64&seed=42&cache=0&time=day";
/** Every nation, women and men (the bodies of the last team mask fixes among them). */
const CROWD = [
  { nation: "roman", variant: "roman-woman-olive" },
  { nation: "viking", variant: "viking-man-blond" },
  { nation: "japanese", variant: "japanese-man-grey" },
  { nation: "nubian", variant: "nubian-man-scarf" },
  { nation: "japanese", variant: "japanese-man-trousers" }
] as const;
/** Settings > Workers colour (graphics-settings.ts), the palette id of WORKER_COLOR. */
const WORKER_COLOR_KEY = "island-of-settlers.worker-color";
const WALKERS = [0, 3];
const CHOPPERS = [1, 2, 4];
const ZOOM_WHEEL = -1600;
const WALK_DISTANCE = 4;

const groupCenter = (page: Page) =>
  page.evaluate(() => {
    const states = window.__workers!.getStates();
    const x = states.reduce((sum, state) => sum + state.x, 0) / states.length;
    const z = states.reduce((sum, state) => sum + state.z, 0) / states.length;
    return { x, z };
  });

const zoomOnGroup = async (page: Page) => {
  const center = await groupCenter(page);
  const point = await page.evaluate((c) => window.__worker!.projectGround(c.x, c.z), center);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, ZOOM_WHEEL);
  await page.waitForTimeout(800);
};

/** Sends the walkers to the first accepted spot on a ring around the group. */
const sendWalkers = async (page: Page) => {
  const center = await groupCenter(page);
  await page.evaluate((walkers) => window.__workers!.select(walkers), WALKERS);
  for (let step = 0; step < 16; step++) {
    const angle = (step / 16) * Math.PI * 2;
    const x = center.x + Math.cos(angle) * WALK_DISTANCE;
    const z = center.z + Math.sin(angle) * WALK_DISTANCE;
    if (await page.evaluate((goal) => window.__workers!.command(goal.x, goal.z), { x, z })) return;
  }
  throw new Error("no walkable target near the group");
};

/** Downloaded bytes of the worker files, per worker folder. */
const readWorkerDownloads = (page: Page) =>
  page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry as PerformanceResourceTiming)
      .filter((entry) => new URL(entry.name).pathname.startsWith("/workers/"))
      .map((entry) => ({
        bytes: entry.encodedBodySize,
        file: new URL(entry.name).pathname.slice("/workers/".length),
        ms: Math.round(entry.duration)
      }))
  );

const shoot = async (page: Page, url: string, errors: string[]) => {
  await openWorkerMap(page, url, MAP);
  if (!(await page.evaluate((crowd) => window.__workers!.setAppearances(crowd), CROWD)))
    throw new Error("the crowd's bodies were not replaced");
  await page.evaluate((choppers) => {
    for (const index of choppers) window.__workers!.setStandingAction(index, "chop_tree");
  }, CHOPPERS);
  await zoomOnGroup(page);
  await sendWalkers(page);
  await page.waitForTimeout(1800);
  await page.evaluate(() => window.__workers!.select([]));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUTPUT}/worker-crowd-nations.png` });
  const states = await page.evaluate(() => window.__workers!.getStates());
  return {
    downloads: await readWorkerDownloads(page),
    errors: [...errors],
    workers: states.map(({ action, nation, variant }) => ({ action, nation, variant }))
  };
};

await mkdir(OUTPUT, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { height: 900, width: 1400 } });
  // The dev server loads hundreds of modules: room for the worker files' timing entries.
  await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
  const color = process.env.WORKER_COLOR;
  if (color)
    await page.addInitScript(
      ([key, id]) => localStorage.setItem(key!, id!),
      [WORKER_COLOR_KEY, color]
    );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    const isFavicon = message.location().url.endsWith("/favicon.ico");
    if (message.type() === "error" && !isFavicon) errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  const result = await shoot(page, url, errors);
  const file = `${OUTPUT}/worker-crowd-nations-validation.json`;
  await writeFile(file, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ errors: result.errors }));
} finally {
  await browser.close();
  await server.close();
}
