import { DEFAULT_ISLAND_CHOICE, readIslandChoice, toWorldOptions } from "../../src/app/map-generator/helpers";
import { createChartingCandidates } from "../../src/shared/settlement/settlement-charting-candidates";
import { harbourPlacementReason, inspectHarbourNavigation } from "../../src/shared/settlement/settlement-harbour-placement";
import { createScenarioInspectionContext } from "../../src/shared/settlement/settlement-map-scenario";
import { createNavalExpeditions } from "../../src/shared/settlement/settlement-naval-expeditions";
import { makeBuilding } from "../../src/shared/settlement/settlement-placement";
import { createSeaMask } from "../../src/shared/settlement/settlement-sea-navigation";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";
import type { PlayableIslandLayout, WorldData } from "../../src/shared/world/world-data";

/**
 * HARBOUR-SPOTS harbour-site check, scan versus stored spots on the SAME generated map (Node only):
 * - full charting re-check: every harbour site of the map proven again (the ~1-2 s re-check after a
 *   placement/levelling, `settlement-charting-candidates` list()), cold per run;
 * - harbour placement check: `harbourPlacementReason` for each stored spot plot, cold per run.
 * "scan" hides the stored spots, so the runtime falls back to its coast scan.
 * Run: SIZE=512 ISLANDS=3 SEEDS=1234,42,7 RUNS=3 npx tsx tools/bench/harbour-site-check-bench.ts
 */
const size = Number(process.env.SIZE ?? 512);
const islands = Number(process.env.ISLANDS ?? 3);
const seeds = (process.env.SEEDS ?? "1234,42,7").split(",").map(Number);
const runs = Number(process.env.RUNS ?? 3);

const median = (values: number[]) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

const withoutSpots = (layout: PlayableIslandLayout): PlayableIslandLayout =>
  ({ ...layout, sites: layout.sites.map(({ harbourSpots: _spots, ...site }) => site) });

/** A fresh context with its sea/turning masks already built (both modes share that cost). */
const warmContext = (world: WorldData) => {
  const context = createScenarioInspectionContext(world);
  inspectHarbourNavigation(context);
  return context;
};

const timeChartingRecheck = (world: WorldData) => {
  const context = warmContext(world), sea = createSeaMask(world);
  const { site } = createNavalExpeditions(context, sea);
  const started = performance.now();
  const sites = createChartingCandidates(context, sea, site).list();
  return { ms: performance.now() - started, sites: sites.length };
};

const timePlacementChecks = (world: WorldData, plots: readonly { rotation: number; x: number; z: number }[]) => {
  const context = warmContext(world);
  const started = performance.now();
  let valid = 0;
  for (const plot of plots) {
    const building = makeBuilding(context, 39, plot.x, plot.z, plot.rotation);
    if (harbourPlacementReason(context, building) === null) valid++;
  }
  return { ms: performance.now() - started, valid };
};

const measure = (world: WorldData, layout: PlayableIslandLayout, stored: boolean) => {
  world.playableIslands = stored ? layout : withoutSpots(layout);
  const plots = layout.sites.flatMap(site => site.harbourSpots ?? []);
  const recheck = Array.from({ length: runs }, () => timeChartingRecheck(world));
  const placement = Array.from({ length: runs }, () => timePlacementChecks(world, plots));
  world.playableIslands = layout;
  return {
    placementMs: Number(median(placement.map(entry => entry.ms)).toFixed(2)), placementValid: placement[0]!.valid,
    plots: plots.length, recheckMs: Number(median(recheck.map(entry => entry.ms)).toFixed(1)),
    sites: recheck[0]!.sites
  };
};

for (const seed of seeds) {
  const query = new URLSearchParams(`size=${size}&landform=archipelago&islandCount=${islands}&harbourSpots=1`);
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, ...toWorldOptions(readIslandChoice(query, DEFAULT_ISLAND_CHOICE)), seed });
  const layout = world.playableIslands!;
  const scan = measure(world, layout, false), stored = measure(world, layout, true);
  console.log(JSON.stringify({
    seed, scan, stored,
    recheckSpeedup: Number((scan.recheckMs / stored.recheckMs).toFixed(1)),
    placementSpeedup: Number((scan.placementMs / stored.placementMs).toFixed(1))
  }));
}
