/**
 * Traffic-wear review (wear-2, owner 2026-11-07): loads a save, advances the simulation several
 * in-game minutes, then captures the same iso views with traffic wear ON and OFF on each detail
 * level, plus OFF | ON side-by-side compares and the measured frame cost of both.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [MINUTES=6] [QUALITIES=high,minimal] [FOCUS=ground|rut|x,z]
 *   [PREFIX=desire] [UNCAPPED=1] [CLOSE_ZOOM=2.6] [WEAR_RUNS=on] [GROUND=full|lite]
 *   [FADE_UPDATES=400] npx tsx tools/bench/traffic-wear-capture.ts
 *
 * FOCUS=ground centres on the strongest desire-path area, FOCUS=rut on the busiest dirt-road ruts
 * (both found in the ON run and reused for the OFF run), `x,z` on a fixed world point.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { installFrameProfiler, readFrameProfile, resetFrameProfile, stageStartupSave } from "./frame-profile";

const save = readFileSync(process.env.SAVE!, "utf8");
const output = resolve(process.env.OUTPUT_DIR!);
const minutes = Number(process.env.MINUTES ?? 6);
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const focusMode = process.env.FOCUS ?? "ground";
const prefix = process.env.PREFIX ?? "desire";
/** The owner's saved gameplay zoom (1.46) and a close look (`CLOSE_ZOOM`, default 2.6). */
const VIEWS = [["normal", 1.46], ["close", Number(process.env.CLOSE_ZOOM ?? 2.6)]] as const;
/** `WEAR_RUNS=on` skips the OFF run (tuning only; no compare images). */
const wearRuns = process.env.WEAR_RUNS === "on" ? [true] : [true, false];
/** Optional `GROUND=full|lite` forces a terrain shader for the review (auto by default). */
const ground = process.env.GROUND ? `&ground=${process.env.GROUND}` : "";
/** Optional `FADE_UPDATES`: advance only the wear source decay, then capture a later frame. */
const fadeUpdates = Number(process.env.FADE_UPDATES ?? 0);
const TICKS_PER_MINUTE = 1200;
const OVERRIDES_KEY = "island-of-settlers.graphics.overrides";
mkdirSync(output, { recursive: true });

type Focus = { x: number; z: number; score: number };

/** Exposes the wear field (island-settlement.ts) to the page; the camera comes from frame-profile. */
const exposeWearField = (page: Page) => page.route("**/src/app/settlement/island-settlement.ts", async route => {
  const response = await route.fetch(), text = await response.text();
  if (!text.includes("const trafficWear = ")) throw new Error("trafficWear source not found");
  await route.fulfill({ response, body: text.replace("const trafficWear = ", "const trafficWear = globalThis.__wearField = ") });
});

const openIsland = async (url: string, quality: string, wear: boolean) => {
  const page = await browser.newPage({ viewport: { height: 900, width: 1400 } });
  page.on("pageerror", error => console.log("pageerror", error.message));
  page.on("console", line => { if (line.type() === "error") console.log("console-error", line.text().split("\n").filter(text => text.includes("ERROR") || text.includes("failed")).join(" | ").slice(0, 1500)); });
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript(({ key, wear }) => {
    (window as any).__name = (value: unknown) => value;
    localStorage.setItem(key, wear ? "{}" : JSON.stringify({ trafficWear: false }));
  }, { key: OVERRIDES_KEY, wear });
  await installFrameProfiler(page);
  await exposeWearField(page);
  await stageStartupSave(page, url, save);
  await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1${ground}`);
  await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: 240000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  await page.waitForTimeout(3000);
  return page;
};

/**
 * Advances in 20-tick batches and yields a render frame between them. The wear source reads the
 * drawn hand-cart frames, which the render loop refreshes between batches; one tight update block
 * would leave every cart frame stale and no wheel contact would move.
 */
const advance = async (page: Page) => {
  for (let minute = 0; minute < minutes; minute++) {
    await page.evaluate(async ticks => {
      const simulation = (window as any).__settlement.simulation;
      for (let done = 0; done < ticks; done += 20) {
        for (let tick = 0; tick < Math.min(20, ticks - done); tick++) simulation.update(.05);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
    }, TICKS_PER_MINUTE);
    await page.waitForTimeout(700);
  }
};

/** Strongest 12 x 12-cell window of a field channel (0 ground, 1 ruts) and field statistics. */
const findFocus = (page: Page, channel: number) => page.evaluate(channel => {
  const field = (window as any).__wearField, block = 12;
  if (!field) return undefined;
  let best = { score: 0, x: 0, z: 0 }, nonZero = 0, max = 0;
  for (let z0 = 0; z0 < field.height; z0 += block / 2) for (let x0 = 0; x0 < field.width; x0 += block / 2) {
    let score = 0;
    for (let z = z0; z < Math.min(field.height, z0 + block); z++) for (let x = x0; x < Math.min(field.width, x0 + block); x++) {
      score += field.pixels[(z * field.width + x) * 4 + channel];
    }
    if (score > best.score) best = { score, x: x0 + block / 2, z: z0 + block / 2 };
  }
  for (let index = channel; index < field.pixels.length; index += 4) {
    if (field.pixels[index]) { nonZero++; max = Math.max(max, field.pixels[index]); }
  }
  return { ...best, max, nonZero, revision: field.revision };
}, channel);

/** The raw RGBA8 field (width x height x 4 bytes, row-major) for offline inspection. */
const dumpField = async (page: Page, path: string) => {
  const bytes = await page.evaluate(() => {
    const field = (window as any).__wearField;
    return field ? Array.from(field.pixels as Uint8Array) : [];
  });
  writeFileSync(path, Uint8Array.from(bytes));
};

const parseFixedFocus = (): Focus | undefined => {
  const [x, z] = focusMode.split(",").map(Number);
  return Number.isFinite(x) && Number.isFinite(z) ? { score: 0, x: x!, z: z! } : undefined;
};

const captureViews = async (page: Page, quality: string, wear: boolean, focus: Focus, suffix = "") => {
  const shots: Record<string, Buffer> = {};
  for (const [name, zoom] of VIEWS) {
    await page.evaluate(({ focus, zoom }) => Object.assign((window as any).__ownerCamera,
      { centerX: focus.x, centerZ: focus.z, tilt: 0, yaw: 0, zoom }), { focus, zoom });
    await page.waitForTimeout(1500);
    const path = resolve(output, `${prefix}-${quality}-${name}-wear${wear ? 1 : 0}${suffix}.png`);
    shots[name] = await page.screenshot({ path });
  }
  return shots;
};

const measureFrames = async (page: Page) => {
  await page.evaluate(zoom => Object.assign((window as any).__ownerCamera, { zoom }), VIEWS[0][1]);
  await page.waitForTimeout(1000);
  await resetFrameProfile(page);
  await page.waitForTimeout(6000);
  const { stats } = await readFrameProfile(page);
  return { cpuMs: stats.cpuMs, fps: stats.averageFps, gpuMs: stats.gpuMs };
};

const compose = async (left: Buffer, right: Buffer, path: string, label: string) => {
  const page = await browser.newPage({ viewport: { height: 960, width: 2800 } });
  const image = (buffer: Buffer) => `data:image/png;base64,${buffer.toString("base64")}`;
  const rows: [string, Buffer][] = [["OFF", left], ["ON", right]];
  await page.setContent(`<body style="margin:0;background:#111;color:#eee;font:20px sans-serif">
    <div style="display:flex">${rows.map(([name, buffer]) =>
      `<figure style="margin:0"><figcaption style="height:60px;line-height:60px;padding-left:12px">${label} — wear ${name}</figcaption>
       <img src="${image(buffer)}" style="display:block;width:1400px"></figure>`).join("")}</div></body>`);
  await page.screenshot({ path });
  await page.close();
};

const { server, url } = await startDevServer();
const browser = await launchBrowser(process.env.UNCAPPED === "1");
const report: Record<string, unknown> = { focusMode, minutes, save: process.env.SAVE };
try {
  for (const quality of qualities) {
    let focus = parseFixedFocus();
    const shots: Record<string, Record<string, Buffer>> = {};
    for (const wear of wearRuns) {
      const page = await openIsland(url, quality, wear);
      await advance(page);
      if (wear) {
        const found = await findFocus(page, focusMode === "rut" ? 1 : 0);
        report[`${quality}-field`] = found;
        await dumpField(page, resolve(output, `${prefix}-${quality}-field.bin`));
        focus ??= found ?? { score: 0, x: 0, z: 0 };
      }
      shots[String(wear)] = await captureViews(page, quality, wear, focus!);
      report[`${quality}-wear${wear ? 1 : 0}-frames`] = await measureFrames(page);
      if (wear && fadeUpdates > 0) {
        const revision = await page.evaluate(updates => {
          const field = (window as any).__wearField;
          for (let update = 0; update < updates; update++) field.update();
          return field.revision;
        }, fadeUpdates);
        await page.waitForTimeout(1200);
        report[`${quality}-fade-revision`] = revision;
        await captureViews(page, quality, wear, focus!, "-fade");
      }
      console.log(quality, wear, JSON.stringify(report));
      await page.close();
    }
    if (!shots.false) continue;
    for (const [name] of VIEWS) {
      await compose(shots.false![name]!, shots.true![name]!,
        resolve(output, `compare-${prefix}-${quality}-${name}.png`), `${prefix} ${quality} ${name}`);
    }
  }
  writeFileSync(resolve(output, `${prefix}-report.json`), JSON.stringify(report, null, 2));
} finally { await browser.close(); await server.close(); }
