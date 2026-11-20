import { resolve } from "node:path";

import {
  navigationInvalidation, setNavigationInvalidation
} from "../../src/shared/settlement/navigation-change-journal";
import { loadHarbourBenchSession, timed } from "./harbour-bench-session";
import { createHarbourPanelEdits, type HarbourPanelEdit } from "./harbour-panel-edits";

/**
 * Harbour panel query timing on one owner save (HARBOUR-PANEL-FREEZE): after a normal load and
 * prewarm, the simulation advances in rounds and each round opens every completed harbour's Harbour
 * page queries (`seaExplorationAvailability`, `seaPotentialSettlements`) twice.
 *
 * Usage: npx tsx tools/bench/harbour-panel-query-timing.ts [save.json]
 * Env: HARBOUR_PANEL_ROUNDS (6), HARBOUR_PANEL_ADVANCE seconds per round (10),
 *   HARBOUR_PANEL_GLOBAL=1 (A03 rollback mode: the pre-fix full revalidation),
 *   HARBOUR_PANEL_VERIFY=1 (strict: every locally renewed proof list is compared with a full rebuild),
 *   HARBOUR_PANEL_RELOAD=1 (an autosave in-place snapshot reload before every round's panel open),
 *   HARBOUR_PANEL_EDITS=place,demolish,road,decoration,bridge,level (HARBOUR-RECHECK: round n makes edit
 *   n mod count right before its timed panel open; `level` plans an uneven plot connected to the roads and
 *   lets the Leveler work HARBOUR_PANEL_LEVEL_SECONDS (120) first, with one untimed open right after the
 *   placement). Every advance and edit ends with one render frame's `shipSites()` read (untimed), as live
 *   frames renew the boat jetties before the owner can open the panel.
 */
const sourcePath = resolve(process.argv[2] ?? "/home/shadowvzs/Downloads/island-settlers-2026-11-08 (3).json");
const roundCount = Number(process.env.HARBOUR_PANEL_ROUNDS ?? 6);
const advanceSeconds = Number(process.env.HARBOUR_PANEL_ADVANCE ?? 10);
const verify = process.env.HARBOUR_PANEL_VERIFY === "1";
const autosaveReload = process.env.HARBOUR_PANEL_RELOAD === "1";
const editKinds = (process.env.HARBOUR_PANEL_EDITS ?? "").split(",").filter(Boolean) as HarbourPanelEdit[];
const levelSeconds = Number(process.env.HARBOUR_PANEL_LEVEL_SECONDS ?? 120);
if (process.env.HARBOUR_PANEL_GLOBAL === "1") setNavigationInvalidation({ mode: "global" });
const { prewarmMs, roads, simulation, world } = await loadHarbourBenchSession(sourcePath);
const harbours = simulation.buildings().filter(building => building.typeId === 39 &&
  building.construction === 1 && (building.militaryFaction ?? 0) === 0);
const revisions = () => [world.buildRevision ?? 0, world.terrainRevision ?? 0, world.fogRevision ?? 0,
  roads.revision ?? 0].join(":");
/** The Harbour page's two queries, in the order `useHarbourExpedition` runs them. */
const openPanel = (uid: number) => {
  const previous = setNavigationInvalidation({ strict: verify });
  try {
    const availability = timed(() => simulation.seaExplorationAvailability(uid));
    const potential = timed(() => simulation.seaPotentialSettlements(uid));
    return { availability: availability.value, availabilityMs: availability.ms,
      potential: potential.value, potentialMs: potential.ms };
  } finally {
    setNavigationInvalidation(previous);
  }
};
/**
 * One render frame's settlement read that the panel open does not own: every live frame reads
 * `shipSites()`, which renews the boat jetties after a navigation change before the owner can click.
 */
const renderFrame = () => timed(() => simulation.shipSites()).ms;
const advance = (seconds: number) => {
  for (let step = 0; step < seconds * 20; step++) simulation.update(.05);
  return renderFrame();
};
const runEdit = createHarbourPanelEdits(simulation, world);
/** The round's edit; `level` first absorbs its placement in an untimed open, then lets the Leveler work. */
const editRound = (round: number) => {
  if (!editKinds.length) return undefined;
  const kind = editKinds[round % editKinds.length]!, detail = runEdit(kind);
  let frameMs = renderFrame();
  if (kind !== "level" || !detail) return { detail, frameMs, kind };
  const heights = world.heights.slice();
  harbours.forEach(harbour => openPanel(harbour.uid));
  frameMs = advance(levelSeconds);
  const levelledVertices = world.heights.filter((height, vertex) => height !== heights[vertex]).length;
  return { detail, frameMs, kind, levelledVertices, siteStatus: simulation.buildings().at(-1)?.status };
};
const rounds = Array.from({ length: roundCount }, (_, round) => {
  const advanceFrameMs = advance(advanceSeconds);
  // The autosave's D3 in-place snapshot reload, between ticks, as the live island runs it.
  if (autosaveReload && !simulation.reloadSnapshot(simulation.saveState(), true).ok)
    throw new Error("In-place snapshot reload failed");
  const edit = editRound(round);
  const revision = revisions();
  return { advanceFrameMs, edit, revision, round, harbours: harbours.map(harbour => {
    const first = openPanel(harbour.uid), again = openPanel(harbour.uid);
    return { ...first, againMs: again.availabilityMs + again.potentialMs, uid: harbour.uid };
  }) };
});
const openMs = rounds.flatMap(round => round.harbours.map(entry => entry.availabilityMs + entry.potentialMs));
console.log(JSON.stringify({
  advanceSeconds, autosaveReload, cellsX: world.cellsX, cellsZ: world.cellsZ,
  chartedSites: simulation.seaChartedSites().length,
  harbours: harbours.map(harbour => harbour.uid), invalidation: navigationInvalidation().mode,
  maxOpenMs: Math.max(...openMs), medianOpenMs: [...openMs].sort((a, b) => a - b)[Math.floor(openMs.length / 2)],
  prewarmMs: +prewarmMs.toFixed(1), save: sourcePath, ships: simulation.ships().length, verify,
  results: rounds.map(round => ({ revision: round.revision, harbours: round.harbours.map(entry =>
    ({ availability: entry.availability, potential: entry.potential, uid: entry.uid })) })),
  timings: rounds.map(round => ({ advanceFrameMs: round.advanceFrameMs, edit: round.edit,
    revision: round.revision, harbours: round.harbours.map(entry =>
    ({ againMs: +entry.againMs.toFixed(2), availabilityMs: entry.availabilityMs, potentialMs: entry.potentialMs,
      uid: entry.uid })) }))
}, null, 1));
