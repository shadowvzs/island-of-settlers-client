import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { launchBrowser, startDevServer } from "../bench/browser";
import { centreOn, type LiveWindow, openDecorReviewPage, settleDecorations } from "../bench/decor-review-session";
import { type FlatIslandPlot, openFixturePage, writeFlatIslandGame } from "../bench/flat-island-fixture";

/**
 * Lamp night-glow matrix: the Nubian woodcutter wall lamp and the Japanese headquarters stone
 * lantern, close and at gameplay distance, day and night, WebGL and `webgpu-gl`.
 *
 *   OUTPUT_DIR=<captures>/building-lamp-glow/before <captures>/browser-slot.sh \
 *     npx tsx --env-file=<file> tools/review/lamp-glow-captures.ts
 */

const outputDir = process.env.OUTPUT_DIR;
assert(outputDir, "Set OUTPUT_DIR");
const RENDERERS = (process.env.LAMP_RENDERERS ?? "webgl,webgpu-gl").split(",") as
  ("webgl" | "webgpu-gl")[];
const HOURS = (process.env.LAMP_HOURS ?? "day,night").split(",");
const shotsDir = resolve(outputDir, "shots");
mkdirSync(shotsDir, { recursive: true });

type LampSubject = {
  label: string;
  level: number;
  nation: "japanese" | "nubian";
  typeId: number;
};

const ALL_SUBJECTS: readonly LampSubject[] = [
  { label: "nubian-woodcutter-l1", level: 1, nation: "nubian", typeId: 17 },
  { label: "japanese-hq-l4", level: 4, nation: "japanese", typeId: 0 }
];
const SUBJECTS = ALL_SUBJECTS.filter(subject => !process.env.LAMP_SUBJECTS ||
  process.env.LAMP_SUBJECTS.split(",").includes(subject.label));

/** Fixture cells seen by the building review tools: a row south of the fixture headquarters. */
const PLOT = { x: 56, z: 30 } as const;

/** Exposes the building scene so the capture can aim at the lamp mesh, not a guessed offset. */
const observeScene = (page: Page) => page.route(
  "**/src/renderers/three/buildings/three-buildings.ts*", async route => {
    const response = await route.fetch(), source = await response.text();
    const anchor = "const scene = new Scene();";
    assert(source.includes(anchor), "Missing building scene anchor");
    await route.fulfill({ response, body: source.replace(anchor,
      `${anchor} globalThis.__lampScene = scene;`) });
  });

/** World centre of the amber lamp mesh under the building root, found from the live scene graph. */
const lampPointOf = (page: Page, rootName: string) => page.evaluate(rootName => {
  const scene = (window as LiveWindow).__lampScene;
  let found: { x: number; y: number; z: number } | null = null;
  scene.traverse((object: any) => {
    if (found || !object.isMesh || object.userData.buildingSurface !== "amber") return;
    let ancestor = object;
    while (ancestor && ancestor.name !== rootName) ancestor = ancestor.parent;
    if (!ancestor) return;
    object.geometry.computeBoundingBox();
    const centre = object.position.clone();
    object.geometry.boundingBox.getCenter(centre);
    object.localToWorld(centre);
    found = { x: centre.x, y: centre.y, z: centre.z };
  });
  if (!found) throw new Error(`No amber lamp mesh under ${rootName}`);
  return found;
}, rootName);

const pageHideUi = (page: Page) => page.addStyleTag({ content:
  "#viewport > :not(#view, #webgpu-view, #loading-screen) { display: none !important; }" });

const setYaw = (page: Page, quarter: number) => page.evaluate(value => {
  (window as LiveWindow).__decorLive.camera.yaw = value * Math.PI / 2;
}, quarter);

const capture = async (page: Page, name: string,
  clip?: { height: number; width: number; x: number; y: number }) => {
  await settleDecorations(page, 30);
  await page.waitForTimeout(180);
  await page.screenshot({ clip, path: resolve(shotsDir, `${name}.png`) });
  console.log("shot", name);
};

const frame = async (page: Page, site: { x: number; z: number }, zoom: number, lift: number) => {
  await centreOn(page, site, zoom, lift);
  await settleDecorations(page, 30);
};

const lampCrop = async (page: Page, point: { x: number; y: number; z: number }) => {
  const projected = await page.evaluate(({ x, y, z }) =>
    (window as LiveWindow).__settlement.project(x, y, z) as { x: number; y: number } | null, point);
  if (!projected) throw new Error("Lamp is outside the viewport");
  return {
    height: 320,
    width: 480,
    x: Math.max(0, Math.round(projected.x - 240)),
    y: Math.max(0, Math.round(projected.y - 160))
  };
};

const captureSubject = async (page: Page, renderer: string, hour: string, subject: LampSubject,
  building: { x: number; z: number }) => {
  // Front quarter; the iso zoom stays above the 1.5 detail threshold, so the lamp mesh is drawn.
  await setYaw(page, 0);
  await frame(page, building, 2.6, 1.1);
  await page.waitForTimeout(800);
  const lamp = await lampPointOf(page, `${subject.nation}_${subject.typeId}`);
  const label = `${renderer}-${hour}-${subject.label}`;
  await capture(page, `${label}-context`);
  await capture(page, `${label}-close`, await lampCrop(page, lamp));
};

const stageFixture = async (page: Page, url: string, subject: LampSubject) => {
  await observeScene(page);
  await openFixturePage(page, url);
  const buildings = subject.typeId === 0 ? []
    : [{ level: subject.level, rotation: 0, typeId: subject.typeId, ...PLOT }];
  const plots = await writeFlatIslandGame(page, {
    buildings, cells: 96, grassGround: true, name: `Lamp glow ${subject.label}`, nation: subject.nation,
    stockAll: 400
  });
  if (subject.typeId === 0) return undefined;
  const plot = plots[0] as FlatIslandPlot;
  return { building: { x: plot.x, z: plot.z } };
};

const stageJapaneseHeadquarters = async (page: Page) => {
  await page.evaluate(() => {
    const simulation = (window as LiveWindow).__settlement.simulation;
    for (let step = 0; step < 3; step++) {
      const raised = simulation.debugRaiseBuildingLevel(simulation.headquarters.uid);
      if (!raised.ok) throw new Error(`Headquarters upgrade: ${raised.reason}`);
    }
  });
  await settleDecorations(page, 60);
  await page.waitForTimeout(1000);
  const building = await page.evaluate(() => {
    const { x, z } = (window as LiveWindow).__settlement.simulation.headquarters;
    return { x, z };
  });
  return { building };
};

const captureAll = async () => {
  const { server, url } = await startDevServer();
  const browser: Browser = await launchBrowser();
  const errors: string[] = [];
  try {
    for (const renderer of RENDERERS) for (const hour of HOURS) for (const subject of SUBJECTS) {
      console.log("capture", renderer, hour, subject.label);
      let staged: { building: { x: number; z: number } } | undefined;
      const prepare = async (fixturePage: Page) => {
        staged = await stageFixture(fixturePage, url, subject);
      };
      const page = await openDecorReviewPage(browser, url, "high", errors,
        `time=${hour}&reveal=1&renderer=${renderer}`, prepare);
      await pageHideUi(page);
      if (renderer === "webgpu-gl") {
        const mode = await page.evaluate(() => (window as LiveWindow).__webgpuSpike?.stats?.().mode);
        assert.equal(mode, "webgpu-gl", "webgpu-gl silently fell back to WebGL2");
      }
      staged ??= await stageJapaneseHeadquarters(page);
      await captureSubject(page, renderer, hour, subject, staged.building);
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify({ errors, renderers: RENDERERS }, null, 2));
  assert.deepEqual(errors, []);
  console.log("Lamp matrix:", outputDir);
};

await captureAll();
