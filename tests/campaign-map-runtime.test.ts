import { describe, expect, it } from "vitest";

import type { CampaignCargo } from "../../island-of-settlers-shared/src/campaign/campaign-model";
import type { MapScript } from "../../island-of-settlers-shared/src/script/types/index";
import {
  doStep, emptyScript, num, ref, str, trigger
} from "../../island-of-settlers-shared/tests/script-fixtures";
import type { CampaignOutcomeRecord } from "../src/shared/campaign/campaign-map-outcome";
import {
  campaignCargoTroops, campaignRunWorld, campaignStartOptions
} from "../src/shared/campaign/campaign-start";
import { BuildingType, HARBOUR_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import { createMapScenario } from "../src/shared/world/map-scenario";
import type { WorldData } from "../src/shared/world/world-data";
import { edgeBayWorld } from "./helpers/edge-bay-settlement";
import { huntingWorld } from "./helpers/hunting-world";

/**
 * C9a: a campaign attempt starts at its landing harbour with the delivered cargo; `endMap` and the landing
 * harbour's loss decide the map once, defeat first within a tick (R19); other islands carry no campaign state.
 */

const CARGO: CampaignCargo = {
  goods: [{ amount: 20, ware: "planks" }, { amount: 5, ware: "stone" }, { amount: 4, ware: "planks" }],
  settlers: 6,
  soldiers: [{ amount: 2, type: "shield" }, { amount: 1, type: "archer" }]
};
const RULES = { commanderAllowed: false, disabledBuildings: [{ buildingType: BuildingType.Woodcutter, maxLevel: null }],
  lodgeAllowed: false };

const create = (world: WorldData, options: Partial<Parameters<typeof createSettlementSimulation>[0]> = {}) => {
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, clockStart: 0, roads, world, ...options });
  return simulation;
};

/** The edge bay's harbour plot, found by an ordinary harbour start on the same world. */
const harbourPlot = () => {
  const home = create(edgeBayWorld(), { homeBuilding: HARBOUR_TYPE_ID, initialSettlers: 0 }).home()!;
  return { rotation: home.rotation, x: home.x, z: home.z };
};
const PLOT = harbourPlot();

const campaignWorld = (script?: MapScript) => {
  const world = edgeBayWorld();
  world.scenario = { ...createMapScenario(), harbourPlot: PLOT, kind: "campaign" };
  world.script = script;
  return campaignRunWorld(world, RULES);
};

const startRun = (script?: MapScript, onCampaignOutcome?: (outcome: CampaignOutcomeRecord) => void) =>
  create(campaignWorld(script), { ...campaignStartOptions({ cargo: CARGO, nation: "viking" }), onCampaignOutcome });

const endMapScript = (...outcomes: string[]) => emptyScript({
  triggers: outcomes.map((outcome, index) =>
    trigger(`end-${index}`, { actions: [doStep(`s${index}`, "endMap", { outcome: str(outcome) })] }))
});

/** One trigger per `[outcome, exit]` pair, in order: `endMap(outcome, exit)`. */
const exitScript = (...ends: [outcome: string, exit: string][]) => emptyScript({
  triggers: ends.map(([outcome, exit], index) => trigger(`end-${index}`,
    { actions: [doStep(`s${index}`, "endMap", { exit: ref("exit", exit), outcome: str(outcome) })] }))
});

const stateHash = (simulation: SettlementSimulation) => hashText(canonicalJson(simulation.saveState()));
const advance = (simulation: SettlementSimulation, ticks: number) => {
  for (let tick = 0; tick < ticks; tick++) simulation.update(0.05);
};

describe("campaign start state (C9a)", () => {
  it("lands at the harbour plot with the delivered cargo, the home nation, Normal and the map's rules", () => {
    const run = startRun();
    const home = run.home()!;
    expect({ colonyHome: home.colonyHome, typeId: home.typeId, x: home.x, z: home.z })
      .toEqual({ colonyHome: true, typeId: HARBOUR_TYPE_ID, x: PLOT.x, z: PLOT.z });
    expect(home.inventory).toEqual({ planks: 24, stone: 5 });
    expect(home.idleSettlers).toBe(6);
    expect(run.playerNation()).toBe("viking");
    expect(run.islandRole()).toBe("campaign");
    expect(run.offersBuilding(BuildingType.Woodcutter)).toBe(false);
    expect(run.offersBuilding(BuildingType.CommandersLodge)).toBe(false);
    expect(run.saveState().difficulty).toBeUndefined();
    expect(run.saveState().campaignMap).toEqual({ harbour: home.uid });
  });

  it("stations the delivered soldiers at the landing harbour before the first tick only", () => {
    const run = startRun();
    expect(run.stationCampaignStartTroops(campaignCargoTroops(CARGO.soldiers))).toBe(true);
    expect(run.militarySoldiers().map(soldier => soldier.combat?.type).sort()).toEqual(["archer", "shield", "shield"]);
    advance(run, 1);
    expect(run.stationCampaignStartTroops(campaignCargoTroops(CARGO.soldiers))).toBe(false);
  });

  it("builds identical islands from the same record and cargo (two-start hash)", () => {
    const first = startRun(), second = startRun();
    expect(stateHash(second)).toBe(stateHash(first));
    advance(first, 200);
    advance(second, 200);
    expect(stateHash(second)).toBe(stateHash(first));
  });

  it("refuses a map file that is not a campaign map or has no landing harbour", () => {
    const world = edgeBayWorld();
    world.scenario = { ...createMapScenario(), kind: "colony" };
    expect(() => campaignRunWorld(world, RULES)).toThrow(/campaign map file/);
    world.scenario = { ...createMapScenario(), kind: "campaign" };
    expect(() => campaignRunWorld(world, RULES)).toThrow(/landing harbour/);
  });
});

describe("campaign map outcome (C9a)", () => {
  it("records the script's victory once, refuses a second endMap and keeps it across a reload", () => {
    const outcomes: CampaignOutcomeRecord[] = [];
    const run = startRun(endMapScript("victory", "defeat"), outcome => outcomes.push(outcome));
    advance(run, 2);
    expect(outcomes).toEqual([{ kind: "victory", reason: "script", tick: 0 }]);
    expect(run.campaignOutcome()).toEqual(outcomes[0]);
    const reloaded = startRun(endMapScript("victory", "defeat"), outcome => outcomes.push(outcome));
    expect(reloaded.loadState(structuredClone(run.saveState()))).toEqual({ ok: true });
    advance(run, 5);
    advance(reloaded, 5);
    expect(reloaded.campaignOutcome()).toEqual(outcomes[0]);
    expect(outcomes).toHaveLength(1);
    expect(stateHash(reloaded)).toBe(stateHash(run));
  });

  it("loses the map when the landing harbour is gone, before the script's victory of the same tick (R19)", () => {
    const outcomes: CampaignOutcomeRecord[] = [];
    const run = startRun(endMapScript("victory"));
    const saved = structuredClone(run.saveState());
    // The landing harbour left the world (BD3 removes a fallen building): its uid no longer resolves.
    saved.campaignMap = { harbour: 9999 };
    const lost = startRun(endMapScript("victory"), outcome => outcomes.push(outcome));
    expect(lost.loadState(saved)).toEqual({ ok: true });
    advance(lost, 3);
    expect(outcomes).toEqual([{ kind: "defeat", reason: "harbourLost", tick: 0 }]);
    expect(lost.campaignOutcome()?.kind).toBe("defeat");
  });

  it("drops every waiting script run when the map ends (C9b, trigger design §11)", () => {
    const outcomes: CampaignOutcomeRecord[] = [];
    const script = emptyScript({ triggers: [
      trigger("late-defeat", { actions: [{ id: "w", k: "wait", seconds: num(2) },
        doStep("d", "endMap", { outcome: str("defeat") })] }),
      trigger("victory", { actions: [doStep("v", "endMap", { outcome: str("victory") }),
        doStep("after", "endMap", { outcome: str("defeat") })] })
    ] });
    const run = startRun(script, outcome => outcomes.push(outcome));
    advance(run, 1);
    expect(run.saveState().scriptRun?.state.runs).toEqual([]);
    advance(run, 60);
    expect(outcomes).toEqual([{ kind: "victory", reason: "script", tick: 0 }]);
  });

  it("records the exit of a script victory, refuses a second endMap with another exit, same hash after a reload",
    () => {
      const outcomes: CampaignOutcomeRecord[] = [];
      const script = exitScript(["victory", "exit-2"], ["victory", "exit-1"]);
      const run = startRun(script, outcome => outcomes.push(outcome));
      advance(run, 2);
      expect(outcomes).toEqual([{ exit: "exit-2", kind: "victory", reason: "script", tick: 0 }]);
      expect(run.saveState().campaignMap?.outcome).toEqual(outcomes[0]);
      const reloaded = startRun(script, outcome => outcomes.push(outcome));
      expect(reloaded.loadState(structuredClone(run.saveState()))).toEqual({ ok: true });
      advance(run, 5);
      advance(reloaded, 5);
      expect(reloaded.campaignOutcome()).toEqual(outcomes[0]);
      expect(outcomes).toHaveLength(1);
      expect(stateHash(reloaded)).toBe(stateHash(run));
    });

  it("hashes the exit: two starts with the same exit agree, another exit or none differs", () => {
    const ended = (script: MapScript) => {
      const run = startRun(script);
      advance(run, 3);
      return stateHash(run);
    };
    const named = ended(exitScript(["victory", "exit-1"]));
    expect(ended(exitScript(["victory", "exit-1"]))).toBe(named);
    expect(ended(exitScript(["victory", "exit-2"]))).not.toBe(named);
    expect(ended(endMapScript("victory"))).not.toBe(named);
  });

  it("stores the implicit victory exit as absent and refuses an exit on a defeat", () => {
    const implicit = startRun(exitScript(["victory", "victory"]));
    advance(implicit, 2);
    expect(implicit.campaignOutcome()).toEqual({ kind: "victory", reason: "script", tick: 0 });
    const defeat = startRun(exitScript(["defeat", "exit-1"], ["victory", "exit-1"]));
    advance(defeat, 2);
    expect(defeat.campaignOutcome()).toEqual({ exit: "exit-1", kind: "victory", reason: "script", tick: 0 });
  });

  it("loses the map before a same-tick victory through a named exit (R19)", () => {
    const run = startRun(exitScript(["victory", "exit-1"]));
    const saved = structuredClone(run.saveState());
    saved.campaignMap = { harbour: 9999 };
    const lost = startRun(exitScript(["victory", "exit-1"]));
    expect(lost.loadState(saved)).toEqual({ ok: true });
    advance(lost, 3);
    expect(lost.campaignOutcome()).toEqual({ kind: "defeat", reason: "harbourLost", tick: 0 });
  });

  it("refuses a saved exit on a defeat, on a built-in rule, malformed or spelled as the implicit exit", () => {
    const saved = (outcome: Record<string, unknown>) => {
      const state = structuredClone(startRun().saveState()) as unknown as Record<string, unknown>;
      state.campaignMap = { harbour: (state.campaignMap as { harbour: number }).harbour, outcome };
      return startRun().loadState(state as never).ok;
    };
    expect(saved({ exit: "exit-1", kind: "victory", reason: "script", tick: 0 })).toBe(true);
    expect(saved({ exit: "exit-1", kind: "defeat", reason: "script", tick: 0 })).toBe(false);
    expect(saved({ exit: "exit-1", kind: "victory", reason: "rule", tick: 0 })).toBe(false);
    expect(saved({ exit: "exit 1", kind: "victory", reason: "script", tick: 0 })).toBe(false);
    expect(saved({ exit: "victory", kind: "victory", reason: "script", tick: 0 })).toBe(false);
  });

  it("pays no authored scenario coins and announces no scenario outcome on a campaign map (C12)", () => {
    const world = campaignWorld();
    world.scenario = { ...world.scenario!, claimSeconds: 0, rewardCoins: 500 };
    const outcomes: string[] = [];
    const run = create(world, { ...campaignStartOptions({ cargo: CARGO, nation: "viking" }),
      onScenarioOutcome: status => outcomes.push(status) });
    const coins = run.resourceTotal("coins");
    for (let step = 0; step < 60; step++) run.update(.05);
    expect(run.resourceTotal("coins")).toBe(coins);
    expect(outcomes).toEqual([]);
  });

  it("refuses an invalid saved campaign state", () => {
    const run = startRun();
    const saved = structuredClone(run.saveState()) as unknown as Record<string, unknown>;
    saved.campaignMap = { harbour: 0, outcome: { kind: "draw", reason: "script", tick: 0 } };
    const result = startRun().loadState(saved as never);
    expect(result.ok).toBe(false);
  });

  it("leaves other islands without campaign state, so endMap is refused there", () => {
    const world = huntingWorld();
    world.script = endMapScript("victory");
    const island = create(world, { initialSettlers: 0 });
    advance(island, 2);
    expect(island.campaignOutcome()).toBeUndefined();
    expect("campaignMap" in island.saveState()).toBe(false);
  });
});
