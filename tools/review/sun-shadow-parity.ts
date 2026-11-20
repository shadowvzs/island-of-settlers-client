import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { launchBrowser, startDevServer } from "../bench/browser";
import { openFrozenPage, pinScene, stackHorizontally, stageFrozenSave } from "../bench/frozen-frame-review";
import {
  assertRendererActive, CAPTURES, type DiffStats, HIDE_UI, OWNER_SAVE, PARITY_VIEWPORT, type ParityRenderer,
  settleFrame, writeDiffPng
} from "../bench/parity-helpers";

/**
 * C-1 sun shadow review: the same frozen iso frames under WebGL High and Ultra (native WebGPU, or
 * `webgpu-gl`), read straight from each canvas inside an animation frame (`toDataURL`; native
 * WebGPU page screenshots are blank on this host), with an x16 diff and a side-by-side sheet.
 * A `pan` shot pair moves the camera by a fraction of a cell to expose shadow shimmer.
 *
 *   env file: WEBGPU=1 WEBGPU_ANGLE=vulkan OUTPUT_DIR=<captures>/webgpu-c1/<step>
 *   <captures>/browser-slot.sh npx tsx --env-file=<file> tools/review/sun-shadow-parity.ts
 *
 * SHADOW_SHOTS limits the shots (comma list of names), SHADOW_RENDERERS the renderers; SHADOW_QUERY
 * appends to the page query; SHADOW_SPOTS adds named day shots (`spotsOf`).
 */
interface Shot {
  /** Iso centre (cells), zoom and tilt. */
  center: readonly [number, number];
  hour: string;
  name: string;
  tilt?: number;
  zoom: number;
}

/** Extra shots: `name@x,z@zoom[@hour];...` (cells), e.g. `forest@120,90@1.4;shore-dusk@170,155@0.5@dusk`. */
const spotsOf = (spec: string | undefined): Shot[] => (spec ?? "").split(";").filter(Boolean).map(entry => {
  const [name, center, zoom, hour] = entry.split("@");
  const [x, z] = center!.split(",").map(Number);
  return { center: [x!, z!], hour: hour ?? "day", name: name!, zoom: Number(zoom ?? 1.4) };
});

const SHOTS: readonly Shot[] = [
  { center: [170, 68], hour: "day", name: "town", zoom: 0.75 },
  { center: [170, 68], hour: "day", name: "town-close", zoom: 2.2 },
  { center: [170.37, 68.21], hour: "day", name: "town-close-pan", zoom: 2.2 },
  { center: [170, 68], hour: "dusk", name: "town-dusk", zoom: 0.75 },
  { center: [170, 68], hour: "day", name: "overview", zoom: 0.4 },
  ...spotsOf(process.env.SHADOW_SPOTS)
];

const OUT = resolve(process.env.OUTPUT_DIR ?? join(CAPTURES, "webgpu-c1", "review"));
const ONLY = process.env.SHADOW_SHOTS?.split(",");
/** SHADOW_HDR=preset keeps the preset's scene target (WebGL bloom/AO/exposure); `off` by default. */
const HDR_QUERY = process.env.SHADOW_HDR === "preset" ? "" : `&hdr=${process.env.SHADOW_HDR ?? "off"}`;
const RENDERERS = (process.env.SHADOW_RENDERERS?.split(",") ?? ["webgl", "webgpu"]) as ParityRenderer[];

const freezeAt = (page: Page, shot: Shot) => page.evaluate(({ center, tilt, zoom }) => {
  const debug = (globalThis as any).__atmosphereLiveDebug;
  debug.freeze();
  const frame = debug.frozenFrame;
  Object.assign(frame.camera, { centerX: center[0], centerZ: center[1], tilt, yaw: 0, zoom });
  frame.time = 12;
  debug.stripDynamic(frame);
  debug.frozenFrame = frame;
  debug.draw();
}, { center: shot.center, tilt: shot.tilt ?? 0, zoom: shot.zoom });

/** Draws once inside an animation frame and reads the presented canvas in the same task. */
const readCanvas = (page: Page) => page.evaluate(() => new Promise<string>(done => requestAnimationFrame(() => {
  (globalThis as any).__atmosphereLiveDebug.draw();
  const canvas = (document.querySelector<HTMLCanvasElement>("canvas#webgpu-view") ??
    document.querySelector<HTMLCanvasElement>("canvas#view"))!;
  done(canvas.toDataURL("image/png"));
})));

const shadowStats = (page: Page) => page.evaluate(() =>
  (globalThis as { __webgpuSpike?: { stats(): { sunShadow?: unknown } } }).__webgpuSpike?.stats().sunShadow ?? null);

/** One page per renderer: every shot is pinned, frozen and read in turn. */
const captureAll = async (browser: Browser, url: string, shots: readonly Shot[], renderer: ParityRenderer,
  saveText: string) => {
  const { errors, page } = await openFrozenPage(browser, url, {
    quality: "high",
    query: `&renderer=${renderer}${HDR_QUERY}${process.env.SHADOW_QUERY ?? ""}`,
    stagedSave: stageFrozenSave(saveText),
    viewport: PARITY_VIEWPORT
  });
  const shadow: Record<string, unknown> = {};
  try {
    await assertRendererActive(page, renderer);
    await page.addStyleTag({ content: HIDE_UI });
    for (const shot of shots) {
      await pinScene(page, shot.hour, true);
      await freezeAt(page, shot);
      await settleFrame(page);
      const data = await readCanvas(page);
      writeFileSync(join(OUT, `${shot.name}-${renderer}.png`), Buffer.from(data.split(",")[1]!, "base64"));
      shadow[shot.name] = await shadowStats(page);
    }
    return { errors, shadow };
  } finally {
    await page.close();
  }
};

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const saveText = readFileSync(process.env.SHADOW_SAVE ?? OWNER_SAVE, "utf8");
  const shots = SHOTS.filter(entry => ONLY === undefined || ONLY.includes(entry.name));
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const errors: string[] = [];
  const shadow: Record<string, unknown> = {};
  const results: Array<{ comparison: string; shot: string; stats: DiffStats }> = [];
  try {
    for (const renderer of RENDERERS) {
      const result = await captureAll(browser, url, shots, renderer, saveText);
      errors.push(...result.errors.map(error => `${renderer}: ${error}`));
      shadow[renderer] = result.shadow;
    }
    for (const shot of RENDERERS.length < 2 ? [] : shots) {
      const files = RENDERERS.map(renderer => join(OUT, `${shot.name}-${renderer}.png`));
      const stats = await writeDiffPng(browser, files[0]!, files[1]!, join(OUT, `diff-${shot.name}.png`));
      stackHorizontally(join(OUT, `sheet-${shot.name}.png`), files);
      results.push({ comparison: RENDERERS.join("-vs-"), shot: shot.name, stats });
    }
    writeFileSync(join(OUT, "sun-shadow-parity.json"), JSON.stringify({ errors, generatedAt: new Date().toISOString(),
      results, shadow }, null, 2));
    console.log(JSON.stringify({ results, shadow }, null, 2));
    if (errors.length > 0) console.log(`Page errors:\n${errors.join("\n")}`);
    console.log(`Sun shadow review: ${OUT}`);
  } finally {
    await browser.close();
    await server.close();
  }
};

main().catch(error => {
  console.error((error as Error).stack ?? error);
  process.exitCode = 1;
});
