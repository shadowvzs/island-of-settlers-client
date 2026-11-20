import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { launchBrowser, startDevServer } from "../../bench/browser";
import { resourcesPath } from "../../bench/resources-path";
import { createSession, observationHookHash, waitForGame } from "./browser-session";
import { runCatalogCases } from "./catalog-cases";
import { type E2eCheckpoint,loadCheckpoint, verifyCheckpoint, writeCheckpoint } from "./checkpoints";
import { runControlsCases } from "./controls-cases";
import { writeCoverage } from "./coverage";
import {
  classifyLane, coverageExitCode, type LaneEvidence,
writeAggregateCoverage} from "./coverage-aggregation";
import { fingerprint } from "./fingerprint";
import { runGeneratorCases } from "./generator-cases";
import { runJourneyCases } from "./journey-cases";
import { runMilitaryCases } from "./military-cases";
import { runNaturalCases } from "./natural-cases";
import { runNaturalPreludeCases } from "./natural-prelude-cases";
import { readPrelude } from "./natural-prelude-helpers";
import { COVERAGE_REQUIREMENTS } from "./obligation-registry";
import { type FullOptions, HELP, type Lane,readOptions } from "./options";
import { runPerformanceCases } from "./performance-cases";
import { runPersistenceCases } from "./persistence-cases";
import { runProductionCases } from "./production-cases";
import { runProgressionCases } from "./progression-cases";
import { runQuestCases } from "./quest-cases";
import { reconcileRun } from "./reconcile";
import { exportRecording, startRecording } from "./recording";
import { createReport, MissingPrerequisite } from "./report";
import { runShipCases } from "./ship-cases";
import { runTrafficCases } from "./traffic-cases";

type Browser = Awaited<ReturnType<typeof launchBrowser>>;
const ROOT = resolve(import.meta.dirname, "../../..");
/** Which earlier lane's saved state a lane resumes from: catalog-backed lanes, persistence, or the baseline. */
const laneCheckpoint = (lane: string, checkpoints: {
  baseline: E2eCheckpoint | undefined;
  catalog: E2eCheckpoint | undefined;
  natural: E2eCheckpoint | undefined;
}) => {
  const { baseline, catalog, natural } = checkpoints;
  if (lane === "performance" || lane === "production" || lane === "traffic") return catalog ?? baseline;
  if (lane === "controls") return natural ?? baseline;
  return lane === "persistence" ? natural ?? catalog ?? baseline : baseline;
};

const main = async () => {
  const options = readOptions();
  if (options.help) { console.log(HELP); return; }
  if (options.reconcile) { process.exitCode = await reconcileRun(resolve(options.reconcile)); return; }
  process.chdir(ROOT);
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = options.output ? resolve(options.output) : resourcesPath("project-reviews", "full-e2e", runId);
  await mkdir(directory, { recursive: true });
  // Exclusive marker also protects custom --output paths and accidental concurrent writers.
  await writeFile(join(directory, "run.lock"), String(process.pid), { flag: "wx" });
  const pinned = await fingerprint(ROOT);
  await writeFile(join(directory, "run.json"), JSON.stringify({ runId, options, pinned, observationHookHash }, null, 2));
  if (!options.headless) process.env.HEADED = "1";
  else process.env.HEADED = "0";
  const { server, url } = await startDevServer();
  let browser: Browser | undefined;
  let failures = 0, incomplete = 0;
  const lanes: LaneEvidence[] = [];
  try {
    browser = await launchBrowser();
    for (const quality of options.qualities) {
      let baseline = options.resume ? await loadCheckpoint(options.resume.endsWith("manifest.json") ?
        dirname(resolve(options.resume)) : resolve(options.resume)) : undefined;
      let natural: E2eCheckpoint | undefined, catalog: E2eCheckpoint | undefined;
      for (const lane of options.lanes) {
        const checkpoint = laneCheckpoint(lane, { baseline, catalog, natural });
        const result = await runLane(browser, url, quality, lane, directory, options, pinned, checkpoint);
        lanes.push({ quality, lane, cases: result.cases });
        if (result.failed) failures++;
        if (result.incomplete) incomplete++;
        if (lane === "generator") baseline = result.checkpoint;
        else if (!baseline) baseline = result.baseline;
        if (lane === "natural" || lane === "prelude") natural = result.checkpoint;
        if (lane === "catalog") catalog = result.checkpoint;
      }
    }
    const coverage = await writeAggregateCoverage(directory, lanes, options.qualities, COVERAGE_REQUIREMENTS);
    if (!coverage.complete) incomplete++;
    assert.equal(await fingerprint(ROOT), pinned, "Source/assets changed during acceptance; run is invalid");
  } finally {
    await browser?.close();
    await server.close();
  }
  console.log(`Artifacts: ${directory}`);
  console.log("Obligations stay not-run until reviewed; add reviewed-evidence.json and run --reconcile.");
  process.exitCode = coverageExitCode(failures, incomplete);
};

const runLane = async (
  browser: Browser, url: string, quality: string, lane: Lane, root: string, options: FullOptions,
  pinned: string, incoming?: E2eCheckpoint
) => {
  const performance = lane === "performance";
  const instrumentation = { trace: !performance, video: !performance && options.video, reproduction: !performance && lane !== "generator" };
  const report = await createReport(join(root, `${quality}-${lane}`), {
    quality, lane, pinned, observationHookHash, instrumentation,
    assists: { unlockAllBuildings: true, reason: "Bench dev server exposes all building cards; materials/builders remain finite. This run does not prove natural building unlock progression." },
    artifactLimits: { trace: "First up to 8 seconds per case; optional up to 3 seconds of failure capture; screenshots enabled, DOM snapshots and sources disabled", video: "First up to 8 seconds at up to 10 actual screencast frames/sec; startup waits for a real frame" },
    startedAt: new Date().toISOString(),
    viewport: { width: 1440, height: 960 }, headed: !options.headless, sourceFrozen: true,
    execution: "Serial isolated contexts; GPU/performance never runs concurrently", parentCheckpoint: incoming?.manifestPath
  });
  const { context, page } = await createSession(browser, report);
  const guard = async () => assert.equal(await fingerprint(ROOT), pinned,
    "Source or assets changed; aborting lane to avoid mixed-version evidence");
  const runCase = report.runCase(page, { video: instrumentation.video, trace: instrumentation.trace, guard });
  let checkpoint: E2eCheckpoint | undefined, baseline: E2eCheckpoint | undefined;
  try {
    await page.goto(`${url}?quality=${quality}&seed=${options.seed}&size=128&forest=2&cache=0`);
    await waitForGame(page);
    await runCase("E2E-01-initialization", "Normal starter or immutable checkpoint restore", async () => {
      if (incoming) return verifyCheckpoint(page, incoming);
      return { initialized: true, seed: options.seed, source: "URL bootstrapping; UI generator is a separate case" };
    });
    if (report.cases.at(-1)?.outcome !== "pass") throw new Error("Initialization/restore did not pass; dependent lane stopped");
    if (incoming) await waitForGame(page);
    report.metadata.playerNation = await page.evaluate(() => (window as any).__settlement.simulation.playerNation());
    if (lane === "generator") {
      await runGeneratorCases(page, runCase, options);
      if (!report.cases.some(item => item.id === "E2E-03-generator-ui" && item.outcome === "pass"))
        throw new Error("UI generation did not pass; refusing a misleading generated checkpoint");
    }
    await runCase("E2E-01-baseline-export", "Matching game and embedded-map checkpoint at one boundary", async () => {
      baseline = await writeCheckpoint(page, join(report.directory, "checkpoints"), "baseline");
      return baseline;
    });
    if (!baseline) throw new Error("Baseline export failed; dependent work stopped");
    if (lane !== "generator") {
      if (instrumentation.reproduction) await runCase("E2E-02-record-start", "Start actual reproduction recording through UI", () => startRecording(page));
      if (lane === "natural") await runNaturalCases(page, runCase);
      if (lane === "controls") await runControlsCases(page, runCase);
      if (lane === "prelude") report.metadata.naturalPrelude = await runNaturalPreludeCases(page, runCase);
      if (lane === "catalog") await runCatalogCases(page, runCase, { observeSeconds: options.observeSeconds });
      if (lane === "production") await runProductionCases(page, runCase);
      if (lane === "progression") await runProgressionCases(page, runCase);
      if (lane === "traffic") await runTrafficCases(page, runCase, { observeSeconds: options.observeSeconds });
      if (lane === "military") await runMilitaryCases(page, runCase);
      if (lane === "quests") await runQuestCases(page, runCase);
      if (lane === "ships") await runShipCases(page, runCase);
      if (lane === "colony" || lane === "adventure") await runJourneyCases(page, runCase, lane, {
        artifactsDirectory: report.directory, timeline: { transitions: [] }
      });
      if (lane === "continuous") {
        const timeline = { transitions: [] };
        const initial = await readPrelude(page);
        const fresh = initial.buildings.length === 1 && initial.buildings[0].typeId === 0 &&
          !initial.soldiers.length && !initial.actors.length;
        const prelude = fresh ? await runNaturalPreludeCases(page, runCase) : undefined;
        report.metadata.continuousJourney = {
          sameContext: true, baselineRestoredOnce: true,
          prelude: prelude ?? "Not run: supplied developed checkpoint does not prove its F0 history",
          expeditionReadiness: "Minimum prelude proves one infantry; real harbour, ships and sufficient expedition force are separate prerequisites"
        };
        let ready = false;
        await runCase("E2E-16-continuous-prerequisite", "Continuous journey has finite real expedition infrastructure", async () => {
          if (!incoming && !prelude?.firstRecruit)
            throw new MissingPrerequisite("No verified finite checkpoint or completed fresh-HQ economy/recruitment prelude");
          const state = await page.evaluate(() => {
            const sim = (window as any).__settlement.simulation;
            return { harbour: sim.buildings().some((building: any) => building.typeId === 39 && building.construction === 1),
              ships: sim.ships().length, reserves: sim.militaryStoredTroops().reduce((sum: number, troop: any) => sum + troop.count, 0),
              existing: sim.colonyExpeditions().length, abroad: !!(sim.colony() || sim.adventure()) };
          });
          if (state.abroad || (!state.existing && (!state.harbour || !state.ships || !state.reserves)))
            throw new MissingPrerequisite("Minimum F0 prelude is separate from voyage readiness: need naturally completed harbour, launched ships and finite troops on home; no grant used");
          ready = true;
          return { checkpoint: incoming?.manifestPath, preludeCoverage: prelude ?? "not-run", state };
        });
        for (const kind of ready ? ["colony", "adventure"] as const : []) {
          const legCase = (id: string, title: string, action: () => Promise<unknown>) =>
            runCase(id.startsWith("E2E-09") ? `E2E-${kind}-ships-${id}` : id, `${kind} leg: ${title}`, action);
          await runJourneyCases(page, legCase, kind, { artifactsDirectory: report.directory, timeline });
          const required = [`E2E-${kind}-conquest`, `E2E-${kind}-return-home`, `E2E-${kind}-return-receipt`];
          if (!required.every(id => report.cases.some(result => result.id === id && result.outcome === "pass"))) break;
          const home = await page.evaluate(() => {
            const sim = (window as any).__settlement.simulation;
            return !sim.colony() && !sim.adventure();
          });
          if (!home) break;
        }
      }
      if (lane === "persistence") await runPersistenceCases(page, runCase, report.directory);
      if (lane === "performance") await runPerformanceCases(page, runCase, options.soakSeconds);
      if (instrumentation.reproduction) await runCase("E2E-02-record-export", "Export bounded per-island reproduction evidence", () =>
        exportRecording(page, report.directory, `${quality}-${lane}`));
    }
    await runCase("E2E-01-result-export", "Export immutable branch result for isolated follow-up", async () => {
      checkpoint = await writeCheckpoint(page, join(report.directory, "checkpoints"), "result");
      return checkpoint;
    });
    await runCase("E2E-02-runtime-errors", "No uncaught browser errors, failed assets or HTML served as scripts", async () => {
      const errors = report.logs.filter((row: any) => ["pageerror", "http", "requestfailed", "html-for-module"].includes(row.kind));
      assert.deepEqual(errors, [], "Browser/runtime failures; inspect logs to distinguish environment and game causes");
      return { runtimeErrors: 0, warningsRetained: report.logs.length };
    });
    await guard();
  } catch (error) {
    report.metadata.aborted = String(error);
    report.metadata.sourceFrozen = await fingerprint(ROOT) === pinned;
    report.pending("E2E-01-lane-aborted", "Lane initialization/execution interrupted", String(error), "blocked");
  } finally {
    await context.close();
    report.metadata.finishedAt = new Date().toISOString();
    await writeCoverage(report);
  }
  return { checkpoint, baseline, cases: report.cases, ...classifyLane(report.cases, Boolean(report.metadata.aborted)) };
};

main().catch(error => { console.error(error); process.exitCode = 1; });
