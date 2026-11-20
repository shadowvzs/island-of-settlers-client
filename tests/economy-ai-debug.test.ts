import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createExternalStore } from "../src/app/components/ui-store";
import { EconomyAiPanel } from "../src/app/settlement/economy-ai-debug/economy-ai-panel";
import { getEconomyAiView, topGoals } from "../src/app/settlement/economy-ai-debug/helpers";
import { createEconomyAiProbeLog } from "../src/app/settlement/economy-ai-debug/probe-log";
import type { EconomyAiPanelState, EconomyAiViewInput } from "../src/app/settlement/economy-ai-debug/types";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { NO_CANDIDATE_PLOT } from "../src/shared/settlement/economy-ai/constants";
import type {
  DevelopGoalReport, DevelopGoalTerms
} from "../src/shared/settlement/economy-ai/develop-diagnostics";
import { setFactionAiProbe } from "../src/shared/settlement/economy-ai/faction-ai-probe";
import type { FactionAiSnapshot } from "../src/shared/settlement/economy-ai/faction-ai-types";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { economyCampaignScenario } from "./helpers/economy-factions";
import { huntingWorld } from "./helpers/hunting-world";
import { renderWithI18n } from "./helpers/render-with-i18n";

/** EAI3d: the economy AI "why" panel's view model, its probe log and the simulation's probe entries. */
const AI = 2;
const WOODCUTTER = 17;
const SAWMILL = 33;
const CELLS_X = 64;
const NOW = 1000;

const terms = (id: string, changes: Partial<DevelopGoalTerms> = {}): DevelopGoalTerms => ({
  cost: 150, deficit: 2, factor: 12_000, id, score: 2250, status: "scored", threat: 0, typeId: WOODCUTTER,
  wanted: 2400, weight: 10, ...changes
});

const report = (goals: DevelopGoalTerms[], changes: Partial<DevelopGoalReport> = {}): DevelopGoalReport =>
  ({ goals, openSites: 0, posture: "grow", soldiers: 0, ...changes });

const snapshot = (changes: Partial<FactionAiSnapshot> = {}): FactionAiSnapshot => ({
  decisions: [5, 25, 50, 16], due: [1100, 1020, 1000, 1045], faction: AI, mode: "develop",
  threat: { health: 0, soldiers: 0 }, ...changes
});

const viewOf = (snapshots: FactionAiSnapshot[], log = createEconomyAiProbeLog(),
  authored: EconomyAiViewInput["authored"] = []) => getEconomyAiView({
  authored, buildingName: typeId => getBuildingDefinition(typeId).name, cellsX: CELLS_X,
  footprint: typeId => getBuildingDefinition(typeId).gridFootprint, logOf: log.of, snapshots, tick: NOW
});

const valueOf = (rows: readonly { label: string; value: string }[], label: string) =>
  rows.find(row => row.label === label)?.value;

describe("economy AI why panel: view model", () => {
  it("shows mode, style, level, threat and the layer clocks; a script's choice wins over the map's", () => {
    const authored = [{ faction: AI, level: "hard", mode: "develop", style: "turtle" }] as const;
    const [mapChoice] = viewOf([snapshot()], undefined, authored);
    expect(mapChoice!.title).toBe("Faction 2");
    expect(valueOf(mapChoice!.setting, "Mode")).toBe("develop");
    expect(valueOf(mapChoice!.setting, "Style")).toBe("turtle");
    expect(valueOf(mapChoice!.setting, "Level")).toBe("hard");
    expect(valueOf(mapChoice!.setting, "Threat")).toBe("none known");
    expect(valueOf(mapChoice!.setting, "Decisions")).toBe("S 5 · P 25 · E 50 · M 16");
    expect(valueOf(mapChoice!.setting, "Next in")).toBe("S 5 s · P 1 s · E 0 s · M 3 s");
    const [scripted] = viewOf([snapshot({ level: "easy", paused: true, style: "aggressive" })], undefined, authored);
    expect(valueOf(scripted!.setting, "Mode")).toBe("develop (paused)");
    expect(valueOf(scripted!.setting, "Style")).toBe("aggressive");
    expect(valueOf(scripted!.setting, "Level")).toBe("easy");
    expect(scripted!.waits).toEqual(["Paused by a script: no decisions."]);
    const [maintain] = viewOf([snapshot({ mode: "maintain" })]);
    expect(valueOf(maintain!.setting, "Style")).toBeUndefined();
    expect(valueOf(maintain!.setting, "Level")).toBe("island difficulty");
    expect(maintain!.goalsNote).toBe("Only a develop faction scores build goals.");
  });

  it("lists the top 3 goals with their score terms, scored first, and marks the committed one", () => {
    const goals = [
      terms("woodcutter"),
      terms("sawmill", { score: -40, status: "unpaid", shortage: { have: 2, need: 4, ware: "planks" } }),
      terms("forester", { status: "prerequisite" }),
      terms("quarry", { cost: 0, factor: 10_000, score: 3000, weight: 15 }),
      terms("tower", { score: -500, threat: 900 })
    ];
    expect(topGoals(report(goals)).map(goal => goal.id)).toEqual(["quarry", "woodcutter", "tower"]);
    const log = createEconomyAiProbeLog();
    log.recorder.goals!(AI, 900, report(goals, { chosen: "woodcutter", posture: "fortify", soldiers: 3 }));
    const [view] = viewOf([snapshot({ develop: { goal: { id: "woodcutter", target: 2 } } })], log);
    expect(view!.goal).toBe("woodcutter (wants 2)");
    expect(view!.goalsNote).toBe("Scored at 0:45, posture fortify.");
    expect(view!.goals).toEqual([
      { committed: false, cost: "0", deficit: "2", factor: "×1.00", id: "quarry", score: "30.00", state: "payable",
        threat: "0", title: "Woodcutter", weight: "15" },
      { committed: true, cost: "−1.50", deficit: "2", factor: "×1.20", id: "woodcutter", score: "22.50",
        state: "payable", threat: "0", title: "Woodcutter", weight: "10" },
      { committed: false, cost: "−1.50", deficit: "2", factor: "×1.20", id: "tower", score: "-5.00",
        state: "threat near", threat: "−9.00", title: "Woodcutter", weight: "10" }
    ]);
    expect(valueOf(view!.setting, "Posture")).toBe("fortify");
    expect(view!.waits).toEqual([]);
  });

  it("explains a faction without a goal: no stock, threat near, prerequisite, backoff until t, complete", () => {
    const log = createEconomyAiProbeLog();
    expect(viewOf([snapshot()], log)[0]!.waits).toEqual(["No goal yet: waiting for the next strategic decision."]);
    log.recorder.goals!(AI, 900, report([
      terms("woodcutter", { status: "backoff" }),
      terms("sawmill", { status: "unpaid", shortage: { have: 2, need: 4, ware: "planks" }, typeId: SAWMILL }),
      terms("tower", { score: -500, threat: 900 }),
      terms("forester", { status: "prerequisite" })
    ]));
    log.recorder.goalRefused!(AI, 880, WOODCUTTER, NO_CANDIDATE_PLOT);
    const develop = { backoffs: [{ attempts: 2, goal: "woodcutter", retryTick: 1240 }] };
    const [view] = viewOf([snapshot({ develop, threat: { health: 240.4, soldiers: 3 } })], log);
    expect(view!.goal).toBe("none");
    expect(view!.waits).toEqual([
      "Backoff until 1:02 (in 12 s): woodcutter (no candidate plot).",
      "Threat known: 3 soldiers known (health 240).",
      "sawmill: no stock: planks 2/4.",
      "tower: threat near (score -5.00).",
      "forester: a prerequisite goal is not finished."
    ]);
    expect(view!.backoffs).toEqual([
      { label: "Goal woodcutter", value: "×2 · until 1:02 (in 12 s) · No candidate plot" }
    ]);
    log.recorder.goals!(AI, 950, report([]));
    expect(viewOf([snapshot()], log)[0]!.waits).toEqual(["Program complete: no goal misses a building."]);
    expect(viewOf([snapshot({ mode: "none" })], log)[0]!.waits).toEqual(["Mode none: no decisions."]);
  });

  it("shows the planner's waiting step, the refused plots with their reasons and the map marks", () => {
    const log = createEconomyAiProbeLog();
    const entry = (10 * CELLS_X + 20) * 4 + 1, later = (12 * CELLS_X + 30) * 4;
    log.recorder.plotRefused!(AI, 900, WOODCUTTER, entry, "Too steep");
    log.recorder.plotRefused!(AI, 900, WOODCUTTER, 4, "Forgotten");
    log.prunePlots(AI, new Set([`${WOODCUTTER}/${entry}`]));
    expect(log.of(AI)!.plotReasons.size).toBe(1);
    log.recorder.goalRefused!(AI, 940, SAWMILL, NO_CANDIDATE_PLOT);
    const planner = {
      memo: [{ entry, expires: 1400, fingerprint: 1, typeId: WOODCUTTER },
        { entry: later, expires: 1800, fingerprint: 2, typeId: SAWMILL }],
      pending: { candidates: [later, entry], road: [], stage: 1, typeId: SAWMILL }
    };
    const [view] = viewOf([snapshot({ planner })], log);
    expect(view!.planner).toEqual([
      { label: "Pending step", value: "Sawmill · road target · plot 30,12 r0 · 2 waiting" },
      { label: "Last refused goal", value: "Sawmill · No candidate plot · at 0:47" },
      { label: "Refused plots", value: "2 remembered" },
      { label: "Sawmill @ 30,12 r0", value: "reason not recorded · forgets in 40 s" },
      { label: "Woodcutter @ 20,10 r1", value: "Too steep · forgets in 20 s" }
    ]);
    const [width, depth] = getBuildingDefinition(WOODCUTTER).gridFootprint;
    expect(view!.plots[0]).toEqual({ kind: "refused", label: "Too steep", x: 20 + depth / 2, z: 10 + width / 2 });
    expect(view!.plots.map(mark => `${mark.kind} ${mark.label}`))
      .toEqual(["refused Too steep", "refused refused", "candidate #1", "candidate #2"]);
    expect(viewOf([snapshot()])[0]!.planner).toEqual([
      { label: "Pending step", value: "idle" }, { label: "Refused plots", value: "0 remembered" }
    ]);
  });

  it("shows the maintain queue, its backoffs and the last rebuild, re-garrison and repair", () => {
    const log = createEconomyAiProbeLog();
    expect(viewOf([snapshot()], log)[0]!.maintain).toEqual([
      { label: "Rebuild", value: "0 waiting · nothing recorded" },
      { label: "Re-garrison", value: "nothing recorded" },
      { label: "Repair", value: "0 in backoff · nothing recorded" }
    ]);
    log.recorder.maintain!(AI, 600, "rebuild", "Not enough planks");
    log.recorder.maintain!(AI, 800, "garrison", "4");
    log.recorder.maintain!(AI, 900, "repair", "done");
    const maintain = {
      rebuilds: [{ attempts: 1, retryTick: 1100, rotation: 0, typeId: WOODCUTTER, uid: 7, x: 5, z: 5 },
        { rotation: 0, typeId: SAWMILL, uid: 8, x: 9, z: 9 }],
      repairs: [{ attempts: 3, retryTick: 990, uid: 12 }]
    };
    const [view] = viewOf([snapshot({ maintain, mode: "maintain" })], log);
    expect(view!.maintain).toEqual([
      { label: "Rebuild", value: "2 waiting · last: refused (Not enough planks) at 0:30" },
      { label: "Re-garrison", value: "last: 4 soldiers sent at 0:40" },
      { label: "Repair", value: "1 in backoff · last: repairer sent at 0:45" }
    ]);
    expect(view!.backoffs).toEqual([
      { label: "Rebuild Woodcutter", value: "×1 · until 0:55 (in 5 s)" },
      { label: "Repair #12", value: "×3 · due now" }
    ]);
    expect(view!.manager).toEqual([]);
  });
});

describe("economy AI why panel: view", () => {
  const renderPanel = (state: EconomyAiPanelState) => renderWithI18n(createElement(EconomyAiPanel, {
    session: { marksShown: createExternalStore(true), state: createExternalStore(state) }
  }));

  it("renders the selected faction compactly and the faction switch only for several factions", () => {
    const log = createEconomyAiProbeLog();
    log.recorder.goals!(AI, 900, report([terms("woodcutter")]));
    const factions = viewOf([snapshot({ develop: { goal: { id: "woodcutter", target: 2 } } })], log);
    const single = renderPanel({ clock: "Game time", factions });
    expect(single).toContain('<span role="status">Game time</span>');
    expect(single).toContain("Plots on map");
    expect(single).toContain("<h3>Faction 2</h3>");
    expect(single).toContain("Committed: <strong>woodcutter (wants 2)</strong>");
    expect(single)
      .toContain('<tr aria-current="true" title="Woodcutter"><th scope="row">woodcutter</th><td>22.50</td>');
    expect(single).not.toContain("Waiting because");
    expect(single).toContain("Economy manager");
    expect(single).toContain("Stock targets (grow)");
    expect(single).not.toContain('aria-label="AI faction"');
    const both = [...factions, ...viewOf([snapshot({ faction: 3, mode: "none" })])];
    const several = renderPanel({ clock: "", factions: both });
    expect(several).toContain('<button aria-pressed="true" title="Faction 2" type="button">2</button>');
    expect(several).toContain('<button aria-pressed="false" title="Faction 3" type="button">3</button>');
    expect(renderPanel({ clock: "", factions: [] })).toContain("No AI faction on this island");
  });
});

describe("economy AI why panel: probe entries of the simulation", () => {
  const DEPOT = { typeId: 0, x: 47, z: 46 };
  const START_KIT = { settlers: 6, stock: { axe: 2, hammer: 3, logs: 12, planks: 40, pickaxe: 1, saw: 1, stone: 30 } };
  const BUILDABLE = [{ bottom: 14, left: 6, right: 14, top: 6 }, { bottom: 49, left: 43, right: 50, top: 42 }];
  const TICKS = 700;

  /** Only the depot (and the player's start) can carry a foundation: the planner finds no plot. */
  const depotOnlyGround = (world: WorldData) => {
    world.buildCap.fill(BUILD.none);
    for (const { bottom, left, right, top } of BUILDABLE)
      for (let z = top; z <= bottom; z++) for (let x = left; x <= right; x++)
        world.buildCap[z * world.cellsX + x] = BUILD.large;
  };

  const island = (shape?: (world: WorldData) => void) => {
    const world = huntingWorld();
    shape?.(world);
    world.scenario = economyCampaignScenario([AI], "develop", "colony");
    let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
    const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
    simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 0, initialSettlers: 8,
      roads, world });
    expect(simulation.aiPlace(AI, DEPOT, START_KIT).ok).toBe(true);
    return { simulation, world };
  };

  const run = (simulation: ReturnType<typeof island>["simulation"]) => {
    while (simulation.gameTick() < TICKS) simulation.update(.05);
    return hashText(canonicalJson({ ...simulation.saveState(), accumulator: 0 }));
  };

  afterEach(() => setFactionAiProbe(null));

  it("records the scored goals of a strategic decision and leaves the state hash unchanged", () => {
    const silent = run(island().simulation);
    const log = createEconomyAiProbeLog();
    setFactionAiProbe(log.recorder);
    const { simulation } = island();
    expect(run(simulation)).toBe(silent);
    const recorded = log.of(AI)!.report!;
    expect(recorded.posture).toBe("grow");
    expect(recorded.goals.length).toBeGreaterThan(0);
    for (const goal of recorded.goals) {
      expect(goal.score).toBe(goal.wanted - goal.cost - goal.threat);
      expect(goal.wanted).toBe(Math.floor(goal.deficit * goal.weight * goal.factor / 100));
    }
    const [view] = viewOf(simulation.factionAiDiagnostics(), log);
    expect(view!.goals.length).toBeGreaterThan(0);
    expect(view!.goals.length).toBeLessThanOrEqual(3);
  });

  it("hears why the planner refused a goal: no candidate plot, then the backoff wait reason", () => {
    const log = createEconomyAiProbeLog();
    setFactionAiProbe(log.recorder);
    const { simulation } = island(depotOnlyGround);
    run(simulation);
    expect(log.of(AI)!.goalRefusals.get(WOODCUTTER)?.detail).toBe(NO_CANDIDATE_PLOT);
    const view = getEconomyAiView({
      authored: [], buildingName: typeId => getBuildingDefinition(typeId).name, cellsX: CELLS_X,
      footprint: typeId => getBuildingDefinition(typeId).gridFootprint, logOf: log.of,
      snapshots: simulation.factionAiDiagnostics(), tick: simulation.gameTick()
    })[0]!;
    expect(view.backoffs[0]!.label).toBe("Goal woodcutter");
    expect(view.backoffs[0]!.value).toContain(NO_CANDIDATE_PLOT);
    expect(valueOf(view.planner, "Last refused goal")).toContain("Woodcutter · No candidate plot");
  });
});
