import { resolve } from "node:path";

import { setNavigationInvalidation } from "../../src/shared/settlement/navigation-change-journal";
import { loadHarbourBenchSession, timed } from "./harbour-bench-session";
import { createHarbourPanelEdits, type HarbourPanelEdit } from "./harbour-panel-edits";

/**
 * JETTY-FRAMES: the render frame's boat jetty work after each player edit and after normal ticks.
 * Each round advances the simulation (tree/crop churn), reads one frame, makes one edit of the
 * round's kind and reads the next frame; `shipSites()` is what every live render frame reads.
 *
 * Usage: npx tsx tools/bench/jetty-frame-timing.ts [save.json]
 * Env: JETTY_ROUNDS (12), JETTY_ADVANCE seconds per round (10), JETTY_LEVEL_SECONDS (120),
 *   JETTY_EDITS (place,demolish,road,decoration,bridge,level), JETTY_VERIFY=1 (strict: every reused
 *   jetty is compared with a full rebuild and a mismatch throws).
 */
const sourcePath = resolve(process.argv[2] ?? "/home/shadowvzs/Downloads/island-settlers-2026-11-08 (3).json");
const roundCount = Number(process.env.JETTY_ROUNDS ?? 12);
const advanceSeconds = Number(process.env.JETTY_ADVANCE ?? 10);
const levelSeconds = Number(process.env.JETTY_LEVEL_SECONDS ?? 120);
const editKinds = (process.env.JETTY_EDITS ?? "place,demolish,road,decoration,bridge,level")
  .split(",").filter(Boolean) as HarbourPanelEdit[];
if (process.env.JETTY_VERIFY === "1") setNavigationInvalidation({ strict: true });
const { simulation, world } = await loadHarbourBenchSession(sourcePath);

const jettyFrames = () => simulation.shipSites().filter(site => site.kind === "jetty");
const frame = () => {
  const { ms, value } = timed(() => simulation.shipSites());
  return { jetties: JSON.stringify(value.filter(site => site.kind === "jetty")), ms };
};
const advance = (seconds: number) => {
  for (let step = 0; step < seconds * 20; step++) simulation.update(.05);
  return frame();
};
const runEdit = createHarbourPanelEdits(simulation, world);
const steadyMs = () => Math.max(...Array.from({ length: 5 }, () => frame().ms));
const rounds = Array.from({ length: roundCount }, (_, round) => {
  const ticks = advance(advanceSeconds);
  const kind = editKinds[round % editKinds.length]!, detail = runEdit(kind);
  const edit = frame();
  const level = kind === "level" && detail ? advance(levelSeconds) : null;
  return { advanceMs: ticks.ms, detail, editMs: edit.ms, jetties: (level ?? edit).jetties, kind,
    levelMs: level?.ms, round, steadyMs: steadyMs() };
});
const frameMs = rounds.flatMap(round => [round.advanceMs, round.editMs, round.levelMs ?? 0]);
console.log(JSON.stringify({
  cellsX: world.cellsX, jettyCount: jettyFrames().length, maxFrameMs: Math.max(...frameMs),
  medianFrameMs: [...frameMs].sort((a, b) => a - b)[Math.floor(frameMs.length / 2)], rounds,
  save: sourcePath
}, null, 1));
