import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser } from "playwright-core";

import { launchBrowser, startDevServer } from "../bench/browser";
import { pinCloudCover } from "../bench/cloud-review-page";
import { openFrozenPage, stageFrozenSave } from "../bench/frozen-frame-review";
import { aimView, captureClockStrip, type CapturedFrame, findBeach, type ViewGeometry }
  from "./reference-capture";
import { extractFrames, readImage, writeClipStill } from "./reference-frames";
import { quantile, rounded } from "./reference-image";
import { type AnalysedSubject, analyseFrames, analyseLook, analyseStill } from "./reference-tuner-analysis";
import { metricsTable } from "./reference-tuner-report";
import { type GameCapture, gameKey, loadTunerSpec, type TunerSpec } from "./reference-tuner-spec";
import { type SheetRow, writeContactSheet } from "./review-contact-sheet";

/**
 * TOOL-8 reference tuner: measures licensed reference clips (static/slow cameras for motion) and the
 * matching game views, then writes a side-by-side sheet and a metrics table. Only the numbers
 * inform shader parameters; extracted frames stay in the output folder (never the repository).
 * Usage (from island-of-settlers-client, browser through captures/browser-slot.sh):
 *   npx tsx tools/review/reference-tuner.ts <spec.json> --out <dir> [--videos <dir>] [--stills <dir>]
 *     [--save <save.json>] [--reference-only | --game-only | --reanalyse] [--before <older out dir>]
 * `--reference-only` and `--reanalyse` measure the strips already captured in `--out` again (no
 * dev server); `--game-only` keeps the reference metrics of the previous run.
 * See tools/README.md "TOOL-8 reference tuner".
 */

const option = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const GAME_ROOT = resolve(process.cwd(), "..");
const firstExisting = (...paths: string[]) => paths.find(path => existsSync(path)) ?? paths[0]!;
/** The owner's reference clips live in the main checkout (untracked); lanes pass `--videos`. */
const requireFolder = (path: string, hint: string) => {
  if (!existsSync(path)) throw new Error(`${path} not found: pass ${hint}`);
  return path;
};
const DEFAULT_SAVE = resolve(GAME_ROOT, "..", "captures", "perf", "owner-laggy-2026-11-07.json");

interface RunResult {
  game: AnalysedSubject[];
  references: AnalysedSubject[];
}

const revision = () => {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
};

const analyseReferences = (spec: TunerSpec, out: string, videos: string, stills: string): AnalysedSubject[] => {
  const clips = spec.references.map(reference => {
    const outDir = resolve(out, "reference", reference.label), file = resolve(videos, reference.clip);
    const frames = extractFrames(file, { duration: reference.duration, fps: reference.fps, start: reference.start,
      width: spec.analysisWidth });
    const subject = analyseFrames(spec.kind, frames, { fps: reference.fps, hfov: reference.hfov ?? 60,
      label: reference.label, landward: reference.landward ?? "down", motion: reference.camera !== "moving", outDir,
      roi: reference.roi });
    const still = resolve(outDir, "still.png");
    writeClipStill(file, reference.start + reference.duration / 2, still);
    console.log(`reference ${reference.label}: ${frames.length} frames`);
    const stillCell = { label: `${reference.label} (${reference.camera})`, path: still };
    return { ...subject, cells: [stillCell, ...subject.cells] };
  });
  const photos = spec.stills.map(still => analyseStill({ image: readImage(resolve(stills, still.image),
    spec.analysisWidth), seconds: 0 }, { fps: 1, hfov: 60, label: still.label, landward: still.landward ?? "down",
    motion: false, outDir: resolve(out, "reference", still.label), roi: still.roi }));
  return [...clips, ...photos];
};

const loadFrames = (frames: CapturedFrame[], width: number) =>
  frames.map(frame => ({ image: readImage(frame.file, width), seconds: frame.seconds }));

/** Strip record beside the frames, so `--reanalyse` can measure them again without a browser. */
interface StripRecord {
  frames: CapturedFrame[];
  geometry: ViewGeometry;
}
const STRIP_RECORD = "strip.json";

const gameCaptures = (spec: TunerSpec, preset: string) => spec.game.filter(capture => capture.presets.includes(preset))
  // Iso views first: possession replaces the frozen iso frame.
  .sort((a, b) => Number(a.view !== "iso-beach") - Number(b.view !== "iso-beach"))
  .flatMap(capture => capture.times.map(time => ({ capture, key: gameKey(capture, preset, time), time })));

const analyseStrip = (spec: TunerSpec, capture: GameCapture, key: string, directory: string): AnalysedSubject => {
  const { frames, geometry } = JSON.parse(readFileSync(resolve(directory, STRIP_RECORD), "utf8")) as StripRecord;
  const beachRoi = capture.view === "possessed-beach" || capture.view === "iso-beach";
  const roi = capture.roi ?? (beachRoi ? geometry.roi : undefined);
  const options = { fps: capture.fps, hfov: geometry.hfov, label: key, landward: geometry.landward, motion: true,
    outDir: resolve(directory, "analysis"), roi };
  const loaded = loadFrames(frames, spec.analysisWidth);
  const subject = capture.view === "possessed-inland" ? analyseLook(loaded, options)
    : analyseFrames(spec.kind, loaded, options);
  const evs = frames.flatMap(frame => (frame.ev === undefined ? [] : [frame.ev]));
  const exposureEv = evs.length ? rounded(quantile(evs, 0.5), 3) : null;
  return { ...subject, cells: [{ label: key, path: frames[0]!.file }, ...subject.cells],
    metrics: { ...subject.metrics, exposureEv } };
};

const reanalyseGame = (spec: TunerSpec, out: string) => {
  const presets = [...new Set(spec.game.flatMap(capture => capture.presets))];
  return presets.flatMap(preset => gameCaptures(spec, preset))
    .filter(({ key }) => existsSync(resolve(out, "game", key, STRIP_RECORD)))
    .map(({ capture, key }) => analyseStrip(spec, capture, key, resolve(out, "game", key)));
};

const captureGame = async (browser: Browser, url: string, spec: TunerSpec, out: string, save: string) => {
  const subjects: AnalysedSubject[] = [];
  const presets = [...new Set(spec.game.flatMap(capture => capture.presets))];
  for (const preset of presets) {
    const { page } = await openFrozenPage(browser, url, {
      extraRoutes: spec.kind === "clouds" ? async pinned => { await pinCloudCover(pinned, spec.cover); } : undefined,
      query: "", quality: preset, stagedSave: stageFrozenSave(readFileSync(save, "utf8")),
      viewport: { height: 800, width: 1280 } });
    try {
      await page.addStyleTag({ content: ".stats-overlay { display: none !important; }" });
      const spot = await findBeach(page);
      for (const { capture, key, time } of gameCaptures(spec, preset)) {
        const directory = resolve(out, "game", key);
        const geometry = await aimView(page, spot, capture.view, time, capture.exposure);
        const count = Math.round(capture.seconds * capture.fps);
        const frames = await captureClockStrip(page, capture.view, directory, count, capture.fps,
          capture.draws);
        writeFileSync(resolve(directory, STRIP_RECORD), JSON.stringify({ frames, geometry } satisfies StripRecord));
        subjects.push(analyseStrip(spec, capture, key, directory));
        console.log(`game ${key}: ${frames.length} frames, landward ${geometry.landward}`);
      }
    } finally { await page.close(); }
  }
  return subjects;
};

const sheetRows = (result: RunResult, before: RunResult | null): SheetRow[] => [
  ...result.references.map(subject => ({ cells: subject.cells, heading: `Reference: ${subject.label}` })),
  ...(before?.game ?? []).map(subject => ({ cells: subject.cells, heading: `Game BEFORE: ${subject.label}` })),
  ...result.game.map(subject => ({ cells: subject.cells, heading: `Game: ${subject.label}` }))
];

const readResult = (folder: string): RunResult | null => {
  const file = resolve(folder, "metrics.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).result as RunResult : null;
};

const run = async () => {
  const specPath = process.argv[2];
  if (!specPath || specPath.startsWith("--")) throw new Error("Usage: reference-tuner.ts <spec.json> --out <dir> ...");
  const spec = loadTunerSpec(specPath), out = resolve(option("out") ?? `reference-tuner-${spec.name}`);
  const videos = requireFolder(option("videos") ?? firstExisting(resolve(GAME_ROOT, "resources", "references",
    "owner-videos"), resolve(GAME_ROOT, "resources-readonly", "references", "owner-videos")), "--videos <dir>");
  const stills = requireFolder(option("stills") ?? firstExisting(resolve(GAME_ROOT, "resources", "references",
    "ground-photos"), resolve(GAME_ROOT, "resources-readonly", "references", "ground-photos")), "--stills <dir>");
  const beforeDir = option("before"), before = beforeDir ? readResult(resolve(beforeDir)) : null;
  mkdirSync(out, { recursive: true });
  const previous = readResult(out);
  const references = flag("game-only") && previous ? previous.references : analyseReferences(spec, out, videos, stills);
  const capture = !flag("reference-only") && !flag("reanalyse");
  const devServer = capture ? await startDevServer() : null;
  const browser = await launchBrowser();
  try {
    const game = devServer ? await captureGame(browser, devServer.url, spec, out, option("save") ?? DEFAULT_SAVE)
      : reanalyseGame(spec, out);
    const result: RunResult = { game, references };
    await writeContactSheet(browser, { columns: 4, rows: sheetRows(result, before),
      title: `TOOL-8 reference tuner: ${spec.name} (${revision()})` }, resolve(out, "sheet.png"));
    writeFileSync(resolve(out, "metrics.json"), JSON.stringify({ generatedAt: new Date().toISOString(), result,
      revision: revision(), spec }, null, 2));
    writeFileSync(resolve(out, "metrics.md"), metricsTable(result, before));
    console.log(`Reference tuner: ${resolve(out, "sheet.png")}, ${resolve(out, "metrics.md")}`);
  } finally { await browser.close(); await devServer?.server.close(); }
};

await run();
