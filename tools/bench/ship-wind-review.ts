import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { type SheetRow, writeContactSheet } from "../review/review-contact-sheet";
import { launchBrowser, startDevServer } from "./browser";
import { fleetEyeView, fleetIsoView, SHIP_WIND_FLEET, type ShipWindLevel, stageShipWind } from "./ship-wind-stage";
import { enterPossessed, openReviewPage, pinLight, prepareScene, readFrame,
  stageReviewSave } from "./water-review-page";

/**
 * SHIP-WIND review (TOOL-3 style sheets on the real island renderer): a frozen owner-save frame with four
 * render-only ships of different nations and liveries at fixed headings to the world wind. Per preset
 * and wind level (calm = the save's clear weather, strong = storm wind): the fleet at normal iso zoom,
 * each ship at close iso zoom, the eye from the beach, the spyglass and a deck-height eye close by; plus
 * a motion strip (six frames, 0.15 s apart) of two ships. Writes `shots/`, `sheet.png`, `strip.png`
 * and, with BEFORE=<older output>, `compare-<preset>.png` and `strip-compare-<preset>.png` (before row
 * above after row).
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [VIEWPORT=1280x800] [BEFORE=<dir>]
 *   [SHEET_ONLY=1] (re-assemble the sheets from existing shots)
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1280x800").split("x").map(Number);
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const before = process.env.BEFORE ? resolve(process.env.BEFORE) : undefined;
const shotsDir = resolve(outputDir, "shots");
const LEVELS: readonly ShipWindLevel[] = ["calm", "strong"];
const SHOT_TIME = 12;
const STRIP_FRAMES = 6, STRIP_STEP = .15;
const STRIP_SHIPS = [1, 3];
const ZOOM = { close: 2.2, normal: 1, strip: 2.8 };
mkdirSync(shotsDir, { recursive: true });

const save = async (page: Page, name: string, crop?: { height: number; width: number; x: number; y: number }) => {
  const dataUrl = await readFrame(page, crop);
  writeFileSync(resolve(shotsDir, `${name}.png`), Buffer.from(dataUrl.split(",")[1]!, "base64"));
  console.log("shot", name);
};

const isoShots = async (page: Page, quality: string, level: ShipWindLevel) => {
  await fleetIsoView(page, -1, ZOOM.normal);
  await stageShipWind(page, level, SHOT_TIME);
  await save(page, `${quality}-${level}-iso-normal`);
  for (const ship of SHIP_WIND_FLEET.keys()) {
    await fleetIsoView(page, ship, ZOOM.close);
    await stageShipWind(page, level, SHOT_TIME);
    await save(page, `${quality}-${level}-iso-close-${ship}`);
  }
};

const stripShots = async (page: Page, quality: string) => {
  const crop = { height: height! * .7, width: width! * .6, x: width! * .2, y: height! * .15 };
  for (const ship of STRIP_SHIPS) for (let frame = 0; frame < STRIP_FRAMES; frame++) {
    await fleetIsoView(page, ship, ZOOM.strip);
    await stageShipWind(page, "strong", SHOT_TIME + frame * STRIP_STEP);
    await save(page, `${quality}-strip-${ship}-${frame}`, crop);
  }
};

const eyeShots = async (page: Page, quality: string) => {
  await enterPossessed(page);
  for (const level of LEVELS) for (const [kind, ship] of [["far", 0], ["spyglass", 1], ["near", 1]] as const) {
    await fleetEyeView(page, kind, ship);
    await stageShipWind(page, level, SHOT_TIME);
    await save(page, `${quality}-${level}-eye-${kind}`);
  }
};

const capturePreset = async (page: Page, quality: string) => {
  await prepareScene(page);
  await pinLight(page, "day");
  for (const level of LEVELS) await isoShots(page, quality, level);
  await stripShots(page, quality);
  await eyeShots(page, quality);
};

const shotPath = (folder: string, name: string) => resolve(folder, "shots", `${name}.png`);
const viewNames = () => ["iso-normal", ...SHIP_WIND_FLEET.map((_, ship) => `iso-close-${ship}`),
  "eye-far", "eye-spyglass", "eye-near"];
const viewLabel = (view: string) => {
  const ship = /iso-close-(\d)/.exec(view)?.[1];
  return ship ? `close: ${SHIP_WIND_FLEET[Number(ship)]!.label}` : view;
};

const presetRows = (folder: string, tag: string, presets = qualities): SheetRow[] =>
  presets.flatMap(quality => LEVELS.map(level => ({
  cells: viewNames().map(view => ({ label: viewLabel(view), path: shotPath(folder, `${quality}-${level}-${view}`) })),
  heading: `${tag}${quality} · ${level} wind`
})));

const stripRows = (folder: string, tag: string, presets = qualities): SheetRow[] =>
  presets.flatMap(quality => STRIP_SHIPS.map(ship => ({
  cells: Array.from({ length: STRIP_FRAMES }, (_, frame) => ({ label: `t+${(frame * STRIP_STEP).toFixed(2)} s`,
    path: shotPath(folder, `${quality}-strip-${ship}-${frame}`) })),
  heading: `${tag}${quality} · strong wind motion · ${SHIP_WIND_FLEET[ship]!.label}`
})));

const interleave = (after: SheetRow[], older: SheetRow[]) => after.flatMap((row, index) => [older[index]!, row]);

const writeSheets = async () => {
  const browser = await launchBrowser();
  try {
    const columns = viewNames().length;
    await writeContactSheet(browser, { columns, rows: presetRows(outputDir, ""), title: "SHIP-WIND sails in the wind",
      width: 3200 }, resolve(outputDir, "sheet.png"));
    await writeContactSheet(browser, { columns: STRIP_FRAMES, rows: stripRows(outputDir, ""),
      title: "SHIP-WIND motion strip (strong wind)", width: 3000 }, resolve(outputDir, "strip.png"));
    if (!before || !existsSync(before)) return;
    // One compare sheet per preset: a single page canvas of every row exceeds the browser's limits.
    for (const quality of qualities) {
      await writeContactSheet(browser, { columns, rows: interleave(presetRows(outputDir, "after · ", [quality]),
        presetRows(before, "before · ", [quality])), title: `SHIP-WIND before / after · ${quality}`, width: 3200 },
      resolve(outputDir, `compare-${quality}.png`));
      await writeContactSheet(browser, { columns: STRIP_FRAMES, rows: interleave(
        stripRows(outputDir, "after · ", [quality]), stripRows(before, "before · ", [quality])),
      title: `SHIP-WIND motion before / after · ${quality}`, width: 3000 }, resolve(outputDir, `strip-compare-${quality}.png`));
    }
  } finally { await browser.close(); }
};

const captureAll = async () => {
  const saveText = readFileSync(sourcePath, "utf8"), staged = stageReviewSave(saveText);
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const errors: string[] = [];
  try {
    for (const quality of qualities) {
      const opened = await openReviewPage(browser, url, quality, staged, { height: height!, width: width! });
      await capturePreset(opened.page, quality);
      errors.push(...opened.errors);
      await opened.page.close();
    }
  } finally { await browser.close(); await server.close(); }
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify({ errors, qualities }, null, 2));
  assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
};

if (process.env.SHEET_ONLY !== "1") await captureAll();
await writeSheets();
console.log("done", outputDir);
