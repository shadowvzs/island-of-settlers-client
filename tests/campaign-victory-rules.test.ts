import { describe, expect, it } from "vitest";

import type { CampaignVictoryRule } from "../../island-of-settlers-shared/src/campaign/campaign-model";
import type { MapRegion } from "../../island-of-settlers-shared/src/campaign/campaign-regions";
import type { CampaignOutcomeRecord } from "../src/shared/campaign/campaign-map-outcome";
import { campaignRunWorld, campaignStartOptions } from "../src/shared/campaign/campaign-start";
import {
  campaignHoldsArea, campaignRuleMet, campaignVictoryCheck, type CampaignVictoryWorld
} from "../src/shared/campaign/campaign-victory";
import { HARBOUR_TYPE_ID, HEADQUARTERS_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { createMapScenario, type ScenarioUnit } from "../src/shared/world/map-scenario";
import type { WorldData } from "../src/shared/world/world-data";
import { edgeBayWorld } from "./helpers/edge-bay-settlement";

/** C9b: the campaign map's built-in victory rules, checked once per game second after the harbour (R17/R19/R34). */

const RULES = { commanderAllowed: false, disabledBuildings: [], lodgeAllowed: false };
const CARGO = { goods: [], settlers: 2, soldiers: [] };
const REGION: MapRegion = { id: "region-1", name: "Ford", shape: { kind: "rect", maxX: 20, maxZ: 20, minX: 10,
  minZ: 10 } };

const create = (world: WorldData, options: Partial<Parameters<typeof createSettlementSimulation>[0]> = {}) => {
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, clockStart: 0, roads, world, ...options });
  return simulation;
};

const PLOT = (() => {
  const home = create(edgeBayWorld(), { homeBuilding: HARBOUR_TYPE_ID, initialSettlers: 0 }).home()!;
  return { rotation: home.rotation, x: home.x, z: home.z };
})();

const enemy = (id: number, x: number, z: number): ScenarioUnit =>
  ({ faction: 1, group: 0, heading: 0, id, rank: 0, type: "shield", x, z });

const startRun = (victory: CampaignVictoryRule, units: ScenarioUnit[], outcomes: CampaignOutcomeRecord[]) => {
  const world = edgeBayWorld();
  world.scenario = { ...createMapScenario(), harbourPlot: PLOT, kind: "campaign", units };
  const map = { regions: [REGION], victory };
  return create(campaignRunWorld(world, RULES), { ...campaignStartOptions({ cargo: CARGO, map, nation: "roman" }),
    onCampaignOutcome: outcome => outcomes.push(outcome) });
};

const advance = (simulation: SettlementSimulation, ticks: number) => {
  for (let tick = 0; tick < ticks; tick++) simulation.update(0.05);
};

describe("campaign victory rules at runtime (C9b)", () => {
  it("wins eliminateArmy at the first second check when no enemy soldier lives, saved with the outcome", () => {
    const outcomes: CampaignOutcomeRecord[] = [];
    const run = startRun({ kind: "eliminateArmy" }, [], outcomes);
    expect(run.saveState().campaignMap?.victory).toEqual({ kind: "eliminateArmy" });
    advance(run, 25);
    expect(outcomes).toEqual([{ kind: "victory", reason: "rule", tick: 20 }]);
  });

  it("does not win eliminateArmy or totalVictory while an enemy soldier lives", () => {
    for (const kind of ["eliminateArmy", "totalVictory"] as const) {
      const outcomes: CampaignOutcomeRecord[] = [];
      advance(startRun({ kind }, [enemy(1, 10.5, 10.5)], outcomes), 60);
      expect(outcomes).toEqual([]);
    }
  });

  it("wins surviveTime at its second and keeps a reload identical", () => {
    const outcomes: CampaignOutcomeRecord[] = [];
    const run = startRun({ kind: "surviveTime", seconds: 3 }, [], outcomes);
    advance(run, 30);
    const reloaded = startRun({ kind: "surviveTime", seconds: 3 }, [], outcomes);
    expect(reloaded.loadState(structuredClone(run.saveState()))).toEqual({ ok: true });
    advance(reloaded, 40);
    expect(outcomes).toEqual([{ kind: "victory", reason: "rule", tick: 60 }]);
  });

  it("holds the landing harbour for its seconds when no enemy comes near", () => {
    const outcomes: CampaignOutcomeRecord[] = [];
    const run = startRun({ kind: "holdArea", seconds: 2, target: { kind: "landingHarbour" } },
      [enemy(1, 10.5, 10.5)], outcomes);
    advance(run, 41);
    expect(outcomes).toEqual([{ kind: "victory", reason: "rule", tick: 40 }]);
  });

  it("leaves surviveWaves to the map script", () => {
    const outcomes: CampaignOutcomeRecord[] = [];
    const run = startRun({ kind: "surviveWaves", waves: 1 }, [], outcomes);
    expect(run.saveState().campaignMap?.victory).toEqual({ kind: "scripted" });
    advance(run, 60);
    expect(outcomes).toEqual([]);
  });

  it("loses at a landing harbour that fell before the same tick's victory (R19)", () => {
    const outcomes: CampaignOutcomeRecord[] = [];
    const run = startRun({ kind: "eliminateArmy" }, [], []);
    const saved = structuredClone(run.saveState());
    saved.campaignMap = { ...saved.campaignMap!, harbour: 9999 };
    const lost = startRun({ kind: "eliminateArmy" }, [], outcomes);
    expect(lost.loadState(saved)).toEqual({ ok: true });
    advance(lost, 25);
    expect(outcomes).toEqual([{ kind: "defeat", reason: "harbourLost", tick: 0 }]);
  });

  it("refuses a hold on a region the map does not have", () => {
    expect(() => campaignVictoryCheck({ kind: "holdArea", seconds: 5, target: { kind: "region", regionId: "x" } }))
      .toThrow(/region x/);
  });
});

const site = (uid: number, typeId: number, militaryFaction: number) =>
  ({ militaryFaction, typeId, uid }) as SettlementBuilding;

const fakeWorld = (fields: Partial<CampaignVictoryWorld> = {}): CampaignVictoryWorld => ({
  actor: () => undefined, seconds: 0, soldiers: [], standing: () => true, targetUid: () => undefined, ...fields
});

describe("campaign victory predicates (C9b)", () => {
  const buildings = [site(1, HEADQUARTERS_TYPE_ID, 1), site(2, 20, 1), site(3, HEADQUARTERS_TYPE_ID, 0)];

  it("counts a fallen building as destroyed and ignores the player's own buildings", () => {
    const standing = (fallen: number[]) => (uid: number) => !fallen.includes(uid);
    const check = (kind: "destroyHeadquarters" | "totalVictory", fallen: number[]) =>
      campaignRuleMet({ kind }, { buildings }, fakeWorld({ standing: standing(fallen) }));
    expect(check("destroyHeadquarters", [])).toBe(false);
    expect(check("destroyHeadquarters", [1])).toBe(true);
    expect(check("totalVictory", [1])).toBe(false);
    expect(check("totalVictory", [1, 2])).toBe(true);
  });

  it("destroys a named target only once it resolves and has fallen", () => {
    const rule = { buildingId: 7, kind: "destroyTarget" } as const;
    expect(campaignRuleMet(rule, { buildings }, fakeWorld())).toBe(false);
    expect(campaignRuleMet(rule, { buildings }, fakeWorld({ standing: () => false, targetUid: () => 2 }))).toBe(true);
  });

  it("holds a region only with an own soldier inside and no enemy", () => {
    const check = campaignVictoryCheck({ kind: "holdArea", seconds: 5, target: { kind: "region",
      regionId: REGION.id } }, [REGION]);
    if (check.kind !== "hold") throw new Error("hold expected");
    const actors = new Map([[1, { x: 12, z: 12 }], [2, { x: 15, z: 15 }], [3, { x: 40, z: 40 }]]);
    const world = (soldiers: CampaignVictoryWorld["soldiers"]) =>
      fakeWorld({ actor: uid => actors.get(uid) as SettlementActor | undefined, soldiers });
    expect(campaignHoldsArea(check, world([]), undefined)).toBe(false);
    expect(campaignHoldsArea(check, world([{ actor: 1, faction: 0 }, { actor: 3, faction: 1 }]), undefined))
      .toBe(true);
    expect(campaignHoldsArea(check, world([{ actor: 1, faction: 0 }, { actor: 2, faction: 1 }]), undefined))
      .toBe(false);
  });
});
