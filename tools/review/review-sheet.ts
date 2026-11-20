import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser } from "playwright-core";

import { launchBrowser, startDevServer } from "../bench/browser";
import { writeContactSheet } from "./review-contact-sheet";
import { compareLayout, MANIFEST, manifestShot, type ManifestShot, readManifest, type ReviewManifest,
  reviewLayout, SHOTS_DIR } from "./review-manifest";
import { groupScenes, stageScene } from "./review-scenes";
import { captureSubject } from "./review-shots";
import { loadSpec, type ReviewSpec, subjectShots } from "./review-spec";

/**
 * TOOL-3 review sheets: captures a spec's subjects on the real island renderer in every preset,
 * view and iso quarter, then writes `sheet.png`, `manifest.json` and `shots/*.png` to the output folder.
 * Usage (from island-of-settlers-client):
 *   npx tsx tools/review/review-sheet.ts <spec.json> [--out <dir>] [--before <dir>] [--sheet-only]
 * `--before` adds `compare.png` (before row above after row per subject and preset); `--sheet-only`
 * re-assembles the sheets from an existing output folder without a browser capture.
 * See tools/README.md "TOOL-3 review sheets".
 */
const option = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

const revision = () => {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
};

const captureAll = async (browser: Browser, url: string, spec: ReviewSpec, errors: string[]) => {
  const shotsDir = resolve(spec.out, SHOTS_DIR), shots: ManifestShot[] = [];
  mkdirSync(shotsDir, { recursive: true });
  for (const scene of groupScenes(spec)) for (const preset of spec.presets) {
    const { page, sites } = await stageScene(browser, url, spec, scene, preset, errors);
    try {
      for (const subject of scene.subjects) {
        const planned = subjectShots(spec, subject, preset);
        const results = await captureSubject(page, spec, shotsDir, planned, sites.get(subject)!);
        results.forEach(result => shots.push(manifestShot(spec, spec.out,
          planned.find(shot => shot.key === result.key)!, result)));
        console.log(`${preset} ${scene.key} subject ${subject}: ${results.length} shots`);
      }
    } finally { await page.close(); }
  }
  return shots;
};

const writeSheets = async (browser: Browser, spec: ReviewSpec, before: string | undefined) => {
  const sheets = [resolve(spec.out, "sheet.png")];
  await writeContactSheet(browser, reviewLayout(spec, spec.out), sheets[0]!);
  if (!before) return sheets;
  sheets.push(resolve(spec.out, "compare.png"));
  await writeContactSheet(browser, compareLayout(spec, spec.out, resolve(before)), sheets[1]!);
  return sheets;
};

const specPath = process.argv[2];
if (!specPath || specPath.startsWith("--")) throw new Error("Usage: review-sheet.ts <spec.json> [--out <dir>] ...");
const spec = loadSpec(specPath), outOverride = option("out"), before = option("before");
if (outOverride) spec.out = resolve(outOverride);
const sheetOnly = process.argv.includes("--sheet-only");
mkdirSync(spec.out, { recursive: true });

const previous = sheetOnly ? readManifest(spec.out) : null;
const errors: string[] = previous ? [...previous.errors] : [];
const devServer = previous ? null : await startDevServer();
const browser = await launchBrowser();
try {
  const shots = previous ? previous.shots : await captureAll(browser, devServer!.url, spec, errors);
  const sheets = await writeSheets(browser, spec, before);
  const manifest: ReviewManifest = { errors, generatedAt: new Date().toISOString(), revision: revision(), sheets,
    shots, spec };
  writeFileSync(resolve(spec.out, MANIFEST), JSON.stringify(manifest, null, 2));
  console.log(`Review sheet: ${sheets.join(", ")}`);
} finally { await browser.close(); await devServer?.server.close(); }
if (errors.length) console.warn(`Page errors (see ${MANIFEST}):\n${errors.join("\n")}`);
