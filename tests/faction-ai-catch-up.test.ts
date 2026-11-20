import { describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import { offlineEconomyStorage } from "../src/app/settlement/offline-economy";
import type { OfflineIslandMetrics } from "../src/app/settlement/offline-island-replay";
import { advanceOfflineGame, type OfflineReplayOptions } from "../src/app/settlement/offline-progress";
import { firstDueTick } from "../src/shared/settlement/commander/director-clock";
import { FACTION_AI_CLOCK_SLOTS, FACTION_AI_LAYER_TICKS } from "../src/shared/settlement/economy-ai/constants";
import { type DiscoveryBits, isCellDiscovered } from "../src/shared/settlement/faction-discovery";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { createFactionAiFixture } from "../tools/bench/faction-ai-fixture";
import { AI_FACTION, aiIslandSave, CATCH_UP_MODES, WOODCUTTER } from "./helpers/ai-island-save";

const MODULES = { createMapScenario, createRoadNetwork, createSettlementSimulation };
const AWAY_SECONDS = 120;
const TIMEOUT = 300_000;

const replay = async (source: GameSaveV1, options: OfflineReplayOptions) => {
  const metrics: OfflineIslandMetrics[] = [];
  const save = await advanceOfflineGame(structuredClone(source), source.savedAt + AWAY_SECONDS * 1000, () => {},
    { ...options, onIslandMetrics: value => metrics.push(value) });
  return { metrics, save };
};

const liveIsland = async (save: GameSaveV1) => {
  const loaded = await stageGameSession(structuredClone(save)), { world } = loaded.map;
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world),
    canWorkerEnterPlot: () => true });
  expect(simulation.loadState(loaded.settlement)).toEqual({ ok: true });
  return simulation;
};

const aiStock = (save: GameSaveV1) => offlineEconomyStorage(save, undefined, AI_FACTION).stock;
const playerStock = (save: GameSaveV1) => offlineEconomyStorage(save).stock;
const hashOf = (simulation: SettlementSimulation) =>
  hashText(canonicalJson({ ...simulation.saveState(), accumulator: 0 }));


describe("EAI5b: the economy AI during offline catch-up", () => {
  it("freezes the AI in every catch-up mode, then decides once on the first live tick", async () => {
    const source = await aiIslandSave(true);
    expect(source.settlement.factionAi).toHaveLength(1);
    const results = new Map<string, GameSaveV1>();
    for (const [name, options] of CATCH_UP_MODES) results.set(name, (await replay(source, options)).save);
    const exact = results.get("exact")!;
    for (const [name, save] of results) {
      expect(save.settlement.factionAi, `${name}: AI state frozen`).toEqual(source.settlement.factionAi);
      expect(save.settlement.gameTick, name).toBe(exact.settlement.gameTick);
    }
    // One decision pass on the first live tick (every layer came due), then each layer back on the faction's slot.
    const live = new Map<string, SettlementSimulation>();
    for (const [name, save] of results) live.set(name, await liveIsland(save));
    for (const [name, simulation] of live) {
      const now = simulation.gameTick();
      simulation.update(.05);
      const [state] = simulation.factionAiDiagnostics();
      expect(state!.decisions, name).toEqual([1, 1, 1, 1]);
      expect(state!.due, name).toEqual(FACTION_AI_LAYER_TICKS.map(period =>
        firstDueTick(AI_FACTION, now, period, FACTION_AI_CLOCK_SLOTS)));
      for (let step = 0; step < 400; step++) simulation.update(.05);
    }
    const exactLive = live.get("exact")!.saveState().factionAi;
    for (const [name, simulation] of live) expect(simulation.saveState().factionAi, name).toEqual(exactLive);
  }, TIMEOUT);

  it("keeps a develop faction's state, discovered cells included, identical in every catch-up mode", async () => {
    const source = await aiIslandSave(true, "develop");
    expect(source.settlement.factionAi?.[0]?.develop).toBeDefined();
    for (const [name, options] of CATCH_UP_MODES)
      expect((await replay(source, options)).save.settlement.factionAi, name).toEqual(source.settlement.factionAi);
  }, TIMEOUT);

  it("stamps no discovered cell while frozen and marks what each faction sees when thawed", () => {
    const { simulation } = createFactionAiFixture(MODULES, "develop");
    for (let step = 0; step < 20; step++) simulation.update(.05);
    const vision = simulation.factionVision(), track = vision.trackDiscovery;
    const tracked = new Map<number, DiscoveryBits | undefined>();
    vision.trackDiscovery = (faction, bits) => { tracked.set(faction, bits); track(faction, bits); };
    simulation.setFactionAiFrozen(true);
    expect([...tracked.values()].every(bits => bits === undefined)).toBe(true);
    expect(tracked.size).toBe(simulation.factionAiDiagnostics().length);
    simulation.setFactionAiFrozen(false);
    for (const [faction, bits] of tracked) {
      const layer = vision.layer(faction)!;
      expect(bits, `faction ${faction} stamps again`).toBeDefined();
      const unmarked = layer.filter((seen, cell) => seen > 0 && !isCellDiscovered(bits!, cell)).length;
      expect(unmarked, `faction ${faction}: every seen cell is discovered`).toBe(0);
    }
  });

  it("produces with the AI's own pool in the fast economy (per-owner pools)", async () => {
    const source = await aiIslandSave(true);
    const fast = (await replay(source, { economy: true, economyCalibrationSeconds: 0 })).save;
    const exact = (await replay(source, { exact: true, eventCore: false })).save;
    expect(aiStock(exact).logs ?? 0, "exact: the AI woodcutter fills its own depot").toBeGreaterThan(
      aiStock(source).logs ?? 0);
    expect(aiStock(fast).logs ?? 0, "fast: the AI woodcutter fills its own depot").toBeGreaterThan(
      aiStock(source).logs ?? 0);
    expect(playerStock(fast), "the player's pool gains nothing from the AI").toEqual(playerStock(source));
    const woodcutter = (save: GameSaveV1) =>
      save.settlement.buildings.find(building => building.typeId === WOODCUTTER)!;
    expect(woodcutter(fast).cycle).toBeGreaterThan(woodcutter(source).cycle);
  }, TIMEOUT);

  it("quiet-skips a frozen AI island exactly and stops before every due decision while live", async () => {
    const source = await aiIslandSave(false);
    const exact = await replay(source, { exact: true, eventCore: false });
    const quiet = await replay(source, { exact: true, quietSkip: true });
    expect(quiet.metrics[0]!.quietTicks, "the AI island is quiet while frozen").toBe(AWAY_SECONDS * 20 - 1);
    expect(quiet.save.settlement, "quiet = exact").toEqual(exact.save.settlement);

    // Live (not frozen): each skip ends before the AI's next due tick, which the fixed tick runs.
    const ticked = await liveIsland(source), skipped = await liveIsland(source);
    ticked.update(.05); skipped.update(.05);
    const end = ticked.gameTick() + 600;
    while (ticked.gameTick() < end) ticked.update(.05);
    let quietTicks = 0;
    while (skipped.gameTick() < end) {
      const advanced = skipped.advanceQuietTicks(end - skipped.gameTick());
      quietTicks += advanced;
      if (!advanced) skipped.update(.05);
    }
    expect(quietTicks).toBeGreaterThan(0);
    expect(skipped.factionAiDiagnostics()[0]!.decisions).toEqual(ticked.factionAiDiagnostics()[0]!.decisions);
    expect(hashOf(skipped)).toBe(hashOf(ticked));
  }, TIMEOUT);
});
