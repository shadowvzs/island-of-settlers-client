import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { launchBrowser, startDevServer } from "../bench/browser";
import {
  aimPossessed, openFrozenPage, pinScene, stackHorizontally, stageFrozenSave
} from "../bench/frozen-frame-review";
import {
  assertRendererActive, CAPTURES, type DiffStats, enterPossessed, HIDE_UI, OWNER_SAVE, PARITY_VIEWPORT,
  type ParityRenderer, settleFrame, writeDiffPng
} from "../bench/parity-helpers";

/**
 * WG-VEG close vegetation review: possessed close-ups of a tree, a bush and lawn grass in the explored
 * owner town (S1 save; the seed-123 meadow is unexplored, so fog hides its props) under WebGL and the
 * WebGPU presenter, each as a wind strip (frozen frame at
 * successive times) and a walk strip (the eye stepping towards the subject), plus x16 diffs.
 * PARITY_RENDERERS picks the renderers, PARITY_QUERY adds page switches (`&season=winter`).
 *
 *   HEADED=1 WEBGPU=1 WEBGPU_ANGLE=vulkan OUTPUT_DIR=<captures>/webgpu-veg/close \
 *     <captures>/browser-slot.sh npx tsx tools/review/vegetation-parity.ts
 */
type SubjectKey = "bush" | "grass" | "tree";

interface Subject { distance: number; pitch: number; types: readonly number[] }

const OUT = resolve(process.env.OUTPUT_DIR ?? join(CAPTURES, "webgpu-veg", "close"));
const RENDERERS = (process.env.PARITY_RENDERERS?.split(",") ?? ["webgl", "webgpu"]) as ParityRenderer[];
/** Extra page query for every renderer, e.g. `&season=winter` for the winter crowns. */
const EXTRA_QUERY = process.env.PARITY_QUERY ?? "";
/** Frame times of the wind strip (s) and eye steps towards the subject of the walk strip (cells). */
const WIND_TIMES = [12, 12.4, 12.8, 13.2];
const WALK_STEPS = [0, 0.6, 1.2, 1.8];
/** Origin of the subject search (the S1 town view). */
const SEARCH_ORIGIN = { x: 170, z: 68 };
/** PROP types: trees, bushes; grass looks down at the lawn tufts beside the nearest tree. */
const SUBJECTS: Record<SubjectKey, Subject> = {
  bush: { distance: 3.2, pitch: -0.18, types: [3, 13, 16, 17] },
  grass: { distance: 2.6, pitch: -0.5, types: [0, 1, 18] },
  tree: { distance: 7, pitch: 0.12, types: [0, 1, 18] }
};

/** The nearest live prop of `types` to the search origin (the meadow point for grass). */
const findSubject = (page: Page, types: readonly number[]) => page.evaluate(({ origin, wanted }) => {
  const { props } = (window as any).__atmosphereLiveDebug.world;
  let best = origin, bestDistance = Infinity;
  for (let index = 0; index < props.count; index++) {
    if (!wanted.includes(props.types[index])) continue;
    const distance = Math.hypot(props.x[index] - origin.x, props.z[index] - origin.z);
    if (distance < bestDistance) { best = { x: props.x[index], z: props.z[index] }; bestDistance = distance; }
  }
  return best;
}, { origin: SEARCH_ORIGIN, wanted: [...types] });

/** Eye pose `distance - step` cells south-west of the subject, looking at it. */
const poseFor = (target: { x: number; z: number }, subject: Subject, step: number) => {
  const away = Math.max(subject.distance - step, 0.5) * Math.SQRT1_2;
  const x = target.x - away, z = target.z - away;
  return { pitch: subject.pitch, x, yaw: Math.atan2(target.x - x, target.z - z), z };
};

const setFrameTime = (page: Page, time: number) => page.evaluate(value => {
  const debug = (window as any).__atmosphereLiveDebug;
  debug.frozenFrame.time = value;
  debug.draw();
}, time);

const shoot = async (page: Page, file: string) => {
  await page.waitForTimeout(300);
  await page.screenshot({ clip: { height: PARITY_VIEWPORT.height, width: PARITY_VIEWPORT.width, x: 0, y: 0 },
    path: file });
  return file;
};

/** The wind and walk strips of one subject; returns the frame files in strip order. */
const captureSubject = async (page: Page, key: SubjectKey, label: string) => {
  const subject = SUBJECTS[key];
  const target = await findSubject(page, subject.types);
  const files: string[] = [];
  await aimPossessed(page, poseFor(target, subject, 0));
  await settleFrame(page);
  for (const [index, time] of WIND_TIMES.entries()) {
    await setFrameTime(page, time);
    files.push(await shoot(page, join(OUT, `${key}-wind${index}-${label}.png`)));
  }
  for (const [index, step] of WALK_STEPS.entries()) {
    await aimPossessed(page, poseFor(target, subject, step));
    await settleFrame(page, 2);
    files.push(await shoot(page, join(OUT, `${key}-walk${index}-${label}.png`)));
  }
  return files;
};

const captureRenderer = async (browser: Browser, url: string, renderer: ParityRenderer, saveText: string) => {
  const { errors, page } = await openFrozenPage(browser, url, {
    quality: "high", query: `&renderer=${renderer}&hdr=off${EXTRA_QUERY}`, stagedSave: stageFrozenSave(saveText),
    viewport: PARITY_VIEWPORT
  });
  try {
    await assertRendererActive(page, renderer);
    await pinScene(page, "day", true);
    await enterPossessed(page);
    await page.addStyleTag({ content: HIDE_UI });
    const shots: Partial<Record<SubjectKey, string[]>> = {};
    for (const key of Object.keys(SUBJECTS) as SubjectKey[]) shots[key] = await captureSubject(page, key, renderer);
    return { errors, shots };
  } finally {
    await page.close();
  }
};

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const errors: string[] = [];
  const results: Array<{ comparison: string; frame: string; stats: DiffStats }> = [];
  try {
    const saveText = readFileSync(OWNER_SAVE, "utf8");
    const byRenderer: Partial<Record<ParityRenderer, Partial<Record<SubjectKey, string[]>>>> = {};
    for (const renderer of RENDERERS) {
      const result = await captureRenderer(browser, url, renderer, saveText);
      byRenderer[renderer] = result.shots;
      errors.push(...result.errors.map(error => `${renderer}: ${error}`));
    }
    for (const key of Object.keys(SUBJECTS) as SubjectKey[]) {
      for (const renderer of RENDERERS)
        stackHorizontally(join(OUT, `${key}-strip-${renderer}.png`), byRenderer[renderer]![key]!);
      const reference = byRenderer.webgl?.[key];
      if (reference === undefined) continue;
      for (const renderer of RENDERERS.filter(value => value !== "webgl"))
        for (const [index, file] of byRenderer[renderer]![key]!.entries()) {
          const frame = file.split("/").pop()!.replace(`-${renderer}.png`, "");
          results.push({ comparison: renderer, frame,
            stats: await writeDiffPng(browser, reference[index]!, file,
              join(OUT, `diff-${frame}-${renderer}.png`)) });
        }
    }
    const lines = ["# WG-VEG close vegetation parity", "",
      "| Frame | Comparison | Changed % | Mean | Over 4 levels % |", "| --- | --- | --- | --- | --- |", ...results.map(({ comparison, frame, stats }) =>
        `| ${frame} | ${comparison} | ${stats.changedPixels.toFixed(3)} | ${stats.meanChannel.toFixed(3)} | ` +
        `${stats.overThreshold.toFixed(3)} |`)];
    writeFileSync(join(OUT, "vegetation-parity.md"), `${lines.join("\n")}\n`);
    writeFileSync(join(OUT, "vegetation-parity.json"), JSON.stringify({ errors, results }, null, 2));
    console.log(lines.join("\n"));
    assert.equal(errors.length, 0, `page errors:\n${errors.join("\n")}`);
  } finally {
    await browser.close();
    await server.close();
  }
};

main().catch(error => {
  console.error((error as Error).stack ?? error);
  process.exitCode = 1;
});
