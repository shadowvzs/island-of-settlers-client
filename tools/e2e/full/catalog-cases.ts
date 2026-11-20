import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import { closeDevelopment, openDevelopmentAction } from "../../bench/development-ui-helpers";
import { createAcceptanceManifest, createProgressTracker } from "./observations";
import { MissingPrerequisite } from "./report";

type RunCase = (id: string, title: string, action: () => Promise<unknown>) => Promise<void>;
interface CatalogOptions { observeSeconds?: number; buildTimeoutMs?: number }

const captureBaseline = (page: Page) => page.evaluate(async () => {
  const live = (window as any).__fullE2E;
  if (!live?.world || !live?.settlement) throw new Error("Full E2E read-only diagnostics unavailable");
  const url = "/tools/e2e/full/observations.ts";
  const helpers = await import(/* @vite-ignore */ url);
  const sim = live.settlement.simulation ?? live.settlement;
  const before = sim.snapshot();
  (window as any).__catalogEvidence = { terrain: helpers.snapshotTerrain(live.world), before };
  return { buildings: before.buildings.map((building: any) => ({ uid: building.uid, typeId: building.typeId })),
    nation: sim.playerNation?.() ?? "roman" };
});

const readTown = (page: Page) => page.evaluate(async () => {
  const live = (window as any).__fullE2E;
  const sim = live.settlement.simulation ?? live.settlement;
  const url = "/tools/e2e/full/observations.ts";
  const helpers = await import(/* @vite-ignore */ url);
  const state = sim.snapshot();
  const clock = performance.now() / 1000;
  return { buildings: state.buildings, actors: helpers.sampleActors(state.actors, clock),
    ledger: helpers.observeGoodsLedger(state.buildings, state.actors),
    roadRevision: sim.roadRevision(), clock };
});

const terrainEvidence = (page: Page) => page.evaluate(async () => {
  const live = (window as any).__fullE2E;
  const sim = live.settlement.simulation ?? live.settlement;
  const url = "/tools/e2e/full/observations.ts";
  const helpers = await import(/* @vite-ignore */ url);
  const baseline = (window as any).__catalogEvidence;
  const beforeIds = new Set(baseline.before.buildings.map((building: any) => building.uid));
  const buildings = sim.buildings().filter((building: any) => !beforeIds.has(building.uid));
  const geometry = ["heights", "normals", "walkCost", "buildClass", "blocking"];
  const authorizations = buildings.map((building: any) => ({
    reason: `Building ${building.uid}: actual footprint, foundation apron 3, normal derivative 1`,
    minX: building.x - building.width / 2 - 4, maxX: building.x + building.width / 2 + 4,
    minZ: building.z - building.depth / 2 - 4, maxZ: building.z + building.depth / 2 + 4,
    layers: geometry
  }));
  // Segment boxes are deliberately individual, rather than permitting an entire town/chunk.
  for (const road of sim.roadSegments()) {
    if (road.preview || road.doorway) continue;
    authorizations.push({ reason: "Committed road grading reach 1.4 and normal derivative 1",
      minX: Math.min(road.start.x, road.end.x) - 2.4, maxX: Math.max(road.start.x, road.end.x) + 2.4,
      minZ: Math.min(road.start.z, road.end.z) - 2.4, maxZ: Math.max(road.start.z, road.end.z) + 2.4,
      layers: geometry });
  }
  const after = helpers.snapshotTerrain(live.world);
  const comparison = helpers.compareTerrain(baseline.terrain, after, authorizations);
  return { comparison, authorizations,
    interpretation: "Outside-mask changes require review. Props, stone clearance, growth and work are not blanket-authorized; " +
      "their differences remain evidence, not automatically a terrain defect. Geometry inside masks still needs visual review." };
});

export const runCatalogCases = async (page: Page, runCase: RunCase, options: CatalogOptions = {}) => {
  const requestedSeconds = options.observeSeconds ?? Number(process.env.E2E_OBSERVE_SECONDS ?? 60);
  assert(Number.isFinite(requestedSeconds) && requestedSeconds > 0 && requestedSeconds <= 3600,
    "Catalog observation seconds must be within (0, 3600]");
  let initial: Awaited<ReturnType<typeof captureBaseline>> | undefined;
  let built = false;
  await runCase("E2E-04-catalog-ui", "Actual Build every building action and per-type placement audit", async () => {
    initial = await captureBaseline(page);
    if (initial.buildings.some((building: { typeId: number }) => building.typeId !== 0))
      throw new MissingPrerequisite("Catalog branch must start at pristine F0 with only its normal HQ");
    const button = await openDevelopmentAction(page, "Build every building");
    if (await button.isDisabled()) throw new MissingPrerequisite("Build every building is disabled on this island");
    await button.click();
    await closeDevelopment(page);
    await page.waitForFunction(() => [...document.querySelectorAll(".settlement-ui__status")]
      .some(node => /Built \d+ finished buildings? with roads/.test(node.textContent ?? "")), null,
    { timeout: options.buildTimeoutMs ?? 180_000 });
    const status = await page.locator(".settlement-ui__status").allTextContents();
    const town = await readTown(page);
    const manifest = createAcceptanceManifest(initial.nation);
    const expected = manifest.buildings.filter(building => !building.headquarters && building.buildable);
    const rows = expected.map(definition => {
      const instances = town.buildings.filter((building: any) => building.typeId === definition.id);
      return { typeId: definition.id, name: definition.name, count: instances.length,
        outcome: instances.length ? "created" : "uncovered", instanceIds: instances.map((b: any) => b.uid),
        status: instances.map((b: any) => b.status), modes: definition.modes.map(mode => ({ mode, outcome: "not-run" })),
        upgrade: definition.upgrade ? "not-run" : "not-applicable" };
    });
    const unfinished = town.buildings.filter((building: any) => building.construction < 1);
    assert.equal(unfinished.length, 0, `Debug-created buildings unfinished: ${JSON.stringify(unfinished)}`);
    built = true;
    return { debugAssist: { action: "Build every building", allowedPurpose: "Catalog branch only" },
      status, manifest, coverage: rows, missingTypes: rows.filter(row => row.count === 0),
      scope: "Completed placement audit; skipped resources/locations require fixture investigation, not inferred game defects." };
  });
  await runCase("E2E-05-catalog-terrain", "Snapshot terrain changes and narrowly scoped grading evidence", async () => {
    if (!built) throw new MissingPrerequisite("Catalog placement did not finish");
    const evidence = await terrainEvidence(page);
    assert.equal(evidence.comparison.nonFinite, 0, "Nonfinite authoritative terrain data detected");
    return { ...evidence, outcome: evidence.comparison.unauthorized ? "inconclusive-review-required" : "within-masks",
      visualInspection: "not-run" };
  });
  await runCase("E2E-06-07-catalog-observation", "Wall-clock production and traffic observation; explicit uncovered modes", async () => {
    if (!built) throw new MissingPrerequisite("Catalog placement did not finish");
    const first = await readTown(page), tracker = createProgressTracker();
    const samples: unknown[] = [], stallCandidates: unknown[] = [];
    const started = Date.now(), end = started + requestedSeconds * 1000;
    let last = first;
    while (Date.now() < end) {
      last = await readTown(page);
      const progress = tracker(last.actors);
      if (samples.length < 120) samples.push({ wallSeconds: (Date.now() - started) / 1000,
        actors: last.actors.length, buildings: last.buildings.map((b: any) => ({ uid: b.uid, cycle: b.cycle,
          status: b.status, worker: b.worker, workTime: b.workTime, output: b.output })),
        suspected: progress.suspected });
      if (stallCandidates.length < 32 && progress.suspected.length) stallCandidates.push(progress.suspected);
      await page.waitForTimeout(Math.min(1000, Math.max(1, end - Date.now())));
    }
    const observed = first.buildings.map((before: any) => {
      const after = last.buildings.find((building: any) => building.uid === before.uid);
      return { uid: before.uid, typeId: before.typeId, initialStatus: before.status, finalStatus: after?.status,
        cycleBefore: before.cycle, cycleAfter: after?.cycle, cycleDelta: after ? after.cycle - before.cycle : null,
        outcome: "observed-only", modeCoverage: "not-run", upgradeCoverage: "not-run" };
    });
    return { wallSeconds: (Date.now() - started) / 1000, observed, samples, stallCandidates,
      ledgerBefore: first.ledger, ledgerAfter: last.ledger,
      scope: "No supplies or targets were injected. Cycle counters can wrap; stock changes include downstream use. " +
        "These samples do not prove three delivered cycles for every mode. Suspected stalls use wall clock and require " +
        "simulation-speed, legitimate-wait and queue review before a jam diagnosis. Long soak and animations remain not-run." };
  });
};
