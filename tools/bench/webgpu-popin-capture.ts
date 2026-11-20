import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { stageStartupSave } from "./frame-profile";

/**
 * G-W5 pop-in evidence for the async pipeline compiler: opens the owner town (S1) on native WebGPU,
 * lets the simulation run after the loading screen and reads the WebGPU canvas every frame with
 * `canvas.toDataURL` inside `requestAnimationFrame` (page screenshots of the WebGPU canvas are blank
 * on this host). Writes `frames.json` (per frame: wall ms, objects hidden behind a compile, compiles
 * done) and a PNG for each frame around a hidden window. Run through `captures/browser-slot.sh`:
 *   npx tsx --env-file=<file> tools/bench/webgpu-popin-capture.ts   (WEBGPU=1, WEBGPU_ANGLE=vulkan, OUT, SAVE)
 */

const CAPTURES = process.env.CAPTURES ??
  "/media/shadowvzs/a3016bc8-b7d7-4116-b510-dad892792829/home/shadowvzs/worktree/captures";
const SAVE = process.env.SAVE ?? join(CAPTURES, "perf", "owner-laggy-2026-11-07.json");
const OUT = resolve(process.env.OUT ?? join(CAPTURES, "webgpu-async-compile", "popin"));
const FRAMES = Number(process.env.FRAMES ?? 150);
const ZOOM = Number(process.env.ZOOM ?? .75);
/** IMAGES=0 records frame gaps only (no `toDataURL` readback stalling the frames). */
const IMAGES = process.env.IMAGES !== "0";
/** Frames kept as PNG before and after each frame with a hidden object. */
const CONTEXT_FRAMES = 2;
const TIMEOUT_MS = 240_000;

interface FrameRecord {
  completed: number;
  /** Wall time since the previous animation frame. */
  frameMs: number;
  hidden: number;
  hiddenObjects: string[];
  image: string;
}

const openTown = async (page: Page, url: string) => {
  await stageStartupSave(page, url, readFileSync(SAVE, "utf8"), true);
  const params = new URLSearchParams({ cache: "0", quality: "high", renderer: "webgpu", skipLogin: "1",
    view: "170,38,0.85" });
  // URL_EXTRA: more query parameters, e.g. `idlePrewarm=off` (DEV) to isolate the draw-time gate.
  for (const [key, value] of new URLSearchParams(process.env.URL_EXTRA ?? "")) params.set(key, value);
  await page.goto(`${url}?${params}`);
  await page.waitForFunction(() => (globalThis as any).__islandReady === true, null, { timeout: TIMEOUT_MS });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: TIMEOUT_MS });
  await page.evaluate(zoom => (globalThis as any).__settlement?.focusGround?.(170, 68, zoom), ZOOM);
};

/**
 * One record per animation frame: the canvas pixels and the async compiler's counters. A source
 * string, because tsx would inject its `__name` helper into a named in-page function.
 */
const RECORD_FRAMES = `(count, images) => new Promise(done => {
  const canvas = document.getElementById("webgpu-view");
  const records = [];
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const stats = globalThis.__webgpuSpike?.stats?.();
    records.push({ completed: stats?.asyncCompile?.completed ?? 0, frameMs: now - last,
      image: images ? canvas.toDataURL("image/png") : "", hidden: stats?.asyncCompile?.hidden ?? 0,
      hiddenObjects: stats?.asyncCompile?.hiddenObjects ?? [] });
    last = now;
    if (records.length >= count) done(records);
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})`;

const recordFrames = (page: Page) =>
  page.evaluate(`(${RECORD_FRAMES})(${FRAMES}, ${IMAGES})`) as Promise<FrameRecord[]>;

const keptFrames = (records: readonly FrameRecord[]) => {
  const kept = new Set<number>();
  records.forEach((record, index) => {
    if (record.hidden === 0) return;
    for (let offset = -CONTEXT_FRAMES; offset <= CONTEXT_FRAMES; offset++) kept.add(index + offset);
  });
  return [...kept].filter(index => index >= 0 && index < records.length).sort((a, b) => a - b);
};

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await openTown(page, url);
    const records = await recordFrames(page);
    const compileStats = await page.evaluate(() => (globalThis as any).__webgpuSpike?.stats?.()?.asyncCompile);
    const kept = IMAGES ? keptFrames(records) : [];
    for (const index of kept) {
      const png = Buffer.from(records[index]!.image.split(",")[1]!, "base64");
      writeFileSync(join(OUT, `frame-${String(index).padStart(3, "0")}.png`), png);
    }
    const summary = records.map(({ completed, frameMs, hidden, hiddenObjects }, index) =>
      ({ completed, frameMs, hidden, hiddenObjects, index }));
    writeFileSync(join(OUT, "frames.json"), JSON.stringify(summary, null, 2));
    const hidden = summary.filter(frame => frame.hidden > 0);
    const gaps = summary.slice(1).map(frame => frame.frameMs).sort((a, b) => a - b);
    console.log(`frames ${records.length}, frames with hidden objects ${hidden.length}, ` +
      `kept PNGs ${kept.length}, max hidden ${Math.max(0, ...hidden.map(frame => frame.hidden))}, ` +
      `frame gap median ${gaps[gaps.length >> 1]?.toFixed(1)} ms, worst ${gaps.at(-1)?.toFixed(1)} ms, ` +
      `second worst ${gaps.at(-2)?.toFixed(1)} ms, longest async build ` +
      `${Number(compileStats?.longestBuildMs ?? 0).toFixed(1)} ms`);
  } finally {
    await browser.close();
    await server.close();
  }
};

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
