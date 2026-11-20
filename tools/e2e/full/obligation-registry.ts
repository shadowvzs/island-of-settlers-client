import type { WorkerNation } from "../../../src/render-common/workers/worker-unit";
import { SAWMILL_TYPE_ID } from "../../../src/shared/settlement/building-type-ids";
import { ROAD_TIERS } from "../../../src/shared/settlement/road-types";
import { COLONY_RESOURCE_TIERS } from "../../../src/shared/world/colony-resource-tiers";
import {
  createAcceptanceManifest, productionLaneBuildings, productionModeCaseId, productionUpgradeCaseId
} from "./acceptance-manifest";
import { NAMES as TROOP_NAMES } from "./military-cases";
import { CHAIN as PRELUDE_CHAIN } from "./natural-prelude-cases";
import { PHASES as PERSISTENCE_PHASES } from "./persistence-cases";

/** Concrete emitted case IDs plus sub-requirements that no implemented case proves yet. */
export interface ObligationRequirements {
  cases: readonly string[];
  uncovered: readonly string[];
}
export interface CoverageObligation {
  id: string;
  task: string;
  title: string;
  resolve: (nation: WorkerNation | null) => ObligationRequirements;
}
type CatalogBuilding = ReturnType<typeof productionLaneBuildings>[number];

const NATION_UNAVAILABLE = "Player nation unavailable; nation-specific catalog case IDs cannot be resolved";
const SAWMILL_SEQUENCING = "Sawmill recipes above level 1 run before the sequential upgrades that unlock them: " +
  "a level-1 checkpoint blocks those mode cases and a pre-upgraded one blocks the upgrade cases";

const fixed = (cases: readonly string[], uncovered: readonly string[] = []) => () => ({ cases, uncovered });
const buildingCases = (building: CatalogBuilding) => [
  ...building.modes.map(mode => productionModeCaseId(building.id, mode)),
  ...(building.upgrade?.steps ?? []).map(step => productionUpgradeCaseId(building.id, step))
];
const catalogCases = (select: (building: CatalogBuilding) => boolean, uncovered: readonly string[]) =>
  (nation: WorkerNation | null): ObligationRequirements => {
    if (!nation) return { cases: [], uncovered: [...uncovered, NATION_UNAVAILABLE] };
    const buildings = productionLaneBuildings(createAcceptanceManifest(nation)).filter(select);
    return { cases: buildings.flatMap(buildingCases), uncovered };
  };
const journeyCases = (kind: "colony" | "adventure") => {
  const steps = ["departure", "arrival", "visit", "conquest", "return-home", "return-receipt"];
  const local = kind === "colony" ? ["local-construction", "local-upgrade", "survivor-recall"] : [];
  return [...steps, ...local].map(step => `E2E-${kind}-${step}`);
};
const preludeCases = () => [
  "E2E-04-prelude-fresh-start",
  ...PRELUDE_CHAIN.map(({ type }) => `E2E-04-prelude-build-${type}`),
  ...PRELUDE_CHAIN.flatMap(({ ware }) => (ware ? [`E2E-06-prelude-produce-${ware}`] : [])),
  "E2E-08-prelude-recruit-shield",
  "E2E-16-prelude-summary"
];
const pavedRoadCases = () => ROAD_TIERS.filter(tier => tier !== "dirt").map(tier => `E2E-05-road-tier-${tier}`);

/** Every explicit full-parent obligation. All required cases must pass within one lane report. */
export const OBLIGATIONS: readonly CoverageObligation[] = [
  { id: "E2E-01-runner-handoff-acceptance", task: "E2E-01", title: "Runner, checkpoint export and handoff",
    resolve: fixed(["E2E-01-initialization", "E2E-01-baseline-export", "E2E-01-result-export"], [
      "Fresh bootstrap and checkpoint restore share E2E-01-initialization, so restored-import proof is not " +
        "separately identifiable"
    ]) },
  { id: "E2E-02-driver-artifact-acceptance", task: "E2E-02", title: "UI driver, recordings and runtime artifacts",
    resolve: fixed(["E2E-02-record-start", "E2E-02-record-export", "E2E-02-runtime-errors"], [
      "Complete cross-lane case matrix and deduplicated findings review are not recorded by any case"
    ]) },
  { id: "E2E-03-tier-fixtures", task: "E2E-03",
    title: "Finite captured fixtures for all four colony resource pairs, including historical legacy saves",
    resolve: fixed(COLONY_RESOURCE_TIERS.map(pair => `E2E-03-colony-pair-${pair.tier}`), [
      "Historical legacy saves (pending upgrades, legacy sawmills, mixed roads) are uncaptured",
      "One progression checkpoint per run proves at most one tier pair; four tier checkpoints are not orchestrated"
    ]) },
  { id: "E2E-03-resource-authoring", task: "E2E-03",
    title: "Author/survey usable mine, marble and hardwood targets; road-free geologist return",
    resolve: fixed(["E2E-03-generator-ui", "E2E-03-generator-resources"], [
      "Authoring/survey of usable mine, marble and hardwood targets", "Road-free geologist return"
    ]) },
  { id: "E2E-04-full-natural", task: "E2E-04",
    title: "All natural footprints/rotations, cancellation/demolition and restored construction",
    resolve: fixed(["E2E-04-catalog-ui", "E2E-04-natural-well", "E2E-04-natural-woodcutter"], [
      "Natural construction of every footprint and rotation", "Construction cancellation/demolition",
      "Restored in-progress construction", "Mines/weapons and harbour/shipyard/launch chain"
    ]) },
  { id: "E2E-05-six-tier-carts", task: "E2E-05",
    title: "Real loaded carts on every paved tier, multi-angle visuals and cost conservation",
    resolve: () => ({ cases: pavedRoadCases(), uncovered: [
      "Loaded cart traversal on each paved tier", "Exact road payment/cost conservation", "Multi-angle visual captures"
    ] }) },
  { id: "E2E-05-road-integrity", task: "E2E-05",
    title: "Road upgrade/removal, boulder/hidden-stone persistence and multi-angle visual review",
    resolve: fixed(["E2E-05-catalog-terrain"], [
      "Terrain grading checks around road upgrade/removal", "Boulder/hidden-stone persistence",
      "Multi-angle visual review"
    ]) },
  { id: "E2E-06-five-recipe-reload", task: "E2E-06",
    title: "Manual sawmill selection across all five recipes, mid-cycle switch/reload and escrow conservation",
    resolve: catalogCases(building => building.id === SAWMILL_TYPE_ID, [
      "Mid-cycle recipe switch and reload", "Recipe escrow conservation", SAWMILL_SEQUENCING
    ]) },
  { id: "E2E-06-all-modes", task: "E2E-06",
    title: "Three delivered cycles in every production mode and supported upgrade",
    resolve: catalogCases(() => true, [SAWMILL_SEQUENCING]) },
  { id: "E2E-06-output-threshold", task: "E2E-06",
    title: "Full shelf prevents new work while an already-started full batch finishes",
    resolve: fixed([], ["No case fills an output shelf to observe the soft start threshold"]) },
  { id: "E2E-06-service-accounting", task: "E2E-06",
    title: "Service buildings, missing-input recovery and concurrent per-ware accounting",
    resolve: fixed([], [
      "Service buildings have no dedicated assertions", "Missing-input recovery",
      "Independent per-ware accounting during concurrent production"
    ]) },
  { id: "E2E-07-recovery", task: "E2E-07",
    title: "Opposing traffic, horse/cart/harbour stress and route-change recovery with goods conserved",
    resolve: fixed(["E2E-07-live-road-upgrade", "E2E-07-remove-reconnect"], [
      "Deliberate opposing junction/door traffic", "Horse/cart/harbour congestion stress",
      "Exact goods conservation across route changes"
    ]) },
  { id: "E2E-08-recruitment-territory", task: "E2E-08",
    title: "Real Tavern recruitment, military construction, rally/cancel/return and territory",
    resolve: fixed([
      "E2E-08-natural-tavern", ...Object.keys(TROOP_NAMES).map(type => `E2E-08-recruit-${type}`),
      "E2E-08-frontier-garrison", "E2E-08-rally-cancel"
    ], [
      "Troop return after a rally", "Empty-site versus garrison-arrival territory timing",
      "All compositions, upgrades and pending orders"
    ]) },
  { id: "E2E-09-cross-island-ships", task: "E2E-09",
    title: "Concurrent voyages, manifests/ETAs, blocked harbours, switching and restore",
    resolve: fixed(["E2E-09-island-register"], [
      "Concurrent voyages, visits and transfers", "Blocked harbours and supplies",
      "Island switching and restore with manifests/ETAs"
    ]) },
  { id: "E2E-10-adventure-journey", task: "E2E-10",
    title: "Sail, land, fight, objectives, return, exactly-once rewards and failure branches",
    resolve: fixed(journeyCases("adventure"), [
      "Failure, cancel and expiry branches", "Objectives across themes and difficulties"
    ]) },
  { id: "E2E-11-colony-journey", task: "E2E-11",
    title: "Actual colony conquest, local economy, garrisons, upgrades and return shipments",
    resolve: fixed(journeyCases("colony"), [
      "Local colony production economy", "Garrison supply and reinforcements",
      "Resource return shipments and revisits during work"
    ]) },
  { id: "E2E-12-reward-progression", task: "E2E-12",
    title: "Real quest progress/claim/reload and duplicate-reward prevention",
    resolve: fixed(["E2E-12-tutorial-progress-claim", "E2E-12-daily-progress-claim", "E2E-12-claim-reload"]) },
  { id: "E2E-12-objective-matrix", task: "E2E-12",
    title: "All objective kinds/payments, midnight rollover and nation/level/expedition eligibility",
    resolve: fixed([], [
      "All objective kinds and delivery payments", "Midnight rollover", "Nation/level/expedition eligibility"
    ]) },
  { id: "E2E-13-phase-conservation", task: "E2E-13",
    title: "Phase-specific actor/goods ownership, timers, offline progress and linked recordings",
    resolve: fixed(PERSISTENCE_PHASES.map(phase => `E2E-13-${phase}-restore`), [
      "Offline progress conservation", "Post-restore continuation", "Linked recording validation across restores",
      "One checkpoint rarely holds every active phase; per-phase fixtures are not orchestrated"
    ]) },
  { id: "E2E-14-contextual-review", task: "E2E-14",
    title: "Minimap/locate/follow, menu and camera input, mobile/touch and contextual animation review",
    resolve: fixed([
      "E2E-14-camera-picking", "E2E-14-minimap", "E2E-14-menu", "E2E-14-camera-input", "E2E-14-follow"
    ], [
      "Mobile/touch controls", "Contextual job/tool/gear/nation animation review"
    ]) },
  { id: "E2E-15-army-voyage-soaks", task: "E2E-15",
    title: "16/32/64/128 troop branches, multi-voyage throughput, route/queue CPU and reload",
    resolve: fixed(["E2E-15-exclusive-soak"], [
      "16/32/64/128 troop branches", "Multi-voyage throughput and route/queue CPU", "Mid-run reload",
      "Calibrated budgets and baseline versus recording comparison"
    ]) },
  { id: "E2E-16-continuous-journey", task: "E2E-16",
    title: "Uninterrupted natural home/colony/adventure/return journey and reviewed findings",
    resolve: fixed([
      ...preludeCases(), "E2E-16-continuous-prerequisite", ...journeyCases("colony"), ...journeyCases("adventure")
    ], [
      "Fresh-HQ prelude stops before harbour/shipyard/fleet readiness; no uninterrupted F0-to-voyage chain exists",
      "Deduplicated reviewed findings and fresh fixed-case reruns"
    ]) }
];

/** Nation-independent IDs for cross-lane aggregation. */
export const COVERAGE_REQUIREMENTS = OBLIGATIONS.map(({ id, task }) => ({ id, task }));
