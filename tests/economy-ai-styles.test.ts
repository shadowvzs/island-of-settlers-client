import { describe, expect, it } from "vitest";

import { handicapText } from "../src/app/settlement/economy-ai-debug/helpers";
import { NEUTRAL_TALENT_MODIFIERS } from "../src/shared/progression/talents";
import { FACTION_AI_LAYERS } from "../src/shared/settlement/economy-ai/constants";
import { factionBonusTalents } from "../src/shared/settlement/faction-bonus";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import { productionTalentBonus, talentsOf } from "../src/shared/settlement/settlement-talents";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import type { ScenarioFactionAi } from "../src/shared/world/scenario-faction-ai";
import { economyCampaignScenario } from "./helpers/economy-factions";
import { huntingWorld, plantForestEdge } from "./helpers/hunting-world";

/** EAI5a: styles, level pace and the map's handicap on a small develop island (the EAI3a fixture). */
const AI = 2;
const WOODCUTTER = 17;
const DEPOT = { typeId: 0, x: 47, z: 46 };
const START_KIT = {
  settlers: 6, stock: { axe: 2, hammer: 3, logs: 12, planks: 40, pickaxe: 1, saw: 1, shovel: 1, stone: 30 }
};
const STRATEGIC = FACTION_AI_LAYERS.indexOf("strategic");
const RUN_TICKS = 3000;

type Setting = Partial<Pick<ScenarioFactionAi, "bonus" | "level" | "style">>;

const island = (setting: Setting = {}) => {
  const world = huntingWorld();
  plantForestEdge(world);
  const scenario = economyCampaignScenario([AI], "develop", "colony");
  scenario.factionAi![0] = { ...scenario.factionAi![0]!, ...setting };
  world.scenario = scenario;
  let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 0, initialSettlers: 8,
    roads, world });
  const depot = simulation.aiPlace(AI, DEPOT, START_KIT);
  expect(depot.ok, depot.reason).toBe(true);
  return simulation;
};

type Simulation = ReturnType<typeof island>;

const run = (simulation: Simulation, frames: readonly number[], ticks: number) => {
  for (let frame = 0; simulation.gameTick() < ticks; frame++)
    simulation.update(Math.min(frames[frame % frames.length]!, (ticks - simulation.gameTick()) * .05));
};

const stateHash = (simulation: Simulation) => hashText(canonicalJson({ ...simulation.saveState(), accumulator: 0 }));
const strategicDecisions = (simulation: Simulation) => simulation.factionAiDiagnostics()[0]!.decisions[STRATEGIC]!;
/** The AI's decisions: its sites, the roads and its saved state (as the EAI3a reload test compares them). */
const decisionsOf = (simulation: Simulation) => {
  const { factionAi, roads } = simulation.saveState();
  const sites = simulation.buildings().filter(building => building.militaryFaction === AI)
    .map(({ rotation, typeId, uid, x, z }) => ({ rotation, typeId, uid, x, z }));
  return { factionAi, roads, sites };
};
/** The tick the faction's first woodcutter stood finished, sampled every 20 ticks. */
const firstWoodcutterTick = (simulation: Simulation, limit: number) => {
  while (simulation.gameTick() < limit) {
    run(simulation, [.05], simulation.gameTick() + 20);
    if (simulation.buildings().some(building => building.militaryFaction === AI && building.typeId === WOODCUTTER &&
      building.construction >= 1)) return simulation.gameTick();
  }
  return Infinity;
};

describe("the map's handicap (bonus)", () => {
  const entries: ScenarioFactionAi[] = [{ faction: 1, mode: "develop" },
    { bonus: { construction: 200, production: 150, training: 300 }, faction: 2, mode: "develop" }];

  it("becomes the faction's talent modifiers; a faction without a bonus and the player keep theirs", () => {
    expect(factionBonusTalents([{ faction: 1, mode: "develop" }])).toBeUndefined();
    const context = { factionTalents: factionBonusTalents(entries) } as SettlementContext;
    expect(talentsOf(context, 1)).toBe(NEUTRAL_TALENT_MODIFIERS);
    expect(talentsOf(context, 0)).toBe(NEUTRAL_TALENT_MODIFIERS);
    expect(talentsOf(context, 2)).toMatchObject({ constructionSpeed: 1, fieldGrowthSpeed: .5, productionSpeed: .5,
      recruitTrainingSpeed: 2 });
    expect(productionTalentBonus(context, WOODCUTTER, 2) - productionTalentBonus(context, WOODCUTTER, 1)).toBe(.5);
  });

  it("is shown in the why panel", () => {
    expect(handicapText(entries[1]!.bonus)).toBe("construction +100 % · production +50 % · training +200 %");
    expect(handicapText({ production: 100 })).toBe("none");
    expect(handicapText(undefined)).toBe("none");
  });

  it("builds faster with a construction bonus", () => {
    const plain = firstWoodcutterTick(island(), RUN_TICKS);
    const handicapped = firstWoodcutterTick(island({ bonus: { construction: 300 } }), RUN_TICKS);
    expect(plain).toBeLessThan(Infinity);
    expect(handicapped).toBeLessThan(plain);
  });
});

describe("level pace and style posture", () => {
  it("decides more often the harder its level; medium keeps plan §3.3's 10 s", () => {
    const decisions = (["easy", "medium", "hard"] as const).map(level => {
      const simulation = island({ level });
      run(simulation, [.05], RUN_TICKS);
      return strategicDecisions(simulation);
    });
    expect(decisions[1]).toBe(Math.floor(RUN_TICKS / 200));
    expect(decisions[0]).toBeLessThan(decisions[1]!);
    expect(decisions[2]).toBeGreaterThan(decisions[1]!);
  });

  it("a turtle fortifies from its first strategic decision without any enemy; balanced and aggressive grow", () => {
    for (const [style, fortify] of [["turtle", true], ["balanced", undefined], ["aggressive", undefined]] as const) {
      const simulation = island({ style });
      run(simulation, [.05], 201);
      expect(simulation.saveState().factionAi?.[0]?.develop?.fortify, style).toBe(fortify);
    }
  });

  it("styles and levels decide the same at any frame rate and after a save and reload", () => {
    for (const setting of [{ level: "hard", style: "turtle" }, { level: "easy", style: "aggressive" }] as const) {
      const reference = island(setting);
      run(reference, [.05], RUN_TICKS);
      const other = island(setting);
      run(other, [.016, .05, .033, .1], RUN_TICKS);
      expect(stateHash(other)).toBe(stateHash(reference));
      const first = island(setting);
      run(first, [.05], 999);
      const saved = JSON.parse(JSON.stringify(first.saveState()));
      const reloaded = island(setting);
      expect(reloaded.loadState(saved)).toEqual({ ok: true });
      run(reloaded, [1 / 60], RUN_TICKS);
      expect(decisionsOf(reloaded)).toEqual(decisionsOf(reference));
    }
  });
});
